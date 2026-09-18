/**
 * Click: o metronomo que a banda ouve no fone.
 *
 * Tres coisas o tornam util no palco, e nenhuma delas e "um bipe por tempo":
 *   - o acento no tempo 1 e o que permite saber onde esta o compasso;
 *   - a subdivisao (0.5x / 1x / 2x) acompanha a musica: balada lenta pede
 *     colcheias, musica rapida pede so o 1 e o 3;
 *   - a pre-contagem antes do play e o que faz todo mundo entrar junto.
 *
 * Os eventos saem do beat grid — a mesma grade que o Live Mode usa para
 * saltar — inclusive os de tempo negativo, que sao a pre-contagem.
 */
import { timeOfBeatIndex } from '@kronilab/core';
import type { BeatGrid } from '@kronilab/core';
import type { SampleBank } from './samples.ts';

export type ClickSound = 'blip' | 'cowbell' | 'woodblock' | 'rim' | 'beep';
export type Subdivision = 0.5 | 1 | 2;

export const CLICK_SOUNDS: { id: ClickSound; label: string }[] = [
  { id: 'blip', label: 'Blip' },
  { id: 'cowbell', label: 'Cowbell' },
  { id: 'woodblock', label: 'Woodblock' },
  { id: 'rim', label: 'Rimshot' },
  { id: 'beep', label: 'Bipe' },
];

export interface ClickEvent {
  /** Segundos na linha do tempo da musica (negativo = pre-contagem). */
  t: number;
  /** Tempo 1 do compasso. */
  accent: boolean;
  /** Colcheia entre dois tempos (so em 2x): mais fraca. */
  offbeat: boolean;
  /** Indice do beat na grade; usado para contar a pre-contagem. */
  beatIndex: number;
}

/**
 * Gera os eventos de click de um trecho da grade.
 * `fromBeat` pode ser negativo: e assim que a pre-contagem nasce da mesma
 * grade, sem um laco separado que pudesse desalinhar.
 */
export function buildClickEvents(
  grid: BeatGrid, subdivision: Subdivision, fromBeat: number, toBeat: number,
): ClickEvent[] {
  const bpb = grid.timeSignature.beatsPerBar;
  const out: ClickEvent[] = [];
  for (let i = fromBeat; i < toBeat; i++) {
    const beatInBar = ((i % bpb) + bpb) % bpb;
    const t = timeOfBeatIndex(grid, i);
    const accent = beatInBar === 0;
    if (subdivision === 0.5) {
      // Um click a cada dois tempos: o 1 e o 3 (em 4/4).
      if (beatInBar % 2 !== 0) continue;
      out.push({ t, accent, offbeat: false, beatIndex: i });
      continue;
    }
    out.push({ t, accent, offbeat: false, beatIndex: i });
    if (subdivision === 2) {
      const next = timeOfBeatIndex(grid, i + 1);
      out.push({ t: (t + next) / 2, accent: false, offbeat: true, beatIndex: i });
    }
  }
  return out;
}

/** Sintetiza um click no instante `when` do relogio de audio. */
export class ClickSynth {
  private noise: AudioBuffer;
  /** Acento no tempo 1 (o "A" do editor de referencia). Desligado = todos iguais. */
  accent = true;

  constructor(private ctx: AudioContext, private out: AudioNode, private samples: SampleBank | null = null) {
    this.noise = makeNoise(ctx);
  }

  play(sound: ClickSound, when: number, event: ClickEvent, gain = 1): void {
    const accent = this.accent && event.accent;
    const level = gain * (accent ? 1 : event.offbeat ? 0.35 : this.accent ? 0.62 : 0.85);
    if (sound === 'blip') {
      // Blip gravado: 900 Hz, 22 ms. Acento = a mesma amostra um pouco mais
      // alta e meio tom acima — o ouvido separa sem virar outro som.
      const src = this.samples?.play('click-blip', when, this.out, level);
      if (src) { if (accent) src.playbackRate.value = 1.06; return; }
      return this.beep(when, level, accent); // sem amostra carregada
    }
    switch (sound) {
      case 'cowbell': return this.cowbell(when, level, accent);
      case 'woodblock': return this.woodblock(when, level, accent);
      case 'rim': return this.rim(when, level, accent);
      default: return this.beep(when, level, accent);
    }
  }

  /**
   * Cowbell classico (estilo 808): duas ondas quadradas em intervalo
   * dissonante por um passa-banda, decaimento curto. E o som de click mais
   * usado em VS de igreja porque atravessa a mistura do fone sem ser agudo.
   */
  private cowbell(when: number, level: number, accent: boolean): void {
    const ctx = this.ctx;
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = accent ? 2640 : 2100;
    filter.Q.value = 3.5;
    env.connect(filter).connect(this.out);

    const base = accent ? 660 : 587;
    for (const ratio of [1, 1.48]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = base * ratio;
      osc.connect(env);
      osc.start(when);
      osc.stop(when + 0.2);
    }
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(level * 0.9, when + 0.002);
    env.gain.exponentialRampToValueAtTime(level * 0.25, when + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
  }

  /** Woodblock: senoide com queda rapida de altura + transiente de ruido. */
  private woodblock(when: number, level: number, accent: boolean): void {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.connect(this.out);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = accent ? 1560 : 1180;
    osc.frequency.setValueAtTime(f, when);
    osc.frequency.exponentialRampToValueAtTime(f * 0.55, when + 0.04);
    osc.connect(env);
    osc.start(when);
    osc.stop(when + 0.09);
    env.gain.setValueAtTime(level, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.075);

    this.burst(when, level * 0.5, 3200, 0.012);
  }

  /** Rimshot: mais ruido que altura — corta bem em fone com muita bateria. */
  private rim(when: number, level: number, accent: boolean): void {
    this.burst(when, level, accent ? 4200 : 3300, 0.035);
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.connect(this.out);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = accent ? 880 : 740;
    osc.connect(env);
    osc.start(when);
    osc.stop(when + 0.05);
    env.gain.setValueAtTime(level * 0.5, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  }

  /** Bipe: o click "de DAW". Existe porque tem gente que so ouve assim. */
  private beep(when: number, level: number, accent: boolean): void {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.connect(this.out);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1760 : 1320;
    osc.connect(env);
    osc.start(when);
    osc.stop(when + 0.06);
    env.gain.setValueAtTime(level * 0.8, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  }

  private burst(when: number, level: number, freq: number, dur: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.1;
    const env = ctx.createGain();
    src.connect(filter).connect(env).connect(this.out);
    env.gain.setValueAtTime(level, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.start(when);
    src.stop(when + dur + 0.01);
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
