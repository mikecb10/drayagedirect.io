// lib/cron/breadcrumb-retention.js
export const RETENTION_DAYS = 90;

export function cutoffIso(daysBack = RETENTION_DAYS, nowMs = Date.now()) {
  return new Date(nowMs - daysBack * 24 * 60 * 60 * 1000).toISOString();
}
