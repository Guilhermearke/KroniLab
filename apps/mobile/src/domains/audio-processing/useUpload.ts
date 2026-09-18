/**
 * Upload e acompanhamento do processamento de IA (itens 6 e 30).
 *
 * A musica nasce aqui e ja nasce ligada a igreja. Nao existe "separador de
 * stems" solto: o job pertence a uma Song que vai para um culto.
 */
import { useCallback, useState } from 'react';
import { STATE_LABEL, overallProgress } from '@kronilab/core';
import type { ProcessingState } from '@kronilab/core';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL ?? '';

export function useUpload() {
  const [state, setState] = useState<ProcessingState | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (
    file: { uri: string; name: string; mimeType: string },
    songId: string,
    churchId: string,
  ) => {
    setError(null);
    setState('queued');
    try {
      const form = new FormData();
      form.append('song_id', songId);
      form.append('church_id', churchId);
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);

      const res = await fetch(`${WORKER_URL}/jobs`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Falha no envio (HTTP ${res.status})`);
      const job = await res.json();

      // Polling ate a musica ficar pronta. O app pode ser fechado no meio: o
      // job continua no servidor e e reencontrado pelo song_id.
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await (await fetch(`${WORKER_URL}/jobs/${job.job_id}`)).json();
        setState(status.state);
        setProgress(overallProgress(status.state, status.progress));
        done = status.state === 'completed' || status.state === 'failed';
        if (status.state === 'failed') setError(status.error ?? 'Processamento falhou');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('failed');
    }
  }, []);

  return { state, progress, error, stateLabel: state ? STATE_LABEL[state] : '', upload };
}
