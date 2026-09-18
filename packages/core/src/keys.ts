/** Tons, semitons e transposicao. Base para o ministro definir o tom do culto. */
import type { KeyMode, MusicalKey } from './types.ts';

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const ALIASES: Record<string, number> = {
  'B#': 0, 'Cb': 11, 'E#': 5, 'Fb': 4,
  'C##': 2, 'Dbb': 0,
};

/** Tons que a igreja brasileira escreve com bemol — evita exibir 'A#'. */
const PREFER_FLAT = new Set([1, 3, 6, 8, 10]);

export function pitchClass(key: MusicalKey): number {
  const k = normalizeSpelling(key);
  const i = SHARP.indexOf(k);
  if (i >= 0) return i;
  const j = FLAT.indexOf(k);
  if (j >= 0) return j;
  const alias = ALIASES[k];
  if (alias !== undefined) return alias;
  throw new Error(`Tom invalido: ${key}`);
}

function normalizeSpelling(key: string): string {
  const t = key.trim();
  if (!t) throw new Error('Tom vazio');
  const head = t[0]!.toUpperCase();
  return head + t.slice(1).replace(/♯/g, '#').replace(/♭/g, 'b');
}

/** Distancia em semitons de `from` para `to`, sempre no intervalo (-6, 6]. */
export function semitonesBetween(from: MusicalKey, to: MusicalKey): number {
  const raw = (pitchClass(to) - pitchClass(from) + 12) % 12;
  return raw > 6 ? raw - 12 : raw;
}

export function transposeKey(key: MusicalKey, semitones: number, prefer?: 'sharp' | 'flat'): MusicalKey {
  const pc = (pitchClass(key) + (semitones % 12) + 12) % 12;
  return spell(pc, prefer);
}

export function spell(pitchClassValue: number, prefer?: 'sharp' | 'flat'): MusicalKey {
  const pc = ((pitchClassValue % 12) + 12) % 12;
  if (prefer === 'sharp') return SHARP[pc]!;
  if (prefer === 'flat') return FLAT[pc]!;
  return PREFER_FLAT.has(pc) ? FLAT[pc]! : SHARP[pc]!;
}

export function formatKey(key: MusicalKey, mode: KeyMode = 'major'): string {
  return mode === 'minor' ? `${key}m` : key;
}

/**
 * Tons candidatos ao redor do original, para o ministro testar (item 16).
 * Ex.: B -> Bb, B, C, Db.
 */
export function candidateKeys(original: MusicalKey, spread = 2): MusicalKey[] {
  const out: MusicalKey[] = [];
  for (let s = -spread; s <= spread; s++) out.push(transposeKey(original, s));
  return out;
}

/** Semitons que o player precisa aplicar (pitch shift sem mexer no tempo). */
export function pitchShiftFor(originalKey: MusicalKey, selectedKey: MusicalKey | null): number {
  if (!selectedKey) return 0;
  return semitonesBetween(originalKey, selectedKey);
}

/** Um salto grande demais degrada o audio — a UI avisa antes de confirmar. */
export function isPitchShiftSafe(semitones: number): boolean {
  return Math.abs(semitones) <= 4;
}
