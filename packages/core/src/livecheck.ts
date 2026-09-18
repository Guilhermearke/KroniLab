/**
 * Live Check (item 20) — a tela que evita o desastre.
 *
 * Roda antes de entrar no Live Mode e responde uma pergunta so:
 * da para subir no palco agora?
 */
import { manifestBytes, missingAssets } from './offline.ts';
import type {
  EventSongSettings,
  LocalManifest,
  OfflineManifest,
  Song,
} from './types.ts';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface LiveCheckResult {
  ready: boolean;
  items: CheckItem[];
}

export function runLiveCheck(opts: {
  songs: Song[];
  settings: EventSongSettings[];
  manifest: OfflineManifest;
  local: LocalManifest | null;
  storageFreeBytes: number;
  audioOutputConnected: boolean;
}): LiveCheckResult {
  const items: CheckItem[] = [];
  const bySong = new Map(opts.songs.map((s) => [s.id, s]));
  const ordered = [...opts.settings].sort((a, b) => a.position - b.position);

  // 1. VS processada
  const unprocessed = ordered.filter((s) => {
    const song = bySong.get(s.songId);
    return !song || !isVsReady(song);
  });
  items.push({
    id: 'vs',
    label: 'VS pronta',
    status: unprocessed.length === 0 ? 'ok' : 'fail',
    detail: unprocessed.length === 0
      ? `${ordered.length} musicas processadas`
      : `${unprocessed.length} musica(s) sem VS`,
  });

  // 2. Stems presentes
  const missingStems = ordered.filter((s) => {
    const song = bySong.get(s.songId);
    return !song || song.stems.filter((x) => x.id !== 'click' && x.id !== 'guide').length === 0;
  });
  items.push({
    id: 'stems',
    label: 'Stems presentes',
    status: missingStems.length === 0 ? 'ok' : 'fail',
    detail: missingStems.length === 0 ? 'Todas as faixas disponiveis' : `${missingStems.length} sem stems`,
  });

  // 3. Click e guia
  const noClick = ordered.filter((s) => !hasStem(bySong.get(s.songId), 'click'));
  const noGuide = ordered.filter((s) => !hasStem(bySong.get(s.songId), 'guide'));
  items.push({
    id: 'click',
    label: 'Click disponivel',
    status: noClick.length === 0 ? 'ok' : 'fail',
    detail: noClick.length === 0 ? 'Click em todas as musicas' : `${noClick.length} sem click`,
  });
  items.push({
    id: 'guide',
    label: 'Guia disponivel',
    // Guia e importante, mas da para tocar sem ela. Avisa, nao bloqueia.
    status: noGuide.length === 0 ? 'ok' : 'warn',
    detail: noGuide.length === 0 ? 'Guia em todas as musicas' : `${noGuide.length} sem guia`,
  });

  // 4. Tom definido pelo ministro
  const noKey = ordered.filter((s) => !s.selectedKey);
  items.push({
    id: 'key',
    label: 'Tom definido',
    status: noKey.length === 0 ? 'ok' : 'warn',
    detail: noKey.length === 0 ? 'Tom definido em todas' : `${noKey.length} usando o tom original`,
  });

  // 5. Setlist sincronizado
  const revisionMatches = opts.local?.revision === opts.manifest.revision;
  items.push({
    id: 'sync',
    label: 'Setlist sincronizado',
    status: revisionMatches ? 'ok' : 'fail',
    detail: revisionMatches ? 'Versao local igual a da nuvem' : 'Ha mudancas nao baixadas',
  });

  // 6. Download completo
  const missing = missingAssets(opts.manifest, opts.local);
  items.push({
    id: 'download',
    label: 'Musicas baixadas',
    status: missing.length === 0 ? 'ok' : 'fail',
    detail: missing.length === 0 ? 'Culto completo no aparelho' : `${missing.length} arquivo(s) faltando`,
  });

  // 7. Armazenamento
  const needed = missing.reduce((s, a) => s + a.bytes, 0);
  const headroom = manifestBytes(opts.manifest) * 0.2;
  items.push({
    id: 'storage',
    label: 'Armazenamento',
    status: opts.storageFreeBytes >= needed + headroom ? 'ok' : opts.storageFreeBytes >= needed ? 'warn' : 'fail',
    detail: `${Math.round(opts.storageFreeBytes / 1e6)} MB livres`,
  });

  // 8. Saida de audio
  items.push({
    id: 'output',
    label: 'Saida de audio',
    status: opts.audioOutputConnected ? 'ok' : 'warn',
    detail: opts.audioOutputConnected ? 'Interface conectada' : 'Nenhuma interface detectada',
  });

  return { ready: items.every((i) => i.status !== 'fail'), items };
}

export function isVsReady(song: Song): boolean {
  return (
    song.beatGrid !== null &&
    song.sections.length > 0 &&
    song.analysis !== null &&
    hasStem(song, 'click') &&
    song.stems.some((s) => s.id !== 'click' && s.id !== 'guide')
  );
}

function hasStem(song: Song | undefined, id: string): boolean {
  return !!song?.stems.some((s) => s.id === id);
}
