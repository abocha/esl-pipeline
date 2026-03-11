import type { AuditLogger, BotAuditEvent } from './types.js';

export function createAuditLogger(): AuditLogger {
  return {
    log(entry: BotAuditEvent) {
      const now = new Date().toISOString();
      const payload = {
        ...entry,
        ts: now,
      };
      if (entry.level === 'error') {
        console.error(JSON.stringify(payload));
      } else if (entry.level === 'warn') {
        console.warn(JSON.stringify(payload));
      } else {
        console.info(JSON.stringify(payload));
      }
    },
  };
}
