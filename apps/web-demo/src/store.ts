/**
 * Músicas importadas ficam no IndexedDB do navegador: o arquivo, os stems
 * e os dados que o usuário ajustou (BPM, beats, seções).
 *
 * Versões do schema:
 *   v1: campo `blob` + metadados básicos
 *   v2: adiciona `stems` (Record<string, Blob>) e `beats` (number[])
 *
 * Recarregar a página não pode apagar o culto de domingo.
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
  /** v2: timestamps dos beats rastreados (grade variável). */
  beats?: number[];
  /** v2: blobs dos stems separados, indexados por StemKey. */
  stems?: Record<string, Blob>;
}

const DB = 'kronilab-demo';
const STORE = 'songs';
const DB_VERSION = 2;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = ev.oldVersion;
      // v1: cria o object store
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      // v2: campos `beats` e `stems` são opcionais em JS — nenhuma migração
      // estrutural necessária no IDB; os registros antigos simplesmente não os têm.
      void oldVersion; // documentado mas sem ação extra necessária
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
