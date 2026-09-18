/**
 * Transicao entre musicas e pads (itens de palco que o operador configura).
 *
 * A banda nao para entre uma musica e outra: ou emenda, ou o pad segura o tom
 * ate a proxima entrar. Quem decide isso e o ministro, musica a musica, e a
 * configuracao vive no culto — nunca na musica.
 */
import { semitonesBetween } from './keys.ts';
import type { MusicalKey } from './types.ts';

export type TransitionMode =
  /** Termina e espera o operador. */
  | 'stop'
  /** Emenda direto na proxima, sem silencio. */
  | 'auto'
  /** Sobrepoe o fim de uma com o comeco da outra. */
  | 'crossfade'
  /** A musica termina, o pad segura o tom ate a proxima comecar. */
  | 'pad';

export const TRANSITION_LABEL: Record<TransitionMode, string> = {
  stop: 'Parar',
  auto: 'Emendar',
  crossfade: 'Crossfade',
  pad: 'Segurar no pad',
};

export interface PadPlan {
  fromKey: MusicalKey | null;
  toKey: MusicalKey;
  /** Distancia da troca; 0 quando o tom nao muda. */
  semitones: number;
  /** True so quando o tom realmente muda — pad nao deve piscar a toa. */
  changed: boolean;
  /** Quando iniciar a troca, na linha do tempo da musica atual. */
  startAt: number;
  crossfadeSec: number;
}

export interface TransitionPlan {
  mode: TransitionMode;
  /** Quando a proxima musica comeca. null = espera o operador. */
  startNextAt: number | null;
  /** Quando a musica atual comeca a sumir. */
  fadeOutAt: number;
  fadeOutSec: number;
  pad: PadPlan | null;
}

export interface TransitionOptions {
  mode: TransitionMode;
  /** Duracao da musica atual, em segundos. */
  duration: number;
  crossfadeSec?: number;
  padFadeSec?: number;
  currentKey?: MusicalKey | null;
  nextKey?: MusicalKey | null;
  padEnabled?: boolean;
}

export const DEFAULT_CROSSFADE_SEC = 3;
export const DEFAULT_PAD_FADE_SEC = 4;

export function planTransition(opts: TransitionOptions): TransitionPlan {
  const duration = Math.max(0, opts.duration);
  const padFade = opts.padFadeSec ?? DEFAULT_PAD_FADE_SEC;
  // O crossfade nunca pode ser maior que a musica: com isso, a proxima
  // comecaria antes desta — e o operador ouviria as duas do inicio.
  const crossfade = Math.max(0, Math.min(opts.crossfadeSec ?? DEFAULT_CROSSFADE_SEC, duration));

  const pad = planPad({
    padEnabled: opts.padEnabled ?? false,
    currentKey: opts.currentKey ?? null,
    nextKey: opts.nextKey ?? null,
    at: Math.max(0, duration - padFade),
    crossfadeSec: padFade,
  });

  switch (opts.mode) {
    case 'auto':
      return { mode: 'auto', startNextAt: duration, fadeOutAt: duration, fadeOutSec: 0, pad };
    case 'crossfade':
      return {
        mode: 'crossfade',
        startNextAt: duration - crossfade,
        fadeOutAt: duration - crossfade,
        fadeOutSec: crossfade,
        pad,
      };
    case 'pad':
      // O pad assume quando a musica sai; a proxima entra quando o operador
      // mandar, e ate la o tom nao cai no vazio.
      return {
        mode: 'pad',
        startNextAt: null,
        fadeOutAt: Math.max(0, duration - padFade),
        fadeOutSec: padFade,
        pad: pad ?? padHold(opts.currentKey ?? null, Math.max(0, duration - padFade), padFade),
      };
    default:
      return { mode: 'stop', startNextAt: null, fadeOutAt: duration, fadeOutSec: 0, pad };
  }
}

function planPad(opts: {
  padEnabled: boolean;
  currentKey: MusicalKey | null;
  nextKey: MusicalKey | null;
  at: number;
  crossfadeSec: number;
}): PadPlan | null {
  if (!opts.padEnabled || !opts.nextKey) return null;
  const changed = opts.currentKey !== null && semitonesBetween(opts.currentKey, opts.nextKey) !== 0;
  return {
    fromKey: opts.currentKey,
    toKey: opts.nextKey,
    semitones: opts.currentKey ? semitonesBetween(opts.currentKey, opts.nextKey) : 0,
    changed,
    startAt: opts.at,
    crossfadeSec: opts.crossfadeSec,
  };
}

function padHold(key: MusicalKey | null, at: number, crossfadeSec: number): PadPlan | null {
  if (!key) return null;
  return { fromKey: key, toKey: key, semitones: 0, changed: false, startAt: at, crossfadeSec };
}

/** Rampa de volume do pad: entrar, sair ou trocar de tom. */
export interface FadePlan {
  from: number;
  to: number;
  startAt: number;
  durationSec: number;
}

export function planPadFade(action: 'in' | 'out', at: number, seconds = DEFAULT_PAD_FADE_SEC): FadePlan {
  return {
    from: action === 'in' ? 0 : 1,
    to: action === 'in' ? 1 : 0,
    startAt: at,
    // Um pad que entra ou sai instantaneamente e ouvido como um corte.
    durationSec: Math.max(0.25, seconds),
  };
}

/**
 * Troca de tom do pad: o tom novo entra enquanto o velho sai, com sobreposicao.
 * Sem isso, ha um buraco audivel entre um tom e outro.
 */
export function planPadKeyChange(at: number, seconds = DEFAULT_PAD_FADE_SEC): { out: FadePlan; in: FadePlan } {
  return {
    out: planPadFade('out', at, seconds),
    in: planPadFade('in', at, seconds),
  };
}
