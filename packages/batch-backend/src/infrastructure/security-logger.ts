// packages/batch-backend/src/infrastructure/security-logger.ts
//
// Security audit logging service for comprehensive security event tracking.
// Provides structured logging for security incidents, suspicious activities,
// and compliance audit trails.

import { logger } from './logger';

export interface SecurityEvent {
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  outcome: 'success' | 'failure' | 'blocked';
  details?: Record<string, any>;
  timestamp: Date;
  correlationId?: string;
  metadata?: Record<string, any>;
}

export enum SecurityEventType {
  // Authentication events
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILURE = 'login_failure',
  LOGOUT = 'logout',
  TOKEN_REFRESH = 'token_refresh',
  TOKEN_VALIDATION_FAILURE = 'token_validation_failure',
  PASSWORD_CHANGE = 'password_change',
  PASSWORD_RESET_REQUEST = 'password_reset_request',
  
  // Authorization events
  UNAUTHORIZED_ACCESS_ATTEMPT = 'unauthorized_access_attempt',
  PRIVILEGE_ESCALATION_ATTEMPT = 'privilege_escalation_attempt',
  ROLE_CHANGE = 'role_change',
  
  // File upload events
  FILE_UPLOAD_ATTEMPT = 'file_upload_attempt',
  FILE_UPLOAD_SUCCESS = 'file_upload_success',
  FILE_UPLOAD_FAILURE = 'file_upload_failure',
  FILE_VALIDATION_FAILURE = 'file_validation_failure',
  FILE_SANITIZATION_REQUIRED = 'file_sanitization_required',
  MALICIOUS_FILE_DETECTED = 'malicious_file_detected',
  SUSPICIOUS_FILE_NAME = 'suspicious_file_name',
  
  // Rate limiting events
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  RATE_LIMIT_BLOCKED = 'rate_limit_blocked',
  BRUTE_FORCE_ATTEMPT = 'brute_force_attempt',
  
  // System events
  SYSTEM_ERROR = 'system_error',
  SECURITY_CONFIGURATION_ERROR = 'security_configuration_error',
  DEPENDENCY_FAILURE = 'dependency_failure',
  
  // Data integrity events
  DATA_CORRUPTION_DETECTED = 'data_corruption_detected',
  INVALID_DATA_FORMAT = 'invalid_data_format',
  ENCODING_ERROR = 'encoding_error',
  
  // Network security events
  SUSPICIOUS_IP_DETECTED = 'suspicious_ip_detected',
  GEOLOCATION_ANOMALY = 'geolocation_anomaly',
  REQUEST_ANOMALY = 'request_anomaly',
  
  // Rate limiting operational events
  RATE_LIMIT_CHECK_SUCCESS = 'rate_limit_check_success',
  RATE_LIMIT_BURST_USED = 'rate_limit_burst_used',
  WINDOW_KEY_GENERATION = 'window_key_generation',
  REDIS_OPERATION_FAILURE = 'redis_operation_failure',
}

export enum SecuritySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface SecurityLogConfig {
  enableDetailedLogging: boolean;
  enableUserTracking: boolean;
  enableIPTracking: boolean;
  enableUserAgentTracking: boolean;
  enableRequestCorrelation: boolean;
  retentionDays: number;
  alertThresholds: {
    failedLogins: number;
    rateLimitViolations: number;
    suspiciousUploads: number;
  };
}

export class SecurityLogger {
  private config: SecurityLogConfig;
  private eventCounter: Map<SecurityEventType, number> = new Map();
  private userSessionTracking: Map<string, { userId: string; sessionId: string; lastActivity: Date }> = new Map();

  constructor(config: SecurityLogConfig) {
    this.config = config;
    this.initializeCounters();
  }

  private initializeCounters(): void {
    Object.values(SecurityEventType).forEach(eventType => {
      this.eventCounter.set(eventType, 0);
    });
  }

