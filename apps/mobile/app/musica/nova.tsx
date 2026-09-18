/**
 * Nova musica: envia o audio e a IA monta a VS.
 *
 * O usuario ve as etapas reais do pipeline, nao uma barra generica. Se a
 * separacao demorar 4 minutos, ele sabe que esta separando.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Button, Card, Label, Muted, Screen, Title } from '../../src/ui/kit.tsx';
import { useSession } from '../../src/domains/auth/useSession.ts';
import { useUpload } from '../../src/domains/audio-processing/useUpload.ts';
import { colors, spacing, type } from '../../src/theme.ts';

export default function NovaMusica() {
  const router = useRouter();
  const { churchId } = useSession();
  const upload = useUpload();
  const [filename, setFilename] = useState<string | null>(null);

  async function pick() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/flac'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const file = result.assets[0];
    setFilename(file.name);
    const songId = `${Date.now()}`;
    await upload.upload(
      { uri: file.uri, name: file.name, mimeType: file.mimeType ?? 'audio/mpeg' },
      songId, churchId,
    );
  }

  return (
    <Screen>
      <Title>Nova musica</Title>
      <Muted>MP3, WAV, M4A, AAC ou FLAC.</Muted>

      <Button title="Escolher arquivo" onPress={() => void pick()} disabled={upload.state !== null && upload.state !== 'failed'} />

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
            <View style={{ marginTop: spacing.sm }}>
              <Button title="Ver musica" onPress={() => router.back()} />
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}
