/**
 * Repertorio do culto: ordem, tom, transicao e pad.
 *
 * A ordem e a transicao vivem NO CULTO, nunca na musica: a mesma cancao emenda
 * na proxima no domingo e termina seca no congresso, sem virar duas musicas.
 *
 * Reordenar renumera tudo de uma vez (ver setlist.ts): duas musicas com a mesma
 * posicao dariam ordens diferentes em cada aparelho da equipe.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  TRANSITION_LABEL, addSong, moveSong, removeSong, sortByPosition,
} from '@kronilab/core';
import type { EventSongSettings, Song, TransitionMode } from '@kronilab/core';
import { Button, Card, Divider, KeyBadge, Label, Muted, Pill, Row, Screen, Title } from '../../../src/ui/kit.tsx';
import { getEventSettings, listSongs, saveSetlist } from '../../../src/data/repositories.ts';
import { useSession } from '../../../src/domains/auth/useSession.ts';
import { colors, radius, spacing, type } from '../../../src/theme.ts';

const MODES: TransitionMode[] = ['stop', 'auto', 'crossfade', 'pad'];

export default function RepertorioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { churchId } = useSession();
  const [settings, setSettings] = useState<EventSongSettings[]>([]);
  const [library, setLibrary] = useState<Song[]>([]);
  const [adding, setAdding] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      setSettings(sortByPosition(await getEventSettings(id!)));
      setLibrary(await listSongs(churchId));
    })();
  }, [id, churchId]);

  function update(next: EventSongSettings[]): void {
    setSettings(next);
    setDirty(true);
  }

  function patch(songId: string, changes: Partial<EventSongSettings>): void {
    update(settings.map((s) => (s.songId === songId ? { ...s, ...changes } : s)));
  }

  const titleOf = (songId: string) =>
    library.find((s) => s.id === songId)?.title ?? songId;
  const originalKeyOf = (songId: string) =>
    library.find((s) => s.id === songId)?.originalKey ?? '?';

  return (
    <Screen>
      <Title>Repertorio</Title>
      <Muted>{settings.length} musicas. A ordem e a transicao valem so para este culto.</Muted>

      {settings.map((setting, index) => (
        <Card key={setting.songId}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ flex: 1 }}>
              <Muted>{String(index + 1).padStart(2, '0')}</Muted>
              <Text style={{ color: colors.text, fontSize: type.body, fontWeight: '700', flex: 1 }}>
                {titleOf(setting.songId)}
              </Text>
            </Row>
            <KeyBadge
              keyName={setting.selectedKey ?? originalKeyOf(setting.songId)}
              dimmed={!setting.selectedKey}
            />
          </Row>

          {/* Reordenar */}
          <Row>
            <Button title="↑" variant="ghost" disabled={index === 0}
              onPress={() => update(moveSong(settings, setting.songId, -1))} />
            <Button title="↓" variant="ghost" disabled={index === settings.length - 1}
              onPress={() => update(moveSong(settings, setting.songId, 1))} />
            <Button title="Tom" variant="ghost"
              onPress={() => router.push(`/evento/${id}/tom?songId=${setting.songId}`)} />
            <Button title="Tirar" variant="danger"
              onPress={() => update(removeSong(settings, setting.songId))} />
          </Row>

          <Divider />

          {/* Transicao: o que acontece quando esta musica acaba */}
          <Label>Ao terminar</Label>
          <Row style={{ flexWrap: 'wrap' }}>
            {MODES.map((mode) => {
              const active = (setting.transition ?? 'stop') === mode;
              // A ultima musica nao tem para onde emendar.
              const disabled = index === settings.length - 1 && (mode === 'auto' || mode === 'crossfade');
              return (
                <Pressable
                  key={mode}
                  disabled={disabled}
                  onPress={() => patch(setting.songId, { transition: mode })}
                  style={{
                    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
                    borderRadius: radius.pill, borderWidth: 1.5, opacity: disabled ? 0.35 : 1,
                    borderColor: active ? colors.accent : colors.line,
                    backgroundColor: active ? colors.accentSoft : 'transparent',
                  }}
                >
                  <Text style={{ color: active ? colors.accent : colors.textMuted, fontWeight: '700', fontSize: type.label }}>
                    {TRANSITION_LABEL[mode]}
                  </Text>
                </Pressable>
              );
            })}
          </Row>

          {/* Pad */}
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Label>Pad no tom</Label>
              <Muted>Segura o tom entre as musicas, com fade.</Muted>
            </View>
            <Pressable
              onPress={() => patch(setting.songId, { padEnabled: !setting.padEnabled })}
              style={{
                paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
                borderRadius: radius.pill, borderWidth: 1.5,
                borderColor: setting.padEnabled ? colors.ok : colors.line,
                backgroundColor: setting.padEnabled ? '#0E2B1E' : 'transparent',
              }}
            >
              <Text style={{ color: setting.padEnabled ? colors.ok : colors.textMuted, fontWeight: '800', fontSize: type.label }}>
                {setting.padEnabled ? 'LIGADO' : 'DESLIGADO'}
              </Text>
            </Pressable>
          </Row>

          {/* Aviso util: mudanca de tom entre musicas com pad ligado */}
          {setting.padEnabled && settings[index + 1] && (
            <Pill
              text={
                (setting.selectedKey ?? originalKeyOf(setting.songId)) ===
                (settings[index + 1]!.selectedKey ?? originalKeyOf(settings[index + 1]!.songId))
                  ? 'Mesmo tom da proxima'
                  : `Troca de tom para ${settings[index + 1]!.selectedKey ?? originalKeyOf(settings[index + 1]!.songId)} com crossfade`
              }
              tone="queued"
            />
          )}
        </Card>
      ))}

      {/* Adicionar do repertorio da igreja */}
      {adding ? (
        <Card>
          <Label>Adicionar musica</Label>
          {library
            .filter((s) => !settings.some((x) => x.songId === s.id))
            .map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  update(addSong(settings, {
                    id: `${id}:${s.id}`, eventId: id!, songId: s.id, arrangementId: null,
                    selectedKey: null, selectedTempo: null, notes: null,
                    transition: 'stop', padEnabled: false,
                    updatedAt: new Date().toISOString(),
                  }));
                  setAdding(false);
                }}
                style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontSize: type.body }}>{s.title}</Text>
                  <KeyBadge keyName={s.originalKey} dimmed />
                </Row>
              </Pressable>
            ))}
          <Button title="Cancelar" variant="ghost" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button title="+ Adicionar musica" variant="ghost" onPress={() => setAdding(true)} />
      )}

      {dirty && (
        <Button
          title="Salvar repertorio"
          onPress={async () => { await saveSetlist(id!, settings); setDirty(false); }}
        />
      )}
    </Screen>
  );
}
