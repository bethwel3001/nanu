// Storage and database constants
const DB_NAME = 'nanu-db';
const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox';
const STORE_REPORTS = 'reports';
const STORAGE_KEY = 'nanu_reports_cache';

// In-memory reports state loaded from local cache
let reports = loadStoredReports();

// Register service worker with root scope
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/js/sw.js', { scope: '/' });
      console.log('[NANU] Service Worker registered successfully with scope:', registration.scope);

      // Notify when a new service worker update is ready
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[NANU] New service worker version available.');
          }
        });
      });
    } catch (error) {
      console.error('[NANU] Service Worker registration failed:', error);
    }
  });

  // Handle broadcast messages from service worker
  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'SYNC_COMPLETED') {
      console.log('[NANU] Received SYNC_COMPLETED from Service Worker:', event.data);
      await handleSyncRecovery();
    }
  });
}

// Capture native PWA install prompt
window.addEventListener('beforeinstallprompt', (event) => {
  console.log('[NANU] Browser install prompt is ready for user interaction:', event);
});

// Network indicators and submission elements
const metricNetwork = document.getElementById('metric-network');
const metricOutbox = document.getElementById('metric-outbox');
const metricCount = document.getElementById('metric-count');
const submitBtn = document.getElementById('submit-btn');

// Update network metric card and submit button state
function setOnlineStatus(online) {
  if (online) {
    if (metricNetwork) {
      metricNetwork.textContent = 'Online';
      metricNetwork.className = 'metric-value brand-font text-blue';
    }
    if (submitBtn) {
      submitBtn.textContent = 'Submit incident report';
    }
  } else {
    if (metricNetwork) {
      metricNetwork.textContent = 'Offline';
      metricNetwork.className = 'metric-value brand-font text-red';
    }
    if (submitBtn) {
      submitBtn.textContent = 'Queue incident (offline)';
    }
  }
}

// Handle network reconnection and trigger sync recovery
window.addEventListener('online', async () => {
  console.log('[NANU] Network recovered: Device is now ONLINE');
  setOnlineStatus(true);
  
  // Prompt service worker to replay queued requests immediately
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'REPLAY_QUEUE' });
  }
  
  await handleSyncRecovery();
});

// Handle network disconnect
window.addEventListener('offline', () => {
  console.log('[NANU] Network dropped: Device is now OFFLINE');
  setOnlineStatus(false);
});

// Initialize current network status
setOnlineStatus(navigator.onLine);

// Open IndexedDB database for local report storage
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB not supported'));
    }
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

// Persist queued incident report to IndexedDB outbox
async function saveToOutbox(report) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).put(report);
    await new Promise((res) => { tx.oncomplete = res; });
    console.log('[NANU Outbox] Saved report to IndexedDB outbox:', report.id);
  } catch (err) {
    console.error('[NANU Outbox] Failed to save to IndexedDB:', err);
  }
}

// Count pending incident reports in outbox
async function getOutboxCount() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const store = tx.objectStore(STORE_OUTBOX);
    return new Promise((resolve) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

// Register one-shot background sync task with browser
async function requestBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-nanu-reports');
      console.log('[NANU Sync] Background sync registered: sync-nanu-reports');
    } catch (err) {
      console.warn('[NANU Sync] Background sync registration failed:', err);
    }
  }
}

// Refresh local state and indicators after sync recovery
async function handleSyncRecovery() {
  const pending = await getOutboxCount();
  
  if (pending === 0) {
    reports = reports.map((r) => (r.status === 'queued' ? { ...r, status: 'synced' } : r));
    persistReports(reports);
    renderReports();
  }

  await updateOutboxIndicators(pending);
  await fetchServerReports();
}

// Fetch latest incident reports from server
async function fetchServerReports() {
  if (!navigator.onLine) return;
  try {
    const res = await fetch('/api/reports');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.reports) && data.reports.length > 0) {
        const map = new Map();
        data.reports.forEach((r) => map.set(r.id, { ...r, status: 'synced' }));
        reports.forEach((r) => {
          if (!map.has(r.id)) map.set(r.id, r);
        });
        reports = Array.from(map.values()).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        persistReports(reports);
        renderReports();
      }
    }
  } catch (err) {
    console.log('[NANU API] Could not fetch server reports:', err);
  }
}

