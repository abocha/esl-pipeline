// packages/batch-backend/src/infrastructure/file-sanitization-service.ts
//
// File sanitization service providing security-focused file processing.
// Sanitizes content, prevents path traversal attacks, and ensures safe filename handling.

import { logger } from './logger';

export interface SanitizationConfig {
  maxFilenameLength: number;
  removeBOM: boolean;
  normalizeLineEndings: boolean;
  sanitizeFilenames: boolean;
  removeInvalidUTF8: boolean;
  sanitizeContent: boolean;
  allowedSpecialChars: string[];
}

export interface SanitizationResult {
  originalFilename: string;
  sanitizedFilename: string;
  originalContent: Buffer;
  sanitizedContent: Buffer;
  warnings: SanitizationWarning[];
}

export interface SanitizationWarning {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  field?: string;
}

export class FileSanitizationError extends Error {
  constructor(
    message: string,
    public code: string,
    public field?: string
  ) {
    super(message);
    this.name = 'FileSanitizationError';
  }
}

export class FileSanitizationService {
  private config: SanitizationConfig;
  
  // Dangerous characters that should be removed or replaced
  private dangerousFilenameChars = /[<>:"/\\|?*]/g;
  
  // Control characters range
  private controlCharacterRanges = [
    { from: 0, to: 31 },   // \x00-\x1f
    { from: 127, to: 159 } // \x7f-\x9f
  ];
  
  // Invalid filename patterns (reserved names on Windows)
  private reservedFilenames = [
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
  ];

  // Content sanitization patterns
  private maliciousContentPatterns = [
    // Script tags
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    // External links in markdown
    /\[.*?\]\(\s*javascript:.*?\)/gi,
    /\[.*?\]\(\s*data:.*?\)/gi,
    /\[.*?\]\(\s*file:.*?\)/gi,
    // HTML tags in markdown (potential XSS)
    /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
    /<object[^>]*data\s*=\s*["'][^"']*["'][^>]*>/gi,
    /<embed[^>]*src\s*=\s*["'][^"']*["'][^>]*>/gi,
    // Meta refresh redirects
    /<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url=([^"']*)["'][^>]*>/gi,
  ];

  constructor(config: SanitizationConfig) {
    this.config = config;
    this.validateConfig();
  }

  private validateConfig(): void {
    if (this.config.maxFilenameLength <= 0) {
      throw new Error('maxFilenameLength must be greater than 0');
    }
    if (!Array.isArray(this.config.allowedSpecialChars)) {
      throw new Error('allowedSpecialChars must be an array');
    }
  }

  /**
   * Main sanitization method - processes file buffer and filename
   */
  async sanitizeFile(
    fileBuffer: Buffer, 
    originalFilename: string
  ): Promise<SanitizationResult> {
    const warnings: SanitizationWarning[] = [];
    
    // 1. Sanitize filename
    const filenameSanitization = this.sanitizeFilename(originalFilename);
    const sanitizedFilename = filenameSanitization.sanitizedFilename;
    
    if (filenameSanitization.warnings.length > 0) {
      warnings.push(...filenameSanitization.warnings);
    }

    // 2. Sanitize content
    const contentSanitization = this.sanitizeContent(fileBuffer);
    const sanitizedContent = contentSanitization.sanitizedContent;
    
    if (contentSanitization.warnings.length > 0) {
      warnings.push(...contentSanitization.warnings);
    }

    // 3. Apply additional sanitization steps
    const finalSanitization = this.applyFinalSanitization(sanitizedContent, sanitizedFilename);
    
    if (finalSanitization.warnings.length > 0) {
      warnings.push(...finalSanitization.warnings);
    }

    logger.info('File sanitization completed', {
      event: 'file_sanitized',
      originalFilename,
      sanitizedFilename,
      originalSize: fileBuffer.length,
      sanitizedSize: finalSanitization.sanitizedContent.length,
      warningsCount: warnings.length,
    });

    return {
      originalFilename,
      sanitizedFilename,
      originalContent: fileBuffer,
      sanitizedContent: finalSanitization.sanitizedContent,
      warnings,
    };
  }

  /**
   * Sanitizes filename to prevent path traversal and ensure safe naming
   */
  private sanitizeFilename(filename: string): {
    sanitizedFilename: string;
    warnings: SanitizationWarning[];
  } {
    const warnings: SanitizationWarning[] = [];
    
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

    let sanitized = filename;

    // Check for path traversal attempts
    if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
      warnings.push({
        code: 'PATH_TRAVERSAL_DETECTED',
        message: 'Filename contains path traversal patterns',
        severity: 'high',
        field: 'filename',
      });
      
      // Remove path components and keep only the basename
      sanitized = sanitized.split(/[\/\\]/).pop() || 'unnamed';
    }

    // Check for HTML-like content in filenames and remove it completely
    const htmlContentMatch = sanitized.match(/<[^>]*>/g);
    if (htmlContentMatch) {
      warnings.push({
        code: 'DANGEROUS_CHARS_REMOVED',
        message: `Removed ${htmlContentMatch.length} HTML content from filename`,
        severity: 'medium',
        field: 'filename',
      });
      
      // Remove entire HTML tags, not just angle brackets
      sanitized = sanitized.replace(/<[^>]*>/g, '');
    }

    // Remove remaining dangerous characters (for any that weren't part of HTML tags)
    const dangerousChars = sanitized.match(/[<>:"/\\|?*]/g);
    if (dangerousChars) {
      warnings.push({
        code: 'DANGEROUS_CHARS_REMOVED',
        message: `Removed ${dangerousChars.length} dangerous characters from filename`,
        severity: 'medium',
        field: 'filename',
      });
      
      // Remove ALL dangerous characters completely (including < and >)
      sanitized = sanitized.replace(/[<>:"/\\|?*]/g, '');
    }

    // Check reserved filenames
    const nameWithoutExtension = sanitized.replace(/\.[^/.]+$/, '').toLowerCase();
    if (this.reservedFilenames.includes(nameWithoutExtension)) {
      warnings.push({
        code: 'RESERVED_FILENAME_DETECTED',
        message: `Filename '${nameWithoutExtension}' is a reserved name`,
        severity: 'high',
        field: 'filename',
      });

      // Replace extension correctly for reserved filenames
      const extension = sanitized.match(/\.[^/.]+$/) || '';
      const baseName = sanitized.replace(/\.[^/.]+$/, '');
      sanitized = `${baseName}_safe${extension}`;
    }

    // Enforce filename length limits
    if (sanitized.length > this.config.maxFilenameLength) {
      const originalLength = sanitized.length;
      const extension = sanitized.match(/\.[^/.]+$/);
      const extensionPart = extension ? extension[0] : '';
      const nameWithoutExt = sanitized.replace(/\.[^/.]+$/, '');
      
      const maxNameLength = this.config.maxFilenameLength - extensionPart.length;
      sanitized = nameWithoutExt.substring(0, Math.max(0, maxNameLength)) + extensionPart;
      
      warnings.push({
        code: 'FILENAME_TRUNCATED',
        message: `Filename truncated from ${originalLength} to ${sanitized.length} characters`,
        severity: 'low',
        field: 'filename',
      });
    }

    // Ensure filename is not empty after sanitization
    if (!sanitized || sanitized.trim() === '') {
      sanitized = `file_${Date.now()}.md`;
      warnings.push({
        code: 'EMPTY_FILENAME_REPLACED',
        message: 'Empty filename replaced with generated name',
        severity: 'medium',
        field: 'filename',
      });
    }

    // This logic is now handled above in the early return

    // Sanitize special characters according to config - but don't double-process
    if (this.config.sanitizeFilenames) {
      // Check for any remaining special characters that weren't caught by dangerous char removal
      const remainingSpecialChars = sanitized.match(/[^\w\s.-]/g);
      if (remainingSpecialChars) {
        warnings.push({
          code: 'SPECIAL_CHARS_SANITIZED',
          message: `Sanitized ${remainingSpecialChars.length} additional special characters from filename`,
          severity: 'low',
          field: 'filename',
        });
        
        sanitized = sanitized.replace(/[^\w\s.-]/g, '_');
      }
    }

    return { sanitizedFilename: sanitized, warnings };
  }

  /**
   * Sanitizes file content for security and integrity
   */
  private sanitizeContent(fileBuffer: Buffer): {
    sanitizedContent: Buffer;
    warnings: SanitizationWarning[];
  } {
    const warnings: SanitizationWarning[] = [];
    let content = fileBuffer.toString('utf8');

    // Remove BOM if configured
    if (this.config.removeBOM && content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
      warnings.push({
        code: 'BOM_REMOVED',
        message: 'Byte Order Mark (BOM) removed from content',
        severity: 'low',
        field: 'content',
      });
    }

    // Remove invalid UTF-8 characters
    if (this.config.removeInvalidUTF8) {
      const originalLength = content.length;
      
      // Check the original fileBuffer for invalid UTF-8, not the string
      const hasInvalidUTF8 = this.containsInvalidUTF8Buffer(fileBuffer);
      
      if (hasInvalidUTF8) {
        content = this.removeInvalidUTF8(content);
        
        warnings.push({
          code: 'INVALID_UTF8_REMOVED',
          message: `Removed invalid UTF-8 characters from content`,
          severity: 'medium',
          field: 'content',
        });
      }
    }

    // Normalize line endings
    if (this.config.normalizeLineEndings) {
      const originalContent = content;
      content = this.normalizeLineEndings(content);
      if (content !== originalContent) {
        warnings.push({
          code: 'LINE_ENDINGS_NORMALIZED',
          message: 'Line endings normalized to Unix format',
          severity: 'low',
          field: 'content',
        });
      }
    }

    // Sanitize malicious content patterns
    if (this.config.sanitizeContent) {
      const sanitizationResult = this.sanitizeMaliciousContent(content);
      if (sanitizationResult.modifications > 0) {
        warnings.push({
          code: 'MALICIOUS_CONTENT_SANITIZED',
          message: `Removed ${sanitizationResult.modifications} potentially malicious content patterns`,
          severity: 'high',
          field: 'content',
        });
        content = sanitizationResult.content;
      }
    }

    // Markdown-specific validation checks
    this.addMarkdownValidationWarnings(content, warnings);

    return {
      sanitizedContent: Buffer.from(content, 'utf8'),
      warnings,
    };
  }

  /**
   * Removes invalid UTF-8 characters from string
   */
  private removeInvalidUTF8(content: string): string {
    try {
      // Use TextDecoder with fatal mode to detect invalid UTF-8
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(content, 'utf8'));
      // If we get here, content is valid UTF-8
      return content;
    } catch {
      // Content contains invalid UTF-8, use lenient decoding
      const decoder = new TextDecoder('utf-8', { fatal: false });
      return decoder.decode(Buffer.from(content, 'utf8'));
    }
  }

  /**
   * Checks if buffer contains invalid UTF-8 characters
   */
  private containsInvalidUTF8Buffer(buffer: Buffer): boolean {
    try {
      // Try to decode with fatal mode
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      return false; // Valid UTF-8
    } catch {
      return true; // Invalid UTF-8 detected
    }
  }

  /**
   * Checks if content contains invalid UTF-8 characters
   */
  private containsInvalidUTF8(content: string): boolean {
    try {
      // Try to decode with fatal mode
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(content, 'utf8'));
      return false; // Valid UTF-8
    } catch {
      return true; // Invalid UTF-8 detected
    }
  }

  /**
   * Normalizes line endings to Unix format (LF)
   */
  private normalizeLineEndings(content: string): string {
    return content
      .replace(/\r\n/g, '\n') // Windows CRLF to LF
      .replace(/\r/g, '\n');   // Mac CR to LF
  }

  /**
   * Sanitizes malicious content patterns
   */
  private sanitizeMaliciousContent(content: string): {
    content: string;
    modifications: number;
  } {
    let modifications = 0;
    let sanitized = content;

    // Apply each sanitization pattern
    for (const pattern of this.maliciousContentPatterns) {
      const matches = sanitized.match(pattern);
      if (matches) {
        modifications += matches.length;
        
        // Replace with safe alternatives
        if (pattern.toString().includes('javascript:') || pattern.toString().includes('data:')) {
          // Replace dangerous links with their text content
          sanitized = sanitized.replace(pattern, (match, url) => {
            const linkText = match.match(/\[(.*?)\]/)?.[1] || 'Link';
            return `[${linkText}]`;
          });
        } else {
          // Remove potentially dangerous HTML tags
          sanitized = sanitized.replace(pattern, '[Sanitized Content]');
        }
      }
    }

    return { content: sanitized, modifications };
  }

  /**
   * Adds Markdown-specific validation warnings
   */
  private addMarkdownValidationWarnings(content: string, warnings: SanitizationWarning[]): void {
    // Check for unbalanced brackets
    const openBrackets = (content.match(/\[/g) || []).length;
    const closeBrackets = (content.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      warnings.push({
        code: 'UNBALANCED_BRACKETS',
        message: 'Unbalanced square brackets detected in markdown',
        severity: 'medium',
        field: 'content',
      });
    }

    // Check for excessive special characters
    const specialChars = (content.match(/[!@#$%^&*()]/g) || []).length;
    if (specialChars > 100) {
      warnings.push({
        code: 'EXCESSIVE_SPECIAL_CHARACTERS',
        message: `Found ${specialChars} special characters - may indicate malicious content`,
        severity: 'medium',
        field: 'content',
      });
    }

    // Check for unusually long lines
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.length > 10000) {
        warnings.push({
          code: 'UNUSUALLY_LONG_LINES',
          message: 'Found line longer than 10,000 characters',
          severity: 'low',
          field: 'content',
        });
        break;
      }
    }
  }

  /**
   * Applies final sanitization steps after content processing
   */
  private applyFinalSanitization(
    sanitizedContent: Buffer,
    sanitizedFilename: string
  ): {
    sanitizedContent: Buffer;
    warnings: SanitizationWarning[];
  } {
    const warnings: SanitizationWarning[] = [];
    let content = sanitizedContent.toString('utf8');
    let buffer = sanitizedContent;

    // Check for null bytes in content
    if (buffer.includes(0)) {
      const nullByteCount = this.countNullBytes(buffer);
      warnings.push({
        code: 'NULL_BYTES_REMOVED',
        message: `Removed ${nullByteCount} null bytes from content`,
        severity: 'high',
        field: 'content',
      });
      
      // Create new buffer without null bytes
      const cleanBytes: number[] = [];
      for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i]!; // Use non-null assertion since buffer[i] should always return a number
        if (byte !== 0) {
          cleanBytes.push(byte);
        }
      }
      buffer = Buffer.from(cleanBytes);
      content = buffer.toString('utf8');
    }

    // Ensure content doesn't exceed reasonable limits
    const maxContentSize = 10 * 1024 * 1024; // 10MB
    if (buffer.length > maxContentSize) {
      warnings.push({
        code: 'CONTENT_SIZE_EXCEEDED',
        message: `Content size (${this.formatBytes(buffer.length)}) exceeds reasonable limits`,
        severity: 'medium',
        field: 'content',
      });
      
      // Truncate content to prevent DoS
      buffer = buffer.subarray(0, maxContentSize);
    }

    // Validate final filename safety
    if (!this.isSafeFilename(sanitizedFilename)) {
      warnings.push({
        code: 'FILENAME_SAFETY_CHECK_FAILED',
        message: 'Final filename safety check failed',
        severity: 'high',
        field: 'filename',
      });
    }

    return {
      sanitizedContent: buffer,
      warnings,
    };
  }

  /**
   * Counts null bytes in buffer
   */
  private countNullBytes(buffer: Buffer): number {
    let count = 0;
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) count++;
    }
    return count;
  }

  /**
   * Checks if filename is safe for use
   */
  private isSafeFilename(filename: string): boolean {
    // Check length
    if (filename.length === 0 || filename.length > this.config.maxFilenameLength) {
      return false;
    }

    // Check for dangerous characters
    if (this.dangerousFilenameChars.test(filename)) {
      return false;
    }

    // Check for path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return false;
    }

    // Check reserved names
    const nameWithoutExtension = filename.replace(/\.[^/.]+$/, '').toLowerCase();
    if (this.reservedFilenames.includes(nameWithoutExtension)) {
      return false;
    }

    // Check for null bytes
    if (filename.includes('\x00')) {
      return false;
    }

    return true;
  }

  /**
   * Formats bytes in human-readable format
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

/**
 * Factory function to create a default file sanitization service
 */
export function createFileSanitizationService(): FileSanitizationService {
  const config: SanitizationConfig = {
    maxFilenameLength: 255,
    removeBOM: true,
    normalizeLineEndings: true,
    sanitizeFilenames: true,
    removeInvalidUTF8: true,
    sanitizeContent: true,
    allowedSpecialChars: ['-', '_', '.', ' '],
  };

  return new FileSanitizationService(config);
}

/**
 * Factory function to create a custom file sanitization service
 */
export function createCustomFileSanitizationService(config: SanitizationConfig): FileSanitizationService {
  return new FileSanitizationService(config);
}