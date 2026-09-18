import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBeatGrid } from '../src/beatgrid.ts';
import { planSectionJump, planLoopWrap, dueAction, resolveBoundary } from '../src/transition.ts';
import { sectionAtTime, nextSection, validateSections } from '../src/sections.ts';
import type { Section } from '../src/types.ts';

const grid = buildBeatGrid({ tempoMap: { segments: [{ startTime: 0, bpm: 120 }] }, duration: 120 });
// 120 BPM, 4/4 -> 1 compasso = 2s
const sections: Section[] = [
  { id: 'intro', type: 'Intro', label: 'Intro', startBar: 1, endBar: 5 },      // 0s  - 8s
  { id: 'verse', type: 'Verse', label: 'Verso', startBar: 5, endBar: 13 },     // 8s  - 24s
  { id: 'chorus', type: 'Chorus', label: 'Refrao', startBar: 13, endBar: 21 }, // 24s - 40s
  { id: 'bridge', type: 'Bridge', label: 'Ponte', startBar: 21, endBar: 29 },  // 40s - 56s
];

test('tocar uma secao NAO pula na hora: entra na fila para o proximo compasso', () => {
  const now = 25.3; // dentro do refrao, meio do compasso 13
  const plan = planSectionJump({ grid, sections, now, targetSectionId: 'intro', mode: 'next-bar' })!;
  assert.equal(plan.boundary, 'bar');
  assert.equal(plan.executeAt, 26); // proximo downbeat
  assert.ok(plan.executeAt > now, 'nunca executa no passado');
  assert.equal(plan.seekTo, 0); // inicio da intro
});

test('modo end-of-section espera a secao terminar', () => {
  const plan = planSectionJump({ grid, sections, now: 25.3, targetSectionId: 'intro', mode: 'end-of-section' })!;
  assert.equal(plan.boundary, 'section-end');
  assert.equal(plan.executeAt, 40); // fim do refrao
});

test('end-of-section cai para o proximo compasso quando o fim ja esta em cima', () => {
  const b = resolveBoundary({ grid, sections, now: 39.98, mode: 'end-of-section' });
  assert.equal(b.boundary, 'bar');
  assert.ok(b.time > 39.98);
});

test('modo next-beat troca no proximo tempo', () => {
  const plan = planSectionJump({ grid, sections, now: 25.3, targetSectionId: 'bridge', mode: 'next-beat' })!;
  assert.equal(plan.boundary, 'beat');
  assert.equal(plan.executeAt, 25.5);
  assert.equal(plan.seekTo, 40);
});

test('secao inexistente nao vira salto inventado', () => {
  assert.equal(planSectionJump({ grid, sections, now: 10, targetSectionId: 'nao-existe', mode: 'next-bar' }), null);
});

test('loop volta ao inicio da secao no fim dela', () => {
  const loop = planLoopWrap({ grid, sections, loopSectionId: 'chorus', now: 30 })!;
  assert.equal(loop.executeAt, 40);
  assert.equal(loop.seekTo, 24);
});

test('loop nao forca retorno se o playhead ja saiu da secao', () => {
  assert.equal(planLoopWrap({ grid, sections, loopSectionId: 'chorus', now: 45 }), null);
});

test('salto enfileirado tem prioridade sobre o loop', () => {
  const queued = planSectionJump({ grid, sections, now: 39.0, targetSectionId: 'intro', mode: 'next-bar' })!;
  const loop = planLoopWrap({ grid, sections, loopSectionId: 'chorus', now: 39.0 })!;
  const action = dueAction({ queued, loop }, 39.0, 1.2);
  assert.equal((action as typeof queued).targetSectionId, 'intro');
});

test('nada vence antes da hora', () => {
  const queued = planSectionJump({ grid, sections, now: 25.3, targetSectionId: 'intro', mode: 'end-of-section' })!;
  assert.equal(dueAction({ queued, loop: null }, 25.3, 0.2), null);
});

test('secao atual e proxima batem com o tempo', () => {
  assert.equal(sectionAtTime(grid, sections, 30)!.id, 'chorus');
  assert.equal(nextSection(sections, 'chorus')!.id, 'bridge');
  assert.equal(nextSection(sections, 'bridge'), null);
});

test('validacao pega buraco e sobreposicao entre secoes', () => {
  assert.deepEqual(validateSections(grid, sections), []);
  const broken: Section[] = [
    { id: 'a', type: 'Intro', label: 'Intro', startBar: 1, endBar: 5 },
    { id: 'b', type: 'Verse', label: 'Verso', startBar: 7, endBar: 13 },
  ];
  assert.ok(validateSections(grid, broken).some((p) => p.includes('buraco')));
});
