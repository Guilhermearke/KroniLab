/**
 * Maquina de estados do processamento de IA (item 30).
 *
 * A IA nao e um projeto a parte: este job pertence a uma Song, que pertence a
 * uma igreja, e e o que destrava EventSong -> Study -> Offline -> Live.
 */
import type { ProcessingState } from './types.ts';

export const PROCESSING_ORDER: ProcessingState[] = [
  'queued',
  'preparing',
  'separating',
  'analyzing',
  'generating_click',
  'generating_guide',
  'uploading',
  'completed',
];

/** Peso de cada etapa no progresso — separacao domina o tempo real de GPU. */
const WEIGHTS: Record<ProcessingState, number> = {
  queued: 0,
  preparing: 0.05,
  separating: 0.55,
  analyzing: 0.2,
  generating_click: 0.05,
  generating_guide: 0.08,
  uploading: 0.07,
  completed: 0,
  failed: 0,
};

export const STATE_LABEL: Record<ProcessingState, string> = {
  queued: 'Na fila',
  preparing: 'Preparando audio',
  separating: 'Separando instrumentos',
  analyzing: 'Analisando tempo e tom',
  generating_click: 'Gerando click',
  generating_guide: 'Gerando guia',
  uploading: 'Enviando',
  completed: 'Musica pronta',
  failed: 'Falhou',
};

/** Progresso agregado 0..1, considerando o progresso interno da etapa atual. */
export function overallProgress(state: ProcessingState, stageProgress = 0): number {
  if (state === 'completed') return 1;
  if (state === 'failed') return 0;
  let acc = 0;
  for (const s of PROCESSING_ORDER) {
    if (s === state) break;
    acc += WEIGHTS[s];
  }
  return Math.min(1, Math.round((acc + WEIGHTS[state] * clamp01(stageProgress)) * 100) / 100);
}

export function canTransition(from: ProcessingState, to: ProcessingState): boolean {
  if (to === 'failed') return from !== 'completed';
  if (from === 'completed' || from === 'failed') return false;
  const a = PROCESSING_ORDER.indexOf(from);
  const b = PROCESSING_ORDER.indexOf(to);
  return a >= 0 && b === a + 1;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
