/**
 * Hoje.
 *
 * Responde tres perguntas antes de qualquer toque: quando e o proximo culto, em
 * que eu estou escalado, e falta alguma coisa minha.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { ChurchEvent, EventSongSettings, Instrument, Song } from '@kronilab/core';
import { Button, Card, KeyBadge, Label, Muted, Pill, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { listUpcomingEvents, getSetlist } from '../../src/data/repositories.ts';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { colors, spacing, type } from '../../src/theme.ts';

export default function Hoje() {
  const router = useRouter();
  const { member, churchId } = useSession();
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [setlist, setSetlist] = useState<{ settings: EventSongSettings[]; songs: Song[] }>({ settings: [], songs: [] });

  useEffect(() => {
    (async () => {
      const events = await listUpcomingEvents(churchId);
      const next = events[0] ?? null;
      setEvent(next);
      if (next) setSetlist(await getSetlist(next.id));
    })();
  }, [churchId]);

  return (
    <Screen>
      <Title>{greeting()}, {member?.name.split(' ')[0] ?? ''}</Title>

      {!event && (
        <Card>
          <Muted>Nenhum culto agendado.</Muted>
        </Card>
      )}

      {event && (
        <Card onPress={() => router.push(`/evento/${event.id}`)}>
          <Label>Proximo culto</Label>
          <Text style={{ color: colors.text, fontSize: type.heading, fontWeight: '700' }}>
            {formatWhen(event.startsAt)}
          </Text>
          {member?.instrument && (
            <Row>
              <Muted>Voce esta escalado:</Muted>
              <Pill text={instrumentLabel(member.instrument)} tone="ok" />
            </Row>
          )}
          <Muted>{setlist.songs.length} musicas</Muted>

          <View style={{ height: spacing.sm }} />
          <Button title="Abrir culto" onPress={() => router.push(`/evento/${event.id}`)} />
        </Card>
      )}

      {event && setlist.songs.length > 0 && (
        <Card>
          <Label>Repertorio</Label>
          {setlist.settings.map((setting, i) => {
            const song = setlist.songs.find((s) => s.id === setting.songId);
            if (!song) return null;
            return (
              <Row key={setting.songId} style={{ justifyContent: 'space-between', paddingVertical: spacing.xs }}>
                <Row>
                  <Muted>{String(i + 1).padStart(2, '0')}</Muted>
                  <Text style={{ color: colors.text, fontSize: type.body }}>{song.title}</Text>
                </Row>
                {/* Tom do culto em destaque; tom original apagado quando o
                    ministro ainda nao decidiu. */}
                <KeyBadge keyName={setting.selectedKey ?? song.originalKey} dimmed={!setting.selectedKey} />
              </Row>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  return h < 18 ? 'Boa tarde' : 'Boa noite';
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const dias = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
  return `${dias[d.getDay()]} • ${String(d.getHours()).padStart(2, '0')}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
}

function instrumentLabel(i: Instrument): string {
  const map: Record<Instrument, string> = {
    MINISTRO: 'Ministro', VOCAL: 'Vocal', GUITARRA: 'Guitarra', VIOLAO: 'Violao',
    BAIXO: 'Baixo', BATERIA: 'Bateria', TECLADO: 'Teclado', SOM: 'Som', PROJECAO: 'Projecao',
  };
  return map[i];
}
