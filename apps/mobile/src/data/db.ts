/**
 * Banco local (SQLite).
 *
 * O Live Mode le DAQUI, nunca do Supabase. Durante o culto o app trabalha como
 * se a internet nao existisse — porque muitas vezes ela nao existe mesmo.
 *
 * Cloud -> Sync -> SQLite -> Live Mode
 */
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('kronilab.db');
  await migrate(db);
  return db;
}

async function migrate(conn: SQLite.SQLiteDatabase): Promise<void> {
  await conn.execAsync(`
    pragma journal_mode = WAL;

    create table if not exists events (
      id text primary key, church_id text not null, ministry_id text not null,
      name text not null, starts_at text not null, location text,
      status text not null, notes text, synced_at text
    );

    create table if not exists event_members (
      id text primary key, event_id text not null, event_role_id text not null,
      instrument text not null, member_id text not null, member_name text not null,
      status text not null, responded_at text
    );

    create table if not exists songs (
      id text primary key, church_id text not null, title text not null,
      artist text, original_key text not null, stem_layout text not null default 'six',
      duration_sec real not null default 0, vs_ready integer not null default 0
    );

    create table if not exists song_analysis (
      song_id text primary key, key text, mode text, key_confidence real,
      bpm real, bpm_confidence real, beats_per_bar integer default 4,
      manually_corrected integer default 0
    );

    -- Beat grid inteiro no disco: e o que o Live Mode consulta a cada salto.
    create table if not exists song_beats (
      song_id text not null, idx integer not null, bar integer not null,
      beat integer not null, timestamp_sec real not null, downbeat integer not null,
      primary key (song_id, idx)
    );
    create index if not exists song_beats_time on song_beats (song_id, timestamp_sec);

    create table if not exists song_sections (
      id text primary key, song_id text not null, type text not null, label text not null,
      start_bar integer not null, end_bar integer not null, position integer not null
    );

    create table if not exists song_stems (
      song_id text not null, stem text not null, remote_key text not null,
      local_uri text, bytes integer not null default 0, sha256 text,
      primary key (song_id, stem)
    );

    create table if not exists event_song_settings (
      event_id text not null, song_id text not null, arrangement_id text,
      selected_key text, selected_tempo real, position integer not null default 0,
      notes text,
      -- O que acontece quando a musica acaba, e se o pad segura o tom.
      transition text not null default 'stop',
      pad_enabled integer not null default 0,
      updated_at text, primary key (event_id, song_id)
    );

    create table if not exists offline_manifests (
      event_id text primary key, revision text not null,
      downloaded_keys text not null, downloaded_at text not null
    );

    -- Retomada apos crash (item 45): o estado do palco sobrevive ao app morrer.
    create table if not exists live_session (
      event_id text primary key, song_id text, position_sec real default 0,
      loop_section_id text, quantize text default 'next-bar',
      mix text default '{}', updated_at text
    );

    create table if not exists event_log (
      id integer primary key autoincrement, event_id text, song_id text,
      kind text not null, payload text, at text not null
    );
  `);
}

export async function saveLiveSession(state: {
  eventId: string; songId: string; positionSec: number;
  loopSectionId: string | null; quantize: string; mix: Record<string, number>;
}): Promise<void> {
  const conn = await getDb();
  await conn.runAsync(
    `insert into live_session (event_id, song_id, position_sec, loop_section_id, quantize, mix, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(event_id) do update set
       song_id = excluded.song_id, position_sec = excluded.position_sec,
       loop_section_id = excluded.loop_section_id, quantize = excluded.quantize,
       mix = excluded.mix, updated_at = excluded.updated_at`,
    [state.eventId, state.songId, state.positionSec, state.loopSectionId,
     state.quantize, JSON.stringify(state.mix), new Date().toISOString()],
  );
}

export async function loadLiveSession(eventId: string) {
  const conn = await getDb();
  return conn.getFirstAsync<{
    event_id: string; song_id: string | null; position_sec: number;
    loop_section_id: string | null; quantize: string; mix: string; updated_at: string;
  }>('select * from live_session where event_id = ?', [eventId]);
}

/** Log local (item 46). Fica no aparelho ate ter rede para subir. */
export async function logEvent(
  kind: 'play' | 'pause' | 'jump' | 'loop' | 'nudge' | 'tap' | 'download_failure' | 'audio_underrun' | 'crash',
  data: { eventId?: string; songId?: string; payload?: unknown } = {},
): Promise<void> {
  const conn = await getDb();
  await conn.runAsync(
    'insert into event_log (event_id, song_id, kind, payload, at) values (?, ?, ?, ?, ?)',
    [data.eventId ?? null, data.songId ?? null, kind,
     data.payload ? JSON.stringify(data.payload) : null, new Date().toISOString()],
  );
}