// Update outbox metric card and native OS app badge
async function updateOutboxIndicators(pendingCount) {
  if (metricOutbox) {
    metricOutbox.textContent = pendingCount > 0 ? `${pendingCount} Queued` : 'Synced';
  }

  // Set or clear native app badge on supported platforms
  if ('setAppBadge' in navigator) {
    try {
      if (pendingCount > 0) {
        await navigator.setAppBadge(pendingCount);
        console.log('[AppBadge] OS badge set to:', pendingCount);
      } else {
        await navigator.clearAppBadge();
        console.log('[AppBadge] OS badge cleared');
      }
    } catch (err) {
      console.log('[AppBadge] Badge API call omitted:', err);
    }
  }
}

// Share incident report via Web Share API or clipboard fallback
async function shareIncidentReport(report) {
  const shareText = `[${report.severity.toUpperCase()}] Incident logged by ${report.reporter} at coordinates ${report.coordinates}:\n"${report.notes}"`;
  
  if (navigator.share && navigator.canShare && navigator.canShare({ title: 'NANU Field Incident', text: shareText })) {
    try {
      await navigator.share({
        title: 'NANU Field Incident',
        text: shareText,
        url: window.location.href
      });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }

  // Clipboard copy fallback when Web Share API is unavailable
  try {
    await navigator.clipboard.writeText(shareText);
    alert('Incident report copied to clipboard!');
    return true;
  } catch {
    return false;
  }
}

// Geolocation auto-detection button handler
const detectGpsBtn = document.getElementById('detect-gps-btn');
const coordsInput = document.getElementById('field-coords');

detectGpsBtn?.addEventListener('click', () => {
  if (!navigator.geolocation) {
    coordsInput.value = '-0.3031, 36.0800';
    return;
  }
  detectGpsBtn.textContent = 'Locating...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coordsInput.value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      detectGpsBtn.textContent = 'Detect GPS';
    },
    () => {
      coordsInput.value = '-0.3031, 36.0800';
      detectGpsBtn.textContent = 'Detect GPS';
    },
    { timeout: 5000 }
  );
});

// Custom severity dropdown elements
const severityDropdown = document.getElementById('severity-dropdown');
const severityTrigger = document.getElementById('severity-trigger');
const severityRating = document.getElementById('severity-rating');
const triggerDot = document.getElementById('trigger-dot');
const triggerName = document.getElementById('trigger-name');
const triggerSub = document.getElementById('trigger-sub');
const dropdownItems = document.querySelectorAll('.dropdown-item');

// Update severity selection and trigger display
function setSeverity(val, name, sub) {
  if (severityRating) severityRating.value = val;

  if (triggerDot) {
    triggerDot.className = `severity-dot dot-${val}`;
  }
  if (triggerName && name) {
    triggerName.textContent = name;
  }
  if (triggerSub && sub) {
    triggerSub.textContent = sub;
  }

  dropdownItems.forEach((item) => {
    const isMatch = item.getAttribute('data-value') === val;
    item.classList.toggle('selected', isMatch);
    item.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    if (isMatch) {
      if (triggerName && !name) triggerName.textContent = item.getAttribute('data-name') || '';
      if (triggerSub && !sub) triggerSub.textContent = item.getAttribute('data-sub') || '';
    }
  });

  closeDropdown();
}

// Toggle dropdown popover visibility
function toggleDropdown() {
  const isOpen = severityDropdown?.classList.contains('open');
  if (isOpen) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

// Open dropdown popover and focus selected item
function openDropdown() {
  severityDropdown?.classList.add('open');
  severityTrigger?.setAttribute('aria-expanded', 'true');
  const selected = severityDropdown?.querySelector('.dropdown-item.selected');
  selected?.focus();
}

// Close dropdown popover
function closeDropdown() {
  severityDropdown?.classList.remove('open');
  severityTrigger?.setAttribute('aria-expanded', 'false');
}

// Toggle dropdown on trigger click
severityTrigger?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown();
});

