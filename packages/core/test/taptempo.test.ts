import test from 'node:test';
import assert from 'node:assert/strict';
import { TapTempo, planTempoReconcile } from '../src/taptempo.ts';

test('quatro taps a 120 BPM dao 120 BPM', () => {
  const tap = new TapTempo();
  let r = tap.tap(0);
  assert.equal(r.bpm, null, 'um tap nao e tempo');
  tap.tap(500);
  r = tap.tap(1000);
  assert.equal(r.bpm, 120);
  r = tap.tap(1500);
  assert.equal(r.bpm, 120);
  assert.ok(r.confidence > 0.9);
});

test('tap humano irregular ainda converge', () => {
  const tap = new TapTempo();
  [0, 520, 1010, 1480, 2020].forEach((t) => tap.tap(t));
  const r = tap.result();
  assert.ok(r.bpm! > 115 && r.bpm! < 126, `bpm fora da faixa: ${r.bpm}`);
});

test('tap perdido e descartado em vez de derrubar o BPM', () => {
  const tap = new TapTempo();
  // Intervalos de 500ms com um tap pulado no meio (1000ms).
  [0, 500, 1000, 2000, 2500, 3000].forEach((t) => tap.tap(t));
  const r = tap.result();
  assert.ok(Math.abs(r.bpm! - 120) < 8, `bpm=${r.bpm}`);
});

test('pausa longa reinicia a contagem', () => {
  const tap = new TapTempo({ resetAfterMs: 2000 });
  [0, 500, 1000].forEach((t) => tap.tap(t));
  const r = tap.tap(9000);
  assert.equal(r.taps, 1);
  assert.equal(r.bpm, null);
});

test('reconciliacao com a banda e gradual, nunca um degrau', () => {
  const plan = planTempoReconcile({ vsBpm: 115, bandBpm: 113.9 });
  assert.ok(plan.targetRate < 1);
  assert.ok(plan.glideSec >= 1, 'sem mudanca brusca');
  assert.equal(plan.bpmTo, 113.9);
  assert.equal(plan.clamped, false);
});

test('diferenca absurda e cortada no limite e sinalizada', () => {
  const plan = planTempoReconcile({ vsBpm: 115, bandBpm: 150 });
  assert.equal(plan.clamped, true);
  assert.ok(plan.targetRate <= 1.04);
  assert.ok(plan.bpmTo < 121);
});
