/**
 * Repertorio do culto: ordem e transicao entre as musicas.
 *
 * A ordem vive em `position`. Reordenar nunca deixa buraco nem posicao
 * repetida: toda operacao renumera, porque duas musicas com position 3 viram
 * uma ordem diferente em cada aparelho da equipe.
 */
import type { EventSongSettings } from './types.ts';

/** Move um item de uma posicao para outra, preservando o resto da ordem. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(target, 0, moved!);
  return copy;
}

/** Renumera `position` de 0 a n-1 na ordem atual do array. */
export function renumber(settings: EventSongSettings[]): EventSongSettings[] {
  return settings.map((s, i) => (s.position === i ? s : { ...s, position: i }));
}

export function sortByPosition(settings: EventSongSettings[]): EventSongSettings[] {
  return [...settings].sort((a, b) => a.position - b.position);
}

/** Move uma musica para um indice e devolve a lista ja renumerada. */
export function reorderSetlist(
  settings: EventSongSettings[],
  songId: string,
  toIndex: number,
): EventSongSettings[] {
  const ordered = sortByPosition(settings);
  const from = ordered.findIndex((s) => s.songId === songId);
  if (from < 0) return ordered;
  return renumber(moveItem(ordered, from, toIndex));
}

export function moveSong(
  settings: EventSongSettings[],
  songId: string,
  direction: -1 | 1,
): EventSongSettings[] {
  const ordered = sortByPosition(settings);
  const from = ordered.findIndex((s) => s.songId === songId);
  if (from < 0) return ordered;
  return renumber(moveItem(ordered, from, from + direction));
}

export function addSong(
  settings: EventSongSettings[],
  entry: Omit<EventSongSettings, 'position'>,
): EventSongSettings[] {
  const ordered = sortByPosition(settings);
  // Musica repetida no mesmo culto quase sempre e engano de quem monta.
  if (ordered.some((s) => s.songId === entry.songId)) return ordered;
  return renumber([...ordered, { ...entry, position: ordered.length }]);
}

export function removeSong(settings: EventSongSettings[], songId: string): EventSongSettings[] {
  return renumber(sortByPosition(settings).filter((s) => s.songId !== songId));
}
