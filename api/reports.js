// Vercel serverless function for incident reports API

const serverReports = [];

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Return synchronized reports
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ reports: serverReports, count: serverReports.length }));
    return;
  }

  // Ingest new or replayed incident report
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {}
    }
    const report = body || {};
    report.syncedAt = new Date().toISOString();

    const index = serverReports.findIndex((r) => r.id === report.id);
    if (index >= 0) {
      serverReports[index] = report;
    } else {
      serverReports.unshift(report);
    }

    res.statusCode = 201;
    res.end(JSON.stringify({ success: true, message: 'Report synchronized', report }));
    return;
  }

  // Clear reports for fresh demo state
  if (req.method === 'DELETE') {
    serverReports.length = 0;
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, message: 'Reports cleared' }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}
