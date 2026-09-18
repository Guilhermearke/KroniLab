/**
 * Setlist e arranjo da demo.
 *
 * Nenhum audio de terceiro e usado: a VS e sintetizada a partir deste plano.
 * As cifras existem tanto para desenhar a linha de acordes quanto para gerar o
 * que toca — e o mesmo dado, entao a tela nunca mente sobre o audio.
 */
import { buildBeatGrid } from '@kronilab/core';
import type { Beat, BeatGrid, Section, SectionType, TransitionMode } from '@kronilab/core';
import type { ImportedAudio } from './importer.ts';
import type { StoredSong } from './store.ts';

/** `mix` e a gravacao inteira de uma musica importada, antes da separacao. */
export type StemKey = 'click' | 'guide' | 'vocals' | 'drums' | 'bass' | 'guitar' | 'keys' | 'other' | 'mix';

export interface StemMeta {
  key: StemKey;
  label: string;
  color: string;
}

/** Cores das lanes. Cada stem tem a sua e ela se repete no mixer. */
export const STEMS: StemMeta[] = [
  { key: 'vocals', label: 'Vocais', color: '#F20D0D' },
  { key: 'drums', label: 'Bateria', color: '#F2B90D' },
  { key: 'bass', label: 'Baixo', color: '#94C20A' },
  { key: 'guitar', label: 'Guitarra', color: '#0AC238' },
  { key: 'keys', label: 'Piano', color: '#0AC285' },
  { key: 'other', label: 'Outro', color: '#F20D80' },
];

export const MIX_STEM: StemMeta = { key: 'mix', label: 'Mix', color: '#2F80ED' };

/** Lanes/canais de uma musica: os stems disponiveis ou mix. */
export function stemsFor(song: DemoSong): StemMeta[] {
  if (song.stems && Object.keys(song.stems).length > 0) {
    // Se tem stems separados, exibe os que estao presentes.
    const keys = Object.keys(song.stems) as StemKey[];
    return STEMS.filter((s) => keys.includes(s.key));
  }
  return song.audio ? [MIX_STEM] : STEMS;
}

export const CLICK_COLOR = '#64748B';
export const GUIDE_COLOR = '#8B5CF6';

/** Acorde: semitons acima da tonica + qualidade. */
export interface Chord {
  degree: number;
  quality: 'maj' | 'min' | 'sus2' | 'sus4' | 'aug' | 'dim';
}

export interface DemoSection extends Section {
  /** Um acorde por compasso (ciclado se a secao for maior). */
  chords: Chord[];
  /** Densidade do arranjo — e o que faz cada secao soar diferente. */
  layers: StemKey[];
}

export interface DemoSong {
  id: string;
  title: string;
  artist: string;
  originalKey: string;
  selectedKey: string | null;
  bpm: number;
  beatsPerBar: number;
  countInBars: number;
  grid: BeatGrid;
  sections: DemoSection[];
  durationSec: number;
  /** O que acontece quando esta musica acaba (configuracao do culto). */
  transition: TransitionMode;
  padEnabled: boolean;
  /** Presente quando a musica veio de um arquivo de Mix (gravação real). */
  audio?: ImportedAudio;
  /** Presente quando a musica veio de stems importados separadamente. */
  stems?: Record<string, ImportedAudio>;
  /** Origem no IndexedDB, para editar/apagar. */
  storedId?: string;
}

const C = (degree: number, quality: Chord['quality'] = 'maj'): Chord => ({ degree, quality });

interface SectionPlan {
  type: SectionType;
  label: string;
  bars: number;
  chords: Chord[];
  layers: StemKey[];
}

function make(
  id: string, title: string, artist: string, key: string, selectedKey: string | null,
  bpm: number, plan: SectionPlan[],
  transition: TransitionMode = 'stop', padEnabled = true,
): DemoSong {
  let bar = 1;
  const sections: DemoSection[] = plan.map((p, i) => {
    const s: DemoSection = {
      id: `${id}-${i}`, type: p.type, label: p.label,
      startBar: bar, endBar: bar + p.bars,
      chords: p.chords, layers: p.layers,
    };
    bar += p.bars;
    return s;
  });
  const totalBars = bar - 1;
  const durationSec = (totalBars * 4 * 60) / bpm;
  return {
    id, title, artist, originalKey: key, selectedKey, bpm,
    beatsPerBar: 4, countInBars: 2,
    grid: buildBeatGrid({
      tempoMap: { segments: [{ startTime: 0, bpm }] },
      duration: durationSec + 2,
    }),
    sections, durationSec, transition, padEnabled,
  };
}

