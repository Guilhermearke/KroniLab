/**
 * Interface da engine de audio (item 27).
 *
 * Regra que nao se negocia: TODOS os stems compartilham UM relogio mestre.
 * Nada de um player por faixa se sincronizando na sorte — a 120 BPM, 12ms de
 * deriva entre bateria e click ja e audivel no palco.
 *
 *   MASTER CLOCK
 *        |
 *   vocals drums bass guitar keys other click guide
 *        |
 *      Mixer
 *        |
 *     Output
 *
 * A UI (React Native) fala so com esta interface. A implementacao de producao e
 * nativa; a de JS existe para desenvolver e para o modo estudo. Trocar uma pela
 * outra nao toca em nenhuma tela.
 */
import type { QuantizeMode, StemId } from '@kronilab/core';

export interface SessionTrack {
  stem: StemId;
  /** Caminho LOCAL. Live Mode nunca toca por streaming. */
  uri: string;
  gain: number;
}

export interface LoadSessionOptions {
  songId: string;
  tracks: SessionTrack[];
  /** Semitons de transposicao (tom do culto), sem alterar o tempo. */
  pitchSemitones: number;
  /** Duracao do audio, em segundos. */
  duration: number;
}

export interface EngineState {
  songId: string | null;
  playing: boolean;
  /** Posicao do relogio mestre, em segundos. */
  position: number;
  /** Multiplicador de velocidade em vigor (nudge/tap). */
  rate: number;
  loaded: boolean;
}

export interface ScheduledJump {
  /** Instante, na linha do tempo da musica, em que a troca acontece. */
  executeAt: number;
  seekTo: number;
  /** Rotulo so para telemetria/log. */
  reason: 'section-jump' | 'loop';
}

export type EngineListener = (state: EngineState) => void;

export interface AudioEngine {
  loadSession(options: LoadSessionOptions): Promise<void>;
  unload(): Promise<void>;

  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(positionSec: number): Promise<void>;

  setTrackVolume(stem: StemId, gain: number): void;
  mute(stem: StemId, muted: boolean): void;
  solo(stem: StemId, soloed: boolean): void;

  /** Transposicao sem mexer no andamento. */
  setPitch(semitones: number): void;
  /** Andamento sem mexer no tom. */
  setTempo(rate: number): void;

  /**
   * Agenda a troca no ponto musical — nao pula na hora.
   * A engine executa sozinha quando o relogio chega la, porque depender de um
   * timer de JS para isso e o que produz salto fora do compasso.
   */
  scheduleJump(jump: ScheduledJump): void;
  cancelScheduledJump(): void;

  /** Rampa temporaria de velocidade (nudge). Volta sozinha ao fim da janela. */
  applyTempoRamp(rate: number, durationSec: number): void;

  getState(): EngineState;
  subscribe(listener: EngineListener): () => void;
}

/** Como a UI pede o salto; a engine so recebe o plano ja resolvido. */
export interface JumpRequest {
  targetSectionId: string;
  mode: QuantizeMode;
}
