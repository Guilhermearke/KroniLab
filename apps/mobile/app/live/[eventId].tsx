/**
 * LIVE MODE.
 *
 * Interface de palco, nao de edicao: botoes grandes, sem tab bar, sem menu, sem
 * nada que possa ser tocado por engano no meio do culto.
 *
 * AMBAR = tocando agora. AZUL = enfileirado. E so isso que o operador precisa
 * distinguir sob a luz do refletor.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { EventSongSettings, QuantizeMode, Song } from '@kronilab/core';
import { getSetlist } from '../../src/data/repositories.ts';
import { useLiveSession } from '../../src/domains/live/useLiveSession.ts';
import { colors, radius, spacing, type } from '../../src/theme.ts';

const QUANTIZE_LABEL: Record<QuantizeMode, string> = {
  'next-beat': 'Tempo',
  'next-bar': 'Compasso',
  'end-of-section': 'Fim da secao',
};

export default function LiveMode() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ settings: EventSongSettings[]; songs: Song[] }>({ settings: [], songs: [] });

  useEffect(() => { void getSetlist(eventId!).then(setData); }, [eventId]);

  const live = useLiveSession(eventId!, data.songs, data.settings);
  const sections = live.song?.sections ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg, paddingTop: spacing.xxl }}>
      {/* Cabecalho: musica, tom, BPM, compasso */}
      <Pressable onPress={() => router.back()} style={{ position: 'absolute', top: spacing.lg, right: spacing.lg, padding: spacing.sm }}>
        <Text style={{ color: colors.textMuted, fontSize: type.body }}>Sair</Text>
      </Pressable>

      <Text style={{ color: colors.text, fontSize: type.liveTitle, fontWeight: '800', letterSpacing: -1 }}>
        {live.song?.title.toUpperCase() ?? '—'}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: type.heading, marginTop: spacing.xs }}>
        {live.selectedKey} • {Math.round(live.bpm)} BPM • {live.song?.analysis?.timeSignature.beatsPerBar ?? 4}/4
        {'   '}
        <Text style={{ color: colors.accent }}>{live.bar}.{live.beat}</Text>
      </Text>

      {live.engine === 'js' && (
        <Text style={{ color: colors.warn, fontSize: type.micro, marginTop: spacing.xs }}>
          Engine JS: timing nao garantido. Use o build nativo no palco.
        </Text>
      )}

      {/* Secoes: o corpo da tela. Tocar enfileira, nao pula. */}
      <ScrollView style={{ flex: 1, marginTop: spacing.lg }} contentContainerStyle={{ gap: spacing.sm }}>
        {sections.map((section) => {
          const isCurrent = live.currentSection?.id === section.id;
          const isQueued = live.queuedSection?.id === section.id;
          const isLoop = live.loopSectionId === section.id;
          return (
            <Pressable
              key={section.id}
              onPress={() => live.jumpTo(section.id)}
              onLongPress={() => live.toggleLoop(section.id)}
              style={{
                paddingVertical: spacing.lg, paddingHorizontal: spacing.xl,
                borderRadius: radius.lg, borderWidth: 2,
                borderColor: isCurrent ? colors.accent : isQueued ? colors.queued : colors.line,
                backgroundColor: isCurrent ? colors.accentSoft : 'transparent',
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <Text style={{
                color: isCurrent ? colors.accent : isQueued ? colors.queued : colors.text,
                fontSize: type.liveSection, fontWeight: '800',
              }}>
                {section.label.toUpperCase()}
              </Text>
              <View style={{ alignItems: 'flex-end' }}>
                {isLoop && <Text style={{ color: colors.accent, fontSize: type.label, fontWeight: '700' }}>LOOP</Text>}
                {isQueued && <Text style={{ color: colors.queued, fontSize: type.label, fontWeight: '700' }}>NA FILA</Text>}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Estado: o que toca agora e o que vem depois */}
      <View style={{ flexDirection: 'row', gap: spacing.xl, paddingVertical: spacing.md }}>
        <View>
          <Text style={{ color: colors.textMuted, fontSize: type.micro, fontWeight: '700' }}>ATUAL</Text>
          <Text style={{ color: colors.accent, fontSize: type.heading, fontWeight: '800' }}>
            {live.currentSection?.label.toUpperCase() ?? '—'}
          </Text>
        </View>
        <View>
          <Text style={{ color: colors.textMuted, fontSize: type.micro, fontWeight: '700' }}>PROXIMO</Text>
          <Text style={{ color: colors.queued, fontSize: type.heading, fontWeight: '800' }}>
            {(live.queuedSection ?? live.nextInArrangement)?.label.toUpperCase() ?? '—'}
          </Text>
        </View>
      </View>

      {/* Transporte */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <LiveButton label={live.playing ? 'PAUSE' : 'PLAY'} primary onPress={() => (live.playing ? live.pause() : live.play())} />
        <LiveButton label="NUDGE −" onPress={() => live.nudge(-1)} />
        <LiveButton label="NUDGE +" onPress={() => live.nudge(1)} />
        <LiveButton label={live.tapBpm ? `TAP ${live.tapBpm}` : 'TAP'} onPress={live.tap} />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <LiveButton
          label={`SALTO: ${QUANTIZE_LABEL[live.quantize].toUpperCase()}`}
          onPress={() => live.setQuantize(nextQuantize(live.quantize))}
        />
        {live.queuedSection && <LiveButton label="CANCELAR FILA" onPress={live.cancelJump} />}
        <LiveButton label="PROXIMA ▸" onPress={live.nextSong} />
      </View>
    </View>
  );
}

function LiveButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1, paddingVertical: spacing.lg, borderRadius: radius.md,
        borderWidth: 2, borderColor: primary ? colors.accent : colors.line,
        backgroundColor: primary ? colors.accent : colors.surface,
        alignItems: 'center', opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{
        color: primary ? colors.bg : colors.text,
        fontSize: type.body, fontWeight: '800',
      }}>
        {label}
      </Text>
    </Pressable>
  );
}

function nextQuantize(mode: QuantizeMode): QuantizeMode {
  const order: QuantizeMode[] = ['next-bar', 'next-beat', 'end-of-section'];
  return order[(order.indexOf(mode) + 1) % order.length]!;
}
