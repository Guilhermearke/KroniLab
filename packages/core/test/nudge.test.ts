import test from 'node:test';
import assert from 'node:assert/strict';
import { planNudge, nudgeProgressMs, NUDGE_STEP_MS } from '../src/nudge.ts';

test('nudge corrige o offset pedido sem seek', () => {
  const plan = planNudge({ offsetMs: 120, baseBpm: 115 });
  assert.equal(plan.appliedMs, 120);
  // 120ms a 2% = 6s de janela
  assert.equal(plan.durationSec, 6);
  assert.equal(plan.rate, 1.02);
  assert.equal(plan.bpmTo, 117.3);
});

test('nudge negativo atrasa a VS', () => {
  const plan = planNudge({ offsetMs: -60, baseBpm: 120 });
  assert.ok(plan.rate < 1);
  assert.equal(plan.appliedMs, -60);
  assert.ok(plan.bpmTo < plan.bpmFrom);
});

test('offset grande aperta o desvio ate o teto, sem estourar a janela', () => {
  const plan = planNudge({ offsetMs: 400, baseBpm: 120, maxDurationSec: 8 });
  assert.ok(plan.durationSec <= 8);
  assert.ok(plan.rate <= 1.06, 'nunca passa do teto duro');
  assert.equal(plan.appliedMs, 400);
});

test('offset impossivel aplica o que da e informa a verdade', () => {
  const plan = planNudge({ offsetMs: 2000, baseBpm: 120, maxDurationSec: 8, hardMaxRateDeviation: 0.06 });
  assert.equal(plan.durationSec, 8);
  assert.equal(plan.rate, 1.06);
  assert.equal(plan.appliedMs, 480); // 6% * 8s — e reporta isso, nao 2000
});

test('o passo de um toque no botao fica no desvio confortavel', () => {
  const plan = planNudge({ offsetMs: NUDGE_STEP_MS, baseBpm: 100 });
  assert.equal(plan.appliedMs, 20);
  // 2% e o desvio que passa despercebido; acima disso soa como fita acelerando.
  assert.ok(plan.rate <= 1.02, `rate=${plan.rate}`);
  // Curto o bastante para o operador tocar varias vezes seguidas.
  assert.ok(plan.durationSec <= 1.5, `dur=${plan.durationSec}`);
});

test('progresso do nudge acompanha a rampa', () => {
  const plan = planNudge({ offsetMs: 120, baseBpm: 115 });
  assert.equal(nudgeProgressMs(plan, 3), 60);
  assert.equal(nudgeProgressMs(plan, 99), 120);
  assert.equal(nudgeProgressMs(plan, -5), 0);
});

test('nudge zero e no-op', () => {
  const plan = planNudge({ offsetMs: 0, baseBpm: 120 });
  assert.equal(plan.rate, 1);
  assert.equal(plan.durationSec, 0);
});
