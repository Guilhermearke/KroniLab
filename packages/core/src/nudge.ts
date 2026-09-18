/**
 * Nudge (item 24): corrigir a diferenca pequena entre banda e VS.
 *
 * Seek abrupto e audivel e quebra o groove. Em vez disso, a VS acelera (ou
 * desacelera) alguns por cento por alguns segundos, ganha os milissegundos
 * necessarios e volta ao tempo original. Ninguem na plateia percebe.
 */

export interface NudgePlan {
  /** Multiplicador de velocidade aplicado durante a janela (1.02 = +2%). */
  rate: number;
  durationSec: number;
  /** Deslocamento efetivamente obtido (pode ser < pedido se bateu no limite). */
  appliedMs: number;
  bpmFrom: number;
  bpmTo: number;
}

export interface NudgeOptions {
  /** > 0 adianta a VS, < 0 atrasa. */
  offsetMs: number;
  baseBpm: number;
  /** Desvio confortavel: 2% passa despercebido. */
  maxRateDeviation?: number;
  /** Teto absoluto antes de soar como "fita acelerando". */
  hardMaxRateDeviation?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
}

export const NUDGE_STEP_MS = 20;

export function planNudge(opts: NudgeOptions): NudgePlan {
  const maxDev = opts.maxRateDeviation ?? 0.02;
  const hardDev = opts.hardMaxRateDeviation ?? 0.06;
  const minDur = opts.minDurationSec ?? 0.5;
  const maxDur = opts.maxDurationSec ?? 8;
  const sign = opts.offsetMs >= 0 ? 1 : -1;
  const need = Math.abs(opts.offsetMs) / 1000;

  if (need === 0) {
    return { rate: 1, durationSec: 0, appliedMs: 0, bpmFrom: opts.baseBpm, bpmTo: opts.baseBpm };
  }

  let dev = maxDev;
  let dur = need / dev;

  if (dur > maxDur) {
    // Nao cabe na janela confortavel: aperta o desvio ate o teto duro.
    dev = Math.min(hardDev, need / maxDur);
    dur = Math.min(maxDur, need / dev);
  } else if (dur < minDur) {
    // Offset minusculo: estica a janela e suaviza o desvio.
    dur = minDur;
    dev = need / dur;
  }

  const rate = 1 + sign * dev;
  const appliedMs = sign * dev * dur * 1000;
  return {
    rate: round4(rate),
    durationSec: round3(dur),
    appliedMs: Math.round(appliedMs),
    bpmFrom: round1(opts.baseBpm),
    bpmTo: round1(opts.baseBpm * rate),
  };
}

/** Quanto do nudge ja foi aplicado em `elapsed` segundos (para a UI e o log). */
export function nudgeProgressMs(plan: NudgePlan, elapsed: number): number {
  if (plan.durationSec <= 0) return 0;
  const t = Math.min(Math.max(elapsed, 0), plan.durationSec);
  return Math.round((plan.rate - 1) * t * 1000);
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round3(n: number) { return Math.round(n * 1000) / 1000; }
function round4(n: number) { return Math.round(n * 10000) / 10000; }
