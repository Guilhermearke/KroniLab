/** Ajustes e diagnostico. */
import { Text } from 'react-native';
import { Card, Label, Muted, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { engineKind } from '../../src/audio-engine/index.ts';
import { isCloudConfigured } from '../../src/data/supabase.ts';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { colors, type } from '../../src/theme.ts';

export default function Mais() {
  const { member, role } = useSession();
  return (
    <Screen>
      <Title>Mais</Title>
      <Card>
        <Label>Conta</Label>
        <Text style={{ color: colors.text, fontSize: type.body }}>{member?.name ?? 'Nao autenticado'}</Text>
        <Muted>Papel: {role}</Muted>
      </Card>
      <Card>
        <Label>Diagnostico</Label>
        {/* Informacao honesta: no palco, saber qual engine esta rodando importa. */}
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>Engine de audio</Muted>
          <Text style={{ color: engineKind() === 'native' ? colors.ok : colors.warn, fontWeight: '700' }}>
            {engineKind() === 'native' ? 'Nativa (sample-accurate)' : 'JS (timing nao garantido)'}
          </Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>Nuvem</Muted>
          <Text style={{ color: isCloudConfigured() ? colors.ok : colors.warn, fontWeight: '700' }}>
            {isCloudConfigured() ? 'Configurada' : 'Nao configurada'}
          </Text>
        </Row>
      </Card>
    </Screen>
  );
}
