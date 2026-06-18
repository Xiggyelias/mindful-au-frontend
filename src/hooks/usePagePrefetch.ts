/**
 * usePagePrefetch.ts
 * 
 * Prefetches React.lazy route chunks on hover/focus for instant page transitions.
 * Uses Intersection Observer for viewport-based prefetching.
 */

import { useRef, useCallback } from 'react';

// Track which chunks have been prefetched to avoid duplicate requests
const prefetchedChunks = new Set<string>();

/**
 * Prefetch a lazy route's chunk by calling its import function.
 * This triggers the network request early so the chunk is in browser cache.
 */
export function prefetchRoute(importFn: () => Promise<{ default: unknown }>): void {
  const importString = importFn.toString();
  
  // Skip if already prefetched
  if (prefetchedChunks.has(importString)) return;
  
  prefetchedChunks.add(importString);
  
  // Fire and forget - don't await
  importFn().catch(() => {
    // Remove from cache on failure so retry is possible
    prefetchedChunks.delete(importString);
  });
}

/**
 * Hook that prefetches route chunks when links are hovered or become visible.
 * Attach to navigation items to enable instant page loads.
 */
export function useRoutePrefetch() {
  const prefetchedRefs = useRef<Set<string>>(new Set());

  const prefetchOnHover = useCallback((
    importFn: () => Promise<{ default: unknown }>,
    path: string
  ) => {
    const key = `${path}:${importFn.toString()}`;
    
    if (prefetchedRefs.current.has(key)) return;
    prefetchedRefs.current.add(key);
    
    // Use requestIdleCallback for non-blocking prefetch
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        prefetchRoute(importFn);
      }, { timeout: 1000 });
    } else {
      setTimeout(() => prefetchRoute(importFn), 100);
    }
  }, []);

  return { prefetchOnHover };
}

/**
 * Preload critical pages immediately on app mount.
 * Call this in App.tsx or main.tsx for the most visited pages.
 */
export function preloadCriticalPages() {
  // Preload dashboard and chat - most visited pages
  const criticalPaths = [
    '/student/dashboard',
    '/student/chat',
    '/counselor/dashboard',
    '/counselor/messages',
  ];
  
  // Use requestIdleCallback to not block initial render
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => {
      criticalPaths.forEach(path => {
        // Dispatch custom event that components can listen to
        window.dispatchEvent(new CustomEvent('prefetch:route', { detail: { path } }));
      });
    }, { timeout: 3000 });
  }
}
