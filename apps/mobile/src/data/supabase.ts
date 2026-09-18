/** Cliente Supabase. Usado para sincronizar — nunca no meio do culto. */
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 2 } },
});

export function isCloudConfigured(): boolean {
  return url.length > 0 && anonKey.length > 0;
}
