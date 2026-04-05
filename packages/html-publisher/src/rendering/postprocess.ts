import { sanitizeMediaUrl } from './safety.js';
import { escapeHtml, escapeHtmlAttribute, stripHtml } from './shared.js';

function normalizeHeadingText(headingHtml: string): string {
  return stripHtml(headingHtml)
    .replaceAll(/&(?:amp|#38|#x26);/gi, '&')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function appendClassToHtmlAttributes(attributes: string, className: string): string {
  if (!attributes || attributes.trim().length === 0) {
    return ` class="${className}"`;
  }

  const classAttrRegex = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;
  const classAttrMatch = classAttrRegex.exec(attributes);
  if (!classAttrMatch) {
    return `${attributes} class="${className}"`;
  }

  const existingClassValue = classAttrMatch[2] ?? classAttrMatch[3] ?? '';
  const classes = new Set(existingClassValue.split(/\s+/).filter(Boolean));
  classes.add(className);
  const updatedClassAttr = `class="${[...classes].join(' ')}"`;
  return attributes.replace(classAttrRegex, updatedClassAttr);
}

function normalizeInlineHtmlSpacing(content: string): string {
  return String(content || '')
    .replaceAll(/<br\s*\/?>/gi, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim();
}

function splitStackedGrammarParagraphs(columnInner: string): string {
  return columnInner.replaceAll(
    /<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
    (fullMatch, rawAttrs: string, rawContent: string) => {
      const content = String(rawContent || '');
      if (!/<br\s*\/?>/i.test(content)) {
        return fullMatch;
      }

      const attrs = rawAttrs || '';
      const segments = content
        .split(/<br\s*\/?>/gi)
        .map((segment) => normalizeInlineHtmlSpacing(segment))
        .filter((segment) => segment.length > 0);

      if (segments.length < 2) {
        return fullMatch;
      }

      return segments.map((segment) => `<p${attrs}>${segment}</p>`).join('');
    },
  );
}

function mergeFragmentedRuleParagraphs(columnInner: string): string {
  return columnInner.replaceAll(
    /<p\b([^>]*)>\s*<strong>\s*Rule:\s*<\/strong>\s*<\/p>\s*((?:<p\b[^>]*>[\s\S]*?<\/p>\s*){1,6})/gi,
    (_fullMatch, ruleAttrs: string, followingParagraphs: string) => {
      const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>\s*/gi;
      const ruleSegments: string[] = [];
      let boundary = 0;
      let paragraphMatch = paragraphRegex.exec(followingParagraphs);

      while (paragraphMatch) {
        const normalizedSegment = normalizeInlineHtmlSpacing(String(paragraphMatch[1] || ''));
        const plainText = stripHtml(normalizedSegment).replaceAll(/\s+/g, ' ').trim();
        boundary = paragraphRegex.lastIndex;
        if (!plainText) {
          paragraphMatch = paragraphRegex.exec(followingParagraphs);
          continue;
        }

        ruleSegments.push(normalizedSegment);
        if (/[.!?](?:["')\]]+)?$/.test(plainText) || ruleSegments.length >= 4) {
          break;
        }
        paragraphMatch = paragraphRegex.exec(followingParagraphs);
      }

      if (ruleSegments.length === 0) {
        return `<p${ruleAttrs}><strong>Rule:</strong></p>${followingParagraphs}`;
      }

      const mergedRuleHtml = normalizeInlineHtmlSpacing(
        `<strong>Rule:</strong> ${ruleSegments.join(' ')}`,
      ).replaceAll(/\s+([,.;!?])/g, '$1');
      const remainder = followingParagraphs.slice(boundary);
      return `<p${ruleAttrs}>${mergedRuleHtml}</p>${remainder}`;
    },
  );
}

function mergeStandaloneGrammarEmphasisParagraphs(columnInner: string): string {
  const hasSentenceEnding = (value: string): boolean =>
    /[.!?:](?:["')\]]+)?$/.test(stripHtml(value).replaceAll(/\s+/g, ' ').trim());

  const isStandaloneInlineEmphasis = (value: string): boolean => {
    const content = String(value || '').trim();
    if (!/^\s*<em\b[\s\S]*<\/em>\s*$/i.test(content)) {
      return false;
    }
    const plainText = stripHtml(content).replaceAll(/\s+/g, ' ').trim();
    if (!plainText) {
      return false;
    }
    return !/^\(.*\)$/.test(plainText);
  };

  let normalized = String(columnInner || '');

  normalized = normalized.replaceAll(
    /<p\b([^>]*)>([\s\S]*?)<\/p>\s*<p\b([^>]*)>\s*(<em\b[\s\S]*?<\/em>)\s*<\/p>\s*<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
    (
      fullMatch,
      prevAttrs: string,
      prevContent: string,
      _emAttrs: string,
      emphasisHtml: string,
      nextAttrs: string,
      nextContent: string,
    ) => {
      if (!isStandaloneInlineEmphasis(emphasisHtml)) {
        return fullMatch;
      }
      if (hasSentenceEnding(prevContent)) {
        return fullMatch;
      }

      const mergedContent = normalizeInlineHtmlSpacing(
        `${prevContent} ${emphasisHtml} ${nextContent}`,
      );
      return `<p${prevAttrs || nextAttrs}>${mergedContent}</p>`;
    },
  );

  normalized = normalized.replaceAll(
    /<p\b([^>]*)>\s*(<em\b[\s\S]*?<\/em>)\s*<\/p>\s*<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
    (
      fullMatch,
      emphasisAttrs: string,
      emphasisHtml: string,
      nextAttrs: string,
      nextContent: string,
    ) => {
      if (!isStandaloneInlineEmphasis(emphasisHtml)) {
        return fullMatch;
      }

      const mergedContent = normalizeInlineHtmlSpacing(`${emphasisHtml} ${nextContent}`);
      return `<p${nextAttrs || emphasisAttrs}>${mergedContent}</p>`;
    },
  );

  return normalized;
}

function markFirstGrammarHeading(columnInner: string): string {
  const headingMatch = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/i.exec(columnInner);
  const paragraphMatch = /<p\b([^>]*)>([\s\S]*?)<\/p>/i.exec(columnInner);

  const headingIndex = headingMatch
    ? (headingMatch.index ?? Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const paragraphIndex = paragraphMatch
    ? (paragraphMatch.index ?? Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(headingIndex) && !Number.isFinite(paragraphIndex)) {
    return columnInner;
  }

  if (headingIndex <= paragraphIndex && headingMatch?.[0]) {
    const fullMatch = headingMatch[0];
    const level = headingMatch[1];
    const attrs = headingMatch[2] || '';
    const content = headingMatch[3] || '';
    const replacement = `<h${level}${appendClassToHtmlAttributes(attrs, 'grammar-card-heading')}>${content}</h${level}>`;
    return `${columnInner.slice(0, headingIndex)}${replacement}${columnInner.slice(headingIndex + fullMatch.length)}`;
  }

  if (!paragraphMatch?.[0]) {
    return columnInner;
  }

  const fullMatch = paragraphMatch[0];
  const attrs = paragraphMatch[1] || '';
  const content = paragraphMatch[2] || '';
  const replacement = `<p${appendClassToHtmlAttributes(attrs, 'grammar-card-heading')}>${content}</p>`;
  return `${columnInner.slice(0, paragraphIndex)}${replacement}${columnInner.slice(paragraphIndex + fullMatch.length)}`;
}

function markGrammarSubheadings(columnInner: string): string {
  return columnInner.replaceAll(
    /<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
    (fullMatch, rawAttrs: string, rawContent: string) => {
      const attrs = String(rawAttrs || '').replaceAll(/\sdata-grammar-prose="true"/gi, '');
      if (/\bgrammar-card-heading\b|\bgrammar-card-subheading\b/i.test(attrs)) {
        return fullMatch;
      }

      const content = String(rawContent || '');
      const plainText = stripHtml(content).replaceAll(/\s+/g, ' ').trim();
      if (!plainText) {
        return fullMatch;
      }

      const wordCount = plainText.split(' ').filter(Boolean).length;
      const isRuleParagraph = /^rule:/i.test(plainText);
      const isEmphasisOnly = /^\s*<em\b[\s\S]*<\/em>\s*$/i.test(content);
      const hasStrongLead = /<strong\b/i.test(content);
      const endsLikeHeading = /[:!?]$/.test(plainText);
      const hasInstructionDash = plainText.includes('—') || plainText.includes('->');
      const isShortHeadingLike =
        !isRuleParagraph &&
        !isEmphasisOnly &&
        wordCount > 0 &&
        wordCount <= 18 &&
        (hasStrongLead || endsLikeHeading || hasInstructionDash);

      if (!isShortHeadingLike) {
        return fullMatch;
      }

      return `<p${appendClassToHtmlAttributes(attrs, 'grammar-card-subheading')}>${content}</p>`;
    },
  );
}

function promoteFirstTableRowToHeaderCells(sectionHtml: string): string {
  return sectionHtml.replace(/<table\b[^>]*>[\s\S]*?<\/table>/i, (tableHtml) => {
    if (/<th\b/i.test(tableHtml)) {
      return tableHtml;
    }

    return tableHtml.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/i, (rowHtml) => {
      if (!/<td\b/i.test(rowHtml)) {
        return rowHtml;
      }
      return rowHtml
        .replaceAll(/<td(\s[^>]*)?>/gi, (_fullCell, attrs = '') => {
          if (/\bscope\s*=/.test(attrs)) {
            return `<th${attrs}>`;
          }
          return `<th${attrs} scope="col">`;
        })
        .replaceAll(/<\/td>/gi, '</th>');
    });
  });
}

function wrapTables(html: string): string {
  return html.replaceAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => {
    if (/<div class="table-scroll">\s*<table\b/i.test(tableHtml)) {
      return tableHtml;
    }
    return `<div class="table-scroll">${tableHtml}</div>`;
  });
}

const USEFUL_CHUNKS_HEADING = 'useful chunks & vocabulary';
const NOTICE_THE_GRAMMAR_HEADING = 'notice the grammar';

function replaceColumnMarkers(html: string): string {
  return html
    .replaceAll('<!--COLUMN_LIST_START-->', '<div class="column-list">')
    .replaceAll('<!--COLUMN_LIST_END-->', '</div>')
    .replaceAll('<!--COLUMN_START-->', '<div class="column">')
    .replaceAll('<!--COLUMN_END-->', '</div>');
}

function wrapTableOfContents(html: string): string {
  return html.replaceAll(
    /<(nav|div)\s+class="table-of-contents"[\s\S]*?<\/\1>/gi,
    (tocHtml) =>
      `<details class="toc-shell"><summary>Contents</summary><div class="content"><div class="content-inner">${tocHtml}</div></div></details>`,
  );
}

function renderAudioPlaceholder(): string {
  return `<div class="audio-placeholder">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
<span>Audio track generating...</span>
</div>`;
}

function renderAudioFigure(url: string, fallbackLabel = 'Open audio in a new tab'): string {
  const safeUrl = sanitizeMediaUrl(url);
  if (!safeUrl) {
    return renderAudioPlaceholder();
  }

  const escapedUrl = escapeHtmlAttribute(safeUrl);
  return `<figure class="audio-figure"><audio controls preload="metadata" src="${escapedUrl}"></audio><figcaption><a data-audio-fallback="true" href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(fallbackLabel)}</a></figcaption></figure>`;
}

export function decorateAudioPlayers(html: string): string {
  return html.replaceAll(
    /<audio\s+controls(?:\s+preload="metadata")?\s+src=("|')([^"']+)\1\s*><\/audio>/gi,
    (_full, _quote, rawUrl) => renderAudioFigure(rawUrl),
  );
}

export function replaceAudioLinks(html: string): string {
  return html.replaceAll(
    /<a\b([^>]*)href=("|')([^"']+\.(?:mp3|wav|m4a|aac|ogg|opus)(?:\?[^"']*)?(?:#[^"']*)?)\2([^>]*)>([\s\S]*?)<\/a>/gi,
    (fullMatch, before, _quote, url, after, labelHtml) => {
      const attrs = `${before ?? ''}${after ?? ''}`;
      if (attrs.toLowerCase().includes('data-audio-fallback')) {
        return fullMatch;
      }
      const label = stripHtml(labelHtml).trim() || 'Open audio in a new tab';
      return renderAudioFigure(url, label);
    },
  );
}

function promoteUsefulChunksTableHeader(html: string): string {
  return html.replaceAll(
    /(<h([1-6])\b[^>]*>[\s\S]*?<\/h\2>)([\s\S]*?)(?=<h[1-6]\b[^>]*>|$)/gi,
    (fullSection, headingHtml, _headingLevel, sectionHtml) => {
      const normalizedHeading = normalizeHeadingText(headingHtml);
      if (!normalizedHeading.includes(USEFUL_CHUNKS_HEADING)) {
        return fullSection;
      }
      return `${headingHtml}${promoteFirstTableRowToHeaderCells(sectionHtml)}`;
    },
  );
}

function decorateNoticeGrammarColumns(html: string): string {
  return html.replaceAll(
    /(<h([1-6])\b[^>]*>[\s\S]*?<\/h\2>)([\s\S]*?)(?=<h[1-6]\b[^>]*>|$)/gi,
    (fullSection, headingHtml, _headingLevel, sectionHtml) => {
      const normalizedHeading = normalizeHeadingText(headingHtml);
      if (!normalizedHeading.includes(NOTICE_THE_GRAMMAR_HEADING)) {
        return fullSection;
      }

      const withScopedGrid = sectionHtml.replace(
        /<div class="column-list">/,
        '<div class="column-list grammar-matrix-grid">',
      );
      const decoratedSection = normalizeGrammarMatrixColumnMarkup(withScopedGrid);
      return `${headingHtml}${decoratedSection}`;
    },
  );
}

function normalizeGrammarMatrixColumnMarkup(sectionHtml: string): string {
  return sectionHtml.replaceAll(
    /<div class="column">([\s\S]*?)<\/div>/gi,
    (_columnHtml, columnInner) => {
      let normalizedInner = String(columnInner || '')
        .replaceAll(/<hr\s*\/?>/gi, '')
        .trim();
      normalizedInner = splitStackedGrammarParagraphs(normalizedInner);
      normalizedInner = mergeFragmentedRuleParagraphs(normalizedInner);
      normalizedInner = mergeStandaloneGrammarEmphasisParagraphs(normalizedInner);
      normalizedInner = normalizedInner.replaceAll(
        /<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
        (_paragraphHtml, rawAttrs: string, rawContent: string) => {
          const attrs = rawAttrs || '';
          const normalizedContent = normalizeInlineHtmlSpacing(String(rawContent || ''));
          const plainText = normalizedContent
            .replaceAll(/<[^>]+>/g, ' ')
            .replaceAll(/\s+/g, ' ')
            .trim();
          const wordCount = plainText.length > 0 ? plainText.split(' ').filter(Boolean).length : 0;
          const isRuleParagraph = /^rule:/i.test(plainText);
          const isEmphasisOnlyParagraph = /^\s*<em\b[^>]*>[\s\S]*<\/em>\s*$/i.test(
            normalizedContent,
          );
          const useProseAlignment = !isRuleParagraph && wordCount >= 12;
          const proseAttribute = useProseAlignment ? ' data-grammar-prose="true"' : '';
          const emphasisOnlyAttribute = isEmphasisOnlyParagraph
            ? ' data-grammar-emphasis-only="true"'
            : '';
          return `<p${attrs}${proseAttribute}${emphasisOnlyAttribute}>${normalizedContent}</p>`;
        },
      );
      normalizedInner = markFirstGrammarHeading(normalizedInner);
      normalizedInner = markGrammarSubheadings(normalizedInner);
      return `<div class="column">${normalizedInner}</div>`;
    },
  );
}

export {
  decorateNoticeGrammarColumns,
  promoteUsefulChunksTableHeader,
  replaceColumnMarkers,
  wrapTableOfContents,
  wrapTables,
};
