import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../src/theme.ts';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Live Mode ocupa a tela inteira: sem header, sem tab bar, sem distracao. */}
        <Stack.Screen name="live/[eventId]" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="evento/[id]/index" options={{ title: 'Culto' }} />
        <Stack.Screen name="evento/[id]/livecheck" options={{ title: 'Live Check' }} />
        <Stack.Screen name="evento/[id]/tom" options={{ title: 'Definir tom' }} />
        <Stack.Screen name="evento/[id]/escala" options={{ title: 'Escala' }} />
        <Stack.Screen name="evento/[id]/repertorio" options={{ title: 'Repertorio' }} />
        <Stack.Screen name="evento/novo" options={{ title: 'Novo culto', presentation: 'modal' }} />
        <Stack.Screen name="estudo/[songId]" options={{ title: 'Estudar' }} />
        <Stack.Screen name="musica/nova" options={{ title: 'Nova musica', presentation: 'modal' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
