/**
 * Beat grid — fonte da verdade do tempo.
 *
 * Nada no produto usa "BPM = 72" solto: click, guia, secoes, loops, saltos
 * quantizados, nudge e tap tempo leem daqui. Isso e o que permite BPM variavel
 * sem quebrar sincronismo.
 */
import type { Beat, BeatGrid, TempoMap, TimeSignature } from './types.ts';

export const DEFAULT_TIME_SIGNATURE: TimeSignature = { beatsPerBar: 4, beatUnit: 4 };

export function bpmAtTimeInMap(map: TempoMap, time: number): number {
  let bpm = map.segments[0]?.bpm ?? 120;
  for (const seg of map.segments) {
    if (seg.startTime <= time) bpm = seg.bpm;
    else break;
  }
  return bpm;
}

/**
 * Gera a grade a partir de um tempo map. O worker produz a grade a partir do
 * audio real; isto cobre musicas sem analise fina e os testes.
 */
export function buildBeatGrid(opts: {
  tempoMap: TempoMap;
  duration: number;
  timeSignature?: TimeSignature;
  /** Tempo do primeiro downbeat (offset da contagem). */
  firstDownbeatAt?: number;
}): BeatGrid {
  const ts = opts.timeSignature ?? DEFAULT_TIME_SIGNATURE;
  const beats: Beat[] = [];
  let t = opts.firstDownbeatAt ?? 0;
  let index = 0;
  // Guarda contra BPM absurdo vindo de analise ruim.
  const guard = Math.ceil((opts.duration / 60) * 600) + 16;
  while (t <= opts.duration && index < guard) {
    const beatInBar = (index % ts.beatsPerBar) + 1;
    beats.push({
      index,
      bar: Math.floor(index / ts.beatsPerBar) + 1,
      beat: beatInBar,
      timestamp: round6(t),
      downbeat: beatInBar === 1,
    });
    t += 60 / bpmAtTimeInMap(opts.tempoMap, t);
    index++;
  }
  return { timeSignature: ts, beats, duration: opts.duration };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Indice do beat ativo em `time` (o ultimo com timestamp <= time). -1 antes do 1o. */
export function beatIndexAtTime(grid: BeatGrid, time: number): number {
  const beats = grid.beats;
  if (beats.length === 0 || time < beats[0]!.timestamp) return -1;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (beats[mid]!.timestamp <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function beatAtTime(grid: BeatGrid, time: number): Beat | null {
  const i = beatIndexAtTime(grid, time);
  return i < 0 ? null : grid.beats[i]!;
}

/** Intervalo medio do fim da grade — usado para extrapolar alem do ultimo beat. */
function tailInterval(grid: BeatGrid): number {
  const n = grid.beats.length;
  if (n < 2) return 0.5;
  return grid.beats[n - 1]!.timestamp - grid.beats[n - 2]!.timestamp;
}

/** Tempo de um indice de beat, extrapolando linearmente fora da grade. */
export function timeOfBeatIndex(grid: BeatGrid, index: number): number {
  const n = grid.beats.length;
  if (n === 0) return 0;
  if (index < 0) {
    const head = grid.beats[1] && grid.beats[0]
      ? grid.beats[1]!.timestamp - grid.beats[0]!.timestamp
      : 0.5;
    return grid.beats[0]!.timestamp + index * head;
  }
  if (index < n) return grid.beats[index]!.timestamp;
  return grid.beats[n - 1]!.timestamp + (index - (n - 1)) * tailInterval(grid);
}

/** Inicio do compasso `bar` (1-based), extrapolando se preciso. */
export function timeOfBar(grid: BeatGrid, bar: number): number {
  return timeOfBeatIndex(grid, (bar - 1) * grid.timeSignature.beatsPerBar);
}

export function barCount(grid: BeatGrid): number {
  if (grid.beats.length === 0) return 0;
  return grid.beats[grid.beats.length - 1]!.bar;
}

/** Posicao musical legivel: compasso, tempo e fase (0..1) dentro do beat. */
export function positionAt(grid: BeatGrid, time: number): { bar: number; beat: number; phase: number } {
  const i = beatIndexAtTime(grid, time);
  if (i < 0) {
    const first = grid.beats[0]?.timestamp ?? 0;
    const head = timeOfBeatIndex(grid, 0) - timeOfBeatIndex(grid, -1);
    const phase = head > 0 ? Math.max(0, 1 - (first - time) / head) : 0;
    return { bar: 0, beat: 0, phase };
  }
  const beat = grid.beats[i]!;
  const next = timeOfBeatIndex(grid, i + 1);
  const span = next - beat.timestamp;
  const phase = span > 0 ? clamp01((time - beat.timestamp) / span) : 0;
  return { bar: beat.bar, beat: beat.beat, phase };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Proximo limite de beat estritamente depois de `time + lookahead`.
 * O lookahead existe porque o agendamento de audio precisa de folga: sem ele,
 * o salto cairia no passado e viraria clique/atraso.
 */
export function nextBeatTimeAfter(grid: BeatGrid, time: number, lookahead = 0): number {
  const target = time + lookahead;
  const i = beatIndexAtTime(grid, target);
  return timeOfBeatIndex(grid, i + 1);
}

/** Proximo downbeat (inicio de compasso) depois de `time + lookahead`. */
export function nextBarTimeAfter(grid: BeatGrid, time: number, lookahead = 0): number {
  const target = time + lookahead;
  const bpb = grid.timeSignature.beatsPerBar;
  const i = beatIndexAtTime(grid, target);
  const nextIndex = i < 0 ? 0 : (Math.floor(i / bpb) + 1) * bpb;
  return timeOfBeatIndex(grid, nextIndex);
}

/** BPM local, medido na grade (respeita BPM variavel). */
export function bpmAtTime(grid: BeatGrid, time: number): number {
  const i = Math.max(0, beatIndexAtTime(grid, time));
  const span = timeOfBeatIndex(grid, i + 1) - timeOfBeatIndex(grid, i);
  return span > 0 ? round2(60 / span) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Tempo map derivado da grade (para exibir/editar "0:00 -> 72, 1:38 -> 74"). */
export function deriveTempoMap(grid: BeatGrid, toleranceBpm = 0.75): TempoMap {
  const segments: TempoMap['segments'] = [];
  for (let i = 0; i + 1 < grid.beats.length; i++) {
    const span = grid.beats[i + 1]!.timestamp - grid.beats[i]!.timestamp;
    if (span <= 0) continue;
    const bpm = round2(60 / span);
    const last = segments[segments.length - 1];
    if (!last || Math.abs(last.bpm - bpm) > toleranceBpm) {
      segments.push({ startTime: grid.beats[i]!.timestamp, bpm });
    }
  }
  return { segments };
}
