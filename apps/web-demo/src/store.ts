/**
 * Musicas importadas ficam no IndexedDB do navegador: o arquivo e os dados
 * que o usuario ajustou (BPM, primeiro beat, secoes). Recarregar a pagina
 * nao pode apagar o culto de domingo.
 *
 * E o mesmo papel do banco local do app (SQLite): fonte de verdade offline,
 * sincronizada com o Supabase quando existe conexao.
 */
import type { SectionType } from '@kronilab/core';

export interface StoredSection {
  type: SectionType;
  label: string;
  bars: number;
}

export interface StoredSong {
  id: string;
  title: string;
  artist: string;
  key: string;
  bpm: number;
  firstDownbeatAt: number;
  beatsPerBar: number;
  sections: StoredSection[];
  fileName: string;
  blob: Blob;
  createdAt: number;
}

const DB = 'kronilab-demo';
const STORE = 'songs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const req = run(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const songStore = {
  async list(): Promise<StoredSong[]> {
    try {
      const all = await tx<StoredSong[]>('readonly', (s) => s.getAll());
      return all.sort((a, b) => a.createdAt - b.createdAt);
    } catch {
      return []; // modo privado / sem IndexedDB: a demo segue sem persistir
    }
  },
  async put(song: StoredSong): Promise<void> {
    try { await tx('readwrite', (s) => s.put(song)); } catch { /* idem */ }
  },
  async remove(id: string): Promise<void> {
    try { await tx('readwrite', (s) => s.delete(id)); } catch { /* idem */ }
  },
};
