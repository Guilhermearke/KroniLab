import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBeatGrid,
  beatAtTime,
  nextBarTimeAfter,
  nextBeatTimeAfter,
  positionAt,
  timeOfBar,
  barCount,
  bpmAtTime,
  deriveTempoMap,
} from '../src/beatgrid.ts';

const steady = buildBeatGrid({
  tempoMap: { segments: [{ startTime: 0, bpm: 120 }] },
  duration: 20,
});

test('grade a 120 BPM tem beats de 0.5s e downbeat a cada 4', () => {
  assert.equal(steady.beats[0]!.timestamp, 0);
  assert.equal(steady.beats[1]!.timestamp, 0.5);
  assert.equal(steady.beats[4]!.timestamp, 2);
  assert.equal(steady.beats[4]!.bar, 2);
  assert.equal(steady.beats[4]!.beat, 1);
  assert.equal(steady.beats[4]!.downbeat, true);
  assert.equal(steady.beats[5]!.downbeat, false);
});

test('beatAtTime pega o beat ativo, nao o mais proximo', () => {
  assert.equal(beatAtTime(steady, 0.9)!.index, 1);
  assert.equal(beatAtTime(steady, 1.0)!.index, 2);
  assert.equal(beatAtTime(steady, -0.1), null);
});

test('proximo compasso respeita o lookahead de agendamento', () => {
  // Em 1.9s o proximo downbeat e 2.0s e ainda da tempo.
  assert.equal(nextBarTimeAfter(steady, 1.9, 0.08), 2);
  // Em 1.95s nao da: precisa ir para o compasso seguinte, nunca para o passado.
  assert.equal(nextBarTimeAfter(steady, 1.95, 0.08), 4);
  assert.ok(nextBarTimeAfter(steady, 1.95, 0.08) > 1.95);
});

test('proximo beat tambem nunca cai no passado', () => {
  assert.equal(nextBeatTimeAfter(steady, 1.0, 0.08), 1.5);
  assert.equal(nextBeatTimeAfter(steady, 1.45, 0.08), 2);
});

test('positionAt da compasso, tempo e fase', () => {
  const p = positionAt(steady, 2.25);
  assert.equal(p.bar, 2);
  assert.equal(p.beat, 1);
  assert.equal(p.phase, 0.5);
});

test('timeOfBar extrapola alem do fim sem quebrar', () => {
  assert.equal(timeOfBar(steady, 3), 4);
  const beyond = timeOfBar(steady, barCount(steady) + 5);
  assert.ok(Number.isFinite(beyond) && beyond > steady.duration);
});

test('BPM variavel: a grade acompanha a mudanca de andamento', () => {
  const grid = buildBeatGrid({
    tempoMap: { segments: [{ startTime: 0, bpm: 72 }, { startTime: 10, bpm: 144 }] },
    duration: 30,
  });
  assert.equal(bpmAtTime(grid, 5), 72);
  assert.equal(bpmAtTime(grid, 20), 144);
  const map = deriveTempoMap(grid);
  assert.equal(map.segments[0]!.bpm, 72);
  assert.ok(map.segments.some((s) => Math.abs(s.bpm - 144) < 1));
});

test('compasso 3/4 conta downbeat a cada 3 tempos', () => {
  const waltz = buildBeatGrid({
    tempoMap: { segments: [{ startTime: 0, bpm: 90 }] },
    duration: 10,
    timeSignature: { beatsPerBar: 3, beatUnit: 4 },
  });
  assert.equal(waltz.beats[3]!.bar, 2);
  assert.equal(waltz.beats[3]!.downbeat, true);
});

test('offset do primeiro downbeat desloca a grade inteira', () => {
  const grid = buildBeatGrid({
    tempoMap: { segments: [{ startTime: 0, bpm: 120 }] },
    duration: 10,
    firstDownbeatAt: 0.35,
  });
  assert.equal(grid.beats[0]!.timestamp, 0.35);
  assert.equal(timeOfBar(grid, 2), 2.35);
});
