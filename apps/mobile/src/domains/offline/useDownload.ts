/**
 * Download do culto (item 19).
 *
 * Baixa tudo que o palco precisa: stems, click, guia, grid, secoes, tom,
 * setlist. Depois disso o culto roda sem rede.
 */
import { useCallback, useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import {
  buildManifest, downloadProgress, formatBytes, manifestBytes,
  missingAssets, offlineStatus,
} from '@levita/core';
import type { ChurchEvent, EventSongSettings, LocalManifest, OfflineStatus, Song } from '@levita/core';
import { getDb, logEvent } from '../../data/db.ts';

export interface DownloadApi {
  status: OfflineStatus;
  progress: number;
  totalLabel: string;
  download(): Promise<void>;
  busy: boolean;
  error: string | null;
}

export function useDownload(
  event: ChurchEvent,
  songs: Song[],
  settings: EventSongSettings[],
  signedUrl: (remoteKey: string) => Promise<string>,
): DownloadApi {
  const [local, setLocal] = useState<LocalManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const manifest = buildManifest({ event, songs, settings });

  useEffect(() => { void loadLocal(event.id).then(setLocal); }, [event.id]);
  useEffect(() => { setProgress(downloadProgress(manifest, local)); }, [local, manifest.revision]);

  const download = useCallback(async () => {
    setBusy(true);
    setError(null);
    const dir = `${FileSystem.documentDirectory}events/${event.id}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

    const pending = missingAssets(manifest, local);
    const done = new Set(local?.downloadedKeys ?? []);

    try {
      for (const [i, asset] of pending.entries()) {
        const target = `${dir}${asset.key.replace('/', '_')}`;
        const url = await signedUrl(asset.url);
        const result = await FileSystem.downloadAsync(url, target);
        if (result.status !== 200) throw new Error(`HTTP ${result.status} em ${asset.key}`);

        const [songId, stem] = asset.key.split('/');
        const conn = await getDb();
        await conn.runAsync(
          'update song_stems set local_uri = ? where song_id = ? and stem = ?',
          [result.uri, songId!, stem!],
        );
        done.add(asset.key);
        setProgress((i + 1) / pending.length);
      }

      const saved: LocalManifest = {
        eventId: event.id, revision: manifest.revision,
        downloadedKeys: [...done], downloadedAt: new Date().toISOString(),
      };
      await persistLocal(saved);
      setLocal(saved);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      // Falha de download e registrada: no domingo de manha isso e a diferenca
      // entre "nao sei o que houve" e "faltou o stem tal".
      void logEvent('download_failure', { eventId: event.id, payload: { message } });
    } finally {
      setBusy(false);
    }
  }, [event.id, manifest.revision, local]);

  return {
    status: offlineStatus({ manifest, local, downloading: busy }),
    progress,
    totalLabel: formatBytes(manifestBytes(manifest)),
    download, busy, error,
  };
}

async function loadLocal(eventId: string): Promise<LocalManifest | null> {
  const conn = await getDb();
  const row = await conn.getFirstAsync<any>(
    'select * from offline_manifests where event_id = ?', [eventId],
  );
  return row ? {
    eventId: row.event_id, revision: row.revision,
    downloadedKeys: JSON.parse(row.downloaded_keys), downloadedAt: row.downloaded_at,
  } : null;
}

async function persistLocal(m: LocalManifest): Promise<void> {
  const conn = await getDb();
  await conn.runAsync(
    `insert into offline_manifests (event_id, revision, downloaded_keys, downloaded_at)
     values (?, ?, ?, ?)
     on conflict(event_id) do update set revision = excluded.revision,
       downloaded_keys = excluded.downloaded_keys, downloaded_at = excluded.downloaded_at`,
    [m.eventId, m.revision, JSON.stringify(m.downloadedKeys), m.downloadedAt],
  );
}
