import test from 'node:test';
import assert from 'node:assert/strict';
import { runLiveCheck, isVsReady } from '../src/livecheck.ts';
import { buildManifest } from '../src/offline.ts';
import { makeSong, event, settings } from './fixtures.ts';
import type { LocalManifest } from '../src/types.ts';

const songs = [makeSong({ id: 's1' }), makeSong({ id: 's2' })];
const st = [settings('s1', 'C', 0), settings('s2', 'D', 1)];
const manifest = buildManifest({ event, songs, settings: st });
const localOk: LocalManifest = {
  eventId: 'ev-1', revision: manifest.revision,
  downloadedKeys: manifest.assets.map((a) => a.key), downloadedAt: '2026-09-18T12:00:00Z',
};

test('culto completamente preparado passa no live check', () => {
  const r = runLiveCheck({
    songs, settings: st, manifest, local: localOk,
    storageFreeBytes: 2e9, audioOutputConnected: true,
  });
  assert.equal(r.ready, true);
  assert.equal(r.items.every((i) => i.status === 'ok'), true);
});

test('nada baixado bloqueia a entrada no live mode', () => {
  const r = runLiveCheck({
    songs, settings: st, manifest, local: null,
    storageFreeBytes: 2e9, audioOutputConnected: true,
  });
  assert.equal(r.ready, false);
  assert.equal(r.items.find((i) => i.id === 'download')!.status, 'fail');
  assert.equal(r.items.find((i) => i.id === 'sync')!.status, 'fail');
});

test('musica sem click bloqueia; sem guia so avisa', () => {
  const noClick = makeSong({ id: 's3', stems: makeSong({ id: 's3' }).stems.filter((s) => s.id !== 'click' && s.id !== 'guide') });
  const r = runLiveCheck({
    songs: [noClick], settings: [settings('s3', 'C', 0)],
    manifest: buildManifest({ event, songs: [noClick], settings: [settings('s3', 'C', 0)] }),
    local: null, storageFreeBytes: 2e9, audioOutputConnected: true,
  });
  assert.equal(r.items.find((i) => i.id === 'click')!.status, 'fail');
  assert.equal(r.items.find((i) => i.id === 'guide')!.status, 'warn');
});

test('tom nao definido nao impede tocar — avisa e usa o original', () => {
  const r = runLiveCheck({
    songs, settings: [settings('s1', null, 0), settings('s2', 'D', 1)],
    manifest: buildManifest({ event, songs, settings: [settings('s1', null, 0), settings('s2', 'D', 1)] }),
    local: null, storageFreeBytes: 2e9, audioOutputConnected: true,
  });
  assert.equal(r.items.find((i) => i.id === 'key')!.status, 'warn');
});

test('sem espaco em disco, falha antes do culto e nao no meio dele', () => {
  const r = runLiveCheck({
    songs, settings: st, manifest, local: null,
    storageFreeBytes: 1_000_000, audioOutputConnected: true,
  });
  assert.equal(r.items.find((i) => i.id === 'storage')!.status, 'fail');
  assert.equal(r.ready, false);
});

test('musica ainda processando nao esta pronta', () => {
  const raw = makeSong({ id: 's9', beatGrid: null, sections: [] });
  assert.equal(isVsReady(raw), false);
  assert.equal(isVsReady(songs[0]!), true);
});
