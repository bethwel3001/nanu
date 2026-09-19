import { registerSW } from 'virtual:pwa-register';
import { updateOutboxIndicator, getPendingQueueCount, shareIncidentReport } from './outbox';
import type { IncidentReport, SeverityLevel } from './types';

const STORAGE_KEY = 'nanu_reports';

function getStoredReports(): IncidentReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistReports(items: IncidentReport[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

let reports: IncidentReport[] = getStoredReports();

// DOM elements
const connStatus = document.getElementById('connection-status') as HTMLSpanElement;
const metricNetwork = document.getElementById('metric-network') as HTMLParagraphElement;
const metricCount = document.getElementById('metric-count') as HTMLParagraphElement;
const incidentForm = document.getElementById('incident-form') as HTMLFormElement;
const reporterInput = document.getElementById('reporter-name') as HTMLInputElement;
const coordsInput = document.getElementById('field-coords') as HTMLInputElement;
const notesInput = document.getElementById('observation-notes') as HTMLTextAreaElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const reportsList = document.getElementById('reports-list') as HTMLDivElement;
const reportsCount = document.getElementById('reports-count') as HTMLSpanElement;
const detectGpsBtn = document.getElementById('detect-gps-btn') as HTMLButtonElement;

// Custom Severity Dropdown Elements
const severityDropdown = document.getElementById('severity-dropdown') as HTMLDivElement;
const severityTrigger = document.getElementById('severity-trigger') as HTMLButtonElement;
const severityRating = document.getElementById('severity-rating') as HTMLInputElement;
const triggerDot = document.getElementById('trigger-dot') as HTMLSpanElement;
const triggerName = document.getElementById('trigger-name') as HTMLSpanElement;
const triggerSub = document.getElementById('trigger-sub') as HTMLSpanElement;
const dropdownItems = document.querySelectorAll<HTMLDivElement>('.dropdown-item');

function setSeverity(val: SeverityLevel, name?: string, sub?: string) {
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

function toggleDropdown() {
  const isOpen = severityDropdown?.classList.contains('open');
  if (isOpen) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

function openDropdown() {
  severityDropdown?.classList.add('open');
  severityTrigger?.setAttribute('aria-expanded', 'true');
  const selected = severityDropdown?.querySelector<HTMLDivElement>('.dropdown-item.selected');
  selected?.focus();
}

function closeDropdown() {
  severityDropdown?.classList.remove('open');
  severityTrigger?.setAttribute('aria-expanded', 'false');
}

severityTrigger?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown();
});

dropdownItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const val = item.getAttribute('data-value') as SeverityLevel;
    const name = item.getAttribute('data-name') || '';
    const sub = item.getAttribute('data-sub') || '';
    if (val) setSeverity(val, name, sub);
    severityTrigger?.focus();
  });

  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const val = item.getAttribute('data-value') as SeverityLevel;
      const name = item.getAttribute('data-name') || '';
      const sub = item.getAttribute('data-sub') || '';
      if (val) setSeverity(val, name, sub);
      severityTrigger?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = item.nextElementSibling as HTMLElement;
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = item.previousElementSibling as HTMLElement;
      prev?.focus();
    } else if (e.key === 'Escape') {
      closeDropdown();
      severityTrigger?.focus();
    }
  });
});

document.addEventListener('click', (e) => {
  if (!severityDropdown?.contains(e.target as Node)) {
    closeDropdown();
  }
});

severityTrigger?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDropdown();
  } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openDropdown();
  }
});

// Service worker registration
registerSW({ immediate: true });

// Native browser install prompt: do not preventDefault
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('[NANU] Browser install prompt ready:', e);
});

