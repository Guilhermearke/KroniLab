/**
 * Leitura do banco local. Toda tela le por aqui — inclusive o Live Mode, que
 * por isso funciona identico com ou sem rede.
 */
import type {
  Beat, BeatGrid, ChurchEvent, EventSongSettings, Section, Song, StemId,
} from '@kronilab/core';
import { getDb } from './db.ts';

export async function listUpcomingEvents(churchId: string): Promise<ChurchEvent[]> {
  const conn = await getDb();
  const rows = await conn.getAllAsync<any>(
    `select * from events where church_id = ? and status != 'cancelled'
       and starts_at >= datetime('now', '-6 hours') order by starts_at asc`,
    [churchId],
  );
  return rows.map(toEvent);
}

export async function getEvent(eventId: string): Promise<ChurchEvent | null> {
  const conn = await getDb();
  const row = await conn.getFirstAsync<any>('select * from events where id = ?', [eventId]);
  return row ? toEvent(row) : null;
}

export async function getEventSettings(eventId: string): Promise<EventSongSettings[]> {
  const conn = await getDb();
  const rows = await conn.getAllAsync<any>(
    'select * from event_song_settings where event_id = ? order by position asc', [eventId],
  );
  return rows.map((r) => ({
    id: `${r.event_id}:${r.song_id}`, eventId: r.event_id, songId: r.song_id,
    arrangementId: r.arrangement_id, selectedKey: r.selected_key,
    selectedTempo: r.selected_tempo, position: r.position, notes: r.notes,
    updatedAt: r.updated_at,
  }));
}

/** Carrega a musica inteira, incluindo o beat grid. */
export async function getSong(songId: string): Promise<Song | null> {
  const conn = await getDb();
  const row = await conn.getFirstAsync<any>('select * from songs where id = ?', [songId]);
  if (!row) return null;

  const [analysis, beats, sections, stems] = await Promise.all([
    conn.getFirstAsync<any>('select * from song_analysis where song_id = ?', [songId]),
    conn.getAllAsync<any>('select * from song_beats where song_id = ? order by idx asc', [songId]),
    conn.getAllAsync<any>('select * from song_sections where song_id = ? order by position asc', [songId]),
    conn.getAllAsync<any>('select * from song_stems where song_id = ?', [songId]),
  ]);

  const grid: BeatGrid | null = beats.length
    ? {
        timeSignature: { beatsPerBar: analysis?.beats_per_bar ?? 4, beatUnit: 4 },
        beats: beats.map<Beat>((b) => ({
          index: b.idx, bar: b.bar, beat: b.beat,
          timestamp: b.timestamp_sec, downbeat: !!b.downbeat,
        })),
        duration: row.duration_sec,
      }
    : null;

  return {
    id: row.id, churchId: row.church_id, title: row.title, artist: row.artist,
    originalKey: row.original_key, stemLayout: row.stem_layout,
    analysis: analysis ? {
      key: analysis.key, mode: analysis.mode, keyConfidence: analysis.key_confidence,
      bpm: analysis.bpm, bpmConfidence: analysis.bpm_confidence,
      timeSignature: { beatsPerBar: analysis.beats_per_bar, beatUnit: 4 },
      manuallyCorrected: !!analysis.manually_corrected,
    } : null,
    stems: stems.map((s) => ({
      id: s.stem as StemId, songId: songId, url: s.local_uri ?? s.remote_key,
      bytes: s.bytes, sha256: s.sha256 ?? '', defaultGainDb: 0,
    })),
    beatGrid: grid, tempoMap: null,
    sections: sections.map<Section>((s) => ({
      id: s.id, type: s.type, label: s.label, startBar: s.start_bar, endBar: s.end_bar,
    })),
    guideCues: [], waveforms: [], arrangements: [], source: null, processing: null,
  };
}

export async function getSetlist(eventId: string): Promise<{ settings: EventSongSettings[]; songs: Song[] }> {
  const settings = await getEventSettings(eventId);
  const songs = (await Promise.all(settings.map((s) => getSong(s.songId))))
    .filter((s): s is Song => s !== null);
  return { settings, songs };
}

/** Caminhos LOCAIS dos stems. Vazio = nao baixado; o Live Check pega isso. */
export async function getLocalStems(songId: string): Promise<{ stem: StemId; uri: string }[]> {
  const conn = await getDb();
  const rows = await conn.getAllAsync<any>(
    'select stem, local_uri from song_stems where song_id = ? and local_uri is not null', [songId],
  );
  return rows.map((r) => ({ stem: r.stem as StemId, uri: r.local_uri }));
}

export async function setSelectedKey(eventId: string, songId: string, key: string | null): Promise<void> {
  const conn = await getDb();
  await conn.runAsync(
    `update event_song_settings set selected_key = ?, updated_at = ?
      where event_id = ? and song_id = ?`,
    [key, new Date().toISOString(), eventId, songId],
  );
}

function toEvent(row: any): ChurchEvent {
  return {
    id: row.id, churchId: row.church_id, ministryId: row.ministry_id, name: row.name,
    startsAt: row.starts_at, location: row.location, status: row.status, notes: row.notes,
  };
}
