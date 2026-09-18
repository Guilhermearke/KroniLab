/**
 * Gera as notas de cada stem a partir do plano da musica.
 *
 * Duas coisas saem daqui e precisam concordar:
 *   1. o que o sintetizador toca;
 *   2. a waveform desenhada na lane.
 * Como a waveform e calculada a partir das MESMAS notas, ela nunca e enfeite:
 * se a bateria nao toca na ponte, a lane fica vazia na ponte.
 */
import { timeOfBar } from '@kronilab/core';
import {
  CHORD_INTERVALS, chordAtBar, midiToHz, pitchClassOf,
  type DemoSection, type DemoSong, type StemKey,
} from './data.ts';

export type Timbre = 'click' | 'kick' | 'snare' | 'hat' | 'pluck' | 'pad' | 'lead' | 'sub' | 'shaker';

export interface Note {
  /** Inicio, em segundos na linha do tempo da musica. */
  t: number;
  dur: number;
  freq: number;
  amp: number;
  timbre: Timbre;
  accent?: boolean;
}

export type Arrangement = Record<StemKey, Note[]>;

export function buildArrangement(song: DemoSong): Arrangement {
  const key = song.selectedKey ?? song.originalKey;
  const root = pitchClassOf(key);
  const secPerBeat = 60 / song.bpm;
  const secPerBar = secPerBeat * song.beatsPerBar;

  const out: Arrangement = {
    click: [], guide: [], vocals: [], drums: [], bass: [], guitar: [], keys: [], other: [], mix: [],
  };

  // O click nao mora aqui: ele e gerado pela engine a partir da grade, com
  // subdivisao e pre-contagem (ver click.ts).

  for (const section of song.sections) {
    // Musica importada: a gravacao ja e o arranjo. So a guia e montada.
    for (let bar = section.startBar; song.audio ? false : bar < section.endBar; bar++) {
      const barStart = timeOfBar(song.grid, bar);
      const chord = chordAtBar(section, bar);
      const chordRoot = root + chord.degree;
      const intervals = CHORD_INTERVALS[chord.quality];

      addBar(out, section, {
        barStart, secPerBeat, secPerBar, chordRoot, intervals,
        barIndex: bar - section.startBar,
      });
    }
    // Guia: um bloco por secao (o desenho da lane roxa).
    out.guide.push({
      t: timeOfBar(song.grid, section.startBar),
      dur: timeOfBar(song.grid, section.endBar) - timeOfBar(song.grid, section.startBar),
      freq: 0, amp: 1, timbre: 'lead',
    });
  }

  return out;
}

interface BarContext {
  barStart: number;
  secPerBeat: number;
  secPerBar: number;
  chordRoot: number;
  intervals: number[];
  barIndex: number;
}

function addBar(out: Arrangement, section: DemoSection, ctx: BarContext): void {
  const has = (stem: StemKey) => section.layers.includes(stem);
  const { barStart, secPerBeat, chordRoot, intervals } = ctx;

  // --- bateria: kick no 1 e 3, caixa no 2 e 4, chimbal em colcheias ---------
  if (has('drums')) {
    for (let beat = 0; beat < 4; beat++) {
      const t = barStart + beat * secPerBeat;
      if (beat === 0 || beat === 2) {
        out.drums.push({ t, dur: 0.18, freq: 55, amp: 0.95, timbre: 'kick' });
      }
      if (beat === 1 || beat === 3) {
        out.drums.push({ t, dur: 0.12, freq: 200, amp: 0.8, timbre: 'snare' });
      }
      out.drums.push({ t, dur: 0.05, freq: 9000, amp: 0.3, timbre: 'hat' });
      out.drums.push({ t: t + secPerBeat / 2, dur: 0.05, freq: 9000, amp: 0.2, timbre: 'hat' });
    }
  }

  // --- baixo: tonica do acorde, com oitava no fim do compasso ---------------
  if (has('bass')) {
    const bassMidi = 36 + (chordRoot % 12);
    out.bass.push({ t: barStart, dur: secPerBeat * 1.8, freq: midiToHz(bassMidi), amp: 0.9, timbre: 'sub' });
    out.bass.push({ t: barStart + secPerBeat * 2, dur: secPerBeat * 0.9, freq: midiToHz(bassMidi), amp: 0.7, timbre: 'sub' });
    out.bass.push({ t: barStart + secPerBeat * 3, dur: secPerBeat * 0.9, freq: midiToHz(bassMidi + 7), amp: 0.6, timbre: 'sub' });
  }

  // --- guitarra: levada em colcheias sobre as notas do acorde ---------------
  if (has('guitar')) {
    for (let eighth = 0; eighth < 8; eighth++) {
      if (eighth % 2 === 1 && eighth !== 3) continue; // levada sincopada
      const t = barStart + (eighth * secPerBeat) / 2;
      for (const interval of intervals) {
        out.guitar.push({
          t, dur: 0.35, freq: midiToHz(60 + (chordRoot % 12) + interval),
          amp: 0.4, timbre: 'pluck',
        });
      }
    }
  }

  // --- teclado: acorde sustentado no compasso inteiro -----------------------
  if (has('keys')) {
    for (const interval of intervals) {
      out.keys.push({
        t: barStart, dur: ctx.secPerBar * 0.98,
        freq: midiToHz(48 + (chordRoot % 12) + interval), amp: 0.45, timbre: 'pad',
      });
    }
  }

  // --- vocais: melodia simples nas notas do acorde --------------------------
  if (has('vocals')) {
    const shape = [intervals[2]!, intervals[1]!, intervals[0]!, intervals[1]!];
    const step = shape[ctx.barIndex % shape.length]!;
    out.vocals.push({
      t: barStart + secPerBeat * 0.5, dur: secPerBeat * 1.4,
      freq: midiToHz(67 + (chordRoot % 12) + step), amp: 0.5, timbre: 'lead',
    });
    out.vocals.push({
      t: barStart + secPerBeat * 2.5, dur: secPerBeat * 1.2,
      freq: midiToHz(67 + (chordRoot % 12) + intervals[0]!), amp: 0.42, timbre: 'lead',
    });
  }

  // --- outros: percussao leve em semicolcheias ------------------------------
  if (has('other')) {
    for (let i = 0; i < 8; i++) {
      out.other.push({
        t: barStart + (i * ctx.secPerBar) / 8, dur: 0.06, freq: 6000,
        amp: i % 2 === 0 ? 0.28 : 0.16, timbre: 'shaker',
      });
    }
  }
}

/**
 * Envelope de amplitude por stem, amostrado para desenhar a lane.
 * E uma soma dos envelopes das notas — o desenho e o audio saem do mesmo lugar.
 */
export function computePeaks(notes: Note[], duration: number, samplesPerSecond = 24): number[] {
  const count = Math.max(1, Math.ceil(duration * samplesPerSecond));
  const peaks = new Array<number>(count).fill(0);

  for (const note of notes) {
    if (note.timbre === 'lead' && note.freq === 0) continue; // bloco de guia
    const start = Math.floor(note.t * samplesPerSecond);
    const length = Math.max(1, Math.ceil(note.dur * samplesPerSecond));
    for (let i = 0; i < length; i++) {
      const idx = start + i;
      if (idx < 0 || idx >= count) continue;
      // Decaimento simples: percussivo cai rapido, pad sustenta.
      const sustain = note.timbre === 'pad' || note.timbre === 'sub' || note.timbre === 'lead';
      const env = sustain ? 1 - (i / length) * 0.35 : Math.exp(-3 * (i / length));
      peaks[idx] = Math.min(1, peaks[idx]! + note.amp * env);
    }
  }
  return peaks;
}
