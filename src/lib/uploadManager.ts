/**
 * Global upload manager that persists uploads across component unmounts.
 * Prevents upload cancellation when navigating away from chat.
 */

type UploadStatus = 'pending' | 'uploading' | 'complete' | 'error';

type UploadEntry = {
  progress: number;
  status: UploadStatus;
  promise: Promise<any>;
  error?: string;
};

class UploadManager {
  private uploads = new Map<string, UploadEntry>();
  private static instance: UploadManager;

  static getInstance(): UploadManager {
    if (!UploadManager.instance) {
      UploadManager.instance = new UploadManager();
    }
    return UploadManager.instance;
  }

  /**
   * Enqueue an upload that will continue even if component unmounts
   */
  enqueue<T>(uploadId: string, file: File, uploadFn: (file: File, onProgress?: (progress: number) => void) => Promise<T>): Promise<T> {
    // Clean up any existing upload with same ID
    if (this.uploads.has(uploadId)) {
      delete this.uploads.delete(uploadId);
    }

    let resolve: (value: T) => void;
    let reject: (reason?: any) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const entry: UploadEntry = {
      progress: 0,
      status: 'pending',
      promise,
    };

    this.uploads.set(uploadId, entry);

    // Start the upload
    (async () => {
      try {
        entry.status = 'uploading';
        
        const result = await uploadFn(file, (progress) => {
          // Update progress even if component unmounted
          const currentEntry = this.uploads.get(uploadId);
          if (currentEntry) {
            currentEntry.progress = progress;
          }
        });

        // Mark as complete
        const finalEntry = this.uploads.get(uploadId);
        if (finalEntry) {
          finalEntry.progress = 100;
          finalEntry.status = 'complete';
        }

        resolve(result);
      } catch (error) {
        const finalEntry = this.uploads.get(uploadId);
        if (finalEntry) {
          finalEntry.status = 'error';
          finalEntry.error = error instanceof Error ? error.message : 'Upload failed';
        }
        reject(error);
      }
    })();

    return promise;
  }

  /**
   * Get current upload progress (0-100)
   */
  getProgress(uploadId: string): number {
    const entry = this.uploads.get(uploadId);
    return entry ? entry.progress : 0;
  }

  /**
   * Check if upload is complete
   */
  isComplete(uploadId: string): boolean {
    const entry = this.uploads.get(uploadId);
    return entry ? entry.status === 'complete' : false;
  }

  /**
   * Get upload status
   */
  getStatus(uploadId: string): UploadStatus {
    const entry = this.uploads.get(uploadId);
    return entry ? entry.status : 'pending';
  }

  /**
   * Get upload error if any
   */
  getError(uploadId: string): string | undefined {
    const entry = this.uploads.get(uploadId);
    return entry?.error;
  }

  /**
   * Clean up completed uploads (optional, for memory management)
   */
  cleanup(uploadId: string): void {
    const entry = this.uploads.get(uploadId);
    if (entry && (entry.status === 'complete' || entry.status === 'error')) {
      this.uploads.delete(uploadId);
    }
  }

  /**
   * Get all uploads (for progress polling)
   */
  getUploads(): Map<string, UploadEntry> {
    return this.uploads;
  }

  /**
   * Clear all uploads (for logout/cleanup)
   */
  clearAll(): void {
    this.uploads.clear();
  }
}

// Export singleton instance
export const uploadManager = UploadManager.getInstance();
