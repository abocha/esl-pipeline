/**
 * Security utilities for the batch-frontend.
 *
 * Provides XSS prevention, input sanitization, and security event logging.
 */

// DOMPurify-like XSS prevention (basic implementation)
export function sanitizeHtml(input: string): string {
  // Basic XSS prevention - escape HTML entities
  return input
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Input sanitization for forms
export function sanitizeInput(input: string): string {
  // Remove potentially dangerous characters and normalize whitespace
  return input
    .trim()
    .replace(/[<>\"'&]/g, '') // Remove HTML/XML injection chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .substring(0, 1000); // Limit length
}

// Email validation (additional security layer)
export function validateEmailSecure(email: string): boolean {
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 254;
}

// Password strength validation
export function validatePasswordStrength(password: string): {
  valid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else feedback.push('At least 8 characters required');

  if (/[A-Z]/.test(password)) score++;
  else feedback.push('At least one uppercase letter required');

  if (/[a-z]/.test(password)) score++;
  else feedback.push('At least one lowercase letter required');

  if (/\d/.test(password)) score++;
  else feedback.push('At least one number required');

  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;
  else feedback.push('At least one special character required');

  // Check for common weak patterns
  if (/(.)\1{2,}/.test(password)) {
    score = Math.max(0, score - 1);
    feedback.push('Avoid repeated characters');
  }

  if (/123|abc|qwe|password/i.test(password)) {
    score = Math.max(0, score - 1);
    feedback.push('Avoid common patterns');
  }

  return {
    valid: score >= 3,
    score,
    feedback,
  };
}

// File name sanitization
export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts and dangerous characters
  return filename
    .replace(/[/\\]/g, '_') // Replace path separators
    .replace(/[<>:"|?*]/g, '_') // Replace Windows forbidden chars
    .replace(/\.\./g, '_') // Prevent directory traversal
    .replace(/^\.+/, '') // Remove leading dots
    .substring(0, 255); // Limit length
}

// Security event logging (client-side)
export interface SecurityEvent {
  type: 'xss_attempt' | 'auth_failure' | 'suspicious_input' | 'rate_limit_hit';
  details: Record<string, any>;
  timestamp: string;
  userAgent: string;
  url: string;
}

export function logSecurityEvent(
  event: Omit<SecurityEvent, 'timestamp' | 'userAgent' | 'url'>
): void {
  const securityEvent: SecurityEvent = {
    ...event,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
  };

  // In development, log to console
  if (process.env.NODE_ENV === 'development') {
    console.warn('Security Event:', securityEvent);
  }

  // In production, you would send this to your backend security logger
  // For now, we'll just store in localStorage for debugging
  try {
    const existingEvents = JSON.parse(localStorage.getItem('security_events') || '[]');
    existingEvents.push(securityEvent);

    // Keep only last 50 events
    if (existingEvents.length > 50) {
      existingEvents.splice(0, existingEvents.length - 50);
    }

    localStorage.setItem('security_events', JSON.stringify(existingEvents));
  } catch (storageError) {
    console.warn('Failed to persist security events locally', storageError);
  }

  // TODO: Send to backend security endpoint
  // await apiClient.post('/security/log', securityEvent);
}

// CSRF token utilities (for forms that need additional protection)
export function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Content Security Policy violation reporting
export function setupCSPViolationReporting(): void {
  document.addEventListener('securitypolicyviolation', event => {
    logSecurityEvent({
      type: 'suspicious_input',
      details: {
        violatedDirective: event.violatedDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
      },
    });
  });
}

// Initialize security monitoring
export function initializeSecurity(): void {
  setupCSPViolationReporting();

  // Monitor for suspicious DOM manipulation attempts
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          // Check for suspicious script injections
          if (element.tagName === 'SCRIPT' && !element.hasAttribute('data-trusted')) {
            logSecurityEvent({
              type: 'xss_attempt',
              details: {
                tagName: element.tagName,
                attributes: Array.from(element.attributes).map(attr => attr.name),
              },
            });
          }
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