const FULL: StemKey[] = ['vocals', 'drums', 'bass', 'guitar', 'keys', 'other'];

export const SETLIST: DemoSong[] = [
  make('s1', 'Santo Pra Sempre', 'Demo KroniLab', 'C', 'C', 115, [
    { type: 'Intro', label: 'Intro', bars: 4, chords: [C(0), C(5), C(7), C(5)], layers: ['keys', 'other'] },
    { type: 'Verse', label: 'Verso', bars: 8, chords: [C(9, 'min'), C(5), C(0), C(7)], layers: ['keys', 'bass', 'drums', 'vocals'] },
    { type: 'PreChorus', label: 'Pre-refrao', bars: 4, chords: [C(5), C(7), C(9, 'min'), C(7)], layers: ['keys', 'bass', 'drums', 'guitar', 'vocals'] },
    { type: 'Chorus', label: 'Refrao', bars: 8, chords: [C(0), C(7), C(9, 'min'), C(5)], layers: FULL },
    { type: 'Verse', label: 'Verso 2', bars: 8, chords: [C(9, 'min'), C(5), C(0), C(7)], layers: ['keys', 'bass', 'drums', 'vocals'] },
    { type: 'Chorus', label: 'Refrao 2', bars: 8, chords: [C(0), C(7), C(9, 'min'), C(5)], layers: FULL },
    { type: 'Bridge', label: 'Ponte', bars: 8, chords: [C(5, 'sus2'), C(9, 'min'), C(7), C(0)], layers: ['keys', 'bass', 'other', 'vocals'] },
    { type: 'Chorus', label: 'Refrao 3', bars: 8, chords: [C(0), C(7), C(9, 'min'), C(5)], layers: FULL },
    { type: 'Outro', label: 'Final', bars: 4, chords: [C(5), C(0)], layers: ['keys', 'other'] },
  ], 'crossfade'),
  make('s2', 'Gratidao', 'Demo KroniLab', 'D', 'D', 132, [
    { type: 'Intro', label: 'Intro', bars: 4, chords: [C(0), C(7)], layers: ['guitar', 'keys'] },
    { type: 'Verse', label: 'Verso', bars: 8, chords: [C(0), C(5), C(7), C(9, 'min')], layers: ['guitar', 'bass', 'drums', 'vocals'] },
    { type: 'Chorus', label: 'Refrao', bars: 8, chords: [C(5), C(0), C(7), C(7)], layers: FULL },
    { type: 'Instrumental', label: 'Instrumental', bars: 4, chords: [C(9, 'min'), C(5)], layers: ['guitar', 'drums', 'bass', 'keys'] },
    { type: 'Chorus', label: 'Refrao 2', bars: 8, chords: [C(5), C(0), C(7), C(7)], layers: FULL },
    { type: 'Outro', label: 'Final', bars: 4, chords: [C(0)], layers: ['keys'] },
  ], 'pad'),
  make('s3', 'Yeshua', 'Demo KroniLab', 'E', null, 88, [
    { type: 'Intro', label: 'Intro', bars: 4, chords: [C(0, 'sus2'), C(0)], layers: ['keys'] },
    { type: 'Verse', label: 'Verso', bars: 8, chords: [C(0), C(9, 'min'), C(5), C(7)], layers: ['keys', 'bass', 'vocals'] },
    { type: 'Chorus', label: 'Refrao', bars: 8, chords: [C(5), C(7), C(0), C(0)], layers: FULL },
    { type: 'Bridge', label: 'Ponte', bars: 12, chords: [C(9, 'min'), C(5), C(0), C(7)], layers: ['keys', 'bass', 'other'] },
    { type: 'Chorus', label: 'Refrao 2', bars: 8, chords: [C(5), C(7), C(0), C(0)], layers: FULL },
  ]),
];

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_TO_FLAT: Record<string, string> = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };

export function pitchClassOf(key: string): number {
  const n = SHARP_TO_FLAT[key] ?? key;
  const i = NAMES.indexOf(n);
  return i < 0 ? 0 : i;
}

const SUFFIX: Record<Chord['quality'], string> = {
  maj: '', min: 'm', sus2: 'sus2', sus4: 'sus4', aug: 'aug', dim: 'dim',
};

