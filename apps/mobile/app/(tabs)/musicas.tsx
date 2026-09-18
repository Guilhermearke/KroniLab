/** Repertorio da igreja. Cada musica e uma VS completa — ou esta virando uma. */
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { isVsReady } from '@kronilab/core';
import type { Song } from '@kronilab/core';
import { Button, Card, KeyBadge, Muted, Pill, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { getDb } from '../../src/data/db.ts';
import { getSong } from '../../src/data/repositories.ts';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { colors, type } from '../../src/theme.ts';

export default function Musicas() {
  const router = useRouter();
  const { churchId, allows } = useSession();
  const [songs, setSongs] = useState<Song[]>([]);

  useEffect(() => {
    (async () => {
      const conn = await getDb();
      const rows = await conn.getAllAsync<any>(
        'select id from songs where church_id = ? order by title', [churchId],
      );
      const loaded = await Promise.all(rows.map((r) => getSong(r.id)));
      setSongs(loaded.filter((s): s is Song => s !== null));
    })();
  }, [churchId]);

  return (
    <Screen>
      <Title>Musicas</Title>
      {allows('song:upload') && (
        <Button title="+ Nova musica" onPress={() => router.push('/musica/nova')} />
      )}
      {songs.map((song) => (
        <Card key={song.id} onPress={() => router.push(`/estudo/${song.id}`)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontSize: type.body, fontWeight: '700', flex: 1 }}>
              {song.title}
            </Text>
            <KeyBadge keyName={song.originalKey} />
          </Row>
          <Row>
            {song.artist && <Muted>{song.artist}</Muted>}
            {song.analysis && <Muted>{Math.round(song.analysis.bpm)} BPM</Muted>}
            <Pill text={isVsReady(song) ? 'VS pronta' : 'Processando'} tone={isVsReady(song) ? 'ok' : 'warn'} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
