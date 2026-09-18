/** Lista de cultos. */
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import type { ChurchEvent } from '@kronilab/core';
import { Button, Card, Muted, Pill, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { listUpcomingEvents } from '../../src/data/repositories.ts';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { colors, type } from '../../src/theme.ts';

const STATUS_TONE = { draft: 'neutral', published: 'ok', completed: 'neutral', cancelled: 'danger' } as const;
const STATUS_LABEL = { draft: 'Rascunho', published: 'Publicado', completed: 'Concluido', cancelled: 'Cancelado' };

export default function Cultos() {
  const router = useRouter();
  const { churchId, allows } = useSession();
  const [events, setEvents] = useState<ChurchEvent[]>([]);

  useEffect(() => { void listUpcomingEvents(churchId).then(setEvents); }, [churchId]);

  return (
    <Screen>
      <Title>Cultos</Title>
      {allows('event:create') && (
        <Button title="+ Novo culto" onPress={() => router.push('/evento/novo')} />
      )}
      {events.length === 0 && <Muted>Nenhum culto agendado.</Muted>}
      {events.map((event) => (
        <Card key={event.id} onPress={() => router.push(`/evento/${event.id}`)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontSize: type.heading, fontWeight: '700' }}>{event.name}</Text>
            <Pill text={STATUS_LABEL[event.status]} tone={STATUS_TONE[event.status]} />
          </Row>
          <Muted>{new Date(event.startsAt).toLocaleString('pt-BR')}</Muted>
          {event.location && <Muted>{event.location}</Muted>}
        </Card>
      ))}
    </Screen>
  );
}
