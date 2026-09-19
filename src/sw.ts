/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { clientsClaim } from 'workbox-core';

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ request }) =>
    request.destination === 'document' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image',
  new StaleWhileRevalidate({ cacheName: 'nanu-app-shell' })
);

const syncPlugin = new BackgroundSyncPlugin('nanuReportQueue', {
  maxRetentionTime: 24 * 60,
  onSync: async ({ queue }) => {
    try {
      await queue.replayRequests();
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({ type: 'SYNC_COMPLETED', queueName: 'nanuReportQueue' });
      }
    } catch (err) {
      console.error('Background sync replay failed:', err);
      throw err;
    }
  }
});

registerRoute(
  /\/api\/reports/,
  new NetworkOnly({ plugins: [syncPlugin] }),
  'POST'
);

self.addEventListener('message', async (event) => {
  if (event.data?.type === 'REPLAY_QUEUE') {
    try {
      const queue = (syncPlugin as any)._queue;
      if (queue) await queue.replayRequests();
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({ type: 'SYNC_COMPLETED', queueName: 'nanuReportQueue' });
      }
    } catch (err) {
      console.warn('Manual replay error:', err);
    }
  }
});
