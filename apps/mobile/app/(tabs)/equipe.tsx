/** Equipe do ministerio. */
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Card, Muted, Pill, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { getDb } from '../../src/data/db.ts';
import { colors, type } from '../../src/theme.ts';

export default function Equipe() {
  const [members, setMembers] = useState<{ name: string; instrument: string; status: string }[]>([]);

  useEffect(() => {
    (async () => {
      const conn = await getDb();
      // Sem sync ainda, a equipe visivel e a das escalas ja baixadas.
      const rows = await conn.getAllAsync<any>(
        'select distinct member_name as name, instrument, status from event_members order by member_name',
      );
      setMembers(rows);
    })();
  }, []);

  return (
    <Screen>
      <Title>Equipe</Title>
      {members.length === 0 && <Muted>Nenhum membro sincronizado ainda.</Muted>}
      {members.map((m, i) => (
        <Card key={`${m.name}-${i}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontSize: type.body, fontWeight: '600' }}>{m.name}</Text>
            <Pill text={m.instrument} tone="neutral" />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
