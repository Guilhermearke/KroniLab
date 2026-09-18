/**
 * Criar culto.
 *
 * O culto nasce com as funcoes ja definidas: uma escala sem funcoes e so uma
 * data no calendario. O ministro escolhe quem preenche depois.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Instrument } from '@kronilab/core';
import { Button, Card, Label, Muted, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { createEvent } from '../../src/data/repositories.ts';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { colors, radius, spacing, type } from '../../src/theme.ts';

const INSTRUMENTS: { key: Instrument; label: string }[] = [
  { key: 'MINISTRO', label: 'Ministro' },
  { key: 'VOCAL', label: 'Vocal' },
  { key: 'GUITARRA', label: 'Guitarra' },
  { key: 'VIOLAO', label: 'Violao' },
  { key: 'BAIXO', label: 'Baixo' },
  { key: 'BATERIA', label: 'Bateria' },
  { key: 'TECLADO', label: 'Teclado' },
  { key: 'SOM', label: 'Som' },
  { key: 'PROJECAO', label: 'Projecao' },
];

/** O que quase todo culto pede — o lider tira o que nao usa. */
const DEFAULT_ROLES: Instrument[] = ['MINISTRO', 'VOCAL', 'GUITARRA', 'BAIXO', 'BATERIA', 'TECLADO'];

export default function NovoCulto() {
  const router = useRouter();
  const { churchId } = useSession();
  const [name, setName] = useState('Culto de Domingo');
  const [date, setDate] = useState(defaultDate());
  const [time, setTime] = useState('19:00');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [roles, setRoles] = useState<Instrument[]>(DEFAULT_ROLES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const startsAt = toIso(date, time);
      if (!startsAt) throw new Error('Data ou hora invalida. Use dd/mm/aaaa e hh:mm.');
      const id = await createEvent({
        churchId, ministryId: `${churchId}-louvor`, name,
        startsAt, location: location || null, notes: notes || null,
        roles: roles.map((instrument) => ({ instrument, slots: instrument === 'VOCAL' ? 2 : 1 })),
      });
      router.replace(`/evento/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>Novo culto</Title>

      <Card>
        <Label>Nome</Label>
        <Field value={name} onChangeText={setName} placeholder="Culto de Domingo" />
        <Row>
          <View style={{ flex: 1 }}>
            <Label>Data</Label>
            <Field value={date} onChangeText={setDate} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" />
          </View>
          <View style={{ width: 110 }}>
            <Label>Hora</Label>
            <Field value={time} onChangeText={setTime} placeholder="19:00" keyboardType="numbers-and-punctuation" />
          </View>
        </Row>
        <Label>Local</Label>
        <Field value={location} onChangeText={setLocation} placeholder="Templo" />
        <Label>Observacoes</Label>
        <Field value={notes} onChangeText={setNotes} placeholder="Ensaio as 18h" multiline />
      </Card>

      <Card>
        <Label>Funcoes deste culto</Label>
        <Muted>Toque para incluir ou tirar.</Muted>
        <Row style={{ flexWrap: 'wrap', marginTop: spacing.xs }}>
          {INSTRUMENTS.map((item) => {
            const active = roles.includes(item.key);
            return (
              <Pressable
                key={item.key}
                onPress={() => setRoles((r) => active ? r.filter((x) => x !== item.key) : [...r, item.key])}
                style={{
                  paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
                  borderRadius: radius.pill, borderWidth: 1.5,
                  borderColor: active ? colors.accent : colors.line,
                  backgroundColor: active ? colors.accentSoft : 'transparent',
                }}
              >
                <Text style={{ color: active ? colors.accent : colors.textMuted, fontWeight: '700', fontSize: type.label }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      {error && <Text style={{ color: colors.danger, fontSize: type.label }}>{error}</Text>}
      <Button
        title={saving ? 'Criando...' : 'Criar culto'}
        onPress={() => void save()}
        disabled={saving || roles.length === 0 || name.trim().length === 0}
      />
    </Screen>
  );
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.textMuted}
      style={{
        backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1,
        borderColor: colors.line, color: colors.text, padding: spacing.md,
        fontSize: type.body, marginBottom: spacing.sm,
      }}
    />
  );
}

function defaultDate(): string {
  // Proximo domingo: e o culto que a maioria das igrejas monta primeiro.
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** dd/mm/aaaa + hh:mm -> ISO. Devolve null em vez de uma data inventada. */
function toIso(date: string, time: string): string | null {
  const dm = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const tm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const parsed = new Date(
    Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]), Number(tm[1]), Number(tm[2]),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
