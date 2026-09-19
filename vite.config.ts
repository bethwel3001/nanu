import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { IncomingMessage, ServerResponse } from 'node:http';

// In-memory store for synchronized reports (simulating cloud backend for GDG DevFest stage demo)
interface IncidentReport {
  id: string;
  reporter: string;
  coordinates: string;
  notes: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  syncedAt?: string;
}

const serverReports: IncidentReport[] = [];

/**
 * Lightweight mock API middleware plugin for handling /api/reports.
 * Handles POST submissions from client and Workbox Background Sync replays,
 * and GET requests to retrieve verified synchronized reports.
 */
function nanuApiPlugin() {
  const handleRequest = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || '';
    if (url.startsWith('/api/reports')) {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ reports: serverReports, count: serverReports.length }));
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const reportData = JSON.parse(body || '{}');
            const newReport: IncidentReport = {
              id: reportData.id || `rep-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              reporter: reportData.reporter || 'Field Operative',
              coordinates: reportData.coordinates || 'Rift Valley Basin',
              notes: reportData.notes || '',
              severity: reportData.severity || 'medium',
              timestamp: reportData.timestamp || new Date().toISOString(),
              syncedAt: new Date().toISOString()
            };

            // Avoid duplicate entries if replayed
            const existingIndex = serverReports.findIndex(r => r.id === newReport.id);
            if (existingIndex >= 0) {
              serverReports[existingIndex] = newReport;
            } else {
              serverReports.unshift(newReport);
            }

            console.log(`[API /api/reports] Successfully received incident report ${newReport.id} from ${newReport.reporter}`);

            res.setHeader('Content-Type', 'application/json');
            res.writeHead(201);
            res.end(JSON.stringify({
              success: true,
              message: 'Incident report synchronized with server',
              report: newReport
            }));
          } catch (err) {
            console.error('[API /api/reports] Error parsing payload:', err);
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        serverReports.length = 0;
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Server reports reset for demo' }));
        return;
      }
    }
    next();
  };

  return {
    name: 'nanu-mock-api',
    configureServer(server: any) {
      server.middlewares.use(handleRequest);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(handleRequest);
    }
  };
}

export default defineConfig({
  plugins: [
    nanuApiPlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
      },
      devOptions: {
        enabled: true,
        type: 'module'
      },
      manifest: {
        name: 'NANU: Resilient Offline Incident Logger',
        short_name: 'NANU',
        description: 'Ultra-lean field logging application demonstrating modern PWA resilience patterns',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
});
