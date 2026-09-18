/**
 * Importação de áudio: decodificação, análise de tempo e picos de waveform.
 *
 * Duas fontes de áudio convivem no mesmo relógio:
 *   - Gravação inteira como "Mix" (um único arquivo)
 *   - Stems separados (vários arquivos: vocals.wav, drums.wav, ...)
 *
 * Beat tracking usa programação dinâmica estilo Ellis (2007):
 *   custo(i,j) = onset[j] − λ·(log₂(Δt·fps / τ))²
 * onde τ é o lag da autocorrelação global. Isso gera timestamps REAIS de
 * cada beat, seguindo o andamento variável de gravações ao vivo.
 *
 * O core já aceita BeatGrid com beats irregulares — essa é a ponte.
 */

import type { Beat, BeatGrid } from '@kronilab/core';
import type { StemKey } from './data.ts';

export interface TempoAnalysis {
  bpm: number;
  /** Segundos até o primeiro downbeat estimado. */
  firstDownbeatAt: number;
  /** 0..1 — quão destacado foi o pico de autocorrelação. */
  confidence: number;
  /** Alternativas por oitava, para o usuário corrigir num toque. */
  alternatives: number[];
}

export interface ImportedAudio {
  buffer: AudioBuffer;
  /** Amplitude por fatia de 1/40s, para desenhar a lane. */
  peaks: number[];
  fileName: string;
  bytes: number;
}

/** Resultado da importação de múltiplos stems. */
export interface StemImportResult {
  /** Stems reconhecidos pelo nome do arquivo. */
  stems: Map<StemKey, ImportedAudio>;
  /** Arquivos não reconhecidos como stem (ficam como Mix se for só 1). */
  unrecognized: File[];
}

const HOP = 512;
const FRAME = 1024;

// ---------------------------------------------------------------------------
// Importação de múltiplos stems por nome de arquivo
// ---------------------------------------------------------------------------

/** Mapa de padrões de nome de arquivo → StemKey. */
const STEM_NAME_MAP: Array<{ patterns: RegExp[]; key: StemKey }> = [
  { patterns: [/vocal/i, /voc\b/i, /voice/i, /lead/i], key: 'vocals' },
  { patterns: [/drum/i, /bat/i, /perc/i], key: 'drums' },
  { patterns: [/bass/i, /baix/i], key: 'bass' },
  { patterns: [/guitar/i, /guit/i, /viol/i], key: 'guitar' },
  { patterns: [/piano/i, /key/i, /teclado/i, /synth/i, /pad\b/i], key: 'keys' },
  { patterns: [/other/i, /outro/i, /misc/i], key: 'other' },
];

/**
 * Detecta o StemKey pelo nome do arquivo.
 * "piano.wav" → "keys"; "vocals.wav" → "vocals"; "outro.wav" → null
 * (não confundir "outro" como stem com "Outro" como seção).
 */
export function stemKeyFromFileName(name: string): StemKey | null {
  const base = name.replace(/\.[^.]+$/, '').toLowerCase();
  for (const { patterns, key } of STEM_NAME_MAP) {
    if (patterns.some((p) => p.test(base))) return key;
  }
  return null;
}

/**
 * Importa múltiplos arquivos de stem em paralelo.
 * Cada arquivo é mapeado por nome → StemKey.
 * Retorna stems reconhecidos e lista de não-reconhecidos.
 */
export async function importStemFiles(
  ctx: AudioContext,
  files: File[],
): Promise<StemImportResult> {
  const stems = new Map<StemKey, ImportedAudio>();
  const unrecognized: File[] = [];

  await Promise.all(
    files.map(async (file) => {
      const key = stemKeyFromFileName(file.name);
      if (!key) {
        unrecognized.push(file);
        return;
      }
      const buffer = await decodeAudioFile(ctx, file);
      const audio: ImportedAudio = {
        buffer,
        peaks: computeBufferPeaks(buffer),
        fileName: file.name,
        bytes: file.size,
      };
      stems.set(key, audio);
    }),
  );

  return { stems, unrecognized };
}

// ---------------------------------------------------------------------------
// Decodificação e picos
// ---------------------------------------------------------------------------

export async function decodeAudioFile(ctx: AudioContext, file: File | Blob): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  return ctx.decodeAudioData(bytes);
}

