import test from 'node:test';
import assert from 'node:assert/strict';
import { studyPreset, toggleOwnInstrument, resolveGains, ownStem, stemsFor, fullMix, gainToDb, dbToGain } from '../src/mixer.ts';

test('baterista abre a musica com a bateria zerada e o resto inteiro', () => {
  const mix = studyPreset('BATERIA', 'six');
  assert.equal(mix.drums, 0);
  assert.equal(mix.vocals, 1);
  assert.equal(mix.bass, 1);
  assert.equal(mix.click, 1);
  assert.equal(mix.guide, 1);
});

test('cada instrumento tira o proprio stem', () => {
  assert.equal(studyPreset('BAIXO', 'six').bass, 0);
  assert.equal(studyPreset('GUITARRA', 'six').guitar, 0);
  assert.equal(studyPreset('TECLADO', 'six').keys, 0);
  assert.equal(studyPreset('VOCAL', 'six').vocals, 0);
});

test('no layout de 4 stems a guitarra nao tem stem proprio — e a UI nao mente', () => {
  assert.equal(ownStem('GUITARRA', 'four'), null);
  const mix = studyPreset('GUITARRA', 'four');
  // Nada e zerado: zerar 'other' levaria junto o resto do arranjo.
  assert.equal(mix.other, 1);
  assert.equal(stemsFor('four').includes('guitar'), false);
});

test('botao "remover meu instrumento" alterna', () => {
  const base = fullMix('six');
  const off = toggleOwnInstrument(base, 'BATERIA', 'six');
  assert.equal(off.drums, 0);
  assert.equal(toggleOwnInstrument(off, 'BATERIA', 'six').drums, 1);
  assert.equal(base.drums, 1, 'nao muta o objeto original');
});

test('solo silencia o resto; mute vence o solo', () => {
  const gains = resolveGains({ layout: 'six', volumes: fullMix('six'), muted: [], soloed: ['drums'] });
  assert.equal(gains.drums, 1);
  assert.equal(gains.vocals, 0);
  const both = resolveGains({ layout: 'six', volumes: fullMix('six'), muted: ['drums'], soloed: ['drums'] });
  assert.equal(both.drums, 0);
});

test('sem solo, todo mundo toca no proprio volume', () => {
  const volumes = { ...fullMix('six'), vocals: 0.4 };
  const gains = resolveGains({ layout: 'six', volumes, muted: ['guide'], soloed: [] });
  assert.equal(gains.vocals, 0.4);
  assert.equal(gains.guide, 0);
  assert.equal(gains.bass, 1);
});

test('conversao dB <-> ganho', () => {
  assert.equal(gainToDb(1), 0);
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.01);
});
