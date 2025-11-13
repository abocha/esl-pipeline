# Batch-Backend Test Remediation Execution Plan

## Phase 3 Implementation Guide

### Critical Fix #1: Rate Limiting Security (Priority 1 - Critical)

**Problem**: Rate limiting allows requests over limits, creating DoS vulnerability
**Files Affected**: 
- `packages/batch-backend/src/transport/rate-limit-middleware.ts`
- `packages/batch-backend/tests/transport.rate-limit-middleware.test.ts`

**Technical Solution**:

#### Step 1: Fix Rate Limiting Logic
```typescript
// In rate-limit-middleware.ts, update checkWindow method:
private async checkWindow(identifier: string, now: number, windowType: 'main' | 'burst'): Promise<RateLimitResult> {
    const isBurst = windowType === 'burst';
    const windowSize = isBurst ? this.config.burstWindow : this.config.windowSize;
    const maxRequests = isBurst ? this.config.burstLimit : this.config.maxRequests;

    const key = this.buildKey(identifier, windowType, now);
    const windowStart = now - windowSize;

    try {
        const removedCount = await this.redis.zremrangebyscore(key, 0, windowStart);
        const count = await this.redis.zcard(key);
        const remainingRequests = Math.max(0, maxRequests - count);
        const resetTime = now + windowSize;

        // CRITICAL: Block request if at or over limit
        const allowed = count < maxRequests;

        if (!allowed && windowType === 'main') {
            logger.warn('Rate limit exceeded', {
                event: 'rate_limit_exceeded',
                identifier,
                count,
                limit: maxRequests,
                windowType,
            });
        }

        return {
            allowed,
            remainingRequests,
            resetTime,
            limit: maxRequests,
            count,
        };
    } catch (error) {
        // SECURITY: Block by default in error cases for security
        const resetTime = now + windowSize;
        return {
            allowed: false, // Changed from true to false
            remainingRequests: 0,
            resetTime,
            limit: maxRequests,
            count: maxRequests,
        };
    }
}
```

#### Step 2: Fix Retry Time Calculation
```typescript
// Update calculateRetryTime method:
private async calculateRetryTime(now: number, identifier: string): Promise<number> {
    try {
        const mainKey = this.buildKey(identifier, 'main', now);
        const oldestRequest = await this.redis.zrange(mainKey, 0, 0, 'WITHSCORES');

        if (oldestRequest && oldestRequest.length >= 2 && oldestRequest[1]) {
            const oldestTimestamp = parseInt(oldestRequest[1]);
            const retryTime = oldestTimestamp + this.config.windowSize - now;
            return Math.max(0, retryTime);
        }
    } catch (error) {
        logger.error('Failed to calculate retry time', { error: error.message, identifier });
    }

    // Ensure positive retry time
    return Math.max(60, Math.ceil(this.config.windowSize / 1000));
}
```

#### Step 3: Fix Tests
Update test expectations in `transport.rate-limit-middleware.test.ts`:
```typescript
// Fix "should handle Redis errors gracefully" test:
it('should handle Redis errors gracefully', async () => {
    mockRedis.zremrangebyscore.mockRejectedValue(new Error('Redis connection failed'));
    
    const result = await rateLimiter.checkRateLimit('user:123');
    
    // SECURITY: Should block by default when Redis fails
    expect(result.allowed).toBe(false); // Changed from true
    expect(result.remainingRequests).toBe(0); // Changed from 10
});
```

**Success Criteria**: 
- ✅ Requests over limits are blocked
- ✅ Retry time calculation works correctly
- ✅ All rate limiting tests pass

---

### Critical Fix #2: File Validation Security (Priority 1 - Critical)

**Problem**: Missing detection of ZIP bombs, polyglot files, malicious content
**Files Affected**: 
- `packages/batch-backend/src/infrastructure/file-validation-service.ts`
- `packages/batch-backend/tests/infrastructure.file-validation-service.test.ts`

**Technical Solution**:

#### Step 1: Enhance Malicious Pattern Detection
```typescript
// Update maliciousPatterns array in file-validation-service.ts:
private maliciousPatterns: RegExp[] = [
    // Existing patterns...
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onerror\s*=/gi,
    
    // NEW: Enhanced path traversal
    /\.\.\/.*/gi,
    /\.\.\\.*/gi,
    /%2e%2e%2f/gi,
    /%2e%2e%5c/gi,
    
    // NEW: Command injection
    /\|\s*nc\s+/gi,
    /\|\s*netcat\s+/gi,
    /\|\s*bash/gi,
    /\|\s*sh/gi,
    /\|\s*powershell/gi,
    
    // NEW: SQL injection patterns
    /(\bunion\b.*\bselect\b)|(\bselect\b.*\bunion\b)/gi,
    /(\bor\b.*1\s*=\s*1\b)|(\band\b.*1\s*=\s*1\b)/gi,
    
    // NEW: File inclusion patterns
    /php:\/\/filter/gi,
    /data:text\/html/gi,
    /file:\/\/\//gi,
    
    // NEW: ZIP bomb detection
    /PK\x03\x04/gi, // ZIP file signature
    /\x50\x4b\x03\x04/gi, // ZIP file signature (hex)
    
    // NEW: Polyglot detection
    /<\?php/gi, // PHP code
    /<\?=/gi,   // PHP short echo
];
```

