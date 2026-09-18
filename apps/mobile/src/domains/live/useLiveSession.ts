/**
 * Controlador do Live Mode.
 *
 * Amarra o que ja foi provado no @kronilab/core (saltos quantizados, loop, nudge,
 * tap tempo) com a engine de audio. Nenhuma tela faz conta de tempo: a tela
 * mostra, este hook decide, a engine executa.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TapTempo, bpmAtTime, dueAction, nextSection, pitchShiftFor, planLoopWrap,
  planNudge, planSectionJump, planTempoReconcile, positionAt, sectionAtTime,
  timeOfBar, NUDGE_STEP_MS,
} from '@kronilab/core';
import type { EventSongSettings, QuantizeMode, Section, Song } from '@kronilab/core';
import { getAudioEngine, engineKind } from '../../audio-engine/index.ts';
import { getLocalStems } from '../../data/repositories.ts';
import { logEvent, saveLiveSession } from '../../data/db.ts';

/** Janela em que um plano agendado e entregue a engine. */
const SCHEDULE_WINDOW = 0.5;

export interface LiveSessionApi {
  song: Song | null;
  playing: boolean;
  position: number;
  bar: number;
  beat: number;
  bpm: number;
  currentSection: Section | null;
  queuedSection: Section | null;
  nextInArrangement: Section | null;
  loopSectionId: string | null;
  quantize: QuantizeMode;
  selectedKey: string | null;
  tapBpm: number | null;
  /** 'js' avisa o operador que nao ha engine nativa (timing nao garantido). */
  engine: 'native' | 'js';

  play(): void;
  pause(): void;
  jumpTo(sectionId: string): void;
  cancelJump(): void;
  toggleLoop(sectionId: string): void;
  setQuantize(mode: QuantizeMode): void;
  nudge(direction: -1 | 1): void;
  tap(): void;
  nextSong(): void;
  previousSong(): void;
}

