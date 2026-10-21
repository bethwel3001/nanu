# NANU

Resilient offline field incident logger built with **pure vanilla HTML, CSS, and modern JavaScript**. Designed for stage demos and beginner PWA workshops.

---

## Project Structure

```
NANU/
├── index.html        # App UI layout & custom dropdown
├── style.css         # Modern styling & animations
├── manifest.json     # PWA installation manifest
├── js/
│   ├── app.js        # Client logic, IndexedDB outbox & platform APIs
│   ├── sw.js         # Service Worker (Cache Storage & Background Sync)
│   └── server.js     # Zero-dependency Node.js mock API & static server
└── images/           # App icons & favicons
```

---

## Running the App

Requires only Node.js (no npm install or build step needed):

```bash
# Start the server
node js/server.js

# Or with npm / pnpm
npm start
```

Open **http://localhost:3000** in your browser.

---

## Demo Steps (Offline and Background Sync)

1. **Inspect Service Worker**:
   * Open DevTools (`F12`) → **Application** → **Service Workers**. Notice `js/sw.js` is active with scope `/`.
   * Check **Cache Storage** → `nanu-cache-v1` to see the precached app shell.

2. **Simulate Offline**:
   * In DevTools **Network** tab, change **No throttling** to **Offline**.
   * The **Network state** card switches dynamically to red **Offline**.

3. **Log an Incident (Offline Queue)**:
   * Fill the form and submit.
   * View **Application** → **IndexedDB** → `nanu-db` → `outbox` to see the incident stored safely offline.
   * Notice the **Outbox queue** card updates to `1 Queued` and the OS app badge updates.

4. **Network Recovery (Background Sync Replay)**:
   * Switch the Network tab back to **Online**.
   * The Service Worker background sync triggers, flushes the queued report to `/api/reports`, marks it **Synced**, and clears the OS badge.
