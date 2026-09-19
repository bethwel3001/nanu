import type { IncidentReport } from './types';

export const QUEUE_NAME = 'nanuReportQueue';

export async function getPendingQueueCount(): Promise<number> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(0);

    const req = indexedDB.open('workbox-background-sync');
    req.onerror = () => resolve(0);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('requests')) {
        db.close();
        return resolve(0);
      }
      try {
        const tx = db.transaction('requests', 'readonly');
        const store = tx.objectStore('requests');
        const countReq = store.indexNames.contains('queueName')
          ? store.index('queueName').count(IDBKeyRange.only(QUEUE_NAME))
          : store.count();

        countReq.onsuccess = () => {
          db.close();
          resolve(countReq.result);
        };
        countReq.onerror = () => {
          db.close();
          resolve(0);
        };
      } catch {
        db.close();
        resolve(0);
      }
    };
  });
}

export async function updateOutboxIndicator(pendingCount: number): Promise<void> {
  const el = document.getElementById('sync-status');
  const metricOutbox = document.getElementById('metric-outbox');
  if (el) {
    if (pendingCount > 0) {
      el.textContent = `${pendingCount} Queued`;
      el.classList.add('pending');
    } else {
      el.textContent = 'Synced';
      el.classList.remove('pending');
    }
  }

  if (metricOutbox) {
    metricOutbox.textContent = pendingCount > 0 ? `${pendingCount} Queued` : 'Synced';
  }

  if ('setAppBadge' in navigator) {
    try {
      if (pendingCount > 0) {
        await (navigator as any).setAppBadge(pendingCount);
      } else {
        await (navigator as any).clearAppBadge();
      }
    } catch {
      // Ignored if browser permission denies badge
    }
  }
}

export async function shareIncidentReport(report: IncidentReport): Promise<boolean> {
  const text = `[${report.severity.toUpperCase()}] ${report.reporter} (${report.coordinates}): ${report.notes}`;

  if (navigator.share && navigator.canShare && navigator.canShare({ title: 'NANU Incident', text })) {
    try {
      await navigator.share({ title: 'NANU Incident', text, url: window.location.href });
      return true;
    } catch (e: any) {
      if (e.name === 'AbortError') return false;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
