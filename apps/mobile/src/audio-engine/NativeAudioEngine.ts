/**
 * Ponte para a engine nativa (Superpowered ou equivalente).
 *
 * Timing critico nao pode morar no JS thread. Esta classe nao toca audio: ela
 * so encaminha para o modulo nativo, que mantem o relogio mestre, o mixer, o
 * pitch shift e o agendamento de saltos em sample-accurate.
 *
 * O adapter existe para o produto nao ficar preso a um fornecedor: trocar a
 * engine nativa e reescrever este arquivo e mais nada.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import type { StemId } from '@levita/core';
import type {
  AudioEngine, EngineListener, EngineState, LoadSessionOptions, ScheduledJump,
} from './AudioEngine.ts';

interface LevitaAudioNativeModule {
  loadSession(payload: string): Promise<void>;
  unload(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(position: number): Promise<void>;
  setTrackVolume(stem: string, gain: number): void;
  setTrackMuted(stem: string, muted: boolean): void;
  setTrackSoloed(stem: string, soloed: boolean): void;
  setPitch(semitones: number): void;
  setTempo(rate: number): void;
  scheduleJump(executeAt: number, seekTo: number, reason: string): void;
  cancelScheduledJump(): void;
  applyTempoRamp(rate: number, durationSec: number): void;
}

const native = NativeModules.LevitaAudio as LevitaAudioNativeModule | undefined;

export function isNativeEngineAvailable(): boolean {
  return native != null;
}

export class NativeAudioEngine implements AudioEngine {
  private listeners = new Set<EngineListener>();
  private state: EngineState = {
    songId: null, playing: false, position: 0, rate: 1, loaded: false,
  };

  constructor() {
    if (!native) {
      throw new Error(
        'Modulo nativo LevitaAudio ausente. Development build e obrigatorio — ' +
        'Expo Go nao carrega a engine de audio.',
      );
    }
    // O estado vem do relogio nativo. O JS nunca calcula a posicao sozinho:
    // se calculasse, a UI e o audio contariam tempos diferentes.
    new NativeEventEmitter(NativeModules.LevitaAudio).addListener(
      'LevitaAudioState',
      (payload: EngineState) => {
        this.state = payload;
        for (const l of this.listeners) l(payload);
      },
    );
  }

  async loadSession(options: LoadSessionOptions): Promise<void> {
    await native!.loadSession(JSON.stringify(options));
  }
  async unload(): Promise<void> { await native!.unload(); }
  async play(): Promise<void> { await native!.play(); }
  async pause(): Promise<void> { await native!.pause(); }
  async stop(): Promise<void> { await native!.stop(); }
  async seek(position: number): Promise<void> { await native!.seek(position); }

  setTrackVolume(stem: StemId, gain: number): void { native!.setTrackVolume(stem, gain); }
  mute(stem: StemId, muted: boolean): void { native!.setTrackMuted(stem, muted); }
  solo(stem: StemId, soloed: boolean): void { native!.setTrackSoloed(stem, soloed); }
  setPitch(semitones: number): void { native!.setPitch(semitones); }
  setTempo(rate: number): void { native!.setTempo(rate); }

  scheduleJump(jump: ScheduledJump): void {
    native!.scheduleJump(jump.executeAt, jump.seekTo, jump.reason);
  }
  cancelScheduledJump(): void { native!.cancelScheduledJump(); }
  applyTempoRamp(rate: number, durationSec: number): void {
    native!.applyTempoRamp(rate, durationSec);
  }

  getState(): EngineState { return this.state; }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
}
