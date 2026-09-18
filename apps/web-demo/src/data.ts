/**
 * Setlist de demonstracao.
 *
 * Numeros reais de louvor: 72 a 140 BPM, secoes de 4 a 16 compassos. Os titulos
 * sao dos cultos; nenhum audio e usado — a demo SINTETIZA a VS, entao nao ha
 * gravacao de terceiro envolvida.
 */
import { buildBeatGrid } from '@kronilab/core';
import type { BeatGrid, Section, SectionType } from '@kronilab/core';

export interface DemoSong {
  id: string;
  title: string;
  originalKey: string;
  selectedKey: string | null;
  bpm: number;
  grid: BeatGrid;
  sections: Section[];
}

/** Graus da escala por tipo de secao — o que torna o salto AUDIVEL. */
export const SECTION_DEGREE: Record<SectionType, number> = {
  Intro: 0, Verse: -3, PreChorus: 5, Chorus: 0,
  Bridge: 3, Instrumental: 5, Solo: 7, Break: -5, Outro: 0,
};

function song(
  id: string, title: string, key: string, selectedKey: string | null,
  bpm: number, plan: [SectionType, string, number][],
): DemoSong {
  let bar = 1;
  const sections: Section[] = plan.map(([type, label, bars], i) => {
    const s: Section = { id: `${id}-${i}`, type, label, startBar: bar, endBar: bar + bars };
    bar += bars;
    return s;
  });
  const totalBeats = (bar - 1) * 4;
  const duration = (totalBeats * 60) / bpm;
  return {
    id, title, originalKey: key, selectedKey, bpm,
    grid: buildBeatGrid({ tempoMap: { segments: [{ startTime: 0, bpm }] }, duration: duration + 4 }),
    sections,
  };
}

export const SETLIST: DemoSong[] = [
  song('s1', 'Santo Pra Sempre', 'B', 'C', 72, [
    ['Intro', 'Intro', 4],
    ['Verse', 'Verso', 8],
    ['PreChorus', 'Pre-refrao', 4],
    ['Chorus', 'Refrao', 8],
    ['Verse', 'Verso 2', 8],
    ['Chorus', 'Refrao 2', 8],
    ['Bridge', 'Ponte', 8],
    ['Chorus', 'Refrao 3', 8],
    ['Outro', 'Final', 4],
  ]),
  song('s2', 'Gratidao', 'D', 'D', 132, [
    ['Intro', 'Intro', 8],
    ['Verse', 'Verso', 8],
    ['Chorus', 'Refrao', 8],
    ['Instrumental', 'Instrumental', 4],
    ['Chorus', 'Refrao 2', 8],
    ['Outro', 'Final', 4],
  ]),
  song('s3', 'Yeshua', 'E', null, 88, [
    ['Intro', 'Intro', 4],
    ['Verse', 'Verso', 8],
    ['Chorus', 'Refrao', 8],
    ['Bridge', 'Ponte', 12],
    ['Chorus', 'Refrao 2', 8],
  ]),
];