/** Nome do acorde ja no tom do culto — a cifra acompanha a transposicao. */
export function chordName(chord: Chord, key: string): string {
  const pc = (pitchClassOf(key) + chord.degree) % 12;
  return NAMES[pc] + SUFFIX[chord.quality];
}

/** Intervalos de cada qualidade, para o sintetizador montar o acorde. */
export const CHORD_INTERVALS: Record<Chord['quality'], number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], sus2: [0, 2, 7],
  sus4: [0, 5, 7], aug: [0, 4, 8], dim: [0, 3, 6],
};

export function chordAtBar(section: DemoSection, bar: number): Chord {
  const offset = bar - section.startBar;
  return section.chords[offset % section.chords.length]!;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Musicas importadas
// ---------------------------------------------------------------------------

export const SECTION_TYPES: { type: SectionType; label: string }[] = [
  { type: 'Intro', label: 'Intro' },
  { type: 'Verse', label: 'Verso' },
  { type: 'PreChorus', label: 'Pre-refrao' },
  { type: 'Chorus', label: 'Refrao' },
  { type: 'Bridge', label: 'Ponte' },
  { type: 'Instrumental', label: 'Instrumental' },
  { type: 'Solo', label: 'Solo' },
  { type: 'Break', label: 'Break' },
  { type: 'Outro', label: 'Final' },
];

export function barsInAudio(durationSec: number, bpm: number, firstDownbeatAt: number, beatsPerBar = 4): number {
  const secPerBar = (60 / bpm) * beatsPerBar;
  return Math.max(1, Math.floor((durationSec - firstDownbeatAt) / secPerBar));
}

/** Monta uma DemoSong a partir do IndexedDB + áudio(s) decodificado(s). */
export function songFromStored(
  stored: StoredSong,
  audio?: ImportedAudio,
  stems?: Record<string, ImportedAudio>
): DemoSong {
  // A duração vem do primeiro áudio disponível
  const durationSec = audio?.buffer.duration ?? Object.values(stems || {})[0]?.buffer.duration ?? 0;
  const totalBars = barsInAudio(durationSec, stored.bpm, stored.firstDownbeatAt, stored.beatsPerBar);
  
  let grid: BeatGrid;
  if (stored.beats && stored.beats.length > 0) {
    // Grade variável
    const beatsObj: Beat[] = stored.beats.map((t, i) => {
      // Reconstroi os beats — assumindo 4/4 e que stored.beats sao sequenciais
      const bar = Math.floor(i / 4) + 1;
      const beatInBar = (i % 4) + 1;
      return { index: i, bar, beat: beatInBar, timestamp: t, downbeat: beatInBar === 1 };
    });
    grid = {
      timeSignature: { beatsPerBar: stored.beatsPerBar, beatUnit: 4 },
      beats: beatsObj,
      duration: durationSec + 4,
    };
  } else {
    // Grade fixa
    grid = buildBeatGrid({
      tempoMap: { segments: [{ startTime: 0, bpm: stored.bpm }] },
      duration: durationSec + 4,
      timeSignature: { beatsPerBar: stored.beatsPerBar, beatUnit: 4 },
      firstDownbeatAt: stored.firstDownbeatAt,
    });
  }

  let bar = 1;
  const sections: DemoSection[] = stored.sections.map((p, i, all) => {
    const isLast = i === all.length - 1;
    const end = isLast ? Math.max(bar + 1, totalBars + 1) : Math.min(totalBars + 1, bar + p.bars);
    const section: DemoSection = {
      id: `${stored.id}-${i}`, type: p.type, label: p.label,
      startBar: bar, endBar: end, chords: [C(0)], layers: ['mix'],
    };
    bar = end;
    return section;
  }).filter((s) => s.endBar > s.startBar);

  return {
    id: stored.id, title: stored.title, artist: stored.artist,
    originalKey: stored.key, selectedKey: null, bpm: stored.bpm,
    beatsPerBar: stored.beatsPerBar, countInBars: 2, grid, sections, durationSec,
    transition: 'stop', padEnabled: true, audio, stems, storedId: stored.id,
  };
}

export function addToSetlist(song: DemoSong): number {
  const existing = SETLIST.findIndex((s) => s.id === song.id);
  if (existing >= 0) { SETLIST[existing] = song; return existing; }
  SETLIST.push(song);
  return SETLIST.length - 1;
}

export function removeFromSetlist(id: string): void {
  const i = SETLIST.findIndex((s) => s.id === id);
  if (i >= 0) SETLIST.splice(i, 1);
}
