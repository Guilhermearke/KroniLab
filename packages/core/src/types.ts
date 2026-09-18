/**
 * Modelo de dominio do KroniLab.
 *
 * Regra central do produto: a MUSICA e uma entidade completa e imutavel do
 * ponto de vista do culto (audio, stems, beat grid, tom original, secoes).
 * O que muda por culto vive em `EventSongSettings` — nunca na musica.
 */

// ---------------------------------------------------------------------------
// Igreja / pessoas
// ---------------------------------------------------------------------------

export type Role =
  | 'OWNER'
  | 'ADMIN'
  | 'WORSHIP_LEADER'
  | 'MINISTRY_LEADER'
  | 'MEMBER';

/** Ordem de poder. Usada por `can()` — nunca comparar strings soltas. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 50,
  ADMIN: 40,
  WORSHIP_LEADER: 30,
  MINISTRY_LEADER: 20,
  MEMBER: 10,
};

export interface Organization {
  id: string;
  name: string;
}

export interface Church {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
}

export type MinistryKind = 'LOUVOR' | 'MIDIA' | 'RECEPCAO' | 'INFANTIL' | 'OUTRO';

export interface Ministry {
  id: string;
  churchId: string;
  kind: MinistryKind;
  name: string;
}

export interface Member {
  id: string;
  churchId: string;
  userId: string;
  name: string;
  role: Role;
  /** Instrumento principal — dirige o preset do mixer no modo estudo. */
  instrument: Instrument | null;
  instruments: Instrument[];
  avatarUrl?: string | null;
  pushToken?: string | null;
}

export type Instrument =
  | 'MINISTRO'
  | 'VOCAL'
  | 'GUITARRA'
  | 'VIOLAO'
  | 'BAIXO'
  | 'BATERIA'
  | 'TECLADO'
  | 'SOM'
  | 'PROJECAO';

// ---------------------------------------------------------------------------
// Cultos e escala
// ---------------------------------------------------------------------------

export type EventStatus = 'draft' | 'published' | 'completed' | 'cancelled';

export interface ChurchEvent {
  id: string;
  churchId: string;
  ministryId: string;
  name: string;
  /** ISO 8601 com offset. */
  startsAt: string;
  location: string | null;
  status: EventStatus;
  notes: string | null;
}

export type AssignmentStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'replacement_requested';

export interface EventRole {
  id: string;
  eventId: string;
  instrument: Instrument;
  /** Quantas pessoas essa funcao pede neste culto (vocal costuma ser > 1). */
  slots: number;
}

export interface EventAssignment {
  id: string;
  eventId: string;
  eventRoleId: string;
  memberId: string;
  status: AssignmentStatus;
  respondedAt: string | null;
}

// ---------------------------------------------------------------------------
// Musica: audio, analise, VS
// ---------------------------------------------------------------------------

export type MusicalKey = string; // 'C', 'F#', 'Bb' — ver keys.ts
export type KeyMode = 'major' | 'minor';

export interface TimeSignature {
  beatsPerBar: number;
  beatUnit: number; // 4 = seminima
}

/** Um beat concreto da grade. O beat grid e a fonte da verdade do tempo. */
export interface Beat {
  /** Indice global, 0-based, na ordem do tempo. */
  index: number;
  /** Compasso, 1-based (como musico conta). */
  bar: number;
  /** Tempo dentro do compasso, 1-based. */
  beat: number;
  /** Segundos desde o inicio do audio. */
  timestamp: number;
  downbeat: boolean;
}

export interface BeatGrid {
  timeSignature: TimeSignature;
  beats: Beat[];
  /** Duracao total do audio em segundos. */
  duration: number;
}

/** BPM variavel: segmentos derivados/editaveis sobre o beat grid. */
export interface TempoSegment {
  startTime: number;
  bpm: number;
}

export interface TempoMap {
  segments: TempoSegment[];
}

export type SectionType =
  | 'Intro'
  | 'Verse'
  | 'PreChorus'
  | 'Chorus'
  | 'Bridge'
  | 'Instrumental'
  | 'Solo'
  | 'Break'
  | 'Outro';