  /**
   * Log a security event with comprehensive context
   */
  async logEvent(event: Omit<SecurityEvent, 'timestamp'>): Promise<void> {
    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date(),
      userId: this.config.enableUserTracking ? event.userId : undefined,
      ipAddress: this.config.enableIPTracking ? event.ipAddress : undefined,
      userAgent: this.config.enableUserAgentTracking ? event.userAgent : undefined,
    };

    try {
      // Update event counters
      const currentCount = this.eventCounter.get(event.eventType) || 0;
      this.eventCounter.set(event.eventType, currentCount + 1);

      // Track user sessions for security monitoring
      if (event.userId && event.sessionId) {
        this.updateUserSession(event.userId, event.sessionId);
      }

      // Check for threshold violations
      await this.checkAlertThresholds(securityEvent);

      // Log based on severity
      await this.logBySeverity(securityEvent);

      // Store for audit trail (if persistence layer is available)
      await this.storeForAudit(securityEvent);

    } catch (error) {
      // Never let security logging failures affect the main application
      logger.error('Security logging failed', {
        error: error instanceof Error ? error.message : String(error),
        originalEvent: event.eventType,
      });
    }
  }

  /**
   * Log authentication-related security events
   */
  async logAuthEvent(
    type: SecurityEventType.LOGIN_SUCCESS | SecurityEventType.LOGIN_FAILURE | SecurityEventType.LOGOUT | SecurityEventType.TOKEN_REFRESH | SecurityEventType.TOKEN_VALIDATION_FAILURE,
    userId: string,
    sessionId: string,
    outcome: 'success' | 'failure' | 'blocked',
    details?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: type,
      severity: this.getAuthEventSeverity(type, outcome),
      userId,
      sessionId,
      outcome,
      details,
      action: 'authentication',
    });
  }

  /**
   * Log file upload security events
   */
  async logFileUploadEvent(
    type: SecurityEventType.FILE_UPLOAD_ATTEMPT | SecurityEventType.FILE_UPLOAD_SUCCESS | SecurityEventType.FILE_UPLOAD_FAILURE | SecurityEventType.FILE_VALIDATION_FAILURE | SecurityEventType.FILE_SANITIZATION_REQUIRED | SecurityEventType.MALICIOUS_FILE_DETECTED | SecurityEventType.SUSPICIOUS_FILE_NAME,
    userId: string,
    filename: string,
    fileSize: number,
    outcome: 'success' | 'failure' | 'blocked',
    details?: Record<string, any>
  ): Promise<void> {
    const severity = this.getFileUploadEventSeverity(type, outcome, filename);

    await this.logEvent({
      eventType: type,
      severity,
      userId,
      outcome,
      resource: filename,
      details: {
        fileSize,
        filename,
        ...details,
      },
      action: 'file_upload',
    });
  }

  /**
   * Log rate limiting events
   */
  async logRateLimitEvent(
    type: SecurityEventType.RATE_LIMIT_EXCEEDED | SecurityEventType.RATE_LIMIT_BLOCKED | SecurityEventType.BRUTE_FORCE_ATTEMPT,
    userId: string,
    identifier: string,
    limit: number,
    count: number,
    retryAfter?: number
  ): Promise<void> {
    await this.logEvent({
      eventType: type,
      severity: SecuritySeverity.MEDIUM,
      userId: type === SecurityEventType.BRUTE_FORCE_ATTEMPT ? userId : undefined,
      outcome: 'blocked',
      details: {
        identifier,
        limit,
        count,
        retryAfter,
      },
      action: 'rate_limiting',
    });
  }

  /**
   * Log authorization events
   */
  async logAuthorizationEvent(
    type: SecurityEventType.UNAUTHORIZED_ACCESS_ATTEMPT | SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT,
    userId: string,
    resource: string,
    action: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: type,
      severity: type === SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT ? SecuritySeverity.CRITICAL : SecuritySeverity.HIGH,
      userId,
      outcome: 'blocked',
      resource,
      action,
      details,
    });
  }

  /**
   * Log system security events
   */
  async logSystemEvent(
    type: SecurityEventType.SYSTEM_ERROR | SecurityEventType.SECURITY_CONFIGURATION_ERROR | SecurityEventType.DEPENDENCY_FAILURE,
    severity: SecuritySeverity,
    details: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: type,
      severity,
      outcome: 'failure',
      details,
      action: 'system',
    });
  }

  /**
   * Log data integrity events
   */
  async logDataIntegrityEvent(
    type: SecurityEventType.DATA_CORRUPTION_DETECTED | SecurityEventType.INVALID_DATA_FORMAT | SecurityEventType.ENCODING_ERROR,
    resource: string,
    details: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      eventType: type,
      severity: SecuritySeverity.HIGH,
      outcome: 'failure',
      resource,
      details,
      action: 'data_integrity',
    });
  }

  /**
   * Get security event statistics
   */
  getEventStatistics(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsBySeverity: Record<string, number>;
    activeUsers: number;
    highSeverityEvents: number;
  } {
    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };

    let totalEvents = 0;
    let highSeverityEvents = 0;

    this.eventCounter.forEach((count, eventType) => {
      eventsByType[eventType] = count;
      totalEvents += count;
    });

    // Calculate severity distribution and high severity count
    // Note: This is a simplified calculation - in production, you'd track this properly
    highSeverityEvents = eventsByType[SecurityEventType.MALICIOUS_FILE_DETECTED] || 0;
    highSeverityEvents += eventsByType[SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT] || 0;
    highSeverityEvents += eventsByType[SecurityEventType.BRUTE_FORCE_ATTEMPT] || 0;

    return {
      totalEvents,
      eventsByType,
      eventsBySeverity,
      activeUsers: this.userSessionTracking.size,
      highSeverityEvents,
    };
  }

  /**
   * Get active user sessions
   */
  getActiveUserSessions(): Array<{ userId: string; sessionId: string; lastActivity: Date }> {
    return Array.from(this.userSessionTracking.values());
  }

  /**
   * Clean up old sessions and events
   */
  async cleanup(): Promise<void> {
    const cutoffTime = new Date(Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000));
    
    // Clean up old user sessions
    for (const [key, session] of this.userSessionTracking.entries()) {
      if (session.lastActivity < cutoffTime) {
        this.userSessionTracking.delete(key);
      }
    }

    // Reset daily counters (implement daily cron or similar)
    this.initializeCounters();

    logger.debug('Security logger cleanup completed', {
      retainedSessions: this.userSessionTracking.size,
      cutoffTime: cutoffTime.toISOString(),
    });
  }

  private async logBySeverity(event: SecurityEvent): Promise<void> {
    const logData = {
      security_event: true,
      event_type: event.eventType,
      severity: event.severity,
      user_id: event.userId,
      session_id: event.sessionId,
      ip_address: event.ipAddress,
      user_agent: event.userAgent,
      resource: event.resource,
      action: event.action,
      outcome: event.outcome,
      timestamp: event.timestamp.toISOString(),
      correlation_id: event.correlationId,
      metadata: event.metadata,
      details: event.details,
    };

    switch (event.severity) {
      case SecuritySeverity.LOW:
        logger.info('Security event', logData);
        break;
      case SecuritySeverity.MEDIUM:
        logger.warn('Security event', logData);
        break;
      case SecuritySeverity.HIGH:
        logger.warn('High severity security event', logData);
        break;
      case SecuritySeverity.CRITICAL:
        logger.error('CRITICAL security event', logData);
        break;
    }
  }

  private getAuthEventSeverity(
    type: SecurityEventType, 
    outcome: 'success' | 'failure' | 'blocked'
  ): SecuritySeverity {
    if (outcome === 'success' && type === SecurityEventType.LOGIN_SUCCESS) {
      return SecuritySeverity.LOW;
    }
    if (outcome === 'failure' && type === SecurityEventType.LOGIN_FAILURE) {
      return SecuritySeverity.MEDIUM;
    }
    if (type === SecurityEventType.TOKEN_VALIDATION_FAILURE) {
      return SecuritySeverity.HIGH;
    }
    return SecuritySeverity.MEDIUM;
  }

  private getFileUploadEventSeverity(
    type: SecurityEventType,
    outcome: 'success' | 'failure' | 'blocked',
    filename: string
  ): SecuritySeverity {
    if (type === SecurityEventType.MALICIOUS_FILE_DETECTED || 
        type === SecurityEventType.SUSPICIOUS_FILE_NAME) {
      return SecuritySeverity.HIGH;
    }
    if (type === SecurityEventType.FILE_VALIDATION_FAILURE && outcome === 'blocked') {
      return SecuritySeverity.MEDIUM;
    }
    return SecuritySeverity.LOW;
  }

  private async checkAlertThresholds(event: SecurityEvent): Promise<void> {
    const failedLogins = this.eventCounter.get(SecurityEventType.LOGIN_FAILURE) || 0;
    const rateLimitViolations = this.eventCounter.get(SecurityEventType.RATE_LIMIT_BLOCKED) || 0;
    const suspiciousUploads = this.eventCounter.get(SecurityEventType.SUSPICIOUS_FILE_NAME) || 0;

    // Check if any thresholds are exceeded
    const exceededThresholds = [];
    
    if (failedLogins > this.config.alertThresholds.failedLogins) {
      exceededThresholds.push(`failed_logins: ${failedLogins}`);
    }
    
    if (rateLimitViolations > this.config.alertThresholds.rateLimitViolations) {
      exceededThresholds.push(`rate_limit_violations: ${rateLimitViolations}`);
    }
    
    if (suspiciousUploads > this.config.alertThresholds.suspiciousUploads) {
      exceededThresholds.push(`suspicious_uploads: ${suspiciousUploads}`);
    }

    if (exceededThresholds.length > 0) {
      logger.warn('Security alert thresholds exceeded', {
        exceeded_thresholds: exceededThresholds,
        user_id: event.userId,
        event_type: event.eventType,
        severity: event.severity,
      });
    }
  }

  private async storeForAudit(event: SecurityEvent): Promise<void> {
    // In a production environment, this would store events in a persistent
    // audit database or logging service for compliance and forensic analysis
    if (this.config.enableDetailedLogging) {
      // For now, we'll just ensure the event is logged comprehensively
      // In production, consider using services like:
      // - AWS CloudTrail
      // - Azure Monitor
      // - ELK Stack
      // - Splunk
      // - Datadog
      logger.debug('Security event stored for audit', {
        event_type: event.eventType,
        severity: event.severity,
        outcome: event.outcome,
        user_id: event.userId,
        timestamp: event.timestamp.toISOString(),
      });
    }
  }

  private updateUserSession(userId: string, sessionId: string): void {
    this.userSessionTracking.set(sessionId, {
      userId,
      sessionId,
      lastActivity: new Date(),
    });
  }
}

/**
 * Factory function to create security logger from configuration
 */
export function createSecurityLogger(): SecurityLogger {
  const config: SecurityLogConfig = {
    enableDetailedLogging: process.env.NODE_ENV !== 'production',
    enableUserTracking: true,
    enableIPTracking: true,
    enableUserAgentTracking: true,
    enableRequestCorrelation: true,
    retentionDays: 90, // 90 days retention for compliance
    alertThresholds: {
      failedLogins: 5,
      rateLimitViolations: 10,
      suspiciousUploads: 3,
    },
  };

  return new SecurityLogger(config);
}

/**
 * Get context information for security logging from request
 */
export function getSecurityContext(request: any): {
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
} {
  const user = request.user;
  const headers = request.headers;
  
  return {
    userId: user?.id,
    sessionId: user?.sessionId,
    ipAddress: headers['x-forwarded-for']?.split(',')[0]?.trim() || headers['x-real-ip'] || request.ip,
    userAgent: headers['user-agent'],
    correlationId: headers['x-correlation-id'] || headers['x-request-id'],
  };
}