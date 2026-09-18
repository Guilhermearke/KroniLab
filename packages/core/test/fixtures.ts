import { buildBeatGrid } from '../src/beatgrid.ts';
import type { ChurchEvent, EventSongSettings, Song, Stem, StemId } from '../src/types.ts';

export function makeStem(songId: string, id: StemId, bytes = 4_000_000): Stem {
  return { id, songId, url: `r2://${songId}/${id}.m4a`, bytes, sha256: `sha-${songId}-${id}`, defaultGainDb: 0 };
}

export function makeSong(overrides: Partial<Song> & { id: string }): Song {
  const grid = buildBeatGrid({ tempoMap: { segments: [{ startTime: 0, bpm: 72 }] }, duration: 240 });
  return {
    churchId: 'church-1',
    title: 'Musica',
    artist: null,
    originalKey: 'B',
    analysis: {
      key: 'B', mode: 'major', keyConfidence: 0.91, bpm: 72, bpmConfidence: 0.95,
      timeSignature: { beatsPerBar: 4, beatUnit: 4 }, manuallyCorrected: false,
    },
    stemLayout: 'six',
    stems: (['vocals', 'drums', 'bass', 'guitar', 'keys', 'other', 'click', 'guide'] as StemId[])
      .map((s) => makeStem(overrides.id, s)),
    beatGrid: grid,
    tempoMap: { segments: [{ startTime: 0, bpm: 72 }] },
    sections: [{ id: 'intro', type: 'Intro', label: 'Intro', startBar: 1, endBar: 9 }],
    guideCues: [{ bar: 1, text: 'Intro' }],
    waveforms: [],
    arrangements: [],
    source: null,
    processing: null,
    ...overrides,
  };
}

export const event: ChurchEvent = {
  id: 'ev-1', churchId: 'church-1', ministryId: 'min-1', name: 'Domingo 19h',
  startsAt: '2026-09-20T19:00:00-03:00', location: 'Templo', status: 'published', notes: null,
};

export function settings(songId: string, key: string | null, position = 0): EventSongSettings {
  return {
    id: `es-${songId}`, eventId: 'ev-1', songId, arrangementId: null, selectedKey: key,
    selectedTempo: null, position, notes: null, updatedAt: '2026-09-18T12:00:00Z',
  };
}
