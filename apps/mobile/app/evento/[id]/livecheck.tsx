/**
 * Live Check (item 20) — a tela que evita o desastre.
 *
 * Roda antes do culto e responde uma pergunta so: da para subir no palco?
 * Item vermelho bloqueia. Amarelo avisa e deixa passar.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { buildManifest, runLiveCheck } from '@kronilab/core';
import type { ChurchEvent, EventSongSettings, LiveCheckResult, Song } from '@kronilab/core';
import { Button, Card, Divider, Label, Muted, Row, Screen, Title } from '../../../src/ui/kit.tsx';
import { getEvent, getSetlist } from '../../../src/data/repositories.ts';
import { useDownload } from '../../../src/domains/offline/useDownload.ts';
import { colors, spacing, type } from '../../../src/theme.ts';

export default function LiveCheckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [data, setData] = useState<{ settings: EventSongSettings[]; songs: Song[] }>({ settings: [], songs: [] });
  const [result, setResult] = useState<LiveCheckResult | null>(null);

  const download = useDownload(
    event ?? ({ id: id!, churchId: '', ministryId: '', name: '', startsAt: '', location: null, status: 'published', notes: null }),
    data.songs, data.settings,
    async (key) => key, // em producao: URL assinada do R2
  );

  useEffect(() => {
    (async () => {
      setEvent(await getEvent(id!));
      setData(await getSetlist(id!));
    })();
  }, [id]);

  useEffect(() => {
    if (!event) return;
    (async () => {
      const free = await FileSystem.getFreeDiskStorageAsync();
      setResult(runLiveCheck({
        songs: data.songs,
        settings: data.settings,
        manifest: buildManifest({ event, songs: data.songs, settings: data.settings }),
        local: null,
        storageFreeBytes: free,
        audioOutputConnected: true,
      }));
    })();
  }, [event, data, download.progress]);

  return (
    <Screen>
      <Title>Live Check</Title>
      <Muted>{event?.name}</Muted>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>Download do culto</Label>
          <Muted>{download.totalLabel}</Muted>
        </Row>
        <View style={{ height: 6, backgroundColor: colors.line, borderRadius: 3, overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(download.progress * 100)}%`, height: 6, backgroundColor: colors.accent }} />
        </View>
        {download.error && <Text style={{ color: colors.danger, fontSize: type.label }}>{download.error}</Text>}
        <Button
          title={download.busy ? 'Baixando...' : 'Baixar culto'}
          onPress={() => void download.download()}
          disabled={download.busy}
        />
      </Card>

      <Card>
        {result?.items.map((item) => (
          <View key={item.id}>
            <Row style={{ justifyContent: 'space-between', paddingVertical: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: type.body, fontWeight: '600' }}>{item.label}</Text>
                <Text style={{ color: colors.textMuted, fontSize: type.label }}>{item.detail}</Text>
              </View>
              <Text style={{
                fontSize: type.heading, fontWeight: '800',
                color: item.status === 'ok' ? colors.ok : item.status === 'warn' ? colors.warn : colors.danger,
              }}>
                {item.status === 'ok' ? '✓' : item.status === 'warn' ? '!' : '✕'}
              </Text>
            </Row>
            <Divider />
          </View>
        ))}
      </Card>

      {result && (
        <>
          <Text style={{
            color: result.ready ? colors.ok : colors.danger,
            fontSize: type.title, fontWeight: '800', textAlign: 'center',
          }}>
            {result.ready ? 'PRONTO PARA O CULTO' : 'AINDA NAO DA PARA SUBIR'}
          </Text>
          <Button
            title="Entrar no Live Mode"
            onPress={() => router.push(`/live/${id}`)}
            disabled={!result.ready}
          />
        </>
      )}
    </Screen>
  );
}
