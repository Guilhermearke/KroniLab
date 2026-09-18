/**
 * Leitura do banco local. Toda tela le por aqui — inclusive o Live Mode, que
 * por isso funciona identico com ou sem rede.
 */
import type {
  Beat, BeatGrid, ChurchEvent, EventSongSettings, Instrument, Section, Song, StemId,
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
    transition: r.transition ?? 'stop', padEnabled: !!r.pad_enabled,
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

// ---------------------------------------------------------------------------
// Escrita: criar culto, montar escala, editar repertorio
// ---------------------------------------------------------------------------

export async function createEvent(input: {
  churchId: string;
  ministryId: string;
  name: string;
  startsAt: string;
  location: string | null;
  notes: string | null;
  roles: { instrument: Instrument; slots: number }[];
}): Promise<string> {
  const conn = await getDb();
  const id = `ev-${Date.now()}`;
  await conn.runAsync(
    `insert into events (id, church_id, ministry_id, name, starts_at, location, status, notes)
     values (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [id, input.churchId, input.ministryId, input.name, input.startsAt, input.location, input.notes],
  );
  // As funcoes do culto nascem junto: uma escala sem funcoes nao e escala.
  for (const role of input.roles) {
    await conn.runAsync(
      `insert into event_members (id, event_id, event_role_id, instrument, member_id, member_name, status)
       values (?, ?, ?, ?, '', '', 'pending')`,
      [`${id}-${role.instrument}`, id, `${id}-role-${role.instrument}`, role.instrument],
    );
  }
  return id;
}

export async function assignMember(input: {
  eventId: string;
  instrument: Instrument;
  memberId: string;
  memberName: string;
}): Promise<void> {
  const conn = await getDb();
  await conn.runAsync(
    `insert into event_members (id, event_id, event_role_id, instrument, member_id, member_name, status)
     values (?, ?, ?, ?, ?, ?, 'pending')
     on conflict(id) do update set member_id = excluded.member_id,
       member_name = excluded.member_name, status = 'pending', responded_at = null`,
    [`${input.eventId}-${input.instrument}`, input.eventId,
     `${input.eventId}-role-${input.instrument}`, input.instrument,
     input.memberId, input.memberName],
  );
}

export async function clearAssignment(eventId: string, instrument: Instrument): Promise<void> {
  const conn = await getDb();
  await conn.runAsync(
    `update event_members set member_id = '', member_name = '', status = 'pending'
      where event_id = ? and instrument = ?`,
    [eventId, instrument],
  );
}

/** Grava a ordem inteira de uma vez: meia ordem salva e ordem divergente. */
export async function saveSetlist(eventId: string, settings: EventSongSettings[]): Promise<void> {
  const conn = await getDb();
  await conn.withTransactionAsync(async () => {
    await conn.runAsync('delete from event_song_settings where event_id = ?', [eventId]);
    for (const s of settings) {
      await conn.runAsync(
        `insert into event_song_settings
           (event_id, song_id, arrangement_id, selected_key, selected_tempo, position, notes, transition, pad_enabled, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, s.songId, s.arrangementId, s.selectedKey, s.selectedTempo,
         s.position, s.notes, s.transition ?? 'stop', s.padEnabled ? 1 : 0,
         new Date().toISOString()],
      );
    }
  });
}

export async function listSongs(churchId: string): Promise<Song[]> {
  const conn = await getDb();
  const rows = await conn.getAllAsync<{ id: string }>(
    'select id from songs where church_id = ? order by title', [churchId],
  );
  const songs = await Promise.all(rows.map((r) => getSong(r.id)));
  return songs.filter((s): s is Song => s !== null);
}