// Handle dropdown item click and keyboard navigation
dropdownItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const val = item.getAttribute('data-value');
    const name = item.getAttribute('data-name') || '';
    const sub = item.getAttribute('data-sub') || '';
    if (val) setSeverity(val, name, sub);
    severityTrigger?.focus();
  });

  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const val = item.getAttribute('data-value');
      const name = item.getAttribute('data-name') || '';
      const sub = item.getAttribute('data-sub') || '';
      if (val) setSeverity(val, name, sub);
      severityTrigger?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = item.nextElementSibling;
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = item.previousElementSibling;
      prev?.focus();
    } else if (e.key === 'Escape') {
      closeDropdown();
      severityTrigger?.focus();
    }
  });
});

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!severityDropdown?.contains(e.target)) {
    closeDropdown();
  }
});

// Keyboard controls for dropdown trigger
severityTrigger?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDropdown();
  } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openDropdown();
  }
});

// Incident form submission elements
const incidentForm = document.getElementById('incident-form');
const reporterInput = document.getElementById('reporter-name');
const notesInput = document.getElementById('observation-notes');
const reportsList = document.getElementById('reports-list');
const reportsCount = document.getElementById('reports-count');

// Handle form submission: sync immediately or queue in outbox
incidentForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const reporter = reporterInput.value.trim();
  const coordinates = coordsInput.value.trim();
  const severity = severityRating?.value || 'medium';
  const notes = notesInput.value.trim();

  if (!reporter || !coordinates || !notes) return;

  const report = {
    id: `rep-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    reporter,
    coordinates,
    severity,
    notes,
    timestamp: new Date().toISOString(),
    status: navigator.onLine ? 'synced' : 'queued'
  };

  submitBtn.disabled = true;

  if (navigator.onLine) {
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      });
      if (res.ok) {
        report.status = 'synced';
      } else {
        report.status = 'queued';
        await saveToOutbox(report);
        await requestBackgroundSync();
      }
    } catch {
      report.status = 'queued';
      await saveToOutbox(report);
      await requestBackgroundSync();
    }
  } else {
    report.status = 'queued';
    await saveToOutbox(report);
    await requestBackgroundSync();
  }

  // Prepend report to feed and persist locally
  reports.unshift(report);
  persistReports(reports);
  renderReports();

  // Reset form inputs and severity selector
  incidentForm.reset();
  setSeverity('medium', 'Medium', '(action recommended)');
  coordsInput.value = '';

  // Refresh outbox indicators and OS badge
  const pending = await getOutboxCount();
  const effective = Math.max(pending, reports.filter((r) => r.status === 'queued').length);
  await updateOutboxIndicators(effective);

  submitBtn.disabled = false;
  submitBtn.textContent = navigator.onLine ? 'Submit incident report' : 'Queue incident (offline)';
});

// Render incident reports feed
function renderReports() {
  if (reportsCount) reportsCount.textContent = String(reports.length);
  if (metricCount) metricCount.textContent = String(reports.length);

  if (reports.length === 0) {
    reportsList.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No reports logged yet</p>
        <p class="empty-sub">Fill out the incident form to record your first field report.</p>
      </div>
    `;
    return;
  }

  reportsList.innerHTML = reports.map((r) => `
    <article class="report-item-card" id="rep-${r.id}">
      <div class="report-header-row">
        <span class="report-reporter-name">${escapeHtml(r.reporter)}</span>
        <div class="badge-cluster">
          <span class="chip chip-severity-${r.severity}">${r.severity}</span>
          <span class="chip chip-${r.status}">${r.status}</span>
        </div>
      </div>
      <p class="report-body-text">${escapeHtml(r.notes)}</p>
      <div class="report-meta-footer">
        <span>${escapeHtml(r.coordinates)}</span>
        <span>${new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <button type="button" class="share-btn" data-id="${r.id}">Share</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll('.share-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const item = reports.find((r) => r.id === id);
      if (item) await shareIncidentReport(item);
    });
  });
}

// Escape untrusted strings for safe DOM insertion
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Load cached reports from localStorage
function loadStoredReports() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Persist reports to localStorage
function persistReports(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

// Initialize application state, indicators, and reports
async function init() {
  renderReports();
  const pending = await getOutboxCount();
  const effective = Math.max(pending, reports.filter((r) => r.status === 'queued').length);
  await updateOutboxIndicators(effective);
  await fetchServerReports();
}

init();
