/**
 * Offline (itens 19 e 35).
 *
 * O culto inteiro desce para o aparelho. Durante a apresentacao nada depende de
 * rede: o Live Mode le do disco local. A nuvem so entra para dizer "tem
 * atualizacao" — quem decide baixar e o usuario.
 */
import type {
  ChurchEvent,
  EventSongSettings,
  LocalManifest,
  ManifestAsset,
  OfflineManifest,
  OfflineStatus,
  Song,
} from './types.ts';

/**
 * Revisao logica do culto. Muda quando muda o que a equipe precisa rebaixar:
 * setlist, ordem, tom, arranjo. Nao muda com edicao de observacao.
 */
export function computeRevision(settings: EventSongSettings[]): string {
  const parts = [...settings]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.songId}:${s.position}:${s.selectedKey ?? '-'}:${s.arrangementId ?? '-'}:${s.selectedTempo ?? '-'}`);
  return hash32(parts.join('|'));
}

/** Hash curto e estavel (FNV-1a). Sem dependencia, roda igual no app e no worker. */
function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function buildManifest(opts: {
  event: ChurchEvent;
  songs: Song[];
  settings: EventSongSettings[];
  builtAt?: string;
}): OfflineManifest {
  const assets: ManifestAsset[] = [];
  const bySong = new Map(opts.songs.map((s) => [s.id, s]));
  for (const setting of [...opts.settings].sort((a, b) => a.position - b.position)) {
    const song = bySong.get(setting.songId);
    if (!song) continue;
    for (const stem of song.stems) {
      assets.push({
        key: `${song.id}/${stem.id}`,
        url: stem.url,
        bytes: stem.bytes,
        sha256: stem.sha256,
      });
    }
  }
  return {
    eventId: opts.event.id,
    revision: computeRevision(opts.settings),
    assets,
    builtAt: opts.builtAt ?? new Date().toISOString(),
  };
}

export function manifestBytes(manifest: OfflineManifest): number {
  return manifest.assets.reduce((sum, a) => sum + a.bytes, 0);
}

/** O que falta baixar. Reaproveita o que ja esta no aparelho. */
export function missingAssets(manifest: OfflineManifest, local: LocalManifest | null): ManifestAsset[] {
  if (!local) return manifest.assets;
  const have = new Set(local.downloadedKeys);
  return manifest.assets.filter((a) => !have.has(a.key));
}

export function offlineStatus(opts: {
  manifest: OfflineManifest;
  local: LocalManifest | null;
  downloading?: boolean;
}): OfflineStatus {
  if (opts.downloading) return 'downloading';
  if (!opts.local) return 'cloud';
  if (opts.local.revision !== opts.manifest.revision) return 'stale';
  return missingAssets(opts.manifest, opts.local).length === 0 ? 'offline' : 'stale';
}

export const OFFLINE_STATUS_LABEL: Record<OfflineStatus, string> = {
  cloud: 'Nuvem',
  downloading: 'Baixando',
  offline: 'Offline',
  stale: 'Desatualizado',
};

export function downloadProgress(manifest: OfflineManifest, local: LocalManifest | null): number {
  const total = manifestBytes(manifest);
  if (total === 0) return 1;
  const missing = missingAssets(manifest, local).reduce((s, a) => s + a.bytes, 0);
  return Math.round(((total - missing) / total) * 100) / 100;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
