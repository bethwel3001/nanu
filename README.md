# NANU Documentation

NANU is an offline-first field incident logger built with vanilla HTML, CSS, and JavaScript. It implements Progressive Web App (PWA) resilience patterns for intermittent connectivity without external frameworks or build tools.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
  - [1. Cache Storage (App Shell)](#1-cache-storage-app-shell)
  - [2. Offline Queue (IndexedDB)](#2-offline-queue-indexeddb)
  - [3. Background Synchronization](#3-background-synchronization)
  - [4. Platform Web APIs](#4-platform-web-apis)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation and Execution](#installation-and-execution)
- [API Reference](#api-reference)
  - [GET /api/reports](#get-apireports)
  - [POST /api/reports](#post-apireports)
  - [DELETE /api/reports](#delete-apireports)
- [Offline Verification Guide](#offline-verification-guide)
- [Deployment](#deployment)

---

## Overview

Field workers often operate in areas with unstable or unavailable network coverage. NANU ensures:
- The application boots instantly without an active internet connection.
- Submissions made while disconnected are accepted immediately and safely stored on-device.
- Pending reports automatically synchronize with the server once connectivity is restored.

---

## Architecture

### 1. Cache Storage (App Shell)
The Service Worker (`js/sw.js`) manages precaching and network requests using a Stale-While-Revalidate caching strategy. During the `install` phase, the core application shell (`index.html`, `style.css`, `js/app.js`, `manifest.json`, and icons) is stored in `nanu-cache-v1` for instant zero-latency startup.

### 2. Offline Queue (IndexedDB)
When submissions occur offline or network requests fail:
- Reports are persisted to the `outbox` store in the browser's native IndexedDB database (`nanu-db`).
- Each incident receives a client-generated identifier (`rep-<timestamp>-<hash>`) to guarantee idempotent replays without duplicates.

### 3. Background Synchronization
- **Background Sync API**: The client registers a sync event (`sync-nanu-reports`). The browser wakes the Service Worker when connectivity returns, even if the user has navigated away or closed the tab.
- **Fallback Synchronization**: The client listens for the window `online` event to send an immediate replay signal (`REPLAY_QUEUE`) to the Service Worker, supporting browsers without native Background Sync.

### 4. Platform Web APIs
- **App Badging API** (`navigator.setAppBadge`): Reflects the number of pending outbox items on the operating system dock or taskbar.
- **Web Share API** (`navigator.share`): Triggers the native OS share sheet with an automatic clipboard fallback.
- **Geolocation API** (`navigator.geolocation`): Auto-detects geographic coordinates with fallback presets.

---

## Project Structure

| File / Directory | Purpose |
| :--- | :--- |
| `index.html` | Semantic HTML5 structure, accessible form, and custom severity dropdown |
| `style.css` | Design system, responsive layout, and keyframe animations |
| `manifest.json` | Web App Manifest for standalone installation |
| `js/app.js` | Client-side application logic, IndexedDB queue, and platform APIs |
| `js/sw.js` | Native Service Worker managing caching, fetch events, and sync replays |
| `js/server.js` | Zero-dependency Node.js mock API and static file server |
| `images/` | Application icons and favicons |
| `api/reports.js` | Serverless function handling `/api/reports` on Vercel deployments |
| `vercel.json` | Vercel configuration for static hosting and service worker headers |

---

## Getting Started

### Prerequisites
- Node.js 18 or higher (uses built-in standard library, zero npm dependencies needed)

### Installation and Execution

1. Start the server:
   ```bash
   node js/server.js
   ```
   Or using npm / pnpm:
   ```bash
   npm start
   ```

2. Open `http://localhost:3000` in a web browser.

---

## API Reference

The local server (`js/server.js`) and Vercel serverless function (`api/reports.js`) provide the following REST endpoints:

### GET /api/reports
Returns all synchronized incident reports.

**Response (200 OK):**
```json
{
  "reports": [
    {
      "id": "rep-1729670000000-a1b2",
      "reporter": "Jane Kiprono",
      "coordinates": "-0.3031, 36.0800",
      "severity": "high",
      "notes": "Damaged perimeter line near substation",
      "timestamp": "2026-10-23T10:00:00.000Z",
      "syncedAt": "2026-10-23T10:05:00.000Z"
    }
  ],
  "count": 1
}
```

### POST /api/reports
Submits or synchronizes an incident report. Updates existing records idempotently if matching `id` is present.

**Request Body:**
```json
{
  "id": "rep-1729670000000-a1b2",
  "reporter": "Jane Kiprono",
  "coordinates": "-0.3031, 36.0800",
  "severity": "high",
  "notes": "Damaged perimeter line near substation",
  "timestamp": "2026-10-23T10:00:00.000Z"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Report synchronized",
  "report": { ... }
}
```

### DELETE /api/reports
Clears stored in-memory reports to reset the environment for testing or demonstrations.

---

## Offline Verification Guide

1. **Verify App Shell Cache**:
   - Open DevTools (`F12`) > **Application** > **Cache Storage** > `nanu-cache-v1`.
   - Confirm all core assets are cached.

2. **Simulate Network Failure**:
   - In DevTools > **Network** tab, change throttling to **Offline**.
   - The UI metric card updates to **Offline** (red).

3. **Queue an Offline Incident**:
   - Fill out and submit the incident form.
   - Inspect **Application** > **IndexedDB** > `nanu-db` > `outbox` to confirm the report is persisted locally.
   - The **Outbox queue** counter updates to `1 Queued` and the OS app badge increments.

4. **Restore Network Connection**:
   - Change the **Network** tab back to **Online**.
   - The Service Worker triggers `sync-nanu-reports`, sends queued items to `/api/reports`, deletes them from IndexedDB, marks them **Synced**, and clears the OS badge.

---

## Deployment

The application is configured for deployment on Vercel:
- `vercel.json` directs Vercel to serve static assets from the root directory (`.`) and sets the `Service-Worker-Allowed: /` header on `/js/sw.js`.
- `api/reports.js` acts as a serverless endpoint handling API operations in production.
