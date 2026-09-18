/**
 * Tap tempo (item 25): o operador marca o andamento real da banda.
 *
 * O sistema nunca troca o tempo de forma brusca — ele calcula o BPM da banda e
 * devolve um plano de convergencia gradual.
 */

export interface TapResult {
  bpm: number | null;
  taps: number;
  /** 0..1 — dispersao entre os intervalos. Abaixo de ~0.5 nao vale usar. */
  confidence: number;
}

export class TapTempo {
  private times: number[] = [];
  private readonly resetAfterMs: number;
  private readonly maxTaps: number;

  constructor(opts: { resetAfterMs?: number; maxTaps?: number } = {}) {
    this.resetAfterMs = opts.resetAfterMs ?? 2500;
    this.maxTaps = opts.maxTaps ?? 8;
  }

  reset(): void {
    this.times = [];
  }

  /** `now` em milissegundos. */
  tap(now: number): TapResult {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && now - last > this.resetAfterMs) this.times = [];
    this.times.push(now);
    if (this.times.length > this.maxTaps) this.times.shift();
    return this.result();
  }

  result(): TapResult {
    const intervals: number[] = [];
    for (let i = 1; i < this.times.length; i++) {
      intervals.push(this.times[i]! - this.times[i - 1]!);
    }
    if (intervals.length < 2) {
      return { bpm: null, taps: this.times.length, confidence: 0 };
    }
    const med = median(intervals);
    // Descarta tap perdido / batida dobrada antes de calcular.
    const kept = intervals.filter((v) => v > med * 0.6 && v < med * 1.6);
    const use = kept.length >= 2 ? kept : intervals;
    const mean = use.reduce((a, b) => a + b, 0) / use.length;
    if (mean <= 0) return { bpm: null, taps: this.times.length, confidence: 0 };
    const sd = Math.sqrt(use.reduce((a, b) => a + (b - mean) ** 2, 0) / use.length);
    const confidence = clamp01(1 - (sd / mean) * 4);
    return {
      bpm: Math.round((60000 / mean) * 10) / 10,
      taps: this.times.length,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
}

export interface ReconcilePlan {
  /** Velocidade alvo relativa ao BPM da VS. */
  targetRate: number;
  /** Tempo para chegar la — nunca 0 (mudanca brusca e proibida). */
  glideSec: number;
  bpmFrom: number;
  bpmTo: number;
  /** True quando a diferenca estourou o limite e foi cortada. */
  clamped: boolean;
}

/**
 * Convergencia gradual do tempo da VS para o tempo da banda.
 * Ex.: VS 115, banda 113.9 -> desce devagar, sem degrau.
 */
export function planTempoReconcile(opts: {
  vsBpm: number;
  bandBpm: number;
  /** Desvio maximo permitido (4% por padrao). */
  maxRateDeviation?: number;
  /** Velocidade da rampa, em fracao de rate por segundo. */
  ratePerSecond?: number;
  minGlideSec?: number;
}): ReconcilePlan {
  const maxDev = opts.maxRateDeviation ?? 0.04;
  const ratePerSecond = opts.ratePerSecond ?? 0.01;
  const minGlide = opts.minGlideSec ?? 1;
  const raw = opts.vsBpm > 0 ? opts.bandBpm / opts.vsBpm : 1;
  const clampedRate = Math.min(1 + maxDev, Math.max(1 - maxDev, raw));
  const glide = Math.max(minGlide, Math.abs(clampedRate - 1) / ratePerSecond);
  return {
    targetRate: Math.round(clampedRate * 10000) / 10000,
    glideSec: Math.round(glide * 100) / 100,
    bpmFrom: Math.round(opts.vsBpm * 10) / 10,
    bpmTo: Math.round(opts.vsBpm * clampedRate * 10) / 10,
    clamped: Math.abs(raw - clampedRate) > 1e-9,
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
