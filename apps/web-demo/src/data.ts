/**
 * Setlist e arranjo da demo.
 *
 * Nenhum audio de terceiro e usado: a VS e sintetizada a partir deste plano.
 * As cifras existem tanto para desenhar a linha de acordes quanto para gerar o
 * que toca — e o mesmo dado, entao a tela nunca mente sobre o audio.
 */
import { buildBeatGrid } from '@kronilab/core';
import type { BeatGrid, Section, SectionType } from '@kronilab/core';

export type StemKey = 'click' | 'guide' | 'vocals' | 'drums' | 'bass' | 'guitar' | 'keys' | 'other';

export interface StemMeta {
  key: StemKey;
  label: string;
  color: string;
}

/** Cores das lanes. Cada stem tem a sua e ela se repete no mixer. */
export const STEMS: StemMeta[] = [
  { key: 'vocals', label: 'Vocais', color: '#E8112D' },
  { key: 'drums', label: 'Bateria', color: '#E0A800' },
  { key: 'bass', label: 'Baixo', color: '#8CC000' },
  { key: 'guitar', label: 'Guitarra', color: '#22B14C' },
  { key: 'keys', label: 'Piano', color: '#12B886' },
  { key: 'other', label: 'Outro', color: '#E91E8C' },
];

export const CLICK_COLOR = '#6B7A8F';
export const GUIDE_COLOR = '#7C4DFF';

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
    sections, durationSec,
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
  ]),
  make('s2', 'Gratidao', 'Demo KroniLab', 'D', 'D', 132, [
    { type: 'Intro', label: 'Intro', bars: 4, chords: [C(0), C(7)], layers: ['guitar', 'keys'] },
    { type: 'Verse', label: 'Verso', bars: 8, chords: [C(0), C(5), C(7), C(9, 'min')], layers: ['guitar', 'bass', 'drums', 'vocals'] },
    { type: 'Chorus', label: 'Refrao', bars: 8, chords: [C(5), C(0), C(7), C(7)], layers: FULL },
    { type: 'Instrumental', label: 'Instrumental', bars: 4, chords: [C(9, 'min'), C(5)], layers: ['guitar', 'drums', 'bass', 'keys'] },
    { type: 'Chorus', label: 'Refrao 2', bars: 8, chords: [C(5), C(0), C(7), C(7)], layers: FULL },
    { type: 'Outro', label: 'Final', bars: 4, chords: [C(0)], layers: ['keys'] },
  ]),
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

/** Frequencia de uma nota MIDI. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
