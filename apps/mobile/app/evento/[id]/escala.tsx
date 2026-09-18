/**
 * Escala do culto.
 *
 * O lider preenche funcao por funcao e o membro confirma. O que importa na tela
 * e enxergar de relance o que ainda falta — por isso o contador de confirmados
 * fica no topo e as funcoes vazias aparecem primeiro.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Instrument } from '@kronilab/core';
import { Button, Card, Divider, Label, Muted, Pill, Row, Screen, Title } from '../../../src/ui/kit.tsx';
import { assignMember, clearAssignment } from '../../../src/data/repositories.ts';
import { getDb } from '../../../src/data/db.ts';
import { useAssignments } from '../../../src/domains/events/useAssignments.ts';
import { colors, radius, spacing, type } from '../../../src/theme.ts';

interface TeamMember { id: string; name: string; instrument: Instrument | null }

export default function EscalaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { assignments, confirmed, total, respond, reload } = useAssignments(id!);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [picking, setPicking] = useState<Instrument | null>(null);

  useEffect(() => {
    (async () => {
      const conn = await getDb();
      const rows = await conn.getAllAsync<any>(
        'select distinct member_id as id, member_name as name, instrument from event_members where member_id != ""',
      );
      setTeam(rows);
    })();
  }, []);

  // Vazias primeiro: e o que o lider precisa resolver.
  const ordered = [...assignments].sort((a, b) => Number(!!b.memberName) - Number(!!a.memberName));

  return (
    <Screen>
      <Title>Escala</Title>
      <Row>
        <Pill
          text={`${confirmed}/${total} confirmados`}
          tone={confirmed === total && total > 0 ? 'ok' : 'warn'}
        />
        {assignments.some((a) => !a.memberName) && (
          <Pill text={`${assignments.filter((a) => !a.memberName).length} sem ninguem`} tone="danger" />
        )}
      </Row>

      {ordered.map((assignment) => (
        <Card key={assignment.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{assignment.instrument}</Label>
            <Pill
              text={statusLabel(assignment.status)}
              tone={assignment.status === 'confirmed' ? 'ok'
                : assignment.status === 'declined' ? 'danger' : 'warn'}
            />
          </Row>
          <Text style={{ color: assignment.memberName ? colors.text : colors.textMuted, fontSize: type.heading, fontWeight: '600' }}>
            {assignment.memberName || 'Ninguem escalado'}
          </Text>

          {picking === assignment.instrument ? (
            <View style={{ gap: spacing.xs }}>
              <Muted>Escolher da equipe:</Muted>
              {team.length === 0 && <Muted>Nenhum membro sincronizado ainda.</Muted>}
              {team.map((member) => (
                <Pressable
                  key={`${member.id}-${member.name}`}
                  onPress={async () => {
                    await assignMember({
                      eventId: id!, instrument: assignment.instrument,
                      memberId: member.id, memberName: member.name,
                    });
                    setPicking(null);
                    await reload();
                  }}
                  style={{
                    padding: spacing.md, borderRadius: radius.md,
                    borderWidth: 1, borderColor: colors.line,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: type.body }}>{member.name}</Text>
                </Pressable>
              ))}
              <Button title="Cancelar" variant="ghost" onPress={() => setPicking(null)} />
            </View>
          ) : (
            <Row>
              <Button
                title={assignment.memberName ? 'Trocar' : 'Escalar'}
                variant="ghost"
                onPress={() => setPicking(assignment.instrument)}
              />
              {assignment.memberName !== '' && (
                <>
                  <Button
                    title="Confirmar"
                    variant="ghost"
                    onPress={() => void respond(assignment.id, 'confirmed')}
                  />
                  <Button
                    title="Remover"
                    variant="danger"
                    onPress={async () => { await clearAssignment(id!, assignment.instrument); await reload(); }}
                  />
                </>
              )}
            </Row>
          )}
          <Divider />
        </Card>
      ))}
    </Screen>
  );
}

function statusLabel(status: string): string {
  return status === 'confirmed' ? 'Confirmado'
    : status === 'declined' ? 'Recusou'
    : status === 'replacement_requested' ? 'Pediu troca'
    : 'Pendente';
}
