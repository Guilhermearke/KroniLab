/**
 * Engine multitrack da demo (Web Audio).
 *
 *   relogio (AudioContext) -> scheduler com lookahead
 *        -> canal por stem (ganho + pan + mute/solo) -> master -> saida
 *
 * Um timer de JS nunca dispara uma nota: ele so AGENDA notas no futuro sobre o
 * relogio de audio. E por isso que o click nao treme enquanto a UI redesenha.
 *
 * A VS e sintetizada — nao ha gravacao envolvida —, mas o AGENDAMENTO e o mesmo
 * do produto: um relogio mestre e os saltos entregues pelo @kronilab/core.
 */
import { beatIndexAtTime } from '@kronilab/core';
import type { Arrangement, Note } from './arrangement.ts';
import { PadPlayer } from './pad.ts';
import type { StemKey } from './data.ts';

const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

interface Channel {
  gain: GainNode;
  pan: StereoPannerNode;
  volume: number;
  muted: boolean;
  soloed: boolean;
  /** Proxima nota ainda nao agendada. */
  cursor: number;
}

export interface ScheduledJump {
  executeAt: number;
  seekTo: number;
}

export class DemoEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels = new Map<StemKey, Channel>();
  private arrangement: Arrangement | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private pad: PadPlayer | null = null;

  private timer: number | null = null;
  private anchorCtx = 0;
  private anchorPos = 0;
  private rate = 1;
  private rampTimer: number | null = null;

  private jump: ScheduledJump | null = null;
  private pendingCue: { at: number; text: string } | null = null;

  private masterVolume = 0.85;
  private masterMuted = false;

  playing = false;
  guideOn = true;
  duration = 0;
  onJumpExecuted: ((seekTo: number) => void) | null = null;

  /**
   * Cria o grafo de audio. NAO chama resume(): sem gesto do usuario o navegador
   * deixa a promessa de resume() pendente para sempre, e qualquer `await` aqui
   * congelaria a montagem da tela. O contexto nasce suspenso e so o play(),
   * que vem de um toque, o acorda.
   */
  init(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.noiseBuffer = makeNoise(ctx);
    // O pad nao passa pelos canais dos stems: ele e um colchao proprio, que
    // continua soando quando a musica sai.
    this.pad = new PadPlayer(ctx, master);
  }

  /** Liga o pad no tom do culto (ou troca o tom, com sobreposicao). */
  setPadKey(key: string): void {
    this.init();
    if (!this.pad) return;
    if (this.pad.enabled) this.pad.setKey(key);
    else this.pad.start(key);
  }

  stopPad(): void {
    this.pad?.stop();
  }

  padEnabled(): boolean {
    return this.pad?.enabled ?? false;
  }

  padKey(): string | null {
    return this.pad?.currentKey() ?? null;
  }

  load(arrangement: Arrangement, duration: number): void {
    this.init();
    this.arrangement = arrangement;
    this.duration = duration;
    const ctx = this.ctx!;

    for (const key of Object.keys(arrangement) as StemKey[]) {
      if (key === 'guide') continue; // guia e falada, nao tem canal de sintese
      let channel = this.channels.get(key);
      if (!channel) {
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        gain.connect(pan).connect(this.master!);
        channel = { gain, pan, volume: 1, muted: false, soloed: false, cursor: 0 };
        this.channels.set(key, channel);
      }
      channel.cursor = 0;
    }
    this.applyGains();
    this.seek(0);
  }

  // --- relogio -------------------------------------------------------------

  position(): number {
    if (!this.ctx || !this.playing) return this.anchorPos;
    return this.anchorPos + (this.ctx.currentTime - this.anchorCtx) * this.rate;
  }

  private ctxTimeOf(songTime: number): number {
    return this.anchorCtx + (songTime - this.anchorPos) / this.rate;
  }

  private reanchor(songTime: number, atCtxTime?: number): void {
    if (!this.ctx) return;
    this.anchorCtx = atCtxTime ?? this.ctx.currentTime;
    this.anchorPos = songTime;
  }

  async play(): Promise<void> {
    this.init();
    if (this.playing) return;
    // Aqui sim: play() vem de um toque, entao o resume e permitido.
    await this.ctx!.resume();
    this.reanchor(this.anchorPos);
    this.resetCursors(this.anchorPos);
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
    this.anchorPos = Math.max(0, songTime);
    if (this.ctx) this.anchorCtx = this.ctx.currentTime;
    this.resetCursors(this.anchorPos);
  }

  private resetCursors(from: number): void {
    if (!this.arrangement) return;
    for (const [key, channel] of this.channels) {
      const notes = this.arrangement[key];
      let i = 0;
      while (i < notes.length && notes[i]!.t < from) i++;
      channel.cursor = i;
    }
  }

  // --- mixer ---------------------------------------------------------------

  setVolume(stem: StemKey, volume: number): void {
    const channel = this.channels.get(stem);
    if (!channel) return;
    channel.volume = volume;
    this.applyGains();
  }

  setPan(stem: StemKey, pan: number): void {
    const channel = this.channels.get(stem);
    if (!channel || !this.ctx) return;
    channel.pan.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.01);
  }

  toggleMute(stem: StemKey): boolean {
    const channel = this.channels.get(stem);
    if (!channel) return false;
    channel.muted = !channel.muted;
    this.applyGains();
    return channel.muted;
  }

  toggleSolo(stem: StemKey): boolean {
    const channel = this.channels.get(stem);
    if (!channel) return false;
    channel.soloed = !channel.soloed;
    this.applyGains();
    return channel.soloed;
  }

  setMasterVolume(volume: number): void {
    if (!this.ctx || !this.master) return;
    this.masterVolume = volume;
    this.master.gain.setTargetAtTime(this.masterMuted ? 0 : volume, this.ctx.currentTime, 0.015);
  }

  toggleMasterMute(): boolean {
    this.masterMuted = !this.masterMuted;
    this.setMasterVolume(this.masterVolume);
    return this.masterMuted;
  }

  state(stem: StemKey): { volume: number; muted: boolean; soloed: boolean } {
    const c = this.channels.get(stem);
    return { volume: c?.volume ?? 1, muted: c?.muted ?? false, soloed: c?.soloed ?? false };
  }

  /** Solo em qualquer canal silencia os demais — regra de mesa, nao de player. */
  private applyGains(): void {
    if (!this.ctx) return;
    const anySolo = [...this.channels.values()].some((c) => c.soloed);
    for (const channel of this.channels.values()) {
      const audible = !channel.muted && (!anySolo || channel.soloed);
      channel.gain.gain.setTargetAtTime(audible ? channel.volume : 0, this.ctx.currentTime, 0.015);
    }
  }

  // --- transporte ----------------------------------------------------------

  scheduleJump(jump: ScheduledJump): void {
    this.jump = jump;
  }

  cancelJump(): void {
    this.jump = null;
  }

  applyTempoRamp(rate: number, durationSec: number): void {
    if (!this.ctx) return;
    // Re-ancora ANTES de trocar a taxa: sem isso o trecho ja percorrido seria
    // recalculado com a taxa nova e o playhead daria um pulo.
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

  announce(text: string, atSongTime: number): void {
    this.pendingCue = { at: atSongTime, text };
  }

  // --- scheduler -----------------------------------------------------------

  private tick(): void {
    if (!this.ctx || !this.arrangement) return;
    const now = this.position();
    const horizon = now + LOOKAHEAD_SEC;

    // 1) Salto confirmado: re-ancora no destino e recomeca os cursores.
    if (this.jump && this.jump.executeAt <= horizon) {
      const jumpCtxTime = this.ctxTimeOf(this.jump.executeAt);
      const seekTo = this.jump.seekTo;
      this.jump = null;
      this.reanchor(seekTo, jumpCtxTime);
      this.resetCursors(seekTo);
      this.onJumpExecuted?.(seekTo);
      return;
    }

    // 2) Agenda as notas de cada canal que caem na janela.
    for (const [key, channel] of this.channels) {
      const notes = this.arrangement[key];
      while (channel.cursor < notes.length) {
        const note = notes[channel.cursor]!;
        if (note.t > horizon) break;
        const when = this.ctxTimeOf(note.t);
        if (when >= this.ctx.currentTime) this.playNote(note, when, channel);
        channel.cursor++;
      }
    }

    // 3) Guia falada (SpeechSynthesis nao aceita agendamento).
    if (this.pendingCue && now >= this.pendingCue.at) {
      const { text } = this.pendingCue;
      this.pendingCue = null;
      if (this.guideOn) speak(text);
    }

    if (this.duration > 0 && now > this.duration) this.pause();
  }

  private playNote(note: Note, when: number, channel: Channel): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.connect(channel.gain);

    if (note.timbre === 'hat' || note.timbre === 'snare' || note.timbre === 'shaker') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = note.timbre === 'snare' ? 'bandpass' : 'highpass';
      filter.frequency.value = note.freq;
      filter.Q.value = note.timbre === 'snare' ? 1.2 : 0.7;
      src.connect(filter).connect(env);
      env.gain.setValueAtTime(note.amp, when);
      env.gain.exponentialRampToValueAtTime(0.0001, when + note.dur);
      src.start(when);
      src.stop(when + note.dur + 0.02);
      return;
    }

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(note.freq, when);

    switch (note.timbre) {
      case 'click':
        osc.type = 'square';
        env.gain.setValueAtTime(note.amp * 0.5, when);
        env.gain.exponentialRampToValueAtTime(0.0001, when + note.dur);
        break;
      case 'kick':
        osc.type = 'sine';
        // Queda de altura: e o que faz soar como bumbo e nao como bipe.
        osc.frequency.exponentialRampToValueAtTime(35, when + note.dur);
        env.gain.setValueAtTime(note.amp, when);
        env.gain.exponentialRampToValueAtTime(0.0001, when + note.dur);
        break;
      case 'sub':
        osc.type = 'triangle';
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(note.amp, when + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0001, when + note.dur);
        break;
      case 'pluck':
        osc.type = 'sawtooth';
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(note.amp, when + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, when + note.dur);
        break;
      case 'pad':
        osc.type = 'triangle';
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(note.amp, when + 0.25);
        env.gain.setValueAtTime(note.amp, when + note.dur * 0.7);
        env.gain.exponentialRampToValueAtTime(0.0001, when + note.dur);
        break;
      default: // lead
        osc.type = 'sine';
        env.gain.setValueAtTime(0.0001, when);
        env.gain.exponentialRampToValueAtTime(note.amp, when + 0.06);
        env.gain.exponentialRampToValueAtTime(0.0001, when + note.dur);
    }

    osc.connect(env);
    osc.start(when);
    osc.stop(when + note.dur + 0.05);
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function speak(text: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-BR';
  utterance.rate = 1.15;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}