// Network status
function setOnlineStatus(online: boolean) {
  if (online) {
    if (connStatus) {
      connStatus.textContent = 'Online';
      connStatus.className = 'status-badge online';
    }
    if (metricNetwork) {
      metricNetwork.textContent = 'Online';
      metricNetwork.className = 'metric-value brand-font text-blue';
    }
    if (submitBtn) submitBtn.textContent = 'Submit incident report';
  } else {
    if (connStatus) {
      connStatus.textContent = 'Offline';
      connStatus.className = 'status-badge offline';
    }
    if (metricNetwork) {
      metricNetwork.textContent = 'Offline';
      metricNetwork.className = 'metric-value brand-font text-red';
    }
    if (submitBtn) submitBtn.textContent = 'Queue incident (offline)';
  }
}

window.addEventListener('online', async () => {
  setOnlineStatus(true);
  await handleSyncRecovery();
});

window.addEventListener('offline', () => {
  setOnlineStatus(false);
});

setOnlineStatus(navigator.onLine);

// Background sync message listener
navigator.serviceWorker?.addEventListener('message', async (e) => {
  if (e.data?.type === 'SYNC_COMPLETED') {
    await handleSyncRecovery();
  }
});

async function handleSyncRecovery() {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'REPLAY_QUEUE' });
  }

  const pending = await getPendingQueueCount();
  if (pending === 0) {
    reports = reports.map(r => r.status === 'queued' ? { ...r, status: 'synced' } : r);
    persistReports(reports);
    renderReports();
  }
  await updateOutboxIndicator(pending);
  await fetchServerReports();
}

async function fetchServerReports() {
  if (!navigator.onLine) return;
  try {
    const res = await fetch('/api/reports');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.reports) && data.reports.length > 0) {
        const map = new Map<string, IncidentReport>();
        data.reports.forEach((r: IncidentReport) => map.set(r.id, { ...r, status: 'synced' }));
        reports.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
        reports = Array.from(map.values()).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        persistReports(reports);
        renderReports();
      }
    }
  } catch {}
}

// GPS detection
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

// Form submission
incidentForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const reporter = reporterInput.value.trim();
  const coordinates = coordsInput.value.trim();
  const severity = (severityRating?.value || 'medium') as SeverityLevel;
  const notes = notesInput.value.trim();

  if (!reporter || !coordinates || !notes) return;

  const report: IncidentReport = {
    id: `rep-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    reporter,
    coordinates,
    severity,
    notes,
    timestamp: new Date().toISOString(),
    status: navigator.onLine ? 'synced' : 'queued'
  };

  submitBtn.disabled = true;

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
    }
  } catch {
    // Intercepted by BackgroundSyncPlugin in service worker
    report.status = 'queued';
  }

  reports.unshift(report);
  persistReports(reports);
  renderReports();

  incidentForm.reset();
  setSeverity('medium', 'Medium', '(action recommended)');
  coordsInput.value = '';

  const pending = await getPendingQueueCount();
  const effective = Math.max(pending, reports.filter(r => r.status === 'queued').length);
  await updateOutboxIndicator(effective);

  submitBtn.disabled = false;
  submitBtn.textContent = navigator.onLine ? 'Submit incident report' : 'Queue incident (offline)';
});

// Rendering
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
        <span class="report-reporter-name">${escape(r.reporter)}</span>
        <div class="badge-cluster">
          <span class="chip chip-severity-${r.severity}">${r.severity}</span>
          <span class="chip chip-${r.status}">${r.status}</span>
        </div>
      </div>
      <p class="report-body-text">${escape(r.notes)}</p>
      <div class="report-meta-footer">
        <span>${escape(r.coordinates)}</span>
        <span>${new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <button class="share-btn" data-id="${r.id}">Share</button>
      </div>
    </article>
  `).join('');

  document.querySelectorAll<HTMLButtonElement>('.share-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const item = reports.find(r => r.id === id);
      if (item) await shareIncidentReport(item);
    });
  });
}

function escape(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Init
async function init() {
  renderReports();
  const pending = await getPendingQueueCount();
  const effective = Math.max(pending, reports.filter(r => r.status === 'queued').length);
  await updateOutboxIndicator(effective);
  await fetchServerReports();
}

init();
