import test from 'node:test';
import assert from 'node:assert/strict';
import { overallProgress, canTransition, PROCESSING_ORDER, STATE_LABEL } from '../src/processing.ts';
import { can } from '../src/permissions.ts';

test('progresso cresce monotonicamente pelo pipeline', () => {
  let prev = -1;
  for (const state of PROCESSING_ORDER) {
    const p = overallProgress(state);
    assert.ok(p >= prev, `${state} regrediu`);
    prev = p;
  }
  assert.equal(overallProgress('completed'), 1);
});

test('separacao de stems domina o progresso (e o custo de GPU)', () => {
  assert.ok(overallProgress('analyzing') - overallProgress('separating') > 0.4);
});

test('progresso interno da etapa aparece na barra', () => {
  assert.ok(overallProgress('separating', 0.5) > overallProgress('separating', 0));
});

test('o pipeline nao pula etapas', () => {
  assert.equal(canTransition('queued', 'preparing'), true);
  assert.equal(canTransition('queued', 'uploading'), false);
  assert.equal(canTransition('separating', 'failed'), true);
  assert.equal(canTransition('completed', 'separating'), false, 'musica pronta nao volta para a fila');
});

test('todo estado tem rotulo pt-BR para a UI', () => {
  for (const s of [...PROCESSING_ORDER, 'failed' as const]) {
    assert.ok(STATE_LABEL[s] && STATE_LABEL[s].length > 0);
  }
});

test('so ministro pra cima define o tom do culto', () => {
  assert.equal(can('MEMBER', 'key:set'), false);
  assert.equal(can('WORSHIP_LEADER', 'key:set'), true);
  assert.equal(can('MEMBER', 'song:study'), true);
  assert.equal(can('MEMBER', 'live:operate'), true);
  assert.equal(can('MINISTRY_LEADER', 'church:manage'), false);
  assert.equal(can('OWNER', 'church:manage'), true);
});
