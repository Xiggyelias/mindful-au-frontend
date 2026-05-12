/**
 * useDecryptWorker
 *
 * Manages a singleton Web Worker instance for off-thread AES-GCM decryption.
 * The worker is created once per component tree mount and terminated on unmount.
 *
 * Usage:
 *   const { decryptBatch } = useDecryptWorker();
 *   const results = await decryptBatch(sessionKeyBase64, messages);
 */

import { useEffect, useRef, useCallback } from 'react';
import type { RawWorkerMessage, DecryptResult } from '@/workers/decryptWorker';

type DecryptBatchFn = (
  sessionKeyBase64: string,
  messages: RawWorkerMessage[]
) => Promise<DecryptResult[]>;

type PendingRequest = {
  resolve: (results: DecryptResult[]) => void;
  reject: (err: Error) => void;
};

export function useDecryptWorker(): { decryptBatch: DecryptBatchFn } {
  const workerRef = useRef<Worker | null>(null);
  /** One pending promise per request (we serialize them for simplicity) */
  const pendingRef = useRef<PendingRequest | null>(null);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;

    try {
      const worker = new Worker(
        new URL('../workers/decryptWorker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (event: MessageEvent) => {
        const { type, results, error } = event.data ?? {};
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;

        if (type === 'result') {
          pending.resolve(results as DecryptResult[]);
        } else {
          pending.reject(new Error(error ?? 'Worker decrypt error'));
        }
      };

      worker.onerror = (err) => {
        const pending = pendingRef.current;
        if (pending) {
          pendingRef.current = null;
          pending.reject(new Error(err.message ?? 'Worker error'));
        }
      };

      workerRef.current = worker;
    } catch {
      // Workers may be unavailable in certain sandboxed environments — graceful fallback
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const decryptBatch = useCallback<DecryptBatchFn>(
    (sessionKeyBase64, messages) =>
      new Promise<DecryptResult[]>((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker || messages.length === 0) {
          resolve([]);
          return;
        }
        // If a prior request is still in-flight, reject it (shouldn't happen in practice)
        if (pendingRef.current) {
          pendingRef.current.reject(new Error('Superseded by newer request'));
        }
        pendingRef.current = { resolve, reject };
        worker.postMessage({
          type: 'decrypt',
          sessionKeyBase64,
          messages,
        });
      }),
    []
  );

  return { decryptBatch };
}
