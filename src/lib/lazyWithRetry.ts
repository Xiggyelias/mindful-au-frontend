import { lazy, ComponentType } from 'react';

/**
 * A wrapper around React.lazy that catches "Failed to fetch dynamically imported module" errors.
 * These errors usually happen when a new version of the app is deployed and the old chunks are removed.
 * It attempts to reload the page once to fetch the latest assets.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      console.error('Lazy load failed, attempting reload:', error);
      
      // Check if we've already retried this session to avoid infinite reload loops
      const hasRetried = window.sessionStorage.getItem('lazy-retry-occurred');
      
      if (!hasRetried) {
        window.sessionStorage.setItem('lazy-retry-occurred', 'true');
        window.location.reload();
        // Return a promise that never resolves while the page is reloading
        return new Promise<{ default: T }>(() => {});
      }

      // If we already retried and it still fails, bubble up the error
      throw error;
    }
  });
}
