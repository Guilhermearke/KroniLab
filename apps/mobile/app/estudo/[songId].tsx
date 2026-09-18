/**
 * Estudo individual (item 18).
 *
 * Abre com o mixer ja adaptado ao instrumento do membro. Ele nao precisa
 * configurar nada para comecar a tocar junto.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { pitchShiftFor } from '@kronilab/core';
import type { Song } from '@kronilab/core';
import { Button, Card, KeyBadge, Label, Muted, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { getSong, getEventSettings } from '../../src/data/repositories.ts';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { useStudySession } from '../../src/domains/study/useStudySession.ts';
import { colors, radius, spacing, type } from '../../src/theme.ts';

export default function EstudoScreen() {
  const { songId, eventId } = useLocalSearchParams<{ songId: string; eventId?: string }>();
  const { member } = useSession();
  const [song, setSong] = useState<Song | null>(null);
  const [eventKey, setEventKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setSong(await getSong(songId!));
      if (eventId) {
        const settings = await getEventSettings(eventId);
        setEventKey(settings.find((s) => s.songId === songId)?.selectedKey ?? null);
      }
    })();
  }, [songId, eventId]);

  const study = useStudySession(
    song, member?.instrument ?? null,
    song ? pitchShiftFor(song.originalKey, eventKey) : 0,
  );

  if (!song) return <Screen><Muted>Carregando...</Muted></Screen>;

  return (
    <Screen>
      <Title>{song.title}</Title>
      <Row>
        <Muted>Original: {song.originalKey}</Muted>
        {eventKey && <><Muted>Culto:</Muted><KeyBadge keyName={eventKey} /></>}
        <Muted>{Math.round(song.analysis?.bpm ?? 0)} BPM</Muted>
      </Row>

      <Card>
        <Label>Mixer</Label>
        {study.stems.map((stem) => {
          const gain = study.volumes[stem] ?? 0;
          const isMuted = study.muted.includes(stem);
          const isSolo = study.soloed.includes(stem);
          return (
            <Row key={stem} style={{ justifyContent: 'space-between', paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontSize: type.body, width: 88 }}>
                {study.labels[stem]}
              </Text>

              {/* Fader simplificado: toque na barra ajusta o volume. */}
              <View style={{ flex: 1, height: 28, justifyContent: 'center' }}>
                <View style={{ height: 6, backgroundColor: colors.line, borderRadius: 3 }}>
                  <View style={{
                    width: `${Math.round(gain * 100)}%`, height: 6, borderRadius: 3,
                    backgroundColor: gain === 0 ? colors.textMuted : colors.accent,
                  }} />
                </View>
              </View>

              <Pressable onPress={() => study.toggleMute(stem)} style={pillStyle(isMuted, colors.danger)}>
                <Text style={{ color: isMuted ? colors.danger : colors.textMuted, fontWeight: '800', fontSize: type.micro }}>M</Text>
              </Pressable>
              <Pressable onPress={() => study.toggleSolo(stem)} style={pillStyle(isSolo, colors.accent)}>
                <Text style={{ color: isSolo ? colors.accent : colors.textMuted, fontWeight: '800', fontSize: type.micro }}>S</Text>
              </Pressable>
            </Row>
          );
        })}
      </Card>

      {member?.instrument && (
        <Button title="Remover meu instrumento" variant="ghost" onPress={study.removeMyInstrument} />
      )}
      <Button title={study.playing ? 'Pausar' : 'Tocar'} onPress={() => (study.playing ? study.pause() : study.play())} />
    </Screen>
  );
}

function pillStyle(active: boolean, tint: string) {
  return {
    width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1,
    borderColor: active ? tint : colors.line,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  };
}
