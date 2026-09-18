/**
 * Ministro define o tom do culto (item 16).
 *
 * Ele testa tons ouvindo, nao imaginando. Quando decide, a decisao vale para
 * AQUELE culto — a musica original continua em B para sempre.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { candidateKeys, isPitchShiftSafe, semitonesBetween } from '@kronilab/core';
import type { Song } from '@kronilab/core';
import { Button, Card, Label, Muted, Pill, Row, Screen, Title } from '../../../src/ui/kit.tsx';
import { getSong, getEventSettings, setSelectedKey, getLocalStems } from '../../../src/data/repositories.ts';
import { getAudioEngine } from '../../../src/audio-engine/index.ts';
import { colors, radius, spacing, type } from '../../../src/theme.ts';

export default function DefinirTom() {
  const { id, songId } = useLocalSearchParams<{ id: string; songId: string }>();
  const router = useRouter();
  const engine = useMemo(() => getAudioEngine(), []);
  const [song, setSong] = useState<Song | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = await getSong(songId!);
      setSong(s);
      const settings = await getEventSettings(id!);
      setSaved(settings.find((x) => x.songId === songId)?.selectedKey ?? null);
      if (s) {
        const stems = await getLocalStems(s.id);
        await engine.loadSession({
          songId: s.id,
          tracks: stems.map((x) => ({ stem: x.stem, uri: x.uri, gain: 1 })),
          pitchSemitones: 0,
          duration: s.beatGrid?.duration ?? 0,
        });
      }
    })();
    return () => { void engine.unload(); };
  }, [songId]);

  if (!song) return <Screen><Muted>Carregando...</Muted></Screen>;

  const options = candidateKeys(song.originalKey);

  async function testKey(key: string) {
    if (!song) return;
    const semitones = semitonesBetween(song.originalKey, key);
    engine.setPitch(semitones);
    setTesting(key);
    await engine.play();
  }

  async function confirm(key: string) {
    await setSelectedKey(id!, songId!, key);
    setSaved(key);
    await engine.pause();
    // A equipe inteira recebe o aviso pelo trigger do banco, nao por aqui.
    router.back();
  }

  return (
    <Screen>
      <Title>{song.title}</Title>
      <Row>
        <Muted>Tom original:</Muted>
        <Pill text={song.originalKey} tone="neutral" />
        <Muted>Tom do culto:</Muted>
        <Pill text={saved ?? 'ainda nao definido'} tone={saved ? 'ok' : 'warn'} />
      </Row>

      <Card>
        <Label>Testar tom</Label>
        <Muted>Toque para ouvir. O andamento nao muda — so o tom.</Muted>
        <Row style={{ flexWrap: 'wrap', marginTop: spacing.sm }}>
          {options.map((key) => {
            const semis = semitonesBetween(song.originalKey, key);
            const active = testing === key;
            return (
              <Pressable
                key={key}
                onPress={() => void testKey(key)}
                style={{
                  paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
                  borderRadius: radius.md, borderWidth: 2,
                  borderColor: active ? colors.accent : colors.line,
                  backgroundColor: active ? colors.accentSoft : 'transparent',
                  alignItems: 'center', minWidth: 72,
                }}
              >
                <Text style={{ color: active ? colors.accent : colors.text, fontSize: type.heading, fontWeight: '800' }}>
                  {key}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: type.micro }}>
                  {semis === 0 ? 'original' : semis > 0 ? `+${semis}` : semis}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        {/* Honestidade tecnica: saltos grandes degradam o audio. Avisar antes
            e melhor do que o ministro descobrir no domingo. */}
        {testing && !isPitchShiftSafe(semitonesBetween(song.originalKey, testing)) && (
          <View style={{ marginTop: spacing.sm }}>
            <Pill text="Salto grande: a qualidade do audio cai" tone="warn" />
          </View>
        )}
      </Card>

      {testing && (
        <Button title={`Definir ${testing} para este culto`} onPress={() => void confirm(testing)} />
      )}
      {saved && (
        <Button title="Voltar ao tom original" variant="ghost" onPress={() => void confirm(song.originalKey)} />
      )}
    </Screen>
  );
}
