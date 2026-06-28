import { useCallback, useEffect, useRef } from 'react';
import { getDecryptWorker } from '@/workers/decryptWorker';
import { getCachedPlaintext, setCachedPlaintext } from '@/lib/chatMemoryCache';

type Pending = { resolve: (plaintext: string) => void; reject: (reason: string) => void };
type WorkerResponse = { id: number; ok: boolean; plaintext?: string; reason?: string };

export function useDecryptWorker() {
  const pendingRef = useRef<Map<number, Pending>>(new Map());
  const seqRef = useRef(0);

  useEffect(() => {
    const worker = getDecryptWorker();
    if (!worker) return;

    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, ok, plaintext, reason } = e.data;
      const pending = pendingRef.current.get(id);
      if (!pending) return;
      pendingRef.current.delete(id);
      if (ok && plaintext !== undefined) {
        pending.resolve(plaintext);
      } else {
        pending.reject(reason ?? 'decrypt_failed');
      }
    };

    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, []);

  const decryptAsync = useCallback(
    (messageId: number, cipherTrimmed: string, keyRawB64: string): Promise<string> => {
      const cached = getCachedPlaintext(messageId);
      if (cached !== undefined) return Promise.resolve(cached);

      const worker = getDecryptWorker();
      if (!worker) return Promise.reject('worker_unavailable');

      return new Promise<string>((resolve, reject) => {
        const id = ++seqRef.current;
        pendingRef.current.set(id, {
          resolve: (plaintext) => {
            setCachedPlaintext(messageId, plaintext);
            resolve(plaintext);
          },
          reject,
        });
        worker.postMessage({ type: 'decrypt', id, cipherTrimmed, keyRawB64 });
      });
    },
    []
  );

  return { decryptAsync };
}
