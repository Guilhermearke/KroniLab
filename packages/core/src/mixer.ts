/**
 * Mixer e presets por instrumento (item 18).
 *
 * O baterista abre a musica e a bateria ja esta em 0: ele estuda tocando por
 * cima. Isso vale para todo instrumento e funciona nos dois layouts de stems.
 */
import type { Instrument, StemId, StemLayout } from './types.ts';

export const SIX_STEMS: StemId[] = ['vocals', 'drums', 'bass', 'guitar', 'keys', 'other'];
export const FOUR_STEMS: StemId[] = ['vocals', 'drums', 'bass', 'other'];
export const AUX_STEMS: StemId[] = ['click', 'guide'];

export function stemsFor(layout: StemLayout): StemId[] {
  return [...(layout === 'six' ? SIX_STEMS : FOUR_STEMS), ...AUX_STEMS];
}

export const STEM_LABELS: Record<StemId, string> = {
  vocals: 'Vocais',
  drums: 'Bateria',
  bass: 'Baixo',
  guitar: 'Guitarra',
  keys: 'Teclado',
  other: 'Outros',
  click: 'Click',
  guide: 'Guia',
};

/**
 * De qual stem cada instrumento "e dono".
 * No layout de 4 stems, guitarra e teclado caem em `other` — e ai remover o
 * proprio instrumento levaria junto o resto do arranjo. `ownStem` devolve null
 * nesse caso e a UI explica em vez de mentir.
 */
export function ownStem(instrument: Instrument, layout: StemLayout): StemId | null {
  switch (instrument) {
    case 'VOCAL':
    case 'MINISTRO':
      return 'vocals';
    case 'BATERIA':
      return 'drums';
    case 'BAIXO':
      return 'bass';
    case 'GUITARRA':
    case 'VIOLAO':
      return layout === 'six' ? 'guitar' : null;
    case 'TECLADO':
      return layout === 'six' ? 'keys' : null;
    default:
      return null;
  }
}

export type Mix = Record<StemId, number>;

export function fullMix(layout: StemLayout): Mix {
  const mix = {} as Mix;
  for (const s of stemsFor(layout)) mix[s] = 1;
  return mix;
}

/** Mix inicial do modo estudo, ja adaptado ao instrumento do membro. */
export function studyPreset(instrument: Instrument | null, layout: StemLayout): Mix {
  const mix = fullMix(layout);
  if (!instrument) return mix;
  const own = ownStem(instrument, layout);
  if (own) mix[own] = 0;
  return mix;
}

export function toggleOwnInstrument(mix: Mix, instrument: Instrument | null, layout: StemLayout): Mix {
  const own = instrument ? ownStem(instrument, layout) : null;
  if (!own) return { ...mix };
  return { ...mix, [own]: mix[own] > 0 ? 0 : 1 };
}

/**
 * Ganho final de cada stem considerando solo/mute.
 * Solo em qualquer stem silencia os demais — regra de mesa, nao de player.
 */
export function resolveGains(opts: {
  layout: StemLayout;
  volumes: Mix;
  muted: StemId[];
  soloed: StemId[];
}): Mix {
  const out = {} as Mix;
  const soloActive = opts.soloed.length > 0;
  for (const stem of stemsFor(opts.layout)) {
    const vol = opts.volumes[stem] ?? 1;
    const isMuted = opts.muted.includes(stem);
    const isSolo = opts.soloed.includes(stem);
    out[stem] = isMuted || (soloActive && !isSolo) ? 0 : vol;
  }
  return out;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : Math.round(20 * Math.log10(gain) * 10) / 10;
}
