/**
 * Engine de audio da demo (Web Audio).
 *
 * Nao ha stems aqui: a VS e SINTETIZADA — click, baixo por secao e guia falada.
 * O que importa e que o AGENDAMENTO e o mesmo do produto: um relogio mestre,
 * lookahead fixo, e os saltos entregues pelo @kronilab/core.
 *
 *   relogio (AudioContext) -> scheduler com lookahead -> osciladores -> saida
 *
 * Um timer de JS nunca dispara uma nota: ele so AGENDA notas no futuro. E por
 * isso que o click nao treme mesmo com a aba ocupada renderizando a UI.
 */
import { beatIndexAtTime, timeOfBeatIndex } from '@kronilab/core';
import type { BeatGrid } from '@kronilab/core';

const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

export interface ScheduledJump {
  executeAt: number;
  seekTo: number;
}

export class DemoEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private clickBus: GainNode | null = null;
  private padBus: GainNode | null = null;

  private grid: BeatGrid | null = null;
  private timer: number | null = null;

  /** Ancora do relogio: converte tempo-da-musica <-> tempo-do-AudioContext. */
  private anchorCtx = 0;
  private anchorPos = 0;
  private rate = 1;
  private rampTimer: number | null = null;

  private nextBeatIndex = 0;
  private jump: ScheduledJump | null = null;
  private padRoot = 220;
  private pendingCue: { at: number; text: string } | null = null;

  playing = false;
  clickOn = true;
  padOn = true;
  guideOn = true;
  /** Recebe o destino do salto: no instante da confirmacao o playhead ainda
   *  nao cruzou o ponto, entao ler a posicao daria a secao ANTERIOR. */
  onJumpExecuted: ((seekTo: number) => void) | null = null;

  async init(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext();
    await ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    const clickBus = ctx.createGain();
    clickBus.gain.value = 0.5;
    clickBus.connect(master);

    const padBus = ctx.createGain();
    padBus.gain.value = 0.22;
    padBus.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.clickBus = clickBus;
    this.padBus = padBus;
  }

  load(grid: BeatGrid, rootHz: number): void {
    this.grid = grid;
    this.padRoot = rootHz;
    this.anchorPos = 0;
    this.nextBeatIndex = 0;
    this.jump = null;
  }

  /** Posicao atual na linha do tempo da musica. */
  position(): number {
    if (!this.ctx || !this.playing) return this.anchorPos;
    return this.anchorPos + (this.ctx.currentTime - this.anchorCtx) * this.rate;
  }

  /** Converte tempo-da-musica em tempo-do-AudioContext. */
  private ctxTimeOf(songTime: number): number {
    return this.anchorCtx + (songTime - this.anchorPos) / this.rate;
  }

  private reanchor(songTime: number, atCtxTime?: number): void {
    if (!this.ctx) return;
    this.anchorCtx = atCtxTime ?? this.ctx.currentTime;
    this.anchorPos = songTime;
  }

  async play(): Promise<void> {
    await this.init();
    if (!this.ctx || this.playing) return;
    await this.ctx.resume();
    this.reanchor(this.anchorPos);
    this.nextBeatIndex = Math.max(0, beatIndexAtTime(this.grid!, this.anchorPos) + 1);
    this.playing = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  pause(): void {
    if (!this.playing) return;
    this.anchorPos = this.position();
    this.playing = false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  seek(songTime: number): void {
    this.anchorPos = songTime;
    if (this.ctx) this.anchorCtx = this.ctx.currentTime;
    if (this.grid) this.nextBeatIndex = Math.max(0, beatIndexAtTime(this.grid, songTime) + 1);
  }

  scheduleJump(jump: ScheduledJump): void {
    this.jump = jump;
  }

  cancelJump(): void {
    this.jump = null;
  }

  /** Rampa temporaria de andamento (nudge / tap). Volta sozinha ao fim. */
  applyTempoRamp(rate: number, durationSec: number): void {
    if (!this.ctx) return;
    // Re-ancora ANTES de trocar a taxa: sem isso, a posicao ja percorrida
    // seria recalculada com a taxa nova e o playhead daria um pulo.
    this.reanchor(this.position());
    this.rate = rate;
    if (this.rampTimer) window.clearTimeout(this.rampTimer);
    this.rampTimer = window.setTimeout(() => {
      this.reanchor(this.position());
      this.rate = 1;
      this.rampTimer = null;
    }, durationSec * 1000);
  }

  currentRate(): number {
    return this.rate;
  }

  setPadRoot(hz: number): void {
    this.padRoot = hz;
  }

  /** Guia falada: anunciada uma vez, um compasso antes da secao. */
  announce(text: string, atSongTime: number): void {
    this.pendingCue = { at: atSongTime, text };
  }

  private tick(): void {
    if (!this.ctx || !this.grid) return;
    const now = this.position();
    const horizon = now + LOOKAHEAD_SEC;

    // 1) Salto: para de agendar no ponto de execucao e re-ancora no destino.
    if (this.jump && this.jump.executeAt <= horizon) {
      const jumpCtxTime = this.ctxTimeOf(this.jump.executeAt);
      const seekTo = this.jump.seekTo;
      this.jump = null;
      this.reanchor(seekTo, jumpCtxTime);
      this.nextBeatIndex = Math.max(0, beatIndexAtTime(this.grid, seekTo));
      this.onJumpExecuted?.(seekTo);
      return;
    }

    // 2) Agenda os beats que caem na janela.
    while (this.nextBeatIndex < this.grid.beats.length) {
      const beat = this.grid.beats[this.nextBeatIndex]!;
      if (beat.timestamp > horizon) break;
      const when = this.ctxTimeOf(beat.timestamp);
      if (when >= this.ctx.currentTime) {
        if (this.clickOn) this.click(when, beat.downbeat);
        if (this.padOn && beat.downbeat && beat.bar % 2 === 1) this.pad(when);
      }
      this.nextBeatIndex++;
    }

    // 3) Guia: fala quando o ponto chega (SpeechSynthesis nao aceita agendamento).
    if (this.pendingCue && now >= this.pendingCue.at) {
      const { text } = this.pendingCue;
      this.pendingCue = null;
      if (this.guideOn) this.speak(text);
    }
  }

  private click(when: number, accent: boolean): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1800 : 1200;
    gain.gain.setValueAtTime(accent ? 0.9 : 0.45, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
    osc.connect(gain).connect(this.clickBus!);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  /** Nota de baixo da secao: e o que faz o salto ser ouvido, nao so visto. */
  private pad(when: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;

    osc.type = 'triangle';
    osc.frequency.value = this.padRoot;
    sub.type = 'sine';
    sub.frequency.value = this.padRoot / 2;

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.5, when + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(this.padBus!);
    osc.start(when); sub.start(when);
    osc.stop(when + 1.7); sub.stop(when + 1.7);
  }

  private speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.15;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }
}

/** Frequencia da tonica, para o baixo soar no tom do culto. */
export function keyToHz(key: string, degree = 0): number {
  const names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const sharps: Record<string, string> = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
  const normalized = sharps[key] ?? key;
  const index = names.indexOf(normalized);
  const semitone = (index < 0 ? 0 : index) + degree;
  // A2 = 110 Hz como referencia grave.
  return 110 * Math.pow(2, semitone / 12);
}