/** Secoes SEMPRE em compassos, nunca em timestamps soltos. */
export interface Section {
  id: string;
  type: SectionType;
  /** Rotulo exibido (pt-BR): 'Refrao', 'Refrao 2'. */
  label: string;
  startBar: number;
  /** Exclusivo: a secao vai ate o inicio de `endBar`. */
  endBar: number;
}

export type StemId =
  | 'vocals'
  | 'drums'
  | 'bass'
  | 'guitar'
  | 'keys'
  | 'other'
  | 'click'
  | 'guide';

/** 6 stems quando o modelo aguenta; 4 como fallback. Nunca travar no modelo. */
export type StemLayout = 'six' | 'four';

export interface Stem {
  id: StemId;
  songId: string;
  url: string;
  /** Bytes — alimenta o manifesto offline. */
  bytes: number;
  sha256: string;
  /** Ganho de fabrica, dB. */
  defaultGainDb: number;
}

export interface Waveform {
  stemId: StemId;
  /** Picos normalizados 0..1, ~200 por minuto de audio. */
  peaks: number[];
  samplesPerSecond: number;
}

export interface AudioSource {
  id: string;
  songId: string;
  /** SHA-256 do arquivo original — chave de deduplicacao (item 7). */
  sha256: string;
  filename: string;
  bytes: number;
  durationSec: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface SongAnalysis {
  key: MusicalKey;
  mode: KeyMode;
  keyConfidence: number; // 0..1
  bpm: number;
  bpmConfidence: number;
  timeSignature: TimeSignature;
  /** True quando um humano corrigiu — o worker nunca sobrescreve correcao manual. */
  manuallyCorrected: boolean;
}

export interface GuideCue {
  /** Compasso onde a guia fala. */
  bar: number;
  /** Texto pt-BR: 'Refrao', 'Refrao em 2', '1'. */
  text: string;
}

export interface Arrangement {
  id: string;
  songId: string;
  name: string;
  /** Ordem das secoes; permite 'versao culto de domingo' sem reprocessar audio. */
  sectionIds: string[];
  isDefault: boolean;
}

export type ProcessingState =
  | 'queued'
  | 'preparing'
  | 'separating'
  | 'analyzing'
  | 'generating_click'
  | 'generating_guide'
  | 'uploading'
  | 'completed'
  | 'failed';

export interface ProcessingJob {
  id: string;
  songId: string;
  state: ProcessingState;
  progress: number; // 0..1
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** A musica completa. `vsReady` so e true com stems + grid + secoes + click. */
export interface Song {
  id: string;
  churchId: string;
  title: string;
  artist: string | null;
  originalKey: MusicalKey;
  analysis: SongAnalysis | null;
  stemLayout: StemLayout;
  stems: Stem[];
  beatGrid: BeatGrid | null;
  tempoMap: TempoMap | null;
  sections: Section[];
  guideCues: GuideCue[];
  waveforms: Waveform[];
  arrangements: Arrangement[];
  source: AudioSource | null;
  processing: ProcessingJob | null;
}

// ---------------------------------------------------------------------------
// Musica x culto
// ---------------------------------------------------------------------------

/**
 * Tudo que e especifico daquele culto. A musica original nunca muda.
 * 'Santo Pra Sempre' original B; domingo C; congresso Bb.
 */
export interface EventSongSettings {
  id: string;
  eventId: string;
  songId: string;
  arrangementId: string | null;
  /** null = ministro ainda nao definiu. */
  selectedKey: MusicalKey | null;
  /** null = usa o BPM analisado. */
  selectedTempo: number | null;
  position: number;
  notes: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

export type OfflineStatus = 'cloud' | 'downloading' | 'offline' | 'stale';

export interface ManifestAsset {
  key: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface OfflineManifest {
  eventId: string;
  /** Revisao logica: muda quando tom/arranjo/setlist muda (item 17 e 35). */
  revision: string;
  assets: ManifestAsset[];
  builtAt: string;
}

export interface LocalManifest {
  eventId: string;
  revision: string;
  downloadedKeys: string[];
  downloadedAt: string;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

export type QuantizeMode = 'next-beat' | 'next-bar' | 'end-of-section';

export interface LiveSessionState {
  eventId: string;
  songId: string;
  positionSec: number;
  playing: boolean;
  loopSectionId: string | null;
  queuedSectionId: string | null;
  quantize: QuantizeMode;
  mix: Record<string, number>;
  updatedAt: string;
}
