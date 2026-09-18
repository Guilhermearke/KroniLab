/**
 * Modo estudo (item 18).
 *
 * O mixer ja abre adaptado ao instrumento do membro: o baterista ouve tudo
 * menos a bateria, e toca por cima. E o motivo de existir a separacao de stems.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { STEM_LABELS, resolveGains, stemsFor, studyPreset, toggleOwnInstrument } from '@kronilab/core';
import type { Instrument, Mix, Song, StemId } from '@kronilab/core';
import { getAudioEngine } from '../../audio-engine/index.ts';
import { getLocalStems } from '../../data/repositories.ts';

export function useStudySession(song: Song | null, instrument: Instrument | null, pitchSemitones: number) {
  const engine = useMemo(() => getAudioEngine(), []);
  const layout = song?.stemLayout ?? 'six';
  const [volumes, setVolumes] = useState<Mix>(() => studyPreset(instrument, layout));
  const [muted, setMuted] = useState<StemId[]>([]);
  const [soloed, setSoloed] = useState<StemId[]>([]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  useEffect(() => { setVolumes(studyPreset(instrument, layout)); }, [instrument, layout]);

  useEffect(() => {
    if (!song) return;
    let cancelled = false;
    (async () => {
      const stems = await getLocalStems(song.id);
      if (cancelled) return;
      await engine.loadSession({
        songId: song.id,
        tracks: stems.map((s) => ({ stem: s.stem, uri: s.uri, gain: volumes[s.stem] ?? 1 })),
        pitchSemitones,
        duration: song.beatGrid?.duration ?? 0,
      });
    })();
    return () => { cancelled = true; void engine.unload(); };
  }, [song?.id, pitchSemitones]);

  useEffect(() => engine.subscribe((s) => { setPlaying(s.playing); setPosition(s.position); }), [engine]);

  // Uma fonte de verdade para os ganhos: solo/mute resolvidos no core.
  useEffect(() => {
    const gains = resolveGains({ layout, volumes, muted, soloed });
    for (const stem of stemsFor(layout)) engine.setTrackVolume(stem, gains[stem] ?? 0);
  }, [volumes, muted, soloed, layout]);

  const removeMyInstrument = useCallback(() => {
    setVolumes((v) => toggleOwnInstrument(v, instrument, layout));
  }, [instrument, layout]);

  return {
    stems: stemsFor(layout), labels: STEM_LABELS,
    volumes, muted, soloed, playing, position,
    setVolume: (stem: StemId, value: number) => setVolumes((v) => ({ ...v, [stem]: value })),
    toggleMute: (stem: StemId) => setMuted((m) => m.includes(stem) ? m.filter((x) => x !== stem) : [...m, stem]),
    toggleSolo: (stem: StemId) => setSoloed((s) => s.includes(stem) ? s.filter((x) => x !== stem) : [...s, stem]),
    removeMyInstrument,
    play: () => void engine.play(),
    pause: () => void engine.pause(),
    seek: (sec: number) => void engine.seek(sec),
  };
}
