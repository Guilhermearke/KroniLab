import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, computeRevision, missingAssets, offlineStatus, downloadProgress, manifestBytes, formatBytes } from '../src/offline.ts';
import { makeSong, event, settings } from './fixtures.ts';
import type { LocalManifest } from '../src/types.ts';

const songs = [makeSong({ id: 's1', title: 'Santo Pra Sempre' }), makeSong({ id: 's2', title: 'Gratidao' })];
const base = [settings('s1', 'C', 0), settings('s2', 'D', 1)];
const manifest = buildManifest({ event, songs, settings: base, builtAt: '2026-09-18T12:00:00Z' });

test('manifesto junta todos os stems do setlist', () => {
  assert.equal(manifest.assets.length, 16); // 8 stems x 2 musicas
  assert.equal(manifestBytes(manifest), 16 * 4_000_000);
});

test('mudar o tom muda a revisao — e a equipe ve "desatualizado"', () => {
  const r1 = computeRevision(base);
  const r2 = computeRevision([settings('s1', 'Db', 0), settings('s2', 'D', 1)]);
  assert.notEqual(r1, r2);
});

test('reordenar o setlist tambem muda a revisao', () => {
  assert.notEqual(computeRevision(base), computeRevision([settings('s1', 'C', 1), settings('s2', 'D', 0)]));
});

test('revisao e estavel: mesmos dados, mesmo hash', () => {
  assert.equal(computeRevision(base), computeRevision([...base].reverse()));
});

test('status offline percorre nuvem -> baixando -> offline', () => {
  assert.equal(offlineStatus({ manifest, local: null }), 'cloud');
  assert.equal(offlineStatus({ manifest, local: null, downloading: true }), 'downloading');
  const local: LocalManifest = {
    eventId: 'ev-1', revision: manifest.revision,
    downloadedKeys: manifest.assets.map((a) => a.key), downloadedAt: '2026-09-18T12:05:00Z',
  };
  assert.equal(offlineStatus({ manifest, local }), 'offline');
});

test('ministro muda o tom depois do download -> desatualizado', () => {
  const local: LocalManifest = {
    eventId: 'ev-1', revision: 'revisao-antiga',
    downloadedKeys: manifest.assets.map((a) => a.key), downloadedAt: '2026-09-18T12:05:00Z',
  };
  assert.equal(offlineStatus({ manifest, local }), 'stale');
});

test('download parcial retoma so o que falta', () => {
  const local: LocalManifest = {
    eventId: 'ev-1', revision: manifest.revision,
    downloadedKeys: manifest.assets.slice(0, 12).map((a) => a.key), downloadedAt: '2026-09-18T12:05:00Z',
  };
  assert.equal(missingAssets(manifest, local).length, 4);
  assert.equal(downloadProgress(manifest, local), 0.75);
});

test('formatBytes legivel para a tela de download', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(4_000_000), '3.8 MB');
});
