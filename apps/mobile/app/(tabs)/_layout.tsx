import { Tabs } from 'expo-router';
import { colors } from '../../src/theme.ts';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Hoje' }} />
      <Tabs.Screen name="cultos" options={{ title: 'Cultos' }} />
      <Tabs.Screen name="musicas" options={{ title: 'Musicas' }} />
      <Tabs.Screen name="equipe" options={{ title: 'Equipe' }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais' }} />
    </Tabs>
  );
}
