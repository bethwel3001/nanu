/**
 * NANU: Resilient Offline Incident Logger
 * GDG DevFest Rift Valley 2026 - Data Models & Types
 */

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface IncidentReport {
  id: string;
  reporter: string;
  coordinates: string;
  notes: string;
  severity: SeverityLevel;
  timestamp: string;
  status: 'queued' | 'synced';
  syncedAt?: string;
}

export interface SyncMessage {
  type: 'SYNC_COMPLETED' | 'REQUEST_QUEUED' | 'QUEUE_STATUS';
  queueName?: string;
  count?: number;
}
