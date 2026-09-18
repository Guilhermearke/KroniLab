/**
 * Detecção de estrutura musical no navegador.
 *
 * Pipeline:
 *   chroma por compasso → auto-similaridade (cosseno) →
 *   curva de novidade (kernel Foote) → limites → agrupamento →
 *   rótulos pt-BR (Intro / Verso / Refrão / Ponte / Final).
 *
 * Tudo em TypeScript puro — sem WebAssembly, sem WASM, sem FFT externa.
 * Usa DFT manual nos 12 bins de nota (suficiente para chroma).
 *
 * Ref: Foote (2000) — "Automatic Audio Segmentation Using a Measure of
 *      Audio Novelty". ICME 2000.
 */

import type { Beat } from '@kronilab/core';
import type { StoredSection } from './store.ts';

// ---------------------------------------------------------------------------
// Chroma por compasso
// ---------------------------------------------------------------------------

/** Frequências das 12 notas na oitava de referência (A4 = 440 Hz). */
const NOTE_FREQS: number[] = Array.from({ length: 12 }, (_, i) =>
  440 * Math.pow(2, (i - 9) / 12), // C4=261.6, C#4=277.2, ...
);

/**
 * Calcula o vetor chroma de 12 bins de um bloco de samples.
 * Usa DFT nos 12 bins de nota (múltiplas oitavas, 3..7).
 */
function chromaFrame(samples: Float32Array, sr: number): Float32Array {
  const chroma = new Float32Array(12);
  for (let pc = 0; pc < 12; pc++) {
    let energy = 0;
    // Soma a energia das oitavas 3 a 7 (range vocal/instrumental)
    for (let oct = 3; oct <= 7; oct++) {
      const freq = NOTE_FREQS[pc]! * Math.pow(2, oct - 4);
      const k = freq / sr; // frequência normalizada
      let re = 0;
      let im = 0;
      const N = samples.length;
      for (let n = 0; n < N; n++) {
        const angle = 2 * Math.PI * k * n;
        re += samples[n]! * Math.cos(angle);
        im += samples[n]! * Math.sin(angle);
      }
      energy += re * re + im * im;
    }
    chroma[pc] = energy;
  }
  // Normaliza pelo L2 norm
  const norm = Math.sqrt(chroma.reduce((s, v) => s + v * v, 0));
  if (norm > 1e-8) for (let i = 0; i < 12; i++) chroma[i] = chroma[i]! / norm;
  return chroma;
}

/**
 * Calcula o vetor chroma por compasso, usando downsampling para performance.
 * Não roda DFT em cada sample — usa até 2048 samples por compasso.
 */
export function computeChromaPerBar(buffer: AudioBuffer, beats: Beat[]): Float32Array[] {
  const sr = buffer.sampleRate;
  const mono = toMono(buffer);
  const downbeats = beats.filter((b) => b.downbeat);
  if (downbeats.length === 0) return [];

  return downbeats.map((db, i) => {
    const start = Math.floor(db.timestamp * sr);
    const next = downbeats[i + 1];
    const end = next ? Math.floor(next.timestamp * sr) : mono.length;
    // Limita a 2048 samples para performance (suficiente para chroma)
    const stride = Math.max(1, Math.floor((end - start) / 2048));
    const seg: number[] = [];
    for (let s = start; s < end; s += stride) seg.push(mono[s]!);
    return chromaFrame(new Float32Array(seg), sr / stride);
  });
}

// ---------------------------------------------------------------------------
// Auto-similaridade
// ---------------------------------------------------------------------------

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 1e-8 ? dot / d : 0;
}

/** Matriz N×N de similaridade de cosseno entre compassos. */
export function selfSimilarity(chroma: Float32Array[]): number[][] {
  const n = chroma.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => cosine(chroma[i]!, chroma[j]!)),
  );
}

// ---------------------------------------------------------------------------
// Curva de novidade (Foote checker-board kernel)
// ---------------------------------------------------------------------------

/** Curva de novidade: picos = transições entre seções. */
export function noveltyCurve(sim: number[][], kernelSize = 8): number[] {
  const n = sim.length;
  const k = Math.min(kernelSize, Math.floor(n / 2));
  const novelty: number[] = [];

  for (let i = 0; i < n; i++) {
    let val = 0;
    for (let di = 0; di < k; di++) {
      for (let dj = 0; dj < k; dj++) {
        const r1 = i - di;
        const c1 = i - dj;
        const r2 = i + di;
        const c2 = i + dj;
        if (r1 >= 0 && c1 >= 0 && r2 < n && c2 < n) {
          // Checker-board: quadrantes diagonais = +1, cruzados = -1
          const sign = ((di < k / 2) === (dj < k / 2)) ? 1 : -1;
          val += sign * (sim[r2]![c2]! - sim[r1]![c1]!);
        }
      }
    }
    novelty.push(val);
  }

  // Normaliza 0..1
  const min = Math.min(...novelty);
  const max = Math.max(...novelty);
  const rng = max - min;
  return rng > 1e-8 ? novelty.map((v) => (v - min) / rng) : novelty.map(() => 0);
}

