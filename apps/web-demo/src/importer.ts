/**
 * Importar musica: um arquivo de audio vira uma musica com beat grid.
 *
 * O que sai daqui e o que o worker de IA entrega no produto, so que sem os
 * stems: BPM, tempo do primeiro beat, duracao e a forma de onda. Com isso o
 * Studio ja toca a gravacao com click e guia por cima, e o Live Mode salta
 * entre secoes na batida. A separacao em stems e o unico passo que precisa
 * de GPU — e por isso fica no worker, nao no navegador.
 *
 * A deteccao de BPM e classica (envelope de onsets + autocorrelacao) e acerta
 * a grande maioria das musicas de louvor, que tem bateria marcada. Quando
 * erra, erra por oitava (72 vs 144) — e a tela deixa corrigir com um toque.
 */

export interface TempoAnalysis {
  bpm: number;
  /** Segundos ate o primeiro downbeat estimado. */
  firstDownbeatAt: number;
  /** 0..1 — quao destacado foi o pico de autocorrelacao. */
  confidence: number;
  /** Alternativas por oitava, para o usuario corrigir num toque. */
  alternatives: number[];
}

export interface ImportedAudio {
  buffer: AudioBuffer;
  /** Amplitude por fatia de 1/40s, para desenhar a lane. */
  peaks: number[];
  fileName: string;
  bytes: number;
}

const HOP = 512;
const FRAME = 1024;

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
  // Normaliza pelo pico global: gravacao baixa nao vira lane vazia.
  const top = Math.max(0.05, ...peaks);
  return peaks.map((p) => p / top);
}

/** BPM e primeiro downbeat a partir do audio. */
export function analyzeTempo(buffer: AudioBuffer): TempoAnalysis {
  const sr = buffer.sampleRate;
  const mono = toMono(buffer);
  const { full: onset, low } = onsetEnvelope(mono);
  const fps = sr / HOP;

  // Autocorrelacao so na faixa musical util. Fora dela e ruido de analise.
  const minLag = Math.floor((60 / 200) * fps);
  const maxLag = Math.ceil((60 / 55) * fps);
  const n = onset.length;
  const scores = new Float32Array(maxLag + 1);
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += onset[i]! * onset[i + lag]!;
    // Preferencia suave por andamentos entre 70 e 150 BPM (Ellis, 2007).
    const bpm = (60 * fps) / lag;
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
    scores[lag] = (sum / (n - lag)) * weight;
    if (scores[lag]! > scores[best]!) best = lag;
  }

  // Refina o lag por interpolacao parabolica: da BPM com casa decimal.
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

/** Recalcula so o primeiro downbeat, para quando o usuario corrige o BPM. */
export function refineDownbeat(buffer: AudioBuffer, bpm: number): number {
  const { full, low } = onsetEnvelope(toMono(buffer));
  const fps = buffer.sampleRate / HOP;
  return findFirstDownbeat(full, low, (60 * fps) / bpm, fps);
}

/**
 * Fase do beat: entre as posicoes possiveis dentro de um periodo, a que
 * acumula mais energia de onset e o beat. Entre os 4 beats do compasso, o "1"
 * e o que tem mais GRAVE: o bumbo acentua o 1, a caixa (aguda) marca 2 e 4 —
 * olhar o envelope cheio escolheria a caixa. Vale para musica marcada; para
 * a balada sem bateria o usuario ajusta na tela.
 */
function findFirstDownbeat(onset: Float32Array, low: Float32Array, lag: number, fps: number): number {
  const window = Math.min(onset.length, Math.floor(fps * 40)); // 40 s bastam
  const period = Math.max(1, Math.round(lag));
  let bestPhase = 0;
  let bestSum = -1;
  for (let phase = 0; phase < period; phase++) {
    let sum = 0;
    for (let i = phase; i < window; i += period) sum += onset[i]! + (onset[i + 1] ?? 0) * 0.5;
    if (sum > bestSum) { bestSum = sum; bestPhase = phase; }
  }
  // Compasso: qual dos 4 beats a partir da fase soa como o "1" (no grave).
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
  // A energia do onset e medida no fim do quadro; o ataque esta um pouco antes.
  return Math.max(0, (frame * HOP - FRAME / 2) / (fps * HOP));
}

/**
 * Envelopes de onset: variacao positiva da energia entre quadros.
 *   full — grave + agudo (peso extra no agudo, onde caixa e chimbal vivem):
 *          e o que da o BPM e a fase do beat;
 *   low  — so o grave (bumbo, baixo): e o que diz onde esta o "1".
 */
function onsetEnvelope(mono: Float32Array): { full: Float32Array; low: Float32Array } {
  const frames = Math.max(1, Math.floor((mono.length - FRAME) / HOP));
  const full = new Float32Array(frames);
  const lowEnv = new Float32Array(frames);
  let prevLow = 0;
  let prevHigh = 0;
  // Passa-baixas de um polo (~150 Hz a 44.1k) para isolar o bumbo.
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
      const d = v - last; // derivada ~ passa-altas de primeira ordem
      high += d * d;
      last = v;
    }
    low = Math.log1p(low / FRAME * 4000);
    high = Math.log1p(high / FRAME * 4000);
    full[f] = Math.max(0, low - prevLow) + 1.6 * Math.max(0, high - prevHigh);
    lowEnv[f] = Math.max(0, low - prevLow);
    prevLow = low;
    prevHigh = high;
  }
  return { full: detrend(full), low: detrend(lowEnv) };
}

/** Remove a media local: sem isso um crescendo longo parece um onset. */
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

/** Titulo a partir do nome do arquivo: "03 - Rio (ao vivo).mp3" -> "Rio (ao vivo)". */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d+\s*[-._]\s*/, '')
    .replace(/[_]+/g, ' ')
    .trim() || 'Sem título';
}
