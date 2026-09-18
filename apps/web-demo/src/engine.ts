/**
 * Engine multitrack da demo (Web Audio).
 *
 *   relogio (AudioContext) -> scheduler com lookahead
 *        -> canal por stem (ganho + pan + mute/solo) -> master -> saida
 *
 * Um timer de JS nunca dispara uma nota: ele so AGENDA notas no futuro sobre o
 * relogio de audio. E por isso que o click nao treme enquanto a UI redesenha.
 *
 * Duas fontes convivem no mesmo relogio:
 *   - musicas sintetizadas (a VS de demonstracao, nota a nota);
 *   - musicas importadas (a gravacao real, num AudioBufferSourceNode).
 * Click, guia, saltos, loop, nudge e tap sao os mesmos para as duas — e os
 * saltos continuam sendo entregues pelo @kronilab/core.
 */
import { beatIndexAtTime, timeOfBar, timeOfBeatIndex } from '@kronilab/core';
import type { BeatGrid, Section } from '@kronilab/core';
import type { Arrangement, Note } from './arrangement.ts';
import { ClickSynth, buildClickEvents, type ClickSound, type Subdivision } from './click.ts';
import { Guide } from './guide.ts';
import { PadPlayer } from './pad.ts';
import type { DemoSong, StemKey } from './data.ts';

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

export interface ClickSettings {
  sound: ClickSound;
  subdivision: Subdivision;
  countInBars: number;
  countInEnabled: boolean;
}