export function useLiveSession(
  eventId: string,
  songs: Song[],
  settings: EventSongSettings[],
): LiveSessionApi {
  const engine = useMemo(() => getAudioEngine(), []);
  const tapTempo = useRef(new TapTempo()).current;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [quantize, setQuantize] = useState<QuantizeMode>('next-bar');
  const [tapBpm, setTapBpm] = useState<number | null>(null);

  const song = songs[index] ?? null;
  const setting = settings.find((s) => s.songId === song?.id) ?? null;
  const sections = song?.sections ?? [];
  const grid = song?.beatGrid ?? null;

  // Planos vivem em ref: o loop de agendamento nao pode depender de re-render.
  const queuedPlan = useRef<ReturnType<typeof planSectionJump>>(null);
  const loopPlan = useRef<ReturnType<typeof planLoopWrap>>(null);

  // --- carregar a musica -----------------------------------------------------
  useEffect(() => {
    if (!song) return;
    let cancelled = false;
    (async () => {
      const stems = await getLocalStems(song.id);
      if (cancelled) return;
      await engine.loadSession({
        songId: song.id,
        tracks: stems.map((s) => ({ stem: s.stem, uri: s.uri, gain: 1 })),
        // O tom do culto entra aqui; a musica original nunca e alterada.
        pitchSemitones: pitchFor(song, setting),
        duration: song.beatGrid?.duration ?? 0,
      });
    })();
    return () => { cancelled = true; };
  }, [song?.id, setting?.selectedKey]);

  // --- relogio ---------------------------------------------------------------
  useEffect(() => engine.subscribe((state) => {
    setPosition(state.position);
    setPlaying(state.playing);
  }), [engine]);

  // --- agendamento: entrega o plano a engine antes da hora -------------------
  useEffect(() => {
    if (!grid || !playing) return;
    const action = dueAction(
      { queued: queuedPlan.current, loop: loopPlan.current },
      position, SCHEDULE_WINDOW,
    );
    if (!action) return;

    if ('targetSectionId' in action) {
      engine.scheduleJump({ executeAt: action.executeAt, seekTo: action.seekTo, reason: 'section-jump' });
      queuedPlan.current = null;
      setQueuedId(null);
      void logEvent('jump', { eventId, songId: song?.id, payload: action });
    } else {
      engine.scheduleJump({ executeAt: action.executeAt, seekTo: action.seekTo, reason: 'loop' });
      // Reagenda a proxima volta do loop imediatamente.
      loopPlan.current = planLoopWrap({ grid, sections, loopSectionId: action.sectionId, now: action.seekTo });
      void logEvent('loop', { eventId, songId: song?.id, payload: action });
    }
  }, [position, playing, grid]);

  // --- retomada apos crash (item 45) ----------------------------------------
  useEffect(() => {
    if (!song) return;
    void saveLiveSession({
      eventId, songId: song.id, positionSec: position,
      loopSectionId: loopId, quantize, mix: {},
    });
  }, [song?.id, Math.floor(position), loopId, quantize]);

  const currentSection = grid ? sectionAtTime(grid, sections, position) : null;
  const musical = grid ? positionAt(grid, position) : { bar: 0, beat: 0, phase: 0 };
  const bpm = grid ? bpmAtTime(grid, position) : (song?.analysis?.bpm ?? 0);

  const jumpTo = useCallback((sectionId: string) => {
    if (!grid) return;
    // Nao pula agora: enfileira e troca no ponto musical.
    queuedPlan.current = planSectionJump({
      grid, sections, now: position, targetSectionId: sectionId, mode: quantize,
    });
    setQueuedId(queuedPlan.current ? sectionId : null);
  }, [grid, sections, position, quantize]);

  const cancelJump = useCallback(() => {
    queuedPlan.current = null;
    setQueuedId(null);
    engine.cancelScheduledJump();
  }, [engine]);

  const toggleLoop = useCallback((sectionId: string) => {
    if (!grid) return;
    if (loopId === sectionId) {
      setLoopId(null);
      loopPlan.current = null;
      return;
    }
    setLoopId(sectionId);
    loopPlan.current = planLoopWrap({ grid, sections, loopSectionId: sectionId, now: position });
  }, [grid, sections, position, loopId]);

  const nudge = useCallback((direction: -1 | 1) => {
    const plan = planNudge({ offsetMs: direction * NUDGE_STEP_MS, baseBpm: bpm || 120 });
    // Rampa de tempo, nunca seek: o publico nao pode ouvir a correcao.
    engine.applyTempoRamp(plan.rate, plan.durationSec);
    void logEvent('nudge', { eventId, songId: song?.id, payload: plan });
  }, [engine, bpm, song?.id]);

  const tap = useCallback(() => {
    const result = tapTempo.tap(Date.now());
    setTapBpm(result.bpm);
    // So age com leitura confiavel: tap tremido nao muda o andamento do culto.
    if (result.bpm && result.confidence > 0.6 && bpm > 0) {
      const plan = planTempoReconcile({ vsBpm: bpm, bandBpm: result.bpm });
      engine.applyTempoRamp(plan.targetRate, plan.glideSec);
      void logEvent('tap', { eventId, songId: song?.id, payload: plan });
    }
  }, [engine, bpm, song?.id]);

  const changeSong = useCallback((delta: number) => {
    const next = Math.min(songs.length - 1, Math.max(0, index + delta));
    if (next === index) return;
    void engine.pause();
    queuedPlan.current = null;
    loopPlan.current = null;
    setQueuedId(null);
    setLoopId(null);
    setIndex(next);
  }, [index, songs.length, engine]);

  return {
    song, playing, position,
    bar: musical.bar, beat: musical.beat, bpm,
    currentSection,
    queuedSection: sections.find((s) => s.id === queuedId) ?? null,
    nextInArrangement: nextSection(sections, currentSection?.id ?? null),
    loopSectionId: loopId,
    quantize,
    selectedKey: setting?.selectedKey ?? song?.originalKey ?? null,
    tapBpm,
    engine: engineKind(),

    play: () => { void engine.play(); void logEvent('play', { eventId, songId: song?.id }); },
    pause: () => { void engine.pause(); void logEvent('pause', { eventId, songId: song?.id }); },
    jumpTo, cancelJump, toggleLoop, setQuantize, nudge, tap,
    nextSong: () => changeSong(1),
    previousSong: () => changeSong(-1),
  };
}

function pitchFor(song: Song, setting: EventSongSettings | null): number {
  return pitchShiftFor(song.originalKey, setting?.selectedKey ?? null);
}

/** Inicio de uma secao em segundos — usado pela barra de progresso. */
export function sectionStart(song: Song, section: Section): number {
  return song.beatGrid ? timeOfBar(song.beatGrid, section.startBar) : 0;
}
