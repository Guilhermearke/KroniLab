-- =============================================================================
-- KroniLab — schema inicial
--
-- Principios:
--  1. Toda linha pertence a uma igreja. RLS filtra por igreja, sempre.
--  2. A musica e imutavel do ponto de vista do culto. O que muda por culto vive
--     em event_song_settings.
--  3. O beat grid e persistido beat a beat: e a fonte da verdade do tempo.
--  4. Deduplicacao por SHA-256 do audio original — GPU e cara.
-- =============================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Organizacao / igreja / ministerios
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz not null default now()
);

create table churches (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create type member_role as enum ('OWNER','ADMIN','WORSHIP_LEADER','MINISTRY_LEADER','MEMBER');
create type instrument as enum ('MINISTRO','VOCAL','GUITARRA','VIOLAO','BAIXO','BATERIA','TECLADO','SOM','PROJECAO');

create table church_members (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role member_role not null default 'MEMBER',
  instrument instrument,
  instruments instrument[] not null default '{}',
  avatar_url text,
  push_token text,
  created_at timestamptz not null default now(),
  unique (church_id, user_id)
);

create type ministry_kind as enum ('LOUVOR','MIDIA','RECEPCAO','INFANTIL','OUTRO');

create table ministries (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  kind ministry_kind not null default 'LOUVOR',
  name text not null
);

create table ministry_members (
  id uuid primary key default uuid_generate_v4(),
  ministry_id uuid not null references ministries(id) on delete cascade,
  member_id uuid not null references church_members(id) on delete cascade,
  is_leader boolean not null default false,
  unique (ministry_id, member_id)
);

-- ---------------------------------------------------------------------------
-- Cultos e escala
-- ---------------------------------------------------------------------------

create type event_status as enum ('draft','published','completed','cancelled');
create type assignment_status as enum ('pending','confirmed','declined','replacement_requested');

create table events (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  ministry_id uuid not null references ministries(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  location text,
  status event_status not null default 'draft',
  notes text,
  created_by uuid references church_members(id),
  created_at timestamptz not null default now()
);
create index on events (church_id, starts_at desc);

create table event_roles (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  instrument instrument not null,
  slots int not null default 1 check (slots > 0),
  unique (event_id, instrument)
);

create table event_members (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  event_role_id uuid not null references event_roles(id) on delete cascade,
  member_id uuid not null references church_members(id) on delete cascade,
  status assignment_status not null default 'pending',
  responded_at timestamptz,
  unique (event_id, event_role_id, member_id)
);
create index on event_members (member_id, status);

-- ---------------------------------------------------------------------------
-- Musicas e processamento de IA
-- ---------------------------------------------------------------------------

create type key_mode as enum ('major','minor');
create type stem_layout as enum ('six','four');
create type stem_id as enum ('vocals','drums','bass','guitar','keys','other','click','guide');
create type section_type as enum ('Intro','Verse','PreChorus','Chorus','Bridge','Instrumental','Solo','Break','Outro');
create type processing_state as enum (
  'queued','preparing','separating','analyzing',
  'generating_click','generating_guide','uploading','completed','failed'
);

create table songs (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  title text not null,
  artist text,
  original_key text not null default 'C',
  stem_layout stem_layout not null default 'six',
  created_by uuid references church_members(id),
  created_at timestamptz not null default now()
);
create index on songs (church_id, title);

-- O audio original. sha256 e a chave de deduplicacao (item 7): se a igreja
-- subir o mesmo arquivo de novo, nao gastamos GPU outra vez.
create table audio_sources (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references songs(id) on delete cascade,
  church_id uuid not null references churches(id) on delete cascade,
  sha256 text not null,
  filename text not null,
  bytes bigint not null,
  duration_sec numeric(10,3) not null,
  storage_key text not null,
  uploaded_by uuid references church_members(id),
  uploaded_at timestamptz not null default now()
);
-- Dedup dentro da igreja: o mesmo audio em outra igreja nao vaza dados.
create unique index audio_sources_dedup on audio_sources (church_id, sha256);

create table song_stems (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references songs(id) on delete cascade,
  stem stem_id not null,
  storage_key text not null,
  bytes bigint not null,
  sha256 text not null,
  default_gain_db numeric(5,2) not null default 0,
  unique (song_id, stem)
);

create table song_analysis (
  song_id uuid primary key references songs(id) on delete cascade,
  key text not null,
  mode key_mode not null default 'major',
  key_confidence numeric(4,3) not null default 0,
  bpm numeric(6,2) not null,
  bpm_confidence numeric(4,3) not null default 0,
  beats_per_bar int not null default 4,
  beat_unit int not null default 4,
  -- Correcao humana e soberana: o worker nunca sobrescreve.
  manually_corrected boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Beat grid completo. ~360 linhas para uma musica de 5 min a 72 BPM.
create table song_beats (
  song_id uuid not null references songs(id) on delete cascade,
  idx int not null,
  bar int not null,
  beat int not null,
  timestamp_sec numeric(10,4) not null,
  downbeat boolean not null default false,
  primary key (song_id, idx)
);
create index on song_beats (song_id, timestamp_sec);

create table tempo_maps (
  song_id uuid not null references songs(id) on delete cascade,
  start_time numeric(10,4) not null,
  bpm numeric(6,2) not null,
  primary key (song_id, start_time)
);

create table song_sections (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references songs(id) on delete cascade,
  type section_type not null,
  label text not null,
  start_bar int not null,
  end_bar int not null,
  position int not null,
  check (end_bar > start_bar)
);
create index on song_sections (song_id, position);

create table guide_cues (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references songs(id) on delete cascade,
  bar int not null,
  text text not null
);

create table waveforms (
  song_id uuid not null references songs(id) on delete cascade,
  stem stem_id not null,
  peaks jsonb not null,
  samples_per_second int not null default 20,
  primary key (song_id, stem)
);

-- Arranjo: reordena/repete secoes sem reprocessar audio.
create table song_arrangements (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references songs(id) on delete cascade,
  name text not null,
  section_ids uuid[] not null,
  is_default boolean not null default false
);

create table processing_jobs (
  id uuid primary key default uuid_generate_v4(),
  song_id uuid not null references songs(id) on delete cascade,
  church_id uuid not null references churches(id) on delete cascade,
  state processing_state not null default 'queued',
  progress numeric(4,3) not null default 0,
  provider text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on processing_jobs (church_id, state);

-- ---------------------------------------------------------------------------
-- Musica x culto
-- ---------------------------------------------------------------------------

create table event_songs (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  song_id uuid not null references songs(id) on delete restrict,
  position int not null,
  unique (event_id, song_id)
);

-- O coracao do item 33: a musica original nunca muda; isto muda por culto.
create table event_song_settings (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  song_id uuid not null references songs(id) on delete cascade,
  arrangement_id uuid references song_arrangements(id) on delete set null,
  selected_key text,
  selected_tempo numeric(6,2),
  position int not null default 0,
  notes text,
  updated_by uuid references church_members(id),
  updated_at timestamptz not null default now(),
  unique (event_id, song_id)
);

create table setlists (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table setlist_items (
  id uuid primary key default uuid_generate_v4(),
  setlist_id uuid not null references setlists(id) on delete cascade,
  song_id uuid not null references songs(id) on delete cascade,
  position int not null
);

create table offline_manifests (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  revision text not null,
  assets jsonb not null,
  built_at timestamptz not null default now(),
  unique (event_id, revision)
);

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  church_id uuid not null references churches(id) on delete cascade,
  member_id uuid not null references church_members(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (member_id, read_at);

-- ---------------------------------------------------------------------------
-- Gatilho: mudou o tom -> a revisao do culto muda -> equipe recebe aviso
-- (itens 17 e 35). Isso e regra de negocio, nao de UI: precisa valer para
-- qualquer cliente que escreva no banco.
-- ---------------------------------------------------------------------------

create or replace function notify_key_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  song_title text;
  event_name text;
  church uuid;
begin
  if tg_op = 'UPDATE' and new.selected_key is not distinct from old.selected_key then
    return new;
  end if;

  select s.title, s.church_id into song_title, church from songs s where s.id = new.song_id;
  select e.name into event_name from events e where e.id = new.event_id;

  insert into notifications (church_id, member_id, kind, title, body, payload)
  select church, em.member_id, 'key_changed',
         'Tom atualizado',
         song_title || ': ' || coalesce(old.selected_key, 'original') || ' -> ' || coalesce(new.selected_key, 'original'),
         jsonb_build_object('eventId', new.event_id, 'songId', new.song_id, 'key', new.selected_key)
  from event_members em
  where em.event_id = new.event_id;

  new.updated_at := now();
  return new;
end;
$$;

create trigger event_song_settings_key_change
  before update on event_song_settings
  for each row execute function notify_key_change();

-- ---------------------------------------------------------------------------
-- RLS — tudo filtrado por igreja
-- ---------------------------------------------------------------------------

create or replace function current_member_churches() returns setof uuid
language sql stable security definer set search_path = public as $$
  select church_id from church_members where user_id = auth.uid();
$$;

create or replace function has_role(target_church uuid, minimum member_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from church_members m
    where m.user_id = auth.uid()
      and m.church_id = target_church
      and case m.role
            when 'OWNER' then 50 when 'ADMIN' then 40 when 'WORSHIP_LEADER' then 30
            when 'MINISTRY_LEADER' then 20 else 10 end
          >=
          case minimum
            when 'OWNER' then 50 when 'ADMIN' then 40 when 'WORSHIP_LEADER' then 30
            when 'MINISTRY_LEADER' then 20 else 10 end
  );
$$;

alter table organizations enable row level security;
alter table churches enable row level security;
alter table church_members enable row level security;
alter table ministries enable row level security;
alter table ministry_members enable row level security;
alter table events enable row level security;
alter table event_roles enable row level security;
alter table event_members enable row level security;
alter table songs enable row level security;
alter table audio_sources enable row level security;
alter table song_stems enable row level security;
alter table song_analysis enable row level security;
alter table song_beats enable row level security;
alter table tempo_maps enable row level security;
alter table song_sections enable row level security;
alter table guide_cues enable row level security;
alter table waveforms enable row level security;
alter table song_arrangements enable row level security;
alter table processing_jobs enable row level security;
alter table event_songs enable row level security;
alter table event_song_settings enable row level security;
alter table setlists enable row level security;
alter table setlist_items enable row level security;
alter table offline_manifests enable row level security;
alter table notifications enable row level security;

-- A organizacao e visivel para quem pertence a alguma igreja dela.
create policy organizations_read on organizations for select
  using (id in (select organization_id from churches where id in (select current_member_churches())));
create policy church_read on churches for select using (id in (select current_member_churches()));
create policy members_read on church_members for select using (church_id in (select current_member_churches()));
create policy ministries_read on ministries for select using (church_id in (select current_member_churches()));
create policy events_read on events for select using (church_id in (select current_member_churches()));
create policy songs_read on songs for select using (church_id in (select current_member_churches()));
create policy audio_read on audio_sources for select using (church_id in (select current_member_churches()));
create policy jobs_read on processing_jobs for select using (church_id in (select current_member_churches()));
create policy setlists_read on setlists for select using (church_id in (select current_member_churches()));
create policy notifications_read on notifications for select
  using (member_id in (select id from church_members where user_id = auth.uid()));

-- Tabelas filhas herdam o acesso da musica/culto pai.
create policy stems_read on song_stems for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy analysis_read on song_analysis for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy beats_read on song_beats for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy tempo_read on tempo_maps for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy sections_read on song_sections for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy cues_read on guide_cues for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy waveforms_read on waveforms for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy arrangements_read on song_arrangements for select
  using (song_id in (select id from songs where church_id in (select current_member_churches())));
create policy event_roles_read on event_roles for select
  using (event_id in (select id from events where church_id in (select current_member_churches())));
create policy event_members_read on event_members for select
  using (event_id in (select id from events where church_id in (select current_member_churches())));
create policy event_songs_read on event_songs for select
  using (event_id in (select id from events where church_id in (select current_member_churches())));
create policy event_song_settings_read on event_song_settings for select
  using (event_id in (select id from events where church_id in (select current_member_churches())));
create policy setlist_items_read on setlist_items for select
  using (setlist_id in (select id from setlists where church_id in (select current_member_churches())));
create policy manifests_read on offline_manifests for select
  using (event_id in (select id from events where church_id in (select current_member_churches())));

-- Escrita: quem manda na escala e o lider; o tom e do ministro; o membro so
-- responde a propria escala.
create policy events_write on events for all
  using (has_role(church_id, 'MINISTRY_LEADER')) with check (has_role(church_id, 'MINISTRY_LEADER'));

create policy songs_write on songs for all
  using (has_role(church_id, 'WORSHIP_LEADER')) with check (has_role(church_id, 'WORSHIP_LEADER'));

create policy key_write on event_song_settings for all
  using (event_id in (select id from events e where has_role(e.church_id, 'WORSHIP_LEADER')))
  with check (event_id in (select id from events e where has_role(e.church_id, 'WORSHIP_LEADER')));

create policy assignment_respond on event_members for update
  using (member_id in (select id from church_members where user_id = auth.uid()))
  with check (member_id in (select id from church_members where user_id = auth.uid()));