export function computeBufferPeaks(buffer: AudioBuffer, samplesPerSecond = 40): number[] {
  const mono = toMono(buffer);
  const step = Math.floor(buffer.sampleRate / samplesPerSecond);
  const count = Math.ceil(mono.length / step);
  const peaks = new Array<number>(count).fill(0);
  for (let i = 0; i < count; i++) {
    let max = 0;
    const end = Math.min(mono.length, (i + 1) * step);
    for (let j = i * step; j < end; j++) {
      const v = Math.abs(mono[j]!);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  // Normaliza pelo pico global: gravação baixa não vira lane vazia.
  const top = Math.max(0.05, ...peaks);
  return peaks.map((p) => p / top);
}

// ---------------------------------------------------------------------------
// Beat tracking com andamento variável — Ellis (2007)
// ---------------------------------------------------------------------------

/**
 * Rastreia beats com andamento variável.
 *
 * Algoritmo de programação dinâmica (Ellis, 2007):
 *   - Calcula o lag global τ por autocorrelação
 *   - Para cada frame de onset, avalia o custo de "beat aqui" dado o
 *     beat anterior: score[i] = onset[i] − λ·(log₂(Δt·fps/τ))²
 *   - Backtrack do frame de maior energia para trás
 *   - Downbeat: grupo de 4 beats com maior energia grave = o "1"
 *
 * Retorna Beat[] compatível com o core (grade irregular OK).
 */
export function trackBeats(buffer: AudioBuffer): Beat[] {
  const sr = buffer.sampleRate;
  const mono = toMono(buffer);
  const { full: onset, low } = onsetEnvelope(mono);
  const fps = sr / HOP;
  const n = onset.length;

  // 1. Lag global por autocorrelação (τ = período médio dos beats)
  const tau = globalLag(onset, fps);
  if (tau < 1) return [];

  // 2. Programação dinâmica estilo Ellis
  //    tightness λ: quanto penaliza desvios do período global
  //    100 = flexível (ao vivo); 400 = rígido (estúdio)
  const lambda = 100.0;
  const score = new Float32Array(n);
  const prev = new Int32Array(n).fill(-1);

  score[0] = onset[0]!;
  for (let i = 1; i < n; i++) {
    // Janela de busca: 0.5τ … 2τ atrás
    const lo = Math.max(0, Math.round(i - tau * 2));
    const hi = Math.max(0, Math.round(i - tau * 0.5));
    let bestScore = -Infinity;
    let bestJ = lo;
    for (let j = lo; j <= hi; j++) {
      const dt = i - j; // em frames
      const deviation = Math.log2(dt / tau);
      const cost = score[j]! - lambda * deviation * deviation;
      if (cost > bestScore) { bestScore = cost; bestJ = j; }
    }
    score[i] = onset[i]! + bestScore;
    prev[i] = bestJ;
  }

  // 3. Backtrack a partir do frame de maior score
  const beatFrames: number[] = [];
  let cur = score.indexOf(Math.max(...score));
  while (cur > 0 && prev[cur] !== undefined && prev[cur]! >= 0) {
    beatFrames.push(cur);
    cur = prev[cur]!;
  }
  beatFrames.push(cur);
  beatFrames.reverse();

  if (beatFrames.length === 0) return [];

  // 4. Converte frames → timestamps
  const beatTimes = beatFrames.map((f) => (f * HOP + FRAME / 2) / sr);

  // 5. Downbeat: qual dos 4 beats tem mais energia grave
  const lowAtBeats = beatFrames.map((f) => low[Math.min(f, low.length - 1)]!);
  const phase = bestDownbeatPhase(lowAtBeats, 4);

  // 6. Monta objetos Beat
  const beats: Beat[] = [];
  let bar = 1;
  for (let i = 0; i < beatTimes.length; i++) {
    const beatInBar = ((i - phase + beatTimes.length * 4) % 4) + 1;
    if (beatInBar === 1 && i > 0) bar++;
    beats.push({
      index: i,
      bar,
      beat: beatInBar,
      timestamp: Math.round(beatTimes[i]! * 1e6) / 1e6,
      downbeat: beatInBar === 1,
    });
  }
  return beats;
}

/**
 * Constrói um BeatGrid direto dos beats rastreados.
 * Compatível com a interface do @kronilab/core.
 */
export function buildBeatGridFromBeats(beats: Beat[], duration: number): BeatGrid {
  return {
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    beats,
    duration,
  };
}

// ---------------------------------------------------------------------------
// Análise de BPM fixo (legado: para músicas de estúdio e as alternativas)
// ---------------------------------------------------------------------------

/** BPM e primeiro downbeat a partir do áudio (grade fixa). */
export function analyzeTempo(buffer: AudioBuffer): TempoAnalysis {
  const sr = buffer.sampleRate;
  const mono = toMono(buffer);
  const { full: onset, low } = onsetEnvelope(mono);
  const fps = sr / HOP;

  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 55) * fps);
  const n = onset.length;
  const scores = new Float32Array(maxLag + 1);
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += onset[i]! * onset[i + lag]!;
    const bpm = (60 * fps) / lag;
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
    scores[lag] = (sum / (n - lag)) * weight;
    if (scores[lag]! > scores[best]!) best = lag;
  }

  const y0 = scores[best - 1] ?? scores[best]!;
  const y1 = scores[best]!;
  const y2 = scores[best + 1] ?? scores[best]!;
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const lag = best + shift;
  const bpm = Math.round(((60 * fps) / lag) * 10) / 10;

  const mean = scores.slice(minLag).reduce((a, b) => a + b, 0) / (maxLag - minLag + 1);
  const confidence = mean > 0 ? Math.min(1, Math.max(0, (y1 - mean) / (y1 + 1e-9))) : 0;

  const firstDownbeatAt = findFirstDownbeat(onset, low, lag, fps);

  const alternatives = [bpm / 2, bpm * 2, (bpm * 3) / 2, (bpm * 2) / 3]
    .map((b) => Math.round(b * 10) / 10)
    .filter((b) => b >= 50 && b <= 220 && Math.abs(b - bpm) > 1);

  return { bpm, firstDownbeatAt, confidence, alternatives };
}

