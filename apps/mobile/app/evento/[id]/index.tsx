/**
 * Tela do culto.
 *
 * Aqui mora o estado real do domingo: quem confirmou, o que vai ser tocado, e
 * se cada musica esta pronta para subir no palco (VS, tom, offline).
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { OFFLINE_STATUS_LABEL, isVsReady } from '@kronilab/core';
import type { ChurchEvent, EventSongSettings, Song } from '@kronilab/core';
import { Button, Card, Divider, KeyBadge, Label, Muted, Pill, Row, Screen, Title } from '../../../src/ui/kit.tsx';
import { getEvent, getSetlist, getLocalStems } from '../../../src/data/repositories.ts';
import { useAssignments } from '../../../src/domains/events/useAssignments.ts';
import { colors, spacing, type } from '../../../src/theme.ts';

export default function CultoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [setlist, setSetlist] = useState<{ settings: EventSongSettings[]; songs: Song[] }>({ settings: [], songs: [] });
  const [offlineSongs, setOfflineSongs] = useState<Set<string>>(new Set());
  const { assignments, confirmed, total } = useAssignments(id!);

  useEffect(() => {
    (async () => {
      setEvent(await getEvent(id!));
      const list = await getSetlist(id!);
      setSetlist(list);
      const offline = new Set<string>();
      for (const song of list.songs) {
        const stems = await getLocalStems(song.id);
        if (stems.length > 0) offline.add(song.id);
      }
      setOfflineSongs(offline);
    })();
  }, [id]);

  if (!event) return <Screen><Muted>Carregando...</Muted></Screen>;

  return (
    <Screen>
      <Title>{event.name}</Title>
      <Muted>{event.location ?? 'Local nao definido'}</Muted>

      {/* --- Escala --- */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>Escala</Label>
          <Pill
            text={`${confirmed}/${total} confirmados`}
            tone={confirmed === total ? 'ok' : 'warn'}
          />
        </Row>
        <Divider />
        {assignments.map((a) => (
          <Row key={a.id} style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
            <Text style={{ color: colors.textMuted, fontSize: type.label, width: 92 }}>
              {a.instrument}
            </Text>
            <Text style={{ color: colors.text, fontSize: type.body, flex: 1 }}>{a.memberName}</Text>
            <Text style={{
              color: a.status === 'confirmed' ? colors.ok
                : a.status === 'declined' ? colors.danger : colors.textMuted,
              fontSize: type.heading, fontWeight: '700',
            }}>
              {a.status === 'confirmed' ? '✓' : a.status === 'declined' ? '✕' : '?'}
            </Text>
          </Row>
        ))}
      </Card>

      {/* --- Repertorio --- */}
      <Card>
        <Label>Repertorio</Label>
        <Divider />
        {setlist.settings.map((setting, i) => {
          const song = setlist.songs.find((s) => s.id === setting.songId);
          if (!song) return null;
          const ready = isVsReady(song);
          return (
            <View key={setting.songId} style={{ paddingVertical: spacing.sm, gap: spacing.xs }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ flex: 1 }}>
                  <Muted>{String(i + 1).padStart(2, '0')}</Muted>
                  <Text style={{ color: colors.text, fontSize: type.body, fontWeight: '600', flex: 1 }}>
                    {song.title}
                  </Text>
                </Row>
                <KeyBadge keyName={setting.selectedKey ?? song.originalKey} dimmed={!setting.selectedKey} />
              </Row>
              {/* Os tres status que decidem se da para tocar. */}
              <Row>
                <Pill text={ready ? 'VS pronta' : 'Processando'} tone={ready ? 'ok' : 'warn'} />
                <Pill
                  text={setting.selectedKey ? 'Tom definido' : 'Tom original'}
                  tone={setting.selectedKey ? 'ok' : 'warn'}
                />
                <Pill
                  text={OFFLINE_STATUS_LABEL[offlineSongs.has(song.id) ? 'offline' : 'cloud']}
                  tone={offlineSongs.has(song.id) ? 'ok' : 'neutral'}
                />
              </Row>
              <Row>
                <Button
                  title="Estudar"
                  variant="ghost"
                  onPress={() => router.push(`/estudo/${song.id}?eventId=${id}`)}
                />
                <Button
                  title="Definir tom"
                  variant="ghost"
                  onPress={() => router.push(`/evento/${id}/tom?songId=${song.id}`)}
                />
              </Row>
            </View>
          );
        })}
      </Card>

      <Button title="Baixar culto" onPress={() => router.push(`/evento/${id}/livecheck`)} />
      <Button title="Live Check" variant="ghost" onPress={() => router.push(`/evento/${id}/livecheck`)} />
    </Screen>
  );
}
