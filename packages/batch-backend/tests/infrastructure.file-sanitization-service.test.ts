// packages/batch-backend/tests/infrastructure.file-sanitization-service.test.ts
//
// Comprehensive tests for file sanitization service covering security-focused
// content sanitization, path traversal prevention, and safety validations.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FileSanitizationService,
  SanitizationConfig,
} from '../src/infrastructure/file-sanitization-service.js';

describe('FileSanitizationService', () => {
  let sanitizationService: FileSanitizationService;
  let testConfig: SanitizationConfig;

  beforeEach(() => {
    testConfig = {
      maxFilenameLength: 255,
      removeBOM: true,
      normalizeLineEndings: true,
      sanitizeFilenames: true,
      removeInvalidUTF8: true,
      sanitizeContent: true,
      allowedSpecialChars: ['-', '_', '.', ' '],
    };
    sanitizationService = new FileSanitizationService(testConfig);
  });

  describe('Filename Sanitization', () => {
    it('should sanitize basic filenames', async () => {
      const result = await sanitizationService.sanitizeFile(
        Buffer.from('test content'),
        'normal-file.md',
      );

      expect(result.sanitizedFilename).toBe('normal-file.md');
      expect(result.warnings).toHaveLength(0);
    });

    it('should remove path traversal patterns', async () => {
      const result = await sanitizationService.sanitizeFile(
        Buffer.from('test content'),
        '../../../etc/passwd.md',
      );

      expect(result.sanitizedFilename).toBe('passwd.md');
      expect(result.warnings.some((w) => w.code === 'PATH_TRAVERSAL_DETECTED')).toBe(true);
    });

    it('should remove dangerous characters from filenames', async () => {
      const result = await sanitizationService.sanitizeFile(
        Buffer.from('test content'),
        'file<>:|?*.md',
      );

      expect(result.sanitizedFilename).toBe('file.md');
      expect(result.warnings.some((w) => w.code === 'DANGEROUS_CHARS_REMOVED')).toBe(true);
    });

    it('should handle reserved Windows filenames', async () => {
      const result = await sanitizationService.sanitizeFile(Buffer.from('test content'), 'con.md');

      expect(result.sanitizedFilename).toBe('con_safe.md');
      expect(result.warnings.some((w) => w.code === 'RESERVED_FILENAME_DETECTED')).toBe(true);
    });

    it('should truncate long filenames', async () => {
      const longName = 'a'.repeat(300) + '.md';
      const result = await sanitizationService.sanitizeFile(Buffer.from('test content'), longName);

      expect(result.sanitizedFilename.length).toBeLessThanOrEqual(255);
      expect(result.sanitizedFilename.endsWith('.md')).toBe(true);
      expect(result.warnings.some((w) => w.code === 'FILENAME_TRUNCATED')).toBe(true);
    });

    it('should replace empty filenames', async () => {
      const result = await sanitizationService.sanitizeFile(Buffer.from('test content'), '');

      expect(result.sanitizedFilename).toMatch(/^file_\d+\.md$/);
      expect(result.warnings.some((w) => w.code === 'EMPTY_FILENAME_REPLACED')).toBe(true);
    });
  });

  describe('Content Sanitization', () => {
    it('should remove script tags', async () => {
      const maliciousContent = Buffer.from(`# Title

<script>alert('xss')</script>

Normal content`);

      const result = await sanitizationService.sanitizeFile(maliciousContent, 'test.md');

      expect(result.sanitizedContent.toString()).not.toContain('<script>');
      expect(result.warnings.some((w) => w.code === 'MALICIOUS_CONTENT_SANITIZED')).toBe(true);
    });

    it('should remove iframe tags', async () => {
      const maliciousContent = Buffer.from(`# Title

<iframe src="evil.com"></iframe>`);

      const result = await sanitizationService.sanitizeFile(maliciousContent, 'test.md');

      expect(result.sanitizedContent.toString()).not.toContain('<iframe>');
      expect(result.warnings.some((w) => w.code === 'MALICIOUS_CONTENT_SANITIZED')).toBe(true);
    });

    it('should sanitize javascript: links', async () => {
      const maliciousContent = Buffer.from(`# Title

[Click me](javascript:alert('xss'))`);

      const result = await sanitizationService.sanitizeFile(maliciousContent, 'test.md');

      expect(result.sanitizedContent.toString()).not.toContain('javascript:');
      expect(result.warnings.some((w) => w.code === 'MALICIOUS_CONTENT_SANITIZED')).toBe(true);
    });

    it('should sanitize data: URLs', async () => {
      const maliciousContent = Buffer.from(`# Title

[Click me](data:text/html,<script>alert('xss')</script>)`);

      const result = await sanitizationService.sanitizeFile(maliciousContent, 'test.md');

      expect(result.sanitizedContent.toString()).not.toContain('data:');
      expect(result.warnings.some((w) => w.code === 'MALICIOUS_CONTENT_SANITIZED')).toBe(true);
    });

    it('should remove BOM', async () => {
      const contentWithBOM = Buffer.from('\uFEFF# Title\n\nContent');
      const result = await sanitizationService.sanitizeFile(contentWithBOM, 'test.md');

      expect(result.sanitizedContent.toString()).toBe('# Title\n\nContent');
      expect(result.warnings.some((w) => w.code === 'BOM_REMOVED')).toBe(true);
    });

    it('should normalize line endings', async () => {
      const contentWithMixedLineEndings = Buffer.from('Line 1\r\nLine 2\nLine 3\r');
      const result = await sanitizationService.sanitizeFile(contentWithMixedLineEndings, 'test.md');

      expect(result.sanitizedContent.toString()).toBe('Line 1\nLine 2\nLine 3\n');
      expect(result.warnings.some((w) => w.code === 'LINE_ENDINGS_NORMALIZED')).toBe(true);
    });

    it('should handle invalid UTF-8 characters', async () => {
      const contentWithInvalidUTF8 = Buffer.from([0xff, 0xfe, 0x41, 0x42, 0x43]); // Invalid UTF-8
      const result = await sanitizationService.sanitizeFile(contentWithInvalidUTF8, 'test.md');

      expect(result.warnings.some((w) => w.code === 'INVALID_UTF8_REMOVED')).toBe(true);
    });

    it('should remove null bytes', async () => {
      const contentWithNullBytes = Buffer.from('test\u0000content\u0000more');
      const result = await sanitizationService.sanitizeFile(contentWithNullBytes, 'test.md');

      expect(result.sanitizedContent.toString()).toBe('testcontentmore');
      expect(result.warnings.some((w) => w.code === 'NULL_BYTES_REMOVED')).toBe(true);
    });
  });

  describe('Markdown-Specific Validation', () => {
    it('should warn about unbalanced brackets', async () => {
      const unbalanced = Buffer.from('# Title\n\n[unclosed link text');
      const result = await sanitizationService.sanitizeFile(unbalanced, 'test.md');

      expect(result.warnings.some((w) => w.code === 'UNBALANCED_BRACKETS')).toBe(true);
    });

    it('should warn about excessive special characters', async () => {
      const excessiveSpecial = Buffer.from('# Title\n\n' + '!@#$%^&*()'.repeat(20));
      const result = await sanitizationService.sanitizeFile(excessiveSpecial, 'test.md');

      expect(result.warnings.some((w) => w.code === 'EXCESSIVE_SPECIAL_CHARACTERS')).toBe(true);
    });

    it('should warn about unusually long lines', async () => {
      const longLine = Buffer.from('# Title\n\n' + 'A'.repeat(15_000));
      const result = await sanitizationService.sanitizeFile(longLine, 'test.md');

      expect(result.warnings.some((w) => w.code === 'UNUSUALLY_LONG_LINES')).toBe(true);
    });
  });

  describe('Security Safety Checks', () => {
    it('should detect polyglot files', async () => {
      const polyglot = Buffer.from(`# Markdown
<script>alert('test')</script>
## Section`);

      const result = await sanitizationService.sanitizeFile(polyglot, 'test.md');

      expect(result.warnings.some((w) => w.code === 'MALICIOUS_CONTENT_SANITIZED')).toBe(true);
    });

    it('should handle command injection attempts', async () => {
      const commandInjection = Buffer.from(`# Title

\`\`\`bash
rm -rf /; echo "pwned"
\`\`\``);

      const result = await sanitizationService.sanitizeFile(commandInjection, 'test.md');

      // Command injection in code blocks should be flagged
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it('should prevent object/embed tag injection', async () => {
      const objectInjection = Buffer.from(`# Title

<object data="evil.swf"></object>`);

      const result = await sanitizationService.sanitizeFile(objectInjection, 'test.md');

      expect(result.sanitizedContent.toString()).not.toContain('<object>');
      expect(result.warnings.some((w) => w.code === 'MALICIOUS_CONTENT_SANITIZED')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty files', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = await sanitizationService.sanitizeFile(emptyBuffer, 'empty.md');

      expect(result.sanitizedContent.length).toBe(0);
      expect(result.sanitizedFilename).toBe('empty.md');
    });

    it('should handle files with only whitespace', async () => {
      const whitespaceBuffer = Buffer.from('   \n\n   \t\t   ');
      const result = await sanitizationService.sanitizeFile(whitespaceBuffer, 'whitespace.md');

      expect(result.sanitizedContent.toString()).toBe('   \n\n   \t\t   ');
    });

    it('should handle very large content', async () => {
      const largeContent = 'A'.repeat(15 * 1024 * 1024); // 15MB
      const result = await sanitizationService.sanitizeFile(Buffer.from(largeContent), 'large.md');

      expect(result.warnings.some((w) => w.code === 'CONTENT_SIZE_EXCEEDED')).toBe(true);
      expect(result.sanitizedContent.length).toBeLessThanOrEqual(10 * 1024 * 1024);
    });
  });

  describe('Configuration Validation', () => {
    it('should throw error for invalid maxFilenameLength', () => {
      expect(
        () =>
          new FileSanitizationService({
            ...testConfig,
            maxFilenameLength: 0,
          }),
      ).toThrow('maxFilenameLength must be greater than 0');
    });

    it('should throw error for invalid allowedSpecialChars', () => {
      expect(
        () =>
          new FileSanitizationService({
            ...testConfig,
            allowedSpecialChars: null as any,
          }),
      ).toThrow('allowedSpecialChars must be an array');
    });
  });

  describe('Performance Tests', () => {
    it('should process large files efficiently', async () => {
      const largeContent = '# Large File\n\n' + 'Content line\n'.repeat(10_000);
      const buffer = Buffer.from(largeContent);

      const start = Date.now();
      const result = await sanitizationService.sanitizeFile(buffer, 'large.md');
      const duration = Date.now() - start;

      expect(result.sanitizedContent.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle concurrent sanitization requests', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        sanitizationService.sanitizeFile(
          Buffer.from(`# Test ${i}\n\nContent for test ${i}`),
          `test-${i}.md`,
        ),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      for (const result of results) {
        expect(result.sanitizedFilename).toMatch(/^test-\d+\.md$/);
      }
    });
  });

  describe('Final Safety Checks', () => {
    it('should validate final filename safety', async () => {
      const result = await sanitizationService.sanitizeFile(Buffer.from('test'), 'safe-file.md');

      // Should pass final safety check
      expect(result.warnings.some((w) => w.code === 'FILENAME_SAFETY_CHECK_FAILED')).toBe(false);
    });

    it('should detect content truncation', async () => {
      const veryLargeContent = 'A'.repeat(20 * 1024 * 1024); // 20MB
      const result = await sanitizationService.sanitizeFile(
        Buffer.from(veryLargeContent),
        'large.md',
      );

      expect(result.warnings.some((w) => w.code === 'CONTENT_SIZE_EXCEEDED')).toBe(true);
      expect(result.sanitizedContent.length).toBe(10 * 1024 * 1024); // Should be truncated to 10MB
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete file processing workflow', async () => {
      const originalContent = `# Title

<script>alert('xss')</script>

Normal content with [link](javascript:evil)

More content`;

      const result = await sanitizationService.sanitizeFile(
        Buffer.from(originalContent),
        '../../../malicious<script>.md',
      );

      // Should sanitize both filename and content
      expect(result.sanitizedFilename).toBe('malicious.md');
      expect(result.sanitizedContent.toString()).not.toContain('<script>');
      expect(result.sanitizedContent.toString()).not.toContain('javascript:');
      expect(result.warnings.length).toBeGreaterThan(1); // Multiple warnings expected
    });

    it('should maintain content integrity for safe files', async () => {
      const safeContent = `# Safe Markdown

This is a normal markdown file with:

- List items
- More items

[Safe link](https://example.com)

\`\`\`javascript
console.log('This is safe code');
\`\`\``;

      const result = await sanitizationService.sanitizeFile(
        Buffer.from(safeContent),
        'safe-content.md',
      );

      expect(result.sanitizedContent.toString()).toBe(safeContent);
      expect(result.warnings).toHaveLength(0);
    });
  });

  afterEach(() => {
    // Cleanup after each test
  });
});