// ---------------------------------------------------------------------------
// Limites de seção
// ---------------------------------------------------------------------------

/** Picos locais da curva de novidade → limites de seção. */
export function findBoundaries(novelty: number[], minBars = 4): number[] {
  const n = novelty.length;
  const boundaries: number[] = [];
  let last = 0;
  for (let i = 1; i < n - 1; i++) {
    if (
      novelty[i]! > novelty[i - 1]! &&
      novelty[i]! > novelty[i + 1]! &&
      novelty[i]! > 0.3 &&
      i - last >= minBars
    ) {
      boundaries.push(i + 1); // 1-based
      last = i;
    }
  }
  return boundaries;
}

// ---------------------------------------------------------------------------
// Agrupamento e rotulação
// ---------------------------------------------------------------------------

/** Agrupa segmentos por similaridade de chroma. Retorna array de IDs de grupo. */
function groupSegments(
  segments: Array<[number, number]>,
  chroma: Float32Array[],
): number[] {
  const threshold = 0.85;
  // Chroma médio de cada segmento
  const segChroma: Float32Array[] = segments.map(([start, end]) => {
    const bars = chroma.slice(start - 1, end - 1);
    if (bars.length === 0) return new Float32Array(12);
    const avg = new Float32Array(12);
    for (const c of bars) for (let i = 0; i < 12; i++) avg[i] = (avg[i]! + c[i]!) / bars.length;
    return avg;
  });

  const groups = new Array<number>(segments.length).fill(-1);
  let nextGroup = 0;
  for (let i = 0; i < segments.length; i++) {
    if (groups[i] >= 0) continue;
    groups[i] = nextGroup;
    for (let j = i + 1; j < segments.length; j++) {
      if (groups[j] >= 0) continue;
      if (cosine(segChroma[i]!, segChroma[j]!) >= threshold) groups[j] = nextGroup;
    }
    nextGroup++;
  }
  return groups;
}

const PT_BR: Record<string, string> = {
  Intro: 'Intro', Verse: 'Verso', PreChorus: 'Pré-refrão',
  Chorus: 'Refrão', Bridge: 'Ponte', Instrumental: 'Instrumental',
  Solo: 'Solo', Break: 'Break', Outro: 'Final',
};

/**
 * Detecta seções da música a partir do buffer e dos beats.
 * Retorna StoredSection[] pronto para o IndexedDB.
 */
export function detectSections(buffer: AudioBuffer, beats: Beat[]): StoredSection[] {
  // 1. Chroma por compasso
  const chroma = computeChromaPerBar(buffer, beats);
  const nBars = chroma.length;
  if (nBars < 4) {
    return [{ type: 'Verse', label: 'Música', bars: nBars }];
  }

  // 2. Auto-similaridade
  const sim = selfSimilarity(chroma);

  // 3. Curva de novidade
  const novelty = noveltyCurve(sim, Math.min(8, Math.floor(nBars / 4)));

  // 4. Limites
  let boundaries = findBoundaries(novelty, 4);
  if (!boundaries.length || boundaries[0] !== 1) boundaries = [1, ...boundaries];
  if (boundaries[boundaries.length - 1] !== nBars + 1) boundaries.push(nBars + 1);

  const segments: Array<[number, number]> = boundaries
    .slice(0, -1)
    .map((start, i) => [start, boundaries[i + 1]!]);

  // 5. Agrupa por similaridade
  const groups = groupSegments(segments, chroma);

  // 6. Conta ocorrências por grupo (exceto primeiro e último = Intro/Final)
  const inner = groups.slice(1, -1);
  const countMap = new Map<number, number>();
  for (const g of inner) countMap.set(g, (countMap.get(g) ?? 0) + 1);

  // Grupo mais repetido = Refrão
  let chorusGroup = -1;
  let maxCount = 0;
  for (const [g, c] of countMap) {
    if (c > maxCount) { maxCount = c; chorusGroup = g; }
  }

  // 7. Monta StoredSection[]
  const sections: StoredSection[] = [];
  const seq: Record<string, number> = {};
  for (let i = 0; i < segments.length; i++) {
    const [start, end] = segments[i]!;
    const g = groups[i]!;
    let type: StoredSection['type'];
    if (i === 0) type = 'Intro';
    else if (i === segments.length - 1) type = 'Outro';
    else if (g === chorusGroup) type = 'Chorus';
    else type = 'Verse';

    seq[type] = (seq[type] ?? 0) + 1;
    const base = PT_BR[type] ?? type;
    const label = seq[type]! > 1 ? `${base} ${seq[type]}` : base;
    sections.push({ type, label, bars: end - start });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] = (out[i]! + data[i]!) / buffer.numberOfChannels;
  }
  return out;
}
