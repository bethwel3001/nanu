/**
 * ==========================================================================
 * NANU DEMO BACKEND SERVER (ZERO-DEPENDENCY VANILLA NODE.JS)
 * ==========================================================================
 * Serves static assets and provides mock cloud API for stage demos.
 *
 * Usage:
 *   node js/server.js
 *   or: pnpm start / npm start
 * ==========================================================================
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PORT = process.env.PORT || 3000;

// In-memory cloud reports storage for live demo
const serverReports = [];

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // --------------------------------------------------------------------------
  // 1. MOCK API: /api/reports
  // --------------------------------------------------------------------------
  if (pathname.startsWith('/api/reports')) {
    // GET: Return all synchronized reports
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reports: serverReports, count: serverReports.length }));
      return;
    }

    // POST: Receive new or replayed report
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const report = JSON.parse(body || '{}');
          report.syncedAt = new Date().toISOString();

          // Deduplicate by report id on replay
          const index = serverReports.findIndex((r) => r.id === report.id);
          if (index >= 0) {
            serverReports[index] = report;
          } else {
            serverReports.unshift(report);
          }

          console.log(`[Cloud Server] Received incident report: [${(report.severity || 'MEDIUM').toUpperCase()}] "${report.notes?.slice(0, 35)}..." from ${report.reporter} (ID: ${report.id})`);

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Report synchronized', report }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // DELETE: Reset for clean demo run
    if (req.method === 'DELETE') {
      serverReports.length = 0;
      console.log('[Cloud Server] Cleared server reports for fresh demo');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Reports cleared' }));
      return;
    }
  }

  // --------------------------------------------------------------------------
  // 2. STATIC FILE SERVER
  // --------------------------------------------------------------------------
  let filePath;

  if (pathname === '/') {
    filePath = path.join(PROJECT_ROOT, 'index.html');
  } else if (pathname === '/sw.js') {
    // Convenience route: map /sw.js directly to js/sw.js
    filePath = path.join(PROJECT_ROOT, 'js', 'sw.js');
  } else {
    filePath = path.join(PROJECT_ROOT, pathname);
  }

  // Prevent directory traversal
  if (!filePath.startsWith(PROJECT_ROOT)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PROJECT_ROOT, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': contentType };

    // Service Worker headers: allow root scope and prevent browser HTTP caching
    if (filePath.endsWith('sw.js')) {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server Error loading file');
        return;
      }
      res.writeHead(200, headers);
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`NANU server running at http://localhost:${PORT}`);
});
