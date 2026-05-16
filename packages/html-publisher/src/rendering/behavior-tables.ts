export function buildTableBehaviorScript(): string {
  return `  try {
    const TABLE_SAMPLE_ROW_LIMIT = 24;
    const TABLE_TIGHT_WIDTH_RESERVE_PX = 1;
    let tableBalanceTimer = 0;
    let tableBalanceFrame = 0;

    const isDesktopViewport = () => {
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia('(min-width: 841px)').matches;
      }
      return window.innerWidth >= 841;
    };

    const getDirectColgroup = (table) =>
      Array.from(table.children).find((child) => child.tagName === 'COLGROUP') ?? null;

    const removeGeneratedColgroup = (table) => {
      const existingColgroup = getDirectColgroup(table);
      if (
        existingColgroup instanceof HTMLElement &&
        existingColgroup.getAttribute('data-generated-colgroup') === 'true'
      ) {
        existingColgroup.remove();
      }
      table.removeAttribute('data-balanced-columns');
    };

    const normalizeCellText = (cell) => (cell.textContent || '').replace(/\\s+/g, ' ').trim();
    const normalizeLabel = (value) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();

    const quantile = (values, q) => {
      if (!values.length) {
        return 0;
      }
      const sorted = [...values].sort((left, right) => left - right);
      const rawIndex = (sorted.length - 1) * q;
      const lower = Math.floor(rawIndex);
      const upper = Math.ceil(rawIndex);
      if (lower === upper) {
        return sorted[lower] ?? 0;
      }
      const lowerValue = sorted[lower] ?? 0;
      const upperValue = sorted[upper] ?? 0;
      return lowerValue + (upperValue - lowerValue) * (rawIndex - lower);
    };

    const isSparseLikeCell = (text) => {
      if (!text) {
        return true;
      }
      const compact = text.replace(/\\s+/g, '');
      if (!compact) {
        return true;
      }
      if (compact.length <= 2) {
        return true;
      }
      const hasAlphaNumeric = /[a-z0-9]/i.test(compact);
      if (!hasAlphaNumeric && compact.length <= 6) {
        return true;
      }
      const tokens = text.split(/\\s+/).filter(Boolean);
      return tokens.length <= 1 && compact.length <= 4;
    };

    const getHeaderRole = (headerText) => {
      const normalized = normalizeLabel(headerText);
      if (
        normalized.includes('structural formula') ||
        normalized.includes('formula') ||
        normalized.includes('pattern') ||
        normalized.includes('structure')
      ) {
        return 'formula';
      }
      if (normalized.includes('emoji') || normalized.includes('icon') || normalized.includes('status')) {
        return 'emoji';
      }
      if (
        normalized.includes('meaning') ||
        normalized.includes('gloss') ||
        normalized.includes('definition') ||
        normalized.includes('real english meaning') ||
        normalized.includes('context')
      ) {
        return 'meaning';
      }
      if (normalized.includes('example') || normalized.includes('sample') || normalized.includes('from text')) {
        return 'example';
      }
      if (
        normalized.includes('expression') ||
        normalized.includes('term') ||
        normalized.includes('phrase') ||
        normalized.includes('word') ||
        normalized.includes('chunk') ||
        normalized.includes('vocabulary')
      ) {
        return 'expression';
      }
      return 'unknown';
    };

    const roleBounds = (role) => {
      if (role === 'meaning') return { min: 30, max: 62, base: 42 };
      if (role === 'example') return { min: 18, max: 40, base: 28 };
      if (role === 'formula') return { min: 14, max: 26, base: 18 };
      if (role === 'emoji') return { min: 6, max: 12, base: 8 };
      if (role === 'expression') return { min: 18, max: 38, base: 24 };
      return { min: 12, max: 42, base: 22 };
    };

    const detectFallbackRole = (column) => {
      const sparseRatio = column.nonEmpty > 0 ? column.emojiLikeCount / column.nonEmpty : 0;
      if (sparseRatio >= 0.75 && column.p75 <= 8) {
        return 'emoji';
      }
      if (column.breakCount >= 2 || column.p75 >= 68) {
        return 'meaning';
      }
      if (column.symbolicRatio >= 0.35 && column.averageWords <= 5 && column.p75 <= 28) {
        return 'formula';
      }
      if (column.averageWords >= 6 || column.p75 >= 40) {
        return 'example';
      }
      if (column.p75 <= 24) {
        return 'expression';
      }
      return 'unknown';
    };

    const classifyArchetype = (columns) => {
      const roles = columns.map((column) => column.role);
      const meaningColumn = columns.find((column) => column.role === 'meaning');
      if (columns.length === 2 && roles.includes('expression') && roles.includes('meaning')) {
        return 'glossary_2col';
      }
      if (columns.length === 3 && roles.includes('expression') && roles.includes('meaning') && roles.includes('example')) {
        if ((meaningColumn?.breakCount ?? 0) > 0 || (meaningColumn?.p75 ?? 0) >= 70) {
          return 'long_meaning_3col';
        }
        return 'vocab_3col';
      }
      if (
        columns.length === 4 &&
        roles.includes('expression') &&
        roles.includes('meaning') &&
        roles.includes('formula') &&
        roles.includes('example')
      ) {
        return 'instructional_4col';
      }
      if (columns.length === 4 && roles.includes('emoji')) {
        return 'emoji_split_4col';
      }
      return 'mixed_fallback';
    };

    const computeBoundedPercentages = (weights, minBounds, maxBounds) => {
      const totalColumns = weights.length;
      if (totalColumns === 0) {
        return [];
      }

      const mins = [...minBounds];
      const maxes = [...maxBounds];
      const sum = (values) => values.reduce((acc, value) => acc + value, 0);
      const minTotal = sum(mins);
      if (minTotal > 100) {
        const shrink = 100 / minTotal;
        for (let index = 0; index < mins.length; index += 1) {
          mins[index] *= shrink;
        }
      }

      const maxTotal = sum(maxes);
      if (maxTotal < 100) {
        const growth = 100 / maxTotal;
        for (let index = 0; index < maxes.length; index += 1) {
          maxes[index] *= growth;
        }
      }

      const result = new Array(totalColumns).fill(0);
      const active = new Set(Array.from({ length: totalColumns }, (_, index) => index));
      let remainingPercent = 100;
      let remainingWeight = weights.reduce((acc, value) => acc + value, 0);
      let guard = 0;

      while (active.size > 0 && guard < totalColumns * 2) {
        guard += 1;
        let changed = false;
        for (const index of [...active]) {
          const share =
            remainingWeight > 0
              ? (remainingPercent * weights[index]) / remainingWeight
              : remainingPercent / active.size;
          if (share < mins[index]) {
            result[index] = mins[index];
            remainingPercent -= result[index];
            remainingWeight -= weights[index];
            active.delete(index);
            changed = true;
            continue;
          }
          if (share > maxes[index]) {
            result[index] = maxes[index];
            remainingPercent -= result[index];
            remainingWeight -= weights[index];
            active.delete(index);
            changed = true;
          }
        }
        if (!changed) {
          break;
        }
      }

      if (active.size > 0) {
        const activeIndices = [...active];
        const activeWeight = activeIndices.reduce((acc, index) => acc + weights[index], 0);
        for (const index of activeIndices) {
          result[index] =
            activeWeight > 0
              ? (remainingPercent * weights[index]) / activeWeight
              : remainingPercent / activeIndices.length;
        }
      }

      const rounded = result.map((value) => Number(value.toFixed(2)));
      const roundedTotal = rounded.reduce((acc, value) => acc + value, 0);
      const delta = Number((100 - roundedTotal).toFixed(2));
      if (delta !== 0 && rounded.length > 0) {
        let targetIndex = 0;
        for (let index = 1; index < rounded.length; index += 1) {
          if (rounded[index] > rounded[targetIndex]) {
            targetIndex = index;
          }
        }
        rounded[targetIndex] = Number((rounded[targetIndex] + delta).toFixed(2));
      }
      return rounded;
    };

    const analyzeTableColumns = (table) => {
      const rows = Array.from(table.querySelectorAll('tr')).slice(0, TABLE_SAMPLE_ROW_LIMIT);
      if (rows.length === 0) {
        return null;
      }

      const columnCount = rows.reduce((maxColumns, row) => {
        const cells = row.querySelectorAll('th, td');
        return Math.max(maxColumns, cells.length);
      }, 0);
      if (columnCount <= 1) {
        return null;
      }

      const columns = Array.from({ length: columnCount }, () => ({
        header: '',
        nonEmpty: 0,
        emojiLikeCount: 0,
        lengths: [],
        breakCount: 0,
        maxChars: 0,
        longestToken: 0,
        totalWords: 0,
        symbolicSamples: 0,
        role: 'unknown',
        p75: 0,
        averageWords: 0,
        symbolicRatio: 0,
      }));

      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        cells.forEach((cell, cellIndex) => {
          const column = columns[cellIndex];
          if (!column) {
            return;
          }
          const text = normalizeCellText(cell);
          const chars = text.length;
          const words = text ? text.split(/\\s+/).filter(Boolean).length : 0;
          const breakCount = cell.querySelectorAll('br').length;
          const compact = text.replace(/\\s+/g, '');
          const symbolMatches = compact.match(/[=+\\/→:()\\[\\]-]/g) ?? [];
          if (rowIndex === 0 && (cell.tagName === 'TH' || !column.header)) {
            column.header = text;
          }
          if (chars > 0) {
            column.nonEmpty += 1;
            column.lengths.push(chars);
            column.totalWords += words;
          }
          column.breakCount += breakCount;
          column.maxChars = Math.max(column.maxChars, chars);
          column.longestToken = Math.max(
            column.longestToken,
            ...text.split(/\\s+/).filter(Boolean).map((token) => token.length),
            0,
          );
          if (isSparseLikeCell(text)) {
            column.emojiLikeCount += 1;
          }
          if (compact && symbolMatches.length / Math.max(compact.length, 1) >= 0.12) {
            column.symbolicSamples += 1;
          }
        });
      });

      columns.forEach((column) => {
        column.p75 = quantile(column.lengths, 0.75);
        column.averageWords = column.nonEmpty > 0 ? column.totalWords / column.nonEmpty : 0;
        column.symbolicRatio = column.nonEmpty > 0 ? column.symbolicSamples / column.nonEmpty : 0;
        column.role = getHeaderRole(column.header);
      });
      columns.forEach((column) => {
        if (column.role === 'unknown') {
          column.role = detectFallbackRole(column);
        }
      });

      return {
        columnCount,
        columns,
        archetype: classifyArchetype(columns),
      };
    };

    const getArchetypeTargets = (analysis) => {
      const { columns, archetype } = analysis;
      if (archetype === 'glossary_2col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 28 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.16));
          if (column.role === 'meaning') return 72 + Math.min(6, Math.max(0, (column.p75 - 56) * 0.08));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'vocab_3col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 26 + Math.min(4, Math.max(0, (column.p75 - 20) * 0.1));
          if (column.role === 'meaning') return 44 + Math.min(8, Math.max(0, (column.p75 - 42) * 0.14)) + column.breakCount * 1.4;
          if (column.role === 'example') return 30 + Math.min(5, Math.max(0, (column.p75 - 34) * 0.09));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'long_meaning_3col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 24 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.08));
          if (column.role === 'meaning') return 49 + Math.min(10, Math.max(0, (column.p75 - 48) * 0.16)) + column.breakCount * 2.2;
          if (column.role === 'example') return 27 + Math.min(4, Math.max(0, (column.p75 - 30) * 0.08));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'instructional_4col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 20 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.08));
          if (column.role === 'meaning') return 35 + Math.min(8, Math.max(0, (column.p75 - 42) * 0.12)) + column.breakCount * 1.4;
          if (column.role === 'formula') return 17 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.12));
          if (column.role === 'example') return 28 + Math.min(7, Math.max(0, (column.p75 - 32) * 0.12));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'emoji_split_4col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 22 + Math.min(3, Math.max(0, (column.p75 - 18) * 0.08));
          if (column.role === 'meaning') return 40 + Math.min(9, Math.max(0, (column.p75 - 40) * 0.14));
          if (column.role === 'example') return 30 + Math.min(6, Math.max(0, (column.p75 - 30) * 0.1));
          if (column.role === 'emoji') return 8;
          return roleBounds(column.role).base;
        });
      }

      return columns.map((column) => {
        let contribution = Math.min(column.p75, 140) + Math.min(column.averageWords * 6, 24);
        if (column.breakCount > 0) {
          contribution += 10;
        }
        if (column.role === 'meaning') {
          contribution += 12;
        }
        if (column.role === 'formula') {
          contribution -= 6;
        }
        return Math.max(contribution, 1);
      });
    };

    const computeColumnWidths = (table) => {
      const analysis = analyzeTableColumns(table);
      if (!analysis) {
        return null;
      }

      const mins = analysis.columns.map((column) => roleBounds(column.role).min);
      const maxes = analysis.columns.map((column) => roleBounds(column.role).max);
      const targets = getArchetypeTargets(analysis);

      analysis.columns.forEach((column, index) => {
        const sparseRatio = column.nonEmpty > 0 ? column.emojiLikeCount / column.nonEmpty : 0;
        if (analysis.archetype === 'emoji_split_4col' && column.role === 'emoji') {
          maxes[index] = Math.min(maxes[index], 10);
        }
        if (analysis.archetype === 'instructional_4col' && column.role === 'formula') {
          maxes[index] = Math.min(maxes[index], 22);
        }
        if (analysis.archetype === 'glossary_2col' && column.role === 'meaning') {
          mins[index] = Math.max(mins[index], 58);
        }
        if (sparseRatio >= 0.75 && column.maxChars <= 8) {
          maxes[index] = Math.min(maxes[index], Math.max(mins[index] + 2, 12));
        }
      });

      return {
        archetype: analysis.archetype,
        columns: analysis.columns,
        widths: computeBoundedPercentages(targets, mins, maxes),
      };
    };

    const measureIntrinsicColumnWidths = (table) => {
      const parentWidth = table.parentElement?.clientWidth ?? 0;
      if (parentWidth <= 0) {
        return null;
      }

      const clone = table.cloneNode(true);
      if (!(clone instanceof HTMLTableElement)) {
        return null;
      }

      removeGeneratedColgroup(clone);
      clone.removeAttribute('data-balanced-columns');
      clone.removeAttribute('data-tight-columns');
      clone.style.position = 'absolute';
      clone.style.left = '-99999px';
      clone.style.top = '0';
      clone.style.visibility = 'hidden';
      clone.style.width = 'max-content';
      clone.style.maxWidth = 'none';
      clone.style.tableLayout = 'auto';

      const cloneCells = clone.querySelectorAll('th, td');
      cloneCells.forEach((cell) => {
        if (!(cell instanceof HTMLElement)) return;
        cell.style.whiteSpace = 'nowrap';
        cell.style.width = 'auto';
      });

      document.body.appendChild(clone);

      try {
        const rows = Array.from(clone.querySelectorAll('tr'));
        const columnCount = rows.reduce((maxColumns, row) => {
          const cells = row.querySelectorAll('th, td');
          return Math.max(maxColumns, cells.length);
        }, 0);
        if (columnCount <= 1) {
          return null;
        }

        const widths = new Array(columnCount).fill(0);
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll('th, td'));
          cells.forEach((cell, index) => {
            if (!(cell instanceof HTMLElement)) return;
            const rect = cell.getBoundingClientRect();
            widths[index] = Math.max(widths[index], Math.ceil(rect.width));
          });
        });

        const total = Math.ceil(clone.getBoundingClientRect().width);
        if (total <= 0) {
          return null;
        }

        return { widths, total, parentWidth };
      } finally {
        clone.remove();
      }
    };

    const computeRenderedPixelWidths = (table, result) => {
      const intrinsic = measureIntrinsicColumnWidths(table);
      const parentWidth = intrinsic?.parentWidth ?? table.parentElement?.clientWidth ?? 0;
      if (parentWidth <= 0) {
        return null;
      }
      const availableWidth = Math.max(parentWidth - TABLE_TIGHT_WIDTH_RESERVE_PX, 1);

      const plannedWidths = result.widths.map((width) => (availableWidth * width) / 100);
      if (!intrinsic) {
        return {
          widths: plannedWidths,
          totalWidth: availableWidth,
          tight: false,
        };
      }

      const widths = [...plannedWidths];
      const cappedIndices = [];
      let cappedTotal = 0;

      for (let index = 0; index < widths.length; index += 1) {
        const intrinsicWidth = intrinsic.widths[index] ?? plannedWidths[index] ?? 0;
        const plannedWidth = plannedWidths[index] ?? 0;
        if (intrinsicWidth + 4 < plannedWidth) {
          widths[index] = intrinsicWidth;
          cappedIndices.push(index);
          cappedTotal += intrinsicWidth;
        }
      }

      if (cappedIndices.length === 0) {
        return {
          widths: plannedWidths,
          totalWidth: parentWidth,
          tight: false,
        };
      }

      const uncappedIndices = widths
        .map((_, index) => index)
        .filter((index) => !cappedIndices.includes(index));
      if (uncappedIndices.length === 0) {
        return {
          widths,
          totalWidth: cappedTotal,
          tight: true,
        };
      }

      const remainingWidth = Math.max(availableWidth - cappedTotal, 0);
      const uncappedWeight = uncappedIndices.reduce(
        (sum, index) => sum + (result.widths[index] ?? 0),
        0,
      );
      uncappedIndices.forEach((index) => {
        widths[index] =
          uncappedWeight > 0
            ? (remainingWidth * (result.widths[index] ?? 0)) / uncappedWeight
            : remainingWidth / uncappedIndices.length;
      });

      return {
        widths,
        totalWidth: widths.reduce((sum, width) => sum + width, 0),
        tight: true,
      };
    };

    const annotateTable = (table, columns, archetype) => {
      table.setAttribute('data-table-archetype', archetype);
      const rows = Array.from(table.querySelectorAll('tr'));
      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        cells.forEach((cell, cellIndex) => {
          const column = columns[cellIndex];
          if (!column) {
            return;
          }
          cell.setAttribute('data-col-role', column.role);
          const text = normalizeCellText(cell);
          const words = text ? text.split(/\\s+/).filter(Boolean).length : 0;
          const proseLike =
            (column.role === 'meaning' || column.role === 'example') &&
            !isSparseLikeCell(text) &&
            (text.length >= 42 || words >= 6 || cell.querySelector('br') !== null);
          cell.setAttribute('data-cell-prose', proseLike ? 'true' : 'false');
          if (rowIndex === 0 && cell.tagName === 'TH') {
            cell.setAttribute('scope', 'col');
          }
        });
      });
    };

    const balanceTableColumns = () => {
      const tables = document.querySelectorAll('.markdown-body table');
      tables.forEach((table) => {
        if (!(table instanceof HTMLTableElement)) {
          return;
        }

        const existingColgroup = getDirectColgroup(table);
        const result = computeColumnWidths(table);
        if (!result) {
          removeGeneratedColgroup(table);
          table.removeAttribute('data-table-archetype');
          return;
        }
        annotateTable(table, result.columns, result.archetype);

        if (
          existingColgroup instanceof HTMLElement &&
          existingColgroup.getAttribute('data-generated-colgroup') !== 'true'
        ) {
          table.removeAttribute('data-balanced-columns');
          return;
        }

        if (!isDesktopViewport()) {
          removeGeneratedColgroup(table);
          table.removeAttribute('data-tight-columns');
          table.style.removeProperty('width');
          table.style.removeProperty('max-width');
          return;
        }

        removeGeneratedColgroup(table);

        const generatedColgroup = document.createElement('colgroup');
        generatedColgroup.setAttribute('data-generated-colgroup', 'true');
        const renderedWidths = computeRenderedPixelWidths(table, result);
        const widths = renderedWidths?.widths ?? [];
        widths.forEach((width) => {
          const col = document.createElement('col');
          col.style.width = String(Math.max(width, 1)) + 'px';
          generatedColgroup.appendChild(col);
        });

        table.insertBefore(generatedColgroup, table.firstChild);
        table.setAttribute('data-balanced-columns', 'true');
        if (renderedWidths?.tight) {
          table.setAttribute('data-tight-columns', 'true');
          table.style.width = String(Math.ceil(renderedWidths.totalWidth)) + 'px';
          table.style.maxWidth = '100%';
        } else {
          table.removeAttribute('data-tight-columns');
          table.style.width = '100%';
          table.style.removeProperty('max-width');
        }
      });
    };

    const scheduleTableBalancing = () => {
      if (tableBalanceTimer) {
        window.clearTimeout(tableBalanceTimer);
      }
      if (tableBalanceFrame) {
        window.cancelAnimationFrame(tableBalanceFrame);
      }
      tableBalanceTimer = window.setTimeout(() => {
        tableBalanceFrame = window.requestAnimationFrame(() => {
          balanceTableColumns();
          tableBalanceFrame = 0;
        });
      }, 140);
    };

    balanceTableColumns();
    window.addEventListener('resize', scheduleTableBalancing, { passive: true });
  } catch {}
`;
}