#### Step 2: Enhanced Binary Content Detection
```typescript
// Improve detectBinaryContent method:
private detectBinaryContent(fileBuffer: Buffer): number {
    let binaryCount = 0;
    
    for (let i = 0; i < fileBuffer.length; i++) {
        const byte = fileBuffer[i];
        
        // Count null bytes (highly suspicious)
        if (byte === 0) {
            binaryCount += 10; // Higher weight for null bytes
        }
        // Count non-printable characters
        else if (byte < 32 || byte > 126) {
            if (byte !== 9 && byte !== 10 && byte !== 13) { // Allow tabs, newlines
                binaryCount += 2;
            }
        }
    }
    
    // Consider files with >5% binary content suspicious
    // Files with >20% binary content are likely malicious
    const binaryRatio = binaryCount / fileBuffer.length;
    
    return binaryRatio;
}
```

#### Step 3: Enhanced MIME Type Validation
```typescript
// Update validateMimeType method:
private validateMimeType(mimeType?: string): { isValid: boolean; error?: ValidationError } {
    if (!mimeType) {
        return {
            isValid: false,
            error: {
                code: 'MIME_TYPE_MISSING',
                message: 'MIME type could not be determined',
            },
        };
    }

    const isAllowed = this.config.allowedMimeTypes.includes(mimeType);
    
    // Additional checks for suspicious MIME types
    const suspiciousMimeTypes = [
        'application/zip',
        'application/x-executable',
        'application/octet-stream'
    ];
    
    if (suspiciousMimeTypes.includes(mimeType)) {
        return {
            isValid: false,
            error: {
                code: 'SUSPICIOUS_MIME_TYPE',
                message: `Suspicious MIME type detected: ${mimeType}`,
            },
        };
    }

    if (!isAllowed) {
        return {
            isValid: false,
            error: {
                code: 'MIME_TYPE_NOT_ALLOWED',
                message: `MIME type '${mimeType}' is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(', ')}`,
            },
        };
    }

    return { isValid: true };
}
```

**Success Criteria**:
- ✅ ZIP bombs detected
- ✅ Polyglot files blocked
- ✅ Malicious MIME types rejected
- ✅ All security tests pass

---

### Critical Fix #3: File Sanitization Bypass (Priority 1 - Critical)

**Problem**: Malicious content not removed from sanitized files
**Files Affected**: 
- `packages/batch-backend/src/infrastructure/file-sanitization-service.ts`
- `packages/batch-backend/tests/infrastructure.file-sanitization-service.test.ts`

**Technical Solution**:

#### Step 1: Enhanced Content Sanitization
```typescript
// Update maliciousContentPatterns array:
private maliciousContentPatterns = [
    // Script tags
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    /<script[^>]*>[\s\S]*$/gim,
    
    // External links in markdown
    /\[.*?\]\(\s*javascript:.*?\)/gi,
    /\[.*?\]\(\s*data:.*?\)/gi,
    /\[.*?\]\(\s*file:.*?\)/gi,
    /\[.*?\]\(\s*ftp:.*?\)/gi,
    
    // HTML tags in markdown (potential XSS)
    /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
    /<object[^>]*data\s*=\s*["'][^"']*["'][^>]*>/gi,
    /<embed[^>]*src\s*=\s*["'][^"']*["'][^>]*>/gi,
    /<link[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi,
    /<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url=([^"']*)["'][^>]*>/gi,
    
    // Form-related tags
    /<form[^>]*>[\s\S]*?<\/form>/gi,
    /<input[^>]*>/gi,
    /<textarea[^>]*>/gi,
    
    // Event handlers
    /\son\w+\s*=\s*["'][^"']*["']/gi,
    /\son\w+\s*=\s*[^\s>]+/gi,
];
```

