import test from 'node:test';
import assert from 'node:assert/strict';
import { addSong, moveItem, moveSong, removeSong, renumber, reorderSetlist, sortByPosition } from '../src/setlist.ts';
import { settings } from './fixtures.ts';

const base = [settings('a', 'C', 0), settings('b', 'D', 1), settings('c', 'E', 2)];
const ids = (list: ReturnType<typeof settings>[]) => list.map((s) => s.songId).join(',');

test('mover um item preserva a ordem do resto', () => {
  assert.deepEqual(moveItem([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(moveItem([1, 2, 3, 4], 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(moveItem([1, 2, 3], 1, 1), [1, 2, 3]);
});

test('mover para fora dos limites nao quebra nem perde item', () => {
  assert.deepEqual(moveItem([1, 2, 3], 0, 99), [2, 3, 1]);
  assert.deepEqual(moveItem([1, 2, 3], 2, -5), [3, 1, 2]);
  assert.deepEqual(moveItem([1, 2, 3], 9, 0), [1, 2, 3]);
});

test('arrastar a terceira musica para o topo renumera todo mundo', () => {
  const result = reorderSetlist(base, 'c', 0);
  assert.equal(ids(result), 'c,a,b');
  assert.deepEqual(result.map((s) => s.position), [0, 1, 2]);
});

test('subir e descer uma musica', () => {
  assert.equal(ids(moveSong(base, 'b', -1)), 'b,a,c');
  assert.equal(ids(moveSong(base, 'b', 1)), 'a,c,b');
});

test('a primeira nao sobe e a ultima nao desce', () => {
  assert.equal(ids(moveSong(base, 'a', -1)), 'a,b,c');
  assert.equal(ids(moveSong(base, 'c', 1)), 'a,b,c');
});

test('adicionar entra no fim; a mesma musica nao entra duas vezes', () => {
  const added = addSong(base, settings('d', 'G', 999));
  assert.equal(ids(added), 'a,b,c,d');
  assert.equal(added[3]!.position, 3);
  assert.equal(ids(addSong(added, settings('b', 'D', 0))), 'a,b,c,d');
});

test('remover fecha o buraco nas posicoes', () => {
  const result = removeSong(base, 'b');
  assert.equal(ids(result), 'a,c');
  assert.deepEqual(result.map((s) => s.position), [0, 1]);
});

test('posicoes repetidas vindas do banco sao normalizadas', () => {
  const messy = [settings('a', 'C', 3), settings('b', 'D', 3), settings('c', 'E', 7)];
  const result = renumber(sortByPosition(messy));
  assert.deepEqual(result.map((s) => s.position), [0, 1, 2]);
});
