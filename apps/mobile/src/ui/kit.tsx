/**
 * Kit visual. Escuro, musical, alto contraste.
 *
 * Um principio guia tudo aqui: AMBAR e o que esta acontecendo agora, AZUL e o
 * que esta enfileirado. O operador de palco le a tela de relance — cor tem que
 * significar uma coisa so.
 */
import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, type } from '../theme.ts';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Body contentContainerStyle={scroll ? s.scrollBody : undefined} style={!scroll ? s.flex : undefined}>
        {children}
      </Body>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{String(children).toUpperCase()}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const content = <View style={[s.card, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

export function Button({
  title, onPress, variant = 'primary', disabled,
}: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        variant === 'primary' && s.buttonPrimary,
        variant === 'ghost' && s.buttonGhost,
        variant === 'danger' && s.buttonDanger,
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 },
      ]}
    >
      <Text style={[s.buttonText, variant === 'primary' && { color: colors.bg }]}>{title}</Text>
    </Pressable>
  );
}

export type Tone = 'ok' | 'warn' | 'danger' | 'queued' | 'neutral';

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const tint = {
    ok: colors.ok, warn: colors.warn, danger: colors.danger,
    queued: colors.queued, neutral: colors.textMuted,
  }[tone];
  return (
    <View style={[s.pill, { borderColor: tint }]}>
      <Text style={[s.pillText, { color: tint }]}>{text}</Text>
    </View>
  );
}

/** Tom exibido do jeito que o musico espera ver: grande e sozinho. */
export function KeyBadge({ keyName, dimmed }: { keyName: string; dimmed?: boolean }) {
  return (
    <View style={[s.keyBadge, dimmed && { borderColor: colors.line }]}>
      <Text style={[s.keyText, dimmed && { color: colors.textMuted }]}>{keyName}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.row, style]}>{children}</View>;
}

export function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scrollBody: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  title: { color: colors.text, fontSize: type.title, fontWeight: '700', letterSpacing: -0.5 },
  label: { color: colors.textMuted, fontSize: type.micro, fontWeight: '700', letterSpacing: 1.2 },
  muted: { color: colors.textMuted, fontSize: type.body },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.line, gap: spacing.sm,
  },
  button: {
    paddingVertical: spacing.md + 2, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, alignItems: 'center', borderWidth: 1,
  },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonGhost: { backgroundColor: 'transparent', borderColor: colors.line },
  buttonDanger: { backgroundColor: 'transparent', borderColor: colors.danger },
  buttonText: { color: colors.text, fontSize: type.body, fontWeight: '700' },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  pillText: { fontSize: type.micro, fontWeight: '700' },
  keyBadge: {
    minWidth: 44, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.accent, alignItems: 'center',
  },
  keyText: { color: colors.accent, fontSize: type.heading, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: spacing.sm },
});