#### Step 2: Improved Filename Sanitization
```typescript
// Update sanitizeFilename method:
private sanitizeFilename(filename: string): {
    sanitizedFilename: string;
    warnings: SanitizationWarning[];
} {
    const warnings: SanitizationWarning[] = [];
    let sanitized = filename;

    // Early return for empty filenames
    if (!filename || filename.trim() === '') {
        const generatedName = `file_${Date.now()}.md`;
        warnings.push({
            code: 'EMPTY_FILENAME_REPLACED',
            message: 'Empty filename replaced with generated name',
            severity: 'medium',
            field: 'filename',
        });
        return { sanitizedFilename: generatedName, warnings };
    }

    // CRITICAL: Remove dangerous characters completely
    const dangerousChars = sanitized.match(this.dangerousFilenameChars);
    if (dangerousChars) {
        warnings.push({
            code: 'DANGEROUS_CHARS_REMOVED',
            message: `Removed ${dangerousChars.length} dangerous characters from filename`,
            severity: 'medium',
            field: 'filename',
        });
        
        // Remove dangerous characters completely (replace with empty string)
        sanitized = sanitized.replace(this.dangerousFilenameChars, '');
    }
    
    // Additional security: Remove control characters
    const controlCharPattern = /[\x00-\x1f\x7f-\x9f]/g;
    const controlChars = sanitized.match(controlCharPattern);
    if (controlChars) {
        sanitized = sanitized.replace(controlCharPattern, '');
        warnings.push({
            code: 'CONTROL_CHARS_REMOVED',
            message: `Removed ${controlChars.length} control characters from filename`,
            severity: 'high',
            field: 'filename',
        });
    }

    // Path traversal prevention
    if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
        warnings.push({
            code: 'PATH_TRAVERSAL_DETECTED',
            message: 'Filename contains path traversal patterns',
            severity: 'high',
            field: 'filename',
        });
        
        // Extract basename only
        sanitized = sanitized.split(/[\/\\]/).pop() || 'unnamed';
    }

    return { sanitizedFilename: sanitized, warnings };
}
```

#### Step 3: Fix Test Expectations
Update test to expect proper sanitization:
```typescript
it('should remove dangerous characters from filenames', async () => {
    const result = await sanitizationService.sanitizeFile(
        Buffer.from('test content'),
        'file<>:|?*.md'
    );

    // Expect dangerous characters to be completely removed
    expect(result.sanitizedFilename).toBe('file.md'); // Changed from 'file______.md'
    expect(result.warnings.some(w => w.code === 'DANGEROUS_CHARS_REMOVED')).toBe(true);
});
```

**Success Criteria**:
- ✅ All malicious content removed
- ✅ Dangerous filenames completely sanitized
- ✅ All sanitization tests pass

---

### Phase 4: Implementation Timeline

#### Week 1: Critical Security Fixes
**Day 1-2**: Rate Limiting Implementation
- [ ] Implement rate limiting logic fixes
- [ ] Update test expectations
- [ ] Run rate limiting test suite
- [ ] Verify security improvements

**Day 3-4**: File Validation Security
- [ ] Implement enhanced malicious pattern detection
- [ ] Update binary content analysis
- [ ] Fix MIME type validation
- [ ] Run file validation test suite

**Day 5-7**: File Sanitization Bypass
- [ ] Implement enhanced content sanitization
- [ ] Fix filename sanitization edge cases
- [ ] Update sanitization tests
- [ ] Run comprehensive security tests

#### Week 2: High Priority Fixes
**Day 1-3**: Auth Service Token Validation
**Day 4-5**: HTTP Integration Response Schema
**Day 6-7**: Integration testing

#### Week 3: Medium Priority Fixes
**Day 1-5**: Test Mock Configuration
**Day 6-7**: Edge Case Handling

#### Week 4: Validation & Documentation
**Day 1-3**: Final regression testing
**Day 4-5**: Documentation updates
**Day 6-7**: Performance validation

## Quality Gates

### After Each Critical Fix:
1. **Security Validation**: Run specific security threat tests
2. **Regression Testing**: Ensure no existing functionality broken
3. **Performance Check**: Verify no performance degradation
4. **Documentation Update**: Update technical documentation

### Success Criteria per Fix:
- **Rate Limiting**: 100% pass rate on rate limiting tests
- **File Validation**: 100% pass rate on security tests
- **File Sanitization**: 100% pass rate on sanitization tests
- **Integration**: All cross-component tests pass

## Risk Mitigation

### Technical Risks:
- **New Vulnerabilities**: Security review after each fix
- **Performance Issues**: Performance testing after implementation
- **Test Coverage**: Maintain test coverage levels

### Timeline Risks:
- **Complexity Underestimation**: Add buffer time for complex fixes
- **Dependency Issues**: Analyze dependencies before starting fix
- **Regression**: Comprehensive testing after each fix

This execution plan provides the technical details needed to implement each critical fix systematically and safely.