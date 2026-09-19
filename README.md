# NANU

Resilient offline field incident logger demonstrating modern PWA capabilities with zero framework overhead.

## Architecture

* **Storage & Caching**: Service worker cache storage with stale-while-revalidate strategy and Workbox core precaching.
* **Offline Queue**: Background sync queue (`BackgroundSyncPlugin`) persisting failed field submissions to IndexedDB and automatically replaying on network recovery.
* **Platform APIs**:
  * **App Badging API**: Native OS app badge counter reflecting pending outbox items.
  * **Web Share API**: Native OS sharing for verified reports.
  * **Geolocation API**: Device field coordinate capture.

## Setup

```bash
pnpm install
pnpm dev
```

Build production bundle:

```bash
pnpm build
pnpm preview
```

## Demo Flow

1. **Cold Load**: Load the app in Chrome. Assets precache for zero-latency offline boot. The browser prompts for native installation.
2. **Disconnect**: In DevTools Network, switch to "Offline". The cached app shell serves instantly.
3. **Field Write**: Submit an incident report while offline. Workbox enqueues the request in IndexedDB and updates the OS badge count.
4. **Recovery**: Switch back to "Online". SyncManager automatically flushes the queue to `/api/reports` and the badge clears to zero.
