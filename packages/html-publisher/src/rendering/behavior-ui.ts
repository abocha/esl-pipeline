import type { ResolvedFeatures } from './options.js';

export function buildUiBehaviorScript(features: ResolvedFeatures): string {
  const copyCode = features.copyCode ? 'true' : 'false';

  return `  const copyCode = ${copyCode};

  if (copyCode) {
    const codeBlocks = document.querySelectorAll('pre > code');
    codeBlocks.forEach((codeElement) => {
      const pre = codeElement.parentElement;
      if (!(pre instanceof HTMLElement)) {
        return;
      }
      if (pre.querySelector('.copy-code-button')) {
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code-button';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        const content = codeElement.textContent ?? '';
        if (!content) {
          return;
        }

        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(content);
          } else {
            const area = document.createElement('textarea');
            area.value = content;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.focus();
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
          }
          const previousLabel = button.textContent;
          button.textContent = 'Copied';
          window.setTimeout(() => {
            button.textContent = previousLabel ?? 'Copy';
          }, 1400);
        } catch {
          button.textContent = 'Failed';
          window.setTimeout(() => {
            button.textContent = 'Copy';
          }, 1400);
        }
      });

      pre.appendChild(button);
    });
  }

  const backToTop = document.querySelector('.back-to-top');
  if (backToTop instanceof HTMLElement) {
    const showThreshold = 300;
    let ticking = false;

    const updateVisibility = () => {
      if (window.scrollY > showThreshold) {
        backToTop.classList.add('visible');
      } else {
        backToTop.classList.remove('visible');
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateVisibility);
        ticking = true;
      }
    }, { passive: true });

    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Keep native details content rendered until the closing transition completes.
  document.querySelectorAll('details').forEach((details) => {
    const summary = details.querySelector(':scope > summary');
    const content = details.querySelector(':scope > .content');
    if (!(summary instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      return;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let expanded = details.open;
    let cancelPendingClose = null;

    const openDetails = () => {
      expanded = true;
      cancelPendingClose?.();
      cancelPendingClose = null;
      details.open = true;
      details.classList.remove('is-open');
      if (!reduceMotion) {
        content.getBoundingClientRect();
      }
      details.classList.add('is-open');
    };

    const closeDetails = () => {
      expanded = false;
      details.classList.remove('is-open');
      if (reduceMotion) {
        details.open = false;
        return;
      }

      const finishClose = () => {
        if (!expanded) {
          details.open = false;
        }
        cancelPendingClose?.();
        cancelPendingClose = null;
      };
      const handleTransitionEnd = (event) => {
        if (event.target === content && event.propertyName === 'grid-template-rows') {
          finishClose();
        }
      };
      const closeTimeout = window.setTimeout(finishClose, 360);
      content.addEventListener('transitionend', handleTransitionEnd);
      cancelPendingClose = () => {
        window.clearTimeout(closeTimeout);
        content.removeEventListener('transitionend', handleTransitionEnd);
      };
    };

    if (details.open) {
      details.classList.add('is-open');
    }

    summary.addEventListener('click', (event) => {
      event.preventDefault();
      if (expanded) {
        closeDetails();
      } else {
        openDetails();
      }
    });
  });

  const updateEditorialRail = () => {
    const page = document.querySelector('.page');
    const header = page?.querySelector(':scope > .page-header');
    if (!(page instanceof HTMLElement) || !(header instanceof HTMLElement)) {
      return;
    }

    const pageRect = page.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const nextStart = Math.max(120, Math.round(headerRect.bottom - pageRect.top + 18));
    page.style.setProperty('--editorial-rail-start', String(nextStart) + 'px');
  };

  let railTicking = false;
  const scheduleEditorialRailUpdate = () => {
    if (railTicking) return;
    railTicking = true;
    requestAnimationFrame(() => {
      updateEditorialRail();
      railTicking = false;
    });
  };

  scheduleEditorialRailUpdate();
  window.addEventListener('resize', scheduleEditorialRailUpdate, { passive: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      scheduleEditorialRailUpdate();
    }).catch(() => {});
  }

  try {
    const lockLeadingParentheticalPair = (value) =>
      String(value || '').replace(/^(\\(\\s*\\S+)\\s+(\\S+)/, '$1\\u00A0$2');

    const lockTrailingShortLeadPhrase = (value) =>
      String(value || '').replace(
        /\\b(the|a|an|or|to|of|in|on|at|for|with)\\s+(\\S+)\\s+(\\S+)(\\s*)$/i,
        '$1\\u00A0$2\\u00A0$3$4',
      );

    const lockCommonAffixNotation = (value) =>
      String(value || '').replace(/(^|\\s)-(?=(er|est|ly|y)\\b)/gi, '$1\\u2011');

    const lockSlashSeparatedPhrase = (value) =>
      String(value || '').replace(/(\\S+)\\s*\\/\\s*(\\S+)/g, '$1\\u00A0/\\u00A0$2');

    const widontText = (value) => String(value || '').replace(/(\\S+)\\s+(\\S+)(\\s*)$/, '$1\\u00A0$2$3');

    const collectTextNodes = (root) => {
      if (!(root instanceof HTMLElement)) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      let current = walker.nextNode();
      while (current) {
        if ((current.textContent || '').trim()) {
          textNodes.push(current);
        }
        current = walker.nextNode();
      }
      return textNodes;
    };

    const findLeadingTextNode = (root) => {
      const textNodes = collectTextNodes(root);
      return textNodes?.[0] ?? null;
    };

    const findTerminalTextNode = (root) => {
      const textNodes = collectTextNodes(root) ?? [];
      for (let index = textNodes.length - 1; index >= 0; index -= 1) {
        const candidate = textNodes[index];
        if (candidate && /\\S+\\s+\\S+/.test(candidate.textContent || '')) {
          return candidate;
        }
      }
      return textNodes.at(-1) ?? null;
    };

    const lockTrailingMarker = (node) => {
      const textNodes = collectTextNodes(node) ?? [];
      if (textNodes.length < 2) return;

      const trailingTextNode = textNodes.at(-1);
      const rawTrailingText = trailingTextNode?.textContent || '';
      const trailingMarker = rawTrailingText.trim();
      if (!trailingMarker || trailingMarker.length > 4 || /[\\p{L}\\p{N}]/u.test(trailingMarker)) {
        return;
      }

      trailingTextNode.textContent = '\\u00A0' + trailingMarker;
    };

    const applyWidont = (node, { lockLeadingPair = false } = {}) => {
      if (!(node instanceof HTMLElement)) return;

      if (lockLeadingPair) {
        const leadingTextNode = findLeadingTextNode(node);
        if (leadingTextNode) {
          const lockedLeading = lockLeadingParentheticalPair(leadingTextNode.textContent || '');
          if (lockedLeading && lockedLeading !== leadingTextNode.textContent) {
            leadingTextNode.textContent = lockedLeading;
          }
        }
      }

      const terminalTextNode = findTerminalTextNode(node);
      if (!terminalTextNode) return;

      const updated = widontText(
        lockTrailingShortLeadPhrase(
          lockSlashSeparatedPhrase(lockCommonAffixNotation(terminalTextNode.textContent || '')),
        ),
      );
      if (updated && updated !== terminalTextNode.textContent) {
        terminalTextNode.textContent = updated;
      }

      lockTrailingMarker(node);
    };

    const grammarWidontTargets = document.querySelectorAll(
      '.column-list.grammar-matrix-grid .column > .grammar-card-heading, ' +
        '.column-list.grammar-matrix-grid .column > .grammar-card-subheading, ' +
        '.column-list.grammar-matrix-grid .column > p[data-grammar-prose="true"], ' +
        '.column-list.grammar-matrix-grid .column li',
    );
    grammarWidontTargets.forEach((element) => applyWidont(element));

    const grammarQuestionEmphasis = document.querySelectorAll(
      '.column-list.grammar-matrix-grid .column > p[data-grammar-emphasis-only="true"] > em:only-child',
    );
    grammarQuestionEmphasis.forEach((element) => applyWidont(element, { lockLeadingPair: true }));

    const grammarInlineNotes = document.querySelectorAll(
      '.column-list.grammar-matrix-grid .column li > em',
    );
    grammarInlineNotes.forEach((element) => applyWidont(element, { lockLeadingPair: true }));
  } catch {}

  const readStoredTheme = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const persistTheme = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  };

  try {
    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle instanceof HTMLElement) {
      const html = document.documentElement;
      const storageKey = 'theme-preference';
      const mediaQuery =
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-color-scheme: dark)')
          : null;

      const getPreference = () => {
        const stored = readStoredTheme(storageKey);
        if (stored === 'dark' || stored === 'light') {
          return stored;
        }
        return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
      };

      const setTheme = (theme) => {
        html.setAttribute('data-theme', theme);
        persistTheme(storageKey, theme);
      };

      setTheme(getPreference());

      themeToggle.addEventListener('click', () => {
        const current = html.getAttribute('data-theme') || getPreference();
        setTheme(current === 'dark' ? 'light' : 'dark');
      });

      if (mediaQuery) {
        const handlePreferenceChange = (event) => {
          if (readStoredTheme(storageKey) === null) {
            setTheme(event.matches ? 'dark' : 'light');
          }
        };
        if (typeof mediaQuery.addEventListener === 'function') {
          mediaQuery.addEventListener('change', handlePreferenceChange);
        } else if (typeof mediaQuery.addListener === 'function') {
          mediaQuery.addListener(handlePreferenceChange);
        }
      }
    }
  } catch {};
`;
}
