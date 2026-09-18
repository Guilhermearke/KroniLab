/**
 * Implementacao JS sobre expo-av.
 *
 * Serve para o modo estudo e para desenvolver o app inteiro sem build nativo.
 * NAO e sample-accurate: o JS thread nao garante isso. Por isso ela:
 *  - elege UM stem como relogio mestre e corrige os outros pela posicao dele;
 *  - reporta a deriva medida, em vez de fingir que esta tudo certo.
 * No palco, use a engine nativa (ver NativeAudioEngine.ts).
 */
import { Audio } from 'expo-av';
import type { StemId } from '@kronilab/core';
import type {
  AudioEngine, EngineListener, EngineState, LoadSessionOptions, ScheduledJump,
} from './AudioEngine.ts';

/** Acima disso, a faixa e realinhada. Abaixo, corrigir soa pior que a deriva. */
const DRIFT_TOLERANCE_SEC = 0.025;
const TICK_MS = 50;

interface Track {
  stem: StemId;
  sound: Audio.Sound;
  gain: number;
  muted: boolean;
  soloed: boolean;
}

export class ExpoAudioEngine implements AudioEngine {
  private tracks: Track[] = [];
  private master: Track | null = null;
  private listeners = new Set<EngineListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private jump: ScheduledJump | null = null;
  private rampTimeout: ReturnType<typeof setTimeout> | null = null;
  private baseRate = 1;
  private state: EngineState = {
    songId: null, playing: false, position: 0, rate: 1, loaded: false,
  };
  /** Ultima deriva medida por faixa — exposta para diagnostico, nao escondida. */
  readonly drift = new Map<StemId, number>();

  async loadSession(options: LoadSessionOptions): Promise<void> {
    await this.unload();
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
    });

    for (const track of options.tracks) {
      const { sound } = await Audio.Sound.createAsync(
        { uri: track.uri },
        { shouldPlay: false, volume: track.gain, progressUpdateIntervalMillis: TICK_MS },
      );
      this.tracks.push({ stem: track.stem, sound, gain: track.gain, muted: false, soloed: false });
    }
    // O click e o relogio: e a faixa que a banda escuta e segue.
    this.master = this.tracks.find((t) => t.stem === 'click') ?? this.tracks[0] ?? null;
    this.setPitch(options.pitchSemitones);
    this.state = { songId: options.songId, playing: false, position: 0, rate: 1, loaded: true };
    this.emit();
  }

  async unload(): Promise<void> {
    this.stopTimer();
    for (const t of this.tracks) await t.sound.unloadAsync().catch(() => {});
    this.tracks = [];
    this.master = null;
    this.jump = null;
    this.drift.clear();
    this.state = { songId: null, playing: false, position: 0, rate: 1, loaded: false };
    this.emit();
  }

  async play(): Promise<void> {
    // Um unico instante alvo para todas as faixas reduz o espalhamento do start.
    await Promise.all(this.tracks.map((t) => t.sound.playAsync()));
    this.state = { ...this.state, playing: true };
    this.startTimer();
    this.emit();
  }

  async pause(): Promise<void> {
    await Promise.all(this.tracks.map((t) => t.sound.pauseAsync()));
    this.state = { ...this.state, playing: false };
    this.stopTimer();
    this.emit();
  }

  async stop(): Promise<void> {
    await this.pause();
    await this.seek(0);
  }

  async seek(positionSec: number): Promise<void> {
    const ms = Math.max(0, positionSec) * 1000;
    await Promise.all(this.tracks.map((t) => t.sound.setPositionAsync(ms)));
    this.state = { ...this.state, position: positionSec };
    this.emit();
  }

  setTrackVolume(stem: StemId, gain: number): void {
    const track = this.tracks.find((t) => t.stem === stem);
    if (!track) return;
    track.gain = gain;
    void this.applyGains();
  }

  mute(stem: StemId, muted: boolean): void {
    const track = this.tracks.find((t) => t.stem === stem);
    if (!track) return;
    track.muted = muted;
    void this.applyGains();
  }

  solo(stem: StemId, soloed: boolean): void {
    const track = this.tracks.find((t) => t.stem === stem);
    if (!track) return;
    track.soloed = soloed;
    void this.applyGains();
  }

  private async applyGains(): Promise<void> {
    const anySolo = this.tracks.some((t) => t.soloed);
    await Promise.all(this.tracks.map((t) => {
      const audible = !t.muted && (!anySolo || t.soloed);
      return t.sound.setVolumeAsync(audible ? t.gain : 0);
    }));
  }

  setPitch(semitones: number): void {
    // expo-av nao separa pitch de tempo. Preservar o andamento e inegociavel
    // (o click tem que continuar batendo com a banda), entao aqui a
    // transposicao e ignorada e a engine nativa assume no palco.
    if (semitones !== 0) {
      console.warn(
        `[ExpoAudioEngine] transposicao de ${semitones} semitons ignorada: ` +
        'esta engine nao separa pitch de tempo. Use a engine nativa.',
      );
    }
  }

  setTempo(rate: number): void {
    this.baseRate = rate;
    this.applyRate(rate);
  }

  private applyRate(rate: number): void {
    this.state = { ...this.state, rate };
    for (const t of this.tracks) {
      void t.sound.setRateAsync(rate, true /* corrige o pitch */);
    }
    this.emit();
  }

  applyTempoRamp(rate: number, durationSec: number): void {
    if (this.rampTimeout) clearTimeout(this.rampTimeout);
    this.applyRate(rate);
    this.rampTimeout = setTimeout(() => {
      this.applyRate(this.baseRate);
      this.rampTimeout = null;
    }, durationSec * 1000);
  }

  scheduleJump(jump: ScheduledJump): void {
    this.jump = jump;
  }

  cancelScheduledJump(): void {
    this.jump = null;
  }

  getState(): EngineState {
    return this.state;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!this.master) return;
    const status = await this.master.sound.getStatusAsync();
    if (!status.isLoaded) return;
    const position = status.positionMillis / 1000;
    this.state = { ...this.state, position };

    // Salto agendado: executa assim que o relogio mestre cruza o ponto.
    if (this.jump && position >= this.jump.executeAt) {
      const target = this.jump.seekTo;
      this.jump = null;
      await this.seek(target);
      this.emit();
      return;
    }

    await this.correctDrift(position);
    this.emit();
  }

  /** Realinha as faixas que se afastaram do relogio mestre. */
  private async correctDrift(masterPosition: number): Promise<void> {
    for (const t of this.tracks) {
      if (t === this.master) continue;
      const status = await t.sound.getStatusAsync();
      if (!status.isLoaded) continue;
      const delta = status.positionMillis / 1000 - masterPosition;
      this.drift.set(t.stem, delta);
      if (Math.abs(delta) > DRIFT_TOLERANCE_SEC) {
        await t.sound.setPositionAsync(masterPosition * 1000);
      }
    }
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
}