/** Recalcula só o primeiro downbeat, para quando o usuário corrige o BPM. */
export function refineDownbeat(buffer: AudioBuffer, bpm: number): number {
  const { full, low } = onsetEnvelope(toMono(buffer));
  const fps = buffer.sampleRate / HOP;
  return findFirstDownbeat(full, low, (60 * fps) / bpm, fps);
}

// ---------------------------------------------------------------------------
// Funções auxiliares (privadas)
// ---------------------------------------------------------------------------

/** Lag global por autocorrelação do envelope de onset. */
function globalLag(onset: Float32Array, fps: number): number {
  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 55) * fps);
  const n = onset.length;
  let best = minLag;
  let bestVal = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += onset[i]! * onset[i + lag]!;
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
    const v = (sum / (n - lag)) * w;
    if (v > bestVal) { bestVal = v; best = lag; }
  }
  return best;
}

/** Fase do downbeat com mais energia grave entre os grupos de 4 beats. */
function bestDownbeatPhase(lowAtBeats: number[], beatsPerBar: number): number {
  let bestPhase = 0;
  let bestSum = -1;
  for (let phase = 0; phase < beatsPerBar; phase++) {
    let sum = 0;
    for (let i = phase; i < lowAtBeats.length; i += beatsPerBar) sum += lowAtBeats[i]!;
    if (sum > bestSum) { bestSum = sum; bestPhase = phase; }
  }
  return bestPhase;
}

function findFirstDownbeat(onset: Float32Array, low: Float32Array, lag: number, fps: number): number {
  const window = Math.min(onset.length, Math.floor(fps * 40));
  const period = Math.max(1, Math.round(lag));
  let bestPhase = 0;
  let bestSum = -1;
  for (let phase = 0; phase < period; phase++) {
    let sum = 0;
    for (let i = phase; i < window; i += period) sum += onset[i]! + (onset[i + 1] ?? 0) * 0.5;
    if (sum > bestSum) { bestSum = sum; bestPhase = phase; }
  }
  let bestBar = 0;
  let bestBarSum = -1;
  for (let m = 0; m < 4; m++) {
    let sum = 0;
    for (let i = bestPhase + m * period; i < window; i += period * 4) {
      sum += low[i]! + (low[i + 1] ?? 0) * 0.5 + (low[i - 1] ?? 0) * 0.5;
    }
    if (sum > bestBarSum) { bestBarSum = sum; bestBar = m; }
  }
  const frame = bestPhase + bestBar * period;
  return Math.max(0, (frame * HOP - FRAME / 2) / (fps * HOP));
}

function onsetEnvelope(mono: Float32Array): { full: Float32Array; low: Float32Array } {
  const frames = Math.max(1, Math.floor((mono.length - FRAME) / HOP));
  const full = new Float32Array(frames);
  const lowEnv = new Float32Array(frames);
  let prevLow = 0;
  let prevHigh = 0;
  let lp = 0;
  const a = 0.02;
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    let low = 0;
    let high = 0;
    let last = mono[start]!;
    for (let i = start; i < start + FRAME; i++) {
      const v = mono[i]!;
      lp += a * (v - lp);
      low += lp * lp;
      const d = v - last;
      high += d * d;
      last = v;
    }
    low = Math.log1p((low / FRAME) * 4000);
    high = Math.log1p((high / FRAME) * 4000);
    full[f] = Math.max(0, low - prevLow) + 1.6 * Math.max(0, high - prevHigh);
    lowEnv[f] = Math.max(0, low - prevLow);
    prevLow = low;
    prevHigh = high;
  }
  return { full: detrend(full), low: detrend(lowEnv) };
}

function detrend(env: Float32Array): Float32Array {
  const frames = env.length;
  const smooth = new Float32Array(frames);
  const radius = 8;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = f + k;
      if (idx >= 0 && idx < frames) { sum += env[idx]!; count++; }
    }
    smooth[f] = Math.max(0, env[f]! - sum / count);
  }
  return smooth;
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + data[i]! / buffer.numberOfChannels;
  }
  return out;
}

/** Título a partir do nome do arquivo: "03 - Rio (ao vivo).mp3" → "Rio (ao vivo)". */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d+\s*[-._]\s*/, '')
    .replace(/[_]+/g, ' ')
    .trim() || 'Sem título';
}
