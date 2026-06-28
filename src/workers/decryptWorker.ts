let instance: Worker | null = null;

export function getDecryptWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!instance) {
    try {
      instance = new Worker(
        new URL('./chatDecrypt.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch {
      instance = null;
    }
  }
  return instance;
}

export function terminateDecryptWorker(): void {
  instance?.terminate();
  instance = null;
}
