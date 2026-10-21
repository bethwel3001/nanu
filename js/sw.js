/* ==========================================================================
   NANU SERVICE WORKER (VANILLA JAVASCRIPT)
   --------------------------------------------------------------------------
   Core Offline Backbone for Progressive Web App Demonstrations:
   
   SECTION 1: CACHING & APP SHELL PRECACHING (Cache Storage API)
   SECTION 2: OFFLINE CAPABILITIES & NETWORK INTERCEPTION (Fetch Handling)
   SECTION 3: BACKGROUND SYNC & OUTBOX QUEUE REPLAY (Background Sync API & IndexedDB)
   ========================================================================== */

const CACHE_NAME = 'nanu-cache-v1';
const DB_NAME = 'nanu-db';
const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox';
const STORE_REPORTS = 'reports';

// Core assets required for complete offline operation
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/js/app.js',
  '/js/sw.js',
  '/images/favicon.svg',
  '/images/apple-touch-icon.png',
  '/images/pwa-192x192.png',
  '/images/pwa-512x512.png',
  '/images/maskable-icon-512x512.png'
];


/* ==========================================================================
   SECTION 1: CACHING & APP SHELL PRECACHING (Cache Storage API)
   --------------------------------------------------------------------------
   On 'install', we download and cache all critical app shell assets.
   On 'activate', we delete any outdated caches to keep storage clean.
   ========================================================================== */

// 1. INSTALL: Pre-cache the entire app shell for zero-latency offline boots
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install: Precaching static assets');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        // Activate worker immediately without waiting for tabs to close
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[ServiceWorker] Precache failed:', err);
      })
  );
});

// 2. ACTIVATE: Purge obsolete caches and claim existing clients
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate: Claiming clients and purging stale caches');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[ServiceWorker] Deleting obsolete cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Take immediate control of all open pages under our scope
        return self.clients.claim();
      })
  );
});


/* ==========================================================================
   SECTION 2: OFFLINE CAPABILITIES & NETWORK INTERCEPTION (Fetch Handling)
   --------------------------------------------------------------------------
   Intercepts all network requests:
   - Stale-While-Revalidate caching for static assets (HTML, CSS, JS, fonts).
   - Serves instantly from Cache Storage, updates in background when online.
   ========================================================================== */

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // API calls are handled with network-first and client outbox fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request.clone()).catch(() => {
        // When network fails for API, respond with fallback message
        return new Response(
          JSON.stringify({ offline: true, message: 'Operating offline. Handled by client outbox queue.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Stale-While-Revalidate strategy for app assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Fetch fresh version in background to update cache
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed; offline fallback
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });

      // Return cached version immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});


/* ==========================================================================
   SECTION 3: BACKGROUND SYNC & OUTBOX QUEUE REPLAY (Background Sync API & IndexedDB)
   --------------------------------------------------------------------------
   When offline reports are submitted, they are persisted to IndexedDB.
   As soon as internet connectivity recovers, the browser triggers the 'sync'
   event in the background, flushing queued reports to the server.
   ========================================================================== */

// Native IndexedDB Helper for the Service Worker
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Replays all pending reports from IndexedDB 'outbox' to /api/reports
async function replayOutboxQueue() {
  console.log('[ServiceWorker Sync] Replaying outbox queue to server...');

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const store = tx.objectStore(STORE_OUTBOX);

    const pendingReports = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (pendingReports.length === 0) {
      console.log('[ServiceWorker Sync] Outbox is already clear. 0 reports to sync.');
      return;
    }

    console.log(`[ServiceWorker Sync] Found ${pendingReports.length} pending report(s) to flush.`);
    let successCount = 0;

    for (const report of pendingReports) {
      try {
        const response = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report)
        });

        if (response.ok) {
          // Remove successfully uploaded report from outbox
          const deleteTx = db.transaction(STORE_OUTBOX, 'readwrite');
          deleteTx.objectStore(STORE_OUTBOX).delete(report.id);
          await new Promise((res) => { deleteTx.oncomplete = res; });
          
          successCount++;
          console.log(`[ServiceWorker Sync] Successfully synchronized report ${report.id}`);
        }
      } catch (err) {
        console.warn(`[ServiceWorker Sync] Replay failed for report ${report.id}, will retry on next sync:`, err);
        break; // Stop loop if network drops again
      }
    }

    // Broadcast sync status to all open tabs/windows
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) {
      client.postMessage({
        type: 'SYNC_COMPLETED',
        syncedCount: successCount,
        remainingCount: pendingReports.length - successCount
      });
    }

  } catch (err) {
    console.error('[ServiceWorker Sync] Queue replay transaction error:', err);
  }
}

// 1. Native Background Sync Event: Browser wakes service worker when online
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-nanu-reports') {
    console.log('[ServiceWorker] Background Sync triggered: sync-nanu-reports');
    event.waitUntil(replayOutboxQueue());
  }
});

// 2. Direct message listener for manual replay from client window
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REPLAY_QUEUE') {
    console.log('[ServiceWorker] Client requested manual outbox replay');
    event.waitUntil(replayOutboxQueue());
  }
});
