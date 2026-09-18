import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planTransition, planPadFade, planPadKeyChange,
  DEFAULT_CROSSFADE_SEC, TRANSITION_LABEL,
} from '../src/transitions.ts';

test('parar: a proxima musica espera o operador', () => {
  const plan = planTransition({ mode: 'stop', duration: 200 });
  assert.equal(plan.startNextAt, null);
  assert.equal(plan.fadeOutSec, 0);
});

test('emendar: a proxima comeca exatamente no fim, sem silencio', () => {
  const plan = planTransition({ mode: 'auto', duration: 200 });
  assert.equal(plan.startNextAt, 200);
  assert.equal(plan.fadeOutSec, 0);
});

test('crossfade: a proxima entra antes desta acabar', () => {
  const plan = planTransition({ mode: 'crossfade', duration: 200, crossfadeSec: 4 });
  assert.equal(plan.startNextAt, 196);
  assert.equal(plan.fadeOutAt, 196);
  assert.equal(plan.fadeOutSec, 4);
});

test('crossfade maior que a musica e cortado, nunca negativo', () => {
  const plan = planTransition({ mode: 'crossfade', duration: 3, crossfadeSec: 30 });
  assert.equal(plan.startNextAt, 0, 'a proxima nao pode comecar antes desta');
  assert.ok(plan.fadeOutAt >= 0);
});

test('segurar no pad: a musica sai, o tom continua', () => {
  const plan = planTransition({
    mode: 'pad', duration: 200, padEnabled: true,
    currentKey: 'C', nextKey: 'C', padFadeSec: 5,
  });
  assert.equal(plan.startNextAt, null, 'quem chama a proxima e o operador');
  assert.equal(plan.fadeOutAt, 195);
  assert.ok(plan.pad, 'o pad segura o tom no intervalo');
  assert.equal(plan.pad!.changed, false);
});

test('mudanca de tom entre musicas e detectada', () => {
  const plan = planTransition({
    mode: 'crossfade', duration: 120, padEnabled: true, currentKey: 'B', nextKey: 'C',
  });
  assert.equal(plan.pad!.changed, true);
  assert.equal(plan.pad!.semitones, 1);
  assert.equal(plan.pad!.toKey, 'C');
});

test('mesmo tom nao faz o pad trocar a toa', () => {
  const plan = planTransition({
    mode: 'auto', duration: 120, padEnabled: true, currentKey: 'D', nextKey: 'D',
  });
  assert.equal(plan.pad!.changed, false);
  assert.equal(plan.pad!.semitones, 0);
});

test('sem pad ligado, nao ha plano de pad', () => {
  const plan = planTransition({ mode: 'auto', duration: 120, currentKey: 'C', nextKey: 'G' });
  assert.equal(plan.pad, null);
});

test('o pad comeca a trocar ANTES do fim, para nao deixar buraco', () => {
  const plan = planTransition({
    mode: 'auto', duration: 100, padEnabled: true, currentKey: 'C', nextKey: 'E', padFadeSec: 6,
  });
  assert.equal(plan.pad!.startAt, 94);
  assert.ok(plan.pad!.startAt + plan.pad!.crossfadeSec >= 100, 'a troca cobre a virada');
});

test('fade de pad nunca e instantaneo (corte seco se ouve)', () => {
  assert.ok(planPadFade('in', 0, 0).durationSec >= 0.25);
  assert.equal(planPadFade('in', 10, 4).to, 1);
  assert.equal(planPadFade('out', 10, 4).to, 0);
});

test('troca de tom do pad sobrepoe saida e entrada', () => {
  const { out, in: fadeIn } = planPadKeyChange(50, 4);
  assert.equal(out.startAt, fadeIn.startAt, 'um sai enquanto o outro entra');
  assert.equal(out.to, 0);
  assert.equal(fadeIn.to, 1);
});

test('todo modo tem rotulo em pt-BR', () => {
  for (const mode of ['stop', 'auto', 'crossfade', 'pad'] as const) {
    assert.ok(TRANSITION_LABEL[mode].length > 0);
  }
  assert.equal(DEFAULT_CROSSFADE_SEC > 0, true);
});
