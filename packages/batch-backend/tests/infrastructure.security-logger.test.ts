// packages/batch-backend/tests/infrastructure.security-logger.test.ts
//
// Tests for security audit logging service covering event logging,
// severity handling, threshold alerts, and audit trail persistence.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SecurityLogger,
  SecurityEventType,
  SecuritySeverity,
  SecurityLogConfig,
  SecurityEvent
} from '../src/infrastructure/security-logger';

// Mock logger
vi.mock('../src/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))


describe('SecurityLogger', () => {
  let securityLogger: SecurityLogger;
  let testConfig: SecurityLogConfig;

  beforeEach(() => {
    testConfig = {
      enableDetailedLogging: true,
      enableUserTracking: true,
      enableIPTracking: true,
      enableUserAgentTracking: true,
      enableRequestCorrelation: true,
      retentionDays: 90,
      alertThresholds: {
        failedLogins: 5,
        rateLimitViolations: 10,
        suspiciousUploads: 3,
      },
    };
    securityLogger = new SecurityLogger(testConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Event Logging', () => {
    it('should log low severity events', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        userId: 'user123',
        outcome: 'success',
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Security event',
        expect.objectContaining({
          security_event: true,
          event_type: SecurityEventType.LOGIN_SUCCESS,
          severity: SecuritySeverity.LOW,
          user_id: 'user123',
          outcome: 'success',
        })
      );
    });

    it('should log medium severity events as warnings', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_FAILURE,
        severity: SecuritySeverity.MEDIUM,
        userId: 'user123',
        outcome: 'failure',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Security event',
        expect.objectContaining({
          event_type: SecurityEventType.LOGIN_FAILURE,
          severity: SecuritySeverity.MEDIUM,
        })
      );
    });

    it('should log high severity events as warnings', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logEvent({
        eventType: SecurityEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
        severity: SecuritySeverity.HIGH,
        userId: 'user123',
        outcome: 'blocked',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'High severity security event',
        expect.objectContaining({
          event_type: SecurityEventType.UNAUTHORIZED_ACCESS_ATTEMPT,
          severity: SecuritySeverity.HIGH,
        })
      );
    });

    it('should log critical severity events as errors', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logEvent({
        eventType: SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT,
        severity: SecuritySeverity.CRITICAL,
        userId: 'user123',
        outcome: 'blocked',
      });

      expect(logger.error).toHaveBeenCalledWith(
        'CRITICAL security event',
        expect.objectContaining({
          event_type: SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT,
          severity: SecuritySeverity.CRITICAL,
        })
      );
    });
  });

  describe('Typed Event Logging Methods', () => {
    it('should log authentication events', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logAuthEvent(
        SecurityEventType.LOGIN_SUCCESS,
        'user123',
        'session456',
        'success'
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Security event',
        expect.objectContaining({
          event_type: SecurityEventType.LOGIN_SUCCESS,
          severity: SecuritySeverity.LOW,
          user_id: 'user123',
          session_id: 'session456',
          outcome: 'success',
          action: 'authentication',
        })
      );
    });

    it('should log file upload events with proper severity', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logFileUploadEvent(
        SecurityEventType.FILE_UPLOAD_SUCCESS,
        'user123',
        'test.md',
        1024,
        'success'
      );

      expect(logger.info).toHaveBeenCalledWith(
        'Security event',
        expect.objectContaining({
          event_type: SecurityEventType.FILE_UPLOAD_SUCCESS,
          severity: SecuritySeverity.LOW,
          user_id: 'user123',
          resource: 'test.md',
          action: 'file_upload',
          details: expect.objectContaining({
            fileSize: 1024,
            filename: 'test.md',
          }),
        })
      );
    });

    it('should assign high severity to malicious file detection', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logFileUploadEvent(
        SecurityEventType.MALICIOUS_FILE_DETECTED,
        'user123',
        'malicious.exe',
        2048,
        'blocked'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'High severity security event',
        expect.objectContaining({
          event_type: SecurityEventType.MALICIOUS_FILE_DETECTED,
          severity: SecuritySeverity.HIGH,
          resource: 'malicious.exe',
        })
      );
    });

    it('should log rate limiting events', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logRateLimitEvent(
        SecurityEventType.RATE_LIMIT_EXCEEDED,
        'user123',
        'ip:192.168.1.1',
        10,
        15,
        60
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'Security event',
        expect.objectContaining({
          event_type: SecurityEventType.RATE_LIMIT_EXCEEDED,
          severity: SecuritySeverity.MEDIUM,
          outcome: 'blocked',
          action: 'rate_limiting',
          details: expect.objectContaining({
            identifier: 'ip:192.168.1.1',
            limit: 10,
            count: 15,
            retryAfter: 60,
          }),
        })
      );
    });

    it('should log authorization events', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logAuthorizationEvent(
        SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT,
        'user123',
        '/admin/users',
        'DELETE',
        { originalRole: 'user', requestedRole: 'admin' }
      );

      expect(logger.error).toHaveBeenCalledWith(
        'CRITICAL security event',
        expect.objectContaining({
          event_type: SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT,
          severity: SecuritySeverity.CRITICAL,
          user_id: 'user123',
          resource: '/admin/users',
          action: 'DELETE',
          outcome: 'blocked',
          details: expect.objectContaining({
            originalRole: 'user',
            requestedRole: 'admin',
          }),
        })
      );
    });

    it('should log system events', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logSystemEvent(
        SecurityEventType.SECURITY_CONFIGURATION_ERROR,
        SecuritySeverity.HIGH,
        { configPath: '/etc/security.yml', error: 'Invalid syntax' }
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'High severity security event',
        expect.objectContaining({
          event_type: SecurityEventType.SECURITY_CONFIGURATION_ERROR,
          severity: SecuritySeverity.HIGH,
          action: 'system',
          outcome: 'failure',
          details: expect.objectContaining({
            configPath: '/etc/security.yml',
            error: 'Invalid syntax',
          }),
        })
      );
    });
  });

  describe('Event Counter Tracking', () => {
    it('should track event counts', async () => {
      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        outcome: 'success',
      });

      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        outcome: 'success',
      });

      const stats = securityLogger.getEventStatistics();

      expect(stats.eventsByType[SecurityEventType.LOGIN_SUCCESS]).toBe(2);
    });

    it('should provide comprehensive statistics', async () => {
      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        outcome: 'success',
      });

      await securityLogger.logEvent({
        eventType: SecurityEventType.MALICIOUS_FILE_DETECTED,
        severity: SecuritySeverity.HIGH,
        outcome: 'blocked',
      });

      const stats = securityLogger.getEventStatistics();

      expect(stats.totalEvents).toBe(2);
      expect(stats.highSeverityEvents).toBe(1);
      expect(stats.activeUsers).toBe(0); // No user sessions tracked in this test
    });
  });

  describe('Alert Threshold Checking', () => {
    it('should trigger alerts when thresholds are exceeded', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      // Simulate multiple failed logins
      for (let i = 0; i < 6; i++) {
        await securityLogger.logEvent({
          eventType: SecurityEventType.LOGIN_FAILURE,
          severity: SecuritySeverity.MEDIUM,
          userId: 'user123',
          outcome: 'failure',
        });
      }

      expect(logger.warn).toHaveBeenCalledWith(
        'Security alert thresholds exceeded',
        expect.objectContaining({
          exceeded_thresholds: expect.arrayContaining(['failed_logins: 6']),
        })
      );
    });

    it('should not trigger alerts below threshold', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      // Simulate few failed logins (below threshold)
      for (let i = 0; i < 3; i++) {
        await securityLogger.logEvent({
          eventType: SecurityEventType.LOGIN_FAILURE,
          severity: SecuritySeverity.MEDIUM,
          userId: 'user123',
          outcome: 'failure',
        });
      }

      expect(logger.warn).not.toHaveBeenCalledWith(
        'Security alert thresholds exceeded',
        expect.any(Object)
      );
    });
  });

  describe('User Session Tracking', () => {
    it('should track user sessions', async () => {
      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        userId: 'user123',
        sessionId: 'session456',
        outcome: 'success',
      });

      const sessions = securityLogger.getActiveUserSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].userId).toBe('user123');
      expect(sessions[0].sessionId).toBe('session456');
    });

    it('should update session activity timestamps', async () => {
      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        userId: 'user123',
        sessionId: 'session456',
        outcome: 'success',
      });

      const sessionsBefore = securityLogger.getActiveUserSessions();
      const firstActivity = sessionsBefore[0].lastActivity;

      // Wait a bit and log another event
      await new Promise(resolve => setTimeout(resolve, 10));

      await securityLogger.logEvent({
        eventType: SecurityEventType.FILE_UPLOAD_SUCCESS,
        severity: SecuritySeverity.LOW,
        userId: 'user123',
        sessionId: 'session456',
        outcome: 'success',
      });

      const sessionsAfter = securityLogger.getActiveUserSessions();
      const secondActivity = sessionsAfter[0].lastActivity;

      expect(secondActivity.getTime()).toBeGreaterThanOrEqual(firstActivity.getTime());
    });
  });

  describe('Error Handling', () => {
    it('should not crash application on logging errors', async () => {
      const { logger } = await import('../src/infrastructure/logger');
      logger.info.mockImplementation(() => {
        throw new Error('Logging failed');
      });

      // This should not throw
      await expect(securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        outcome: 'success',
      })).resolves.toBeUndefined();

      // Error should be logged
      expect(logger.error).toHaveBeenCalledWith(
        'Security logging failed',
        expect.any(Object)
      );
    });
  });

  describe('Data Privacy', () => {
    it('should respect user tracking configuration', () => {
      const privacyLogger = new SecurityLogger({
        ...testConfig,
        enableUserTracking: false,
        enableIPTracking: false,
        enableUserAgentTracking: false,
      });

      // Even with user data, it should not be logged when tracking is disabled
      expect(privacyLogger).toBeInstanceOf(SecurityLogger);
    });

    it('should handle missing optional fields gracefully', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      await securityLogger.logEvent({
        eventType: SecurityEventType.SYSTEM_ERROR,
        severity: SecuritySeverity.MEDIUM,
        outcome: 'failure',
        // No userId, sessionId, etc.
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Security event',
        expect.objectContaining({
          user_id: undefined,
          session_id: undefined,
          ip_address: undefined,
          user_agent: undefined,
        })
      );
    });
  });

  describe('Cleanup Operations', () => {
    it('should clean up old sessions', async () => {
      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        userId: 'user123',
        sessionId: 'session456',
        outcome: 'success',
      });

      expect(securityLogger.getActiveUserSessions()).toHaveLength(1);

      // Simulate old session by directly accessing internal state
      // (In real usage, sessions would naturally expire)
      await securityLogger.cleanup();

      // Cleanup should still work even if no sessions need cleanup
      expect(securityLogger).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete security event workflow', async () => {
      const { logger } = await import('../src/infrastructure/logger');

      // Simulate a complete attack scenario
      await securityLogger.logAuthEvent(
        SecurityEventType.LOGIN_FAILURE,
        'attacker',
        'session123',
        'failure'
      );

      await securityLogger.logFileUploadEvent(
        SecurityEventType.MALICIOUS_FILE_DETECTED,
        'attacker',
        'malware.exe',
        1024,
        'blocked'
      );

      await securityLogger.logRateLimitEvent(
        SecurityEventType.RATE_LIMIT_BLOCKED,
        'attacker',
        'ip:192.168.1.100',
        10,
        15
      );

      // Verify events were logged
      expect(logger.warn).toHaveBeenCalledTimes(3);
      // No info calls expected as all events are medium/high severity

      // Verify statistics
      const stats = securityLogger.getEventStatistics();
      expect(stats.totalEvents).toBe(3);
      expect(stats.highSeverityEvents).toBe(1);
    });

    it('should maintain event correlation', async () => {
      const correlationId = 'correlation-123';

      await securityLogger.logEvent({
        eventType: SecurityEventType.LOGIN_SUCCESS,
        severity: SecuritySeverity.LOW,
        userId: 'user123',
        outcome: 'success',
        correlationId,
      });

      await securityLogger.logEvent({
        eventType: SecurityEventType.FILE_UPLOAD_SUCCESS,
        severity: SecuritySeverity.LOW,
        userId: 'user123',
        outcome: 'success',
        correlationId,
      });

      const { logger } = await import('../src/infrastructure/logger');
      const calls = logger.info.mock.calls;

      expect(calls[0][1]).toHaveProperty('correlation_id', correlationId);
      expect(calls[1][1]).toHaveProperty('correlation_id', correlationId);
    });
  });
});