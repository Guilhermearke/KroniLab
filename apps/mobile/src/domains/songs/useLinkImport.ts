/**
 * Identificacao de musica por link.
 *
 * Traz metadado (titulo, artista) para a musica ja nascer identificada e para a
 * deduplicacao ter com que trabalhar. Nao traz audio — essa fronteira e
 * deliberada e esta documentada em services/audio-worker/app/importing.py.
 */
import { useCallback, useState } from 'react';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL ?? '';

export interface LinkResult {
  title: string;
  artist: string | null;
  source: string;
  sourceId: string | null;
  thumbnailUrl: string | null;
  needsAudioUpload: boolean;
}

export function useLinkImport() {
  const [result, setResult] = useState<LinkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identify = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${WORKER_URL}/import/link?url=${encodeURIComponent(url)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? `HTTP ${response.status}`);
      setResult({
        title: body.title, artist: body.artist, source: body.source,
        sourceId: body.source_id, thumbnailUrl: body.thumbnail_url,
        needsAudioUpload: body.needs_audio_upload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, identify, reset: () => setResult(null) };
}
