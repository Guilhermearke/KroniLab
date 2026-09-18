/**
 * Saltos de secao e loop (itens 22 e 23).
 *
 * Regra: tocar um botao NUNCA pula na hora. O destino entra na fila e a troca
 * acontece no ponto musical correto — por padrao, no proximo compasso.
 */
import { nextBarTimeAfter, nextBeatTimeAfter, timeOfBar } from './beatgrid.ts';
import { sectionAtTime, sectionTiming } from './sections.ts';
import type { BeatGrid, QuantizeMode, Section } from './types.ts';

/** Folga minima de agendamento. Abaixo disso o audio nao chega a tempo. */
export const DEFAULT_LOOKAHEAD = 0.08;

export interface JumpPlan {
  targetSectionId: string;
  /** Quando executar (segundos na linha do tempo da musica). */
  executeAt: number;
  /** Para onde pular. */
  seekTo: number;
  boundary: 'beat' | 'bar' | 'section-end';
}

export function resolveBoundary(opts: {
  grid: BeatGrid;
  sections: Section[];
  now: number;
  mode: QuantizeMode;
  lookahead?: number;
}): { time: number; boundary: JumpPlan['boundary'] } {
  const lookahead = opts.lookahead ?? DEFAULT_LOOKAHEAD;
  if (opts.mode === 'next-beat') {
    return { time: nextBeatTimeAfter(opts.grid, opts.now, lookahead), boundary: 'beat' };
  }
  if (opts.mode === 'end-of-section') {
    const current = sectionAtTime(opts.grid, opts.sections, opts.now);
    if (current) {
      const end = sectionTiming(opts.grid, current).endTime;
      // Se o fim ja passou (ou esta dentro do lookahead), cai para o proximo compasso.
      if (end > opts.now + lookahead) return { time: end, boundary: 'section-end' };
    }
    return { time: nextBarTimeAfter(opts.grid, opts.now, lookahead), boundary: 'bar' };
  }
  return { time: nextBarTimeAfter(opts.grid, opts.now, lookahead), boundary: 'bar' };
}

/**
 * Enfileira um salto. Retorna null se a secao nao existe — a UI nao deve
 * inventar destino.
 */
export function planSectionJump(opts: {
  grid: BeatGrid;
  sections: Section[];
  now: number;
  targetSectionId: string;
  mode: QuantizeMode;
  lookahead?: number;
}): JumpPlan | null {
  const target = opts.sections.find((s) => s.id === opts.targetSectionId);
  if (!target) return null;
  const { time, boundary } = resolveBoundary(opts);
  return {
    targetSectionId: target.id,
    executeAt: time,
    seekTo: timeOfBar(opts.grid, target.startBar),
    boundary,
  };
}

export interface LoopPlan {
  sectionId: string;
  /** Fim da secao: ponto onde o playhead volta. */
  executeAt: number;
  seekTo: number;
}

/**
 * Loop da secao atual. Volta ao inicio quando o playhead chega no fim.
 * Retorna null se o playhead ja saiu da secao (nesse caso o live mode
 * enfileira um salto normal em vez de forcar o retorno).
 */
export function planLoopWrap(opts: {
  grid: BeatGrid;
  sections: Section[];
  loopSectionId: string;
  now: number;
}): LoopPlan | null {
  const section = opts.sections.find((s) => s.id === opts.loopSectionId);
  if (!section) return null;
  const { startTime, endTime } = sectionTiming(opts.grid, section);
  if (opts.now < startTime || opts.now >= endTime) return null;
  return { sectionId: section.id, executeAt: endTime, seekTo: startTime };
}

/**
 * Estado da fila do live mode. Mantido puro de proposito: a engine de audio
 * consome o plano, a UI mostra "Proximo: REFRAO", e ambos leem a mesma verdade.
 */
export interface QueueState {
  queued: JumpPlan | null;
  loop: LoopPlan | null;
}

/** O que deve acontecer entre `now` e `now + window`. Nada = null. */
export function dueAction(state: QueueState, now: number, window: number): JumpPlan | LoopPlan | null {
  const limit = now + window;
  // Um salto enfileirado sempre vence o loop: o operador pediu explicitamente.
  if (state.queued && state.queued.executeAt <= limit) return state.queued;
  if (state.loop && state.loop.executeAt <= limit) return state.loop;
  return null;
}
