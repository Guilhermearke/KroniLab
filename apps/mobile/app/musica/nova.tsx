/**
 * Nova musica.
 *
 * Dois caminhos ate a mesma VS:
 *   1. colar o link — identifica a musica (titulo e artista);
 *   2. enviar o audio — e o que a IA processa.
 *
 * O link NAO traz o audio. Ele so identifica: a gravacao continua vindo da
 * igreja, que e quem tem o direito de usa-la (multitrack comprado, gravacao da
 * propria banda, arquivo licenciado). Extrair o audio do link copiaria a
 * gravacao original, e o produto nao se apoia nisso.
 */
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Button, Card, Label, Muted, Pill, Row, Screen, Title } from '../../src/ui/kit.tsx';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { useUpload } from '../../src/domains/audio-processing/useUpload.ts';
import { useLinkImport } from '../../src/domains/songs/useLinkImport.ts';
import { colors, radius, spacing, type } from '../../src/theme.ts';

export default function NovaMusica() {
  const router = useRouter();
  const { churchId } = useSession();
  const upload = useUpload();
  const link = useLinkImport();
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState<string | null>(null);

  const busy = upload.state !== null && upload.state !== 'failed';

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/flac'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const file = result.assets[0];
    setFilename(file.name);
    await upload.upload(
      { uri: file.uri, name: file.name, mimeType: file.mimeType ?? 'audio/mpeg' },
      `${Date.now()}`, churchId,
    );
  }

  return (
    <Screen>
      <Title>Nova musica</Title>

      {/* --- 1. identificar pelo link ------------------------------------ */}
      <Card>
        <Label>1. Identificar (opcional)</Label>
        <Muted>Cole o link do YouTube para preencher titulo e artista.</Muted>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://youtu.be/..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1,
            borderColor: colors.line, color: colors.text, padding: spacing.md,
            fontSize: type.body, marginTop: spacing.xs,
          }}
        />
        <Button
          title={link.loading ? 'Identificando...' : 'Identificar'}
          variant="ghost"
          disabled={link.loading || url.length === 0}
          onPress={() => void link.identify(url)}
        />
        {link.error && <Text style={{ color: colors.danger, fontSize: type.label }}>{link.error}</Text>}
        {link.result && (
          <View style={{ gap: spacing.xs }}>
            <Text style={{ color: colors.text, fontSize: type.heading, fontWeight: '700' }}>
              {link.result.title}
            </Text>
            {link.result.artist && <Muted>{link.result.artist}</Muted>}
            <Pill text="Falta o audio" tone="warn" />
          </View>
        )}
      </Card>

      {/* --- 2. enviar o audio ------------------------------------------- */}
      <Card>
        <Label>2. Enviar o audio</Label>
        <Muted>
          O link identifica a musica, mas nao traz a gravacao. Envie o arquivo que a
          igreja tem direito de usar: o multitrack comprado, a gravacao da propria
          banda ou o arquivo licenciado. MP3, WAV, M4A, AAC ou FLAC.
        </Muted>
        <Button title="Escolher arquivo" onPress={() => void pickFile()} disabled={busy} />
      </Card>

      {/* --- 3. a IA monta a VS ------------------------------------------ */}
      {filename && (
        <Card>
          <Label>{filename}</Label>
          <Text style={{ color: colors.accent, fontSize: type.heading, fontWeight: '700' }}>
            {upload.stateLabel}
          </Text>
          <View style={{ height: 6, backgroundColor: colors.line, borderRadius: 3, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(upload.progress * 100)}%`, height: 6, backgroundColor: colors.accent }} />
          </View>
          {upload.error && <Text style={{ color: colors.danger, fontSize: type.label }}>{upload.error}</Text>}
          {upload.state === 'completed' && (
            <Row style={{ marginTop: spacing.sm }}>
              <Button title="Ver musica" onPress={() => router.back()} />
            </Row>
          )}
        </Card>
      )}
    </Screen>
  );
}
