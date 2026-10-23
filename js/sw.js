// Service Worker: offline caching, fetch interception, and background sync

const CACHE_NAME = 'nanu-cache-v1';
const DB_NAME = 'nanu-db';
const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox';
const STORE_REPORTS = 'reports';

// Static assets cached for offline operation
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

// Precache static application shell on install
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install: Precaching static assets');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[ServiceWorker] Precache failed:', err);
      })
  );
});

// Clean up old caches and claim control of clients
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
        return self.clients.claim();
      })
  );
});

// Intercept requests: network-first for API, stale-while-revalidate for assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Fallback response for offline API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request.clone()).catch(() => {
        return new Response(
          JSON.stringify({ offline: true, message: 'Operating offline. Handled by client outbox queue.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Stale-while-revalidate caching for static assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
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
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// Open IndexedDB database for offline queue storage
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

// Flush queued reports from IndexedDB outbox to the server
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
          const deleteTx = db.transaction(STORE_OUTBOX, 'readwrite');
          deleteTx.objectStore(STORE_OUTBOX).delete(report.id);
          await new Promise((res) => { deleteTx.oncomplete = res; });
          
          successCount++;
          console.log(`[ServiceWorker Sync] Successfully synchronized report ${report.id}`);
        }
      } catch (err) {
        console.warn(`[ServiceWorker Sync] Replay failed for report ${report.id}, will retry on next sync:`, err);
        break;
      }
    }

    // Broadcast sync status to active client windows
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

// Background Sync event triggered by browser upon network recovery
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-nanu-reports') {
    console.log('[ServiceWorker] Background Sync triggered: sync-nanu-reports');
    event.waitUntil(replayOutboxQueue());
  }
});

// Manual queue replay trigger from client window
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REPLAY_QUEUE') {
    console.log('[ServiceWorker] Client requested manual outbox replay');
    event.waitUntil(replayOutboxQueue());
  }
});