export class DemoEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels = new Map<StemKey, Channel>();
  private arrangement: Arrangement | null = null;
  private grid: BeatGrid | null = null;
  private sections: Section[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private pad: PadPlayer | null = null;
  private clickSynth: ClickSynth | null = null;
  private guide: Guide | null = null;

  private timer: number | null = null;
  private anchorCtx = 0;
  private anchorPos = 0;
  /** Andamento escolhido pelo operador (BPM do chip), multiplicativo. */
  private baseRate = 1;
  /** Rampa temporaria de nudge/tap. */
  private rampRate = 1;
  private rampTimer: number | null = null;

  private jump: ScheduledJump | null = null;

  /** Ate onde (tempo da musica) o click ja foi agendado. */
  private clickScheduledUntil = -Infinity;
  private guideCuedSectionId: string | null = null;

  /** Gravacao importada, quando existe. */
  private mixBuffer: AudioBuffer | null = null;
  private mixSource: AudioBufferSourceNode | null = null;

  private masterVolume = 0.85;
  private masterMuted = false;

  click: ClickSettings = { sound: 'cowbell', subdivision: 1, countInBars: 2, countInEnabled: true };

  playing = false;
  duration = 0;
  onJumpExecuted: ((seekTo: number) => void) | null = null;
  onEnded: (() => void) | null = null;

  /**
   * Cria o grafo de audio. NAO chama resume(): sem gesto do usuario o navegador
   * deixa a promessa de resume() pendente para sempre, e qualquer `await` aqui
   * congelaria a montagem da tela. O contexto nasce suspenso e so o play(),
   * que vem de um toque, o acorda.
   */
  init(): void {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.noiseBuffer = makeNoise(ctx);
    // O pad nao passa pelos canais dos stems: ele e um colchao proprio, que
    // continua soando quando a musica sai.
    this.pad = new PadPlayer(ctx, master);
    // Click e guia tem canal proprio (M/S/volume no mixer, como qualquer stem).
    const clickChannel = this.ensureChannel('click');
    this.clickSynth = new ClickSynth(ctx, clickChannel.gain);
    const guideChannel = this.ensureChannel('guide');
    this.guide = new Guide(ctx, guideChannel.gain);
  }

  audioContext(): AudioContext | null {
    return this.ctx;
  }

  guideController(): Guide {
    this.init();
    return this.guide!;
  }

  private ensureChannel(key: StemKey): Channel {
    let channel = this.channels.get(key);
    if (!channel) {
      const ctx = this.ctx!;
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.connect(pan).connect(this.master!);
      channel = { gain, pan, volume: 1, muted: false, soloed: false, cursor: 0 };
      this.channels.set(key, channel);
    }
    return channel;
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

  load(song: DemoSong, arrangement: Arrangement): void {
    this.init();
    this.pause();
    this.arrangement = arrangement;
    this.grid = song.grid;
    this.sections = song.sections;
    this.duration = song.durationSec;
    this.mixBuffer = song.audio?.buffer ?? null;
    this.baseRate = 1;
    this.rampRate = 1;
    this.jump = null;

    for (const key of Object.keys(arrangement) as StemKey[]) {
      if (key === 'guide' || key === 'click') continue;
      this.ensureChannel(key).cursor = 0;
    }
    this.applyGains();
    this.seek(0);
  }

  // --- relogio -------------------------------------------------------------

  private get rate(): number {
    return this.baseRate * this.rampRate;
  }

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

  /**
   * Play com pre-contagem: o relogio comeca N compassos ANTES da posicao, e o
   * click toca esses compassos com tempo negativo. A gravacao (ou a VS) so
   * entra no tempo zero da posicao pedida. Assim a contagem sai da mesma
   * grade que o resto — nao e um timer paralelo que poderia desalinhar.
   */
  async play(opts: { countIn?: boolean } = {}): Promise<void> {
    this.init();
    if (this.playing) return;
    // Aqui sim: play() vem de um toque, entao o resume e permitido.
    await this.ctx!.resume();
    this.guide?.prime();

    const start = this.anchorPos;
    const wantsCountIn = opts.countIn ?? (this.click.countInEnabled && this.click.countInBars > 0);
    let from = start;
    if (wantsCountIn && this.grid) {
      // Duracao de N compassos medida na grade, a partir do compasso da posicao.
      const bpb = this.grid.timeSignature.beatsPerBar;
      const beat = beatIndexNear(this.grid, start);
      const barStart = Math.floor(beat / bpb) * bpb;
      const span = timeOfBeatIndex(this.grid, barStart + bpb * this.click.countInBars) - timeOfBeatIndex(this.grid, barStart);
      from = start - span;
    }

    // Uma folga antes de comecar: o primeiro click precisa cair no futuro.
    const startCtx = this.ctx!.currentTime + 0.06;
    this.reanchor(from, startCtx);
    this.resetCursors(from);
    this.clickScheduledUntil = from - 1e-6;
    this.guideCuedSectionId = null;
    this.playing = true;
    this.startMix(this.ctxTimeOf(Math.max(start, 0)), Math.max(start, 0));
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.anchorPos = Math.max(0, this.position());
    this.playing = false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    this.stopMix();
    this.guide?.cancel();
  }

  seek(songTime: number): void {
    const target = Math.max(0, Math.min(songTime, this.duration));
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.stopMix();
      this.guide?.cancel();
    }
    this.anchorPos = target;
    if (this.ctx) this.anchorCtx = this.ctx.currentTime + (wasPlaying ? 0.03 : 0);
    this.resetCursors(target);
    this.clickScheduledUntil = target - 1e-6;
    this.guideCuedSectionId = null;
    this.jump = null;
    if (wasPlaying) this.startMix(this.anchorCtx, target);
  }

  private resetCursors(from: number): void {
    if (!this.arrangement) return;
    for (const [key, channel] of this.channels) {
      const notes = this.arrangement[key] ?? [];
      let i = 0;
      while (i < notes.length && notes[i]!.t < from) i++;
      channel.cursor = i;
    }
  }

  // --- gravacao importada --------------------------------------------------

  private startMix(atCtxTime: number, offsetSongTime: number): void {
    if (!this.mixBuffer || !this.ctx) return;
    this.stopMix();
    const src = this.ctx.createBufferSource();
    src.buffer = this.mixBuffer;
    src.playbackRate.value = this.rate;
    src.connect(this.ensureChannel('mix').gain);
    src.start(Math.max(atCtxTime, this.ctx.currentTime), Math.max(0, offsetSongTime));
    this.mixSource = src;
  }

  private stopMix(atCtxTime?: number): void {
    const src = this.mixSource;
    if (!src) return;
    this.mixSource = null;
    try { src.stop(atCtxTime ?? 0); } catch { /* ja parado */ }
    window.setTimeout(() => src.disconnect(), ((atCtxTime ?? 0) - (this.ctx?.currentTime ?? 0)) * 1000 + 100);
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

  /** A voz da guia nao passa pelo grafo: mute dela e desligar a fala. */
  guideAudible(): boolean {
    const c = this.channels.get('guide');
    const anySolo = [...this.channels.values()].some((ch) => ch.soloed);
    return !!c && !c.muted && (!anySolo || c.soloed);
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
    this.rampRate = rate;
    this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);
    if (this.rampTimer) window.clearTimeout(this.rampTimer);
    this.rampTimer = window.setTimeout(() => {
      this.reanchor(this.position());
      this.rampRate = 1;
      this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx!.currentTime, 0.02);
      this.rampTimer = null;
    }, durationSec * 1000);
  }

  /** Andamento do culto (BPM do chip): persistente, ao contrario do nudge. */
  setBaseRate(rate: number): void {
    if (!this.ctx) { this.baseRate = rate; return; }
    this.reanchor(this.position());
    this.baseRate = rate;
    this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.05);
  }

  currentRate(): number {
    return this.rate;
  }

  // --- scheduler -----------------------------------------------------------

  private tick(): void {
    if (!this.ctx || !this.arrangement || !this.grid) return;
    const now = this.position();
    const horizon = now + LOOKAHEAD_SEC;

    // 1) Salto confirmado: re-ancora no destino e recomeca os cursores.
    if (this.jump && this.jump.executeAt <= horizon) {
      const jumpCtxTime = this.ctxTimeOf(this.jump.executeAt);
      const seekTo = this.jump.seekTo;
      this.jump = null;
      this.stopMix(jumpCtxTime);
      this.reanchor(seekTo, jumpCtxTime);
      this.resetCursors(seekTo);
      this.clickScheduledUntil = seekTo - 1e-6;
      this.guideCuedSectionId = null;
      this.guide?.cancel();
      this.startMix(jumpCtxTime, seekTo);
      this.onJumpExecuted?.(seekTo);
      return;
    }

    // 2) Agenda as notas de cada canal sintetizado que caem na janela.
    for (const [key, channel] of this.channels) {
      if (key === 'click' || key === 'guide' || key === 'mix') continue;
      const notes = this.arrangement[key] ?? [];
      while (channel.cursor < notes.length) {
        const note = notes[channel.cursor]!;
        if (note.t > horizon) break;
        const when = this.ctxTimeOf(note.t);
        if (when >= this.ctx.currentTime) this.playNote(note, when, channel);
        channel.cursor++;
      }
    }

    // 3) Click: eventos da grade dentro da janela, inclusive os negativos
    //    (pre-contagem). Nao toca alem do fim da musica.
    if (horizon > this.clickScheduledUntil) {
      const from = this.clickScheduledUntil;
      const bpb = this.grid.timeSignature.beatsPerBar;
      const i0 = beatIndexNear(this.grid, from) - 1;
      const i1 = beatIndexNear(this.grid, horizon) + 2;
      for (const ev of buildClickEvents(this.grid, this.click.subdivision, i0, i1)) {
        if (ev.t <= from || ev.t > horizon || ev.t > this.duration) continue;
        const when = this.ctxTimeOf(ev.t);
        if (when >= this.ctx.currentTime) this.clickSynth!.play(this.click.sound, when, ev);
      }
      void bpb;
      this.clickScheduledUntil = horizon;
    }

    // 4) Guia: a proxima secao e anunciada com antecedencia, pelo relogio.
    if (this.guide && this.guideAudible() && this.guide.settings.mode !== 'off') {
      const lead = this.guide.settings.lead;
      for (const section of this.sections) {
        const start = timeOfBar(this.grid, section.startBar);
        const leadSec = lead === 'bar'
          ? start - timeOfBar(this.grid, section.startBar - 1)
          : (start - timeOfBar(this.grid, section.startBar - 1)) / 2;
        const cueAt = start - leadSec;
        if (cueAt > now - 0.05 && cueAt <= horizon + 0.25 && this.guideCuedSectionId !== section.id) {
          this.guideCuedSectionId = section.id;
          this.guide.cueAt(section.label, this.ctxTimeOf(cueAt));
          break;
        }
      }
    }

    if (this.duration > 0 && now > this.duration) {
      this.pause();
      this.anchorPos = 0;
      this.onEnded?.();
    }
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

/**
 * Indice do beat em `t`, tambem para t antes do primeiro beat (negativo).
 * beatIndexAtTime devolve -1 para tudo antes da grade; aqui a extrapolacao
 * usa o intervalo do inicio, que e o que a pre-contagem precisa.
 */
function beatIndexNear(grid: BeatGrid, t: number): number {
  const i = beatIndexAtTime(grid, t);
  if (i >= 0) return i;
  const t0 = timeOfBeatIndex(grid, 0);
  const head = t0 - timeOfBeatIndex(grid, -1);
  return head > 0 ? Math.floor((t - t0) / head) : -1;
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
