import test from 'node:test';
import assert from 'node:assert/strict';
import { semitonesBetween, transposeKey, candidateKeys, pitchShiftFor, isPitchShiftSafe, spell, formatKey } from '../src/keys.ts';

test('B -> C e um semitom acima', () => {
  assert.equal(semitonesBetween('B', 'C'), 1);
  assert.equal(semitonesBetween('B', 'Bb'), -1);
});

test('a distancia usa o caminho curto (nunca 11 semitons)', () => {
  assert.equal(semitonesBetween('C', 'B'), -1);
  assert.equal(semitonesBetween('C', 'F#'), 6);
});

test('enarmonia: A# e Bb sao o mesmo tom', () => {
  assert.equal(semitonesBetween('A#', 'Bb'), 0);
  assert.equal(transposeKey('A', 1), 'Bb', 'a igreja escreve Bb, nao A#');
  assert.equal(transposeKey('A', 1, 'sharp'), 'A#');
  assert.equal(spell(6), 'Gb');
});

test('candidatos ao redor do original (o ministro testando o tom)', () => {
  assert.deepEqual(candidateKeys('B'), ['A', 'Bb', 'B', 'C', 'Db']);
});

test('pitch shift do player vem do tom do culto', () => {
  assert.equal(pitchShiftFor('B', 'C'), 1);
  assert.equal(pitchShiftFor('B', null), 0, 'sem tom definido, toca no original');
  assert.equal(isPitchShiftSafe(1), true);
  assert.equal(isPitchShiftSafe(5), false, 'salto grande degrada o audio — a UI avisa');
});

test('formatKey marca menor', () => {
  assert.equal(formatKey('A', 'minor'), 'Am');
  assert.equal(formatKey('A'), 'A');
});

test('tom invalido falha alto em vez de virar C silencioso', () => {
  assert.throws(() => semitonesBetween('H', 'C'), /Tom invalido/);
});
