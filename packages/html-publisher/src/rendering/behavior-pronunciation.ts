export function buildPronunciationBehaviorScript(): string {
  return `  try {
    const audioPayloadNode = document.getElementById('esl-pronunciation-audio');
    let pronunciationAudio = null;
    if (audioPayloadNode instanceof HTMLScriptElement && audioPayloadNode.textContent) {
      try {
        pronunciationAudio = JSON.parse(audioPayloadNode.textContent);
      } catch {
        pronunciationAudio = null;
      }
    }
    const normalizeText = (value) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();

    const headingCandidates = Array.from(document.querySelectorAll('.markdown-body h3'));
    const pronunciationHeading = headingCandidates.find((heading) => {
      const normalized = normalizeText(heading.textContent || '');
      return (
        normalized.includes('pronunciation') &&
        normalized.includes('micro') &&
        normalized.includes('focus')
      );
    });

    if (pronunciationHeading instanceof HTMLElement) {
      const sectionElements = [];
      let cursor = pronunciationHeading.nextElementSibling;
      while (cursor) {
        if (cursor.matches('h2, h3')) {
          break;
        }
        sectionElements.push(cursor);
        cursor = cursor.nextElementSibling;
      }

      const sectionText = sectionElements
        .map((element) => element.textContent || '')
        .join('\\n');
      const modeMatch = /\\bmode\\s*:\\s*([a-z_]+)\\b/i.exec(sectionText);
      let pronunciationMode = '';
      if (modeMatch && modeMatch[1]) {
        pronunciationMode = String(modeMatch[1]).trim().toLowerCase();
      }
      const wordDrillModes = new Set(['shadow_sentence', 'intonation', 'rhythm_chunking', 'sentence_stress', 'minimal_pair']);
      const wordDrillEnabled = wordDrillModes.has(pronunciationMode);
      const connectedSpeechEnabled = pronunciationMode === 'connected_speech';

      if (wordDrillEnabled || connectedSpeechEnabled) {
        const hasSentenceAnchorLabel = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rawText = String(element.textContent || '')
            .replace(/\\s+/g, ' ')
            .trim();
          return /(^|\\b)(shadow sentence|natural sentence practice)\\s*:/i.test(rawText);
        };

        const findFirstMatchingDescendant = (root, selector) => {
          if (!(root instanceof HTMLElement)) return null;
          const candidates = Array.from(root.querySelectorAll(selector));
          return candidates.find((candidate) => hasSentenceAnchorLabel(candidate)) || null;
        };

        const applySentenceAnchorTone = (element) => {
          if (!(element instanceof HTMLElement)) return null;
          element.classList.add('pronunciation-sentence-anchor');
          const labelTexts = Array.from(element.querySelectorAll('strong, b'))
            .map((label) => String(label.textContent || '').trim());
          const hasShadowLabel = labelTexts.some((text) => /^shadow sentence:?$/i.test(text));
          const hasNaturalLabel = labelTexts.some((text) =>
            /^natural sentence practice:?$/i.test(text),
          );
          const normalizedText = String(element.textContent || '')
            .replace(/\\s+/g, ' ')
            .trim();
          if (hasShadowLabel || /(^|\\b)shadow sentence\\s*:/i.test(normalizedText)) {
            element.classList.add('pronunciation-shadow-sentence');
          } else if (
            hasNaturalLabel ||
            /(^|\\b)natural sentence practice\\s*:/i.test(normalizedText)
          ) {
            element.classList.add('pronunciation-natural-sentence');
          } else {
            element.classList.add('pronunciation-natural-sentence');
          }
          return element;
        };

        const isEmptyPronunciationSpacer = (node) => {
          if (!(node instanceof HTMLParagraphElement)) return false;
          if (node.children.length > 0) return false;
          return String(node.textContent || '').trim() === '';
        };

        const cleanupPronunciationSpacing = () => {
          const targets = sectionElements.flatMap((element) => {
            if (!(element instanceof HTMLElement)) return [];
            const descendants = Array.from(
              element.querySelectorAll(
                '.pronunciation-sentence-anchor, .pronunciation-shadow-sentence, .pronunciation-natural-sentence, figure.audio-figure',
              ),
            );
            return element.matches(
              '.pronunciation-sentence-anchor, .pronunciation-shadow-sentence, .pronunciation-natural-sentence, figure.audio-figure',
            )
              ? [element, ...descendants]
              : descendants;
          });
          for (const element of targets) {
            const previous = element.previousElementSibling;
            if (isEmptyPronunciationSpacer(previous)) {
              previous.remove();
            }
            const next = element.nextElementSibling;
            if (isEmptyPronunciationSpacer(next)) {
              next.remove();
            }
          }
        };

        const highlightSentenceAnchor = () => {
          const existing = document.querySelector('.pronunciation-shadow-sentence, .pronunciation-natural-sentence');
          if (existing instanceof HTMLElement) {
            if (
              existing.tagName === 'SPAN' &&
              existing.parentElement instanceof HTMLParagraphElement &&
              existing.parentElement.classList.contains('pronunciation-sentence-anchor')
            ) {
              const parent = existing.parentElement;
              while (existing.firstChild) {
                parent.insertBefore(existing.firstChild, existing);
              }
              existing.remove();
              return applySentenceAnchorTone(parent);
            }
            return existing;
          }
          const sentenceAnchorLabel = sectionElements
            .flatMap((element) =>
              element instanceof HTMLElement
                ? Array.from(element.querySelectorAll('strong, b'))
                : [],
            )
            .find((candidate) =>
              /^(?:shadow sentence:?|natural sentence practice:?)$/i.test(
                String(candidate.textContent || '').trim(),
              ),
            );
          if (
            sentenceAnchorLabel instanceof HTMLElement &&
            sentenceAnchorLabel.parentElement instanceof HTMLElement
          ) {
            const parent = sentenceAnchorLabel.parentElement;
            if (
              parent.tagName === 'P' &&
              !/\\bmode\\s*:/i.test(String(parent.textContent || ''))
            ) {
              return applySentenceAnchorTone(parent);
            }
            const wrapper = document.createElement('span');
            wrapper.className = 'pronunciation-sentence-anchor';
            if (/^shadow sentence:?$/i.test(String(sentenceAnchorLabel.textContent || '').trim())) {
              wrapper.classList.add('pronunciation-shadow-sentence');
            } else {
              wrapper.classList.add('pronunciation-natural-sentence');
            }
            parent.insertBefore(wrapper, sentenceAnchorLabel);
            let current = sentenceAnchorLabel;
            while (current) {
              const nextSibling = current.nextSibling;
              wrapper.appendChild(current);
              current = nextSibling;
            }
            if (
              parent.tagName === 'P' &&
              !/\\bmodes*:/i.test(String(parent.textContent || ''))
            ) {
              parent.classList.add('pronunciation-sentence-anchor');
            }
            return applySentenceAnchorTone(wrapper);
          }

          const directBlockMatch = sectionElements.find((element) => {
            if (!(element instanceof HTMLElement)) return false;
            if (element.classList.contains('callout')) return false;
            if (!element.matches('li, p, blockquote')) return false;
            return hasSentenceAnchorLabel(element);
          });
          if (directBlockMatch instanceof HTMLElement) {
            return applySentenceAnchorTone(directBlockMatch);
          }

          const descendantSelectors = ['li', 'p', '.content > *', 'blockquote > *', 'div > *'];
          for (const element of sectionElements) {
            if (!(element instanceof HTMLElement)) continue;
            for (const selector of descendantSelectors) {
              const match = findFirstMatchingDescendant(element, selector);
              if (match instanceof HTMLElement) {
                return applySentenceAnchorTone(match);
              }
            }
          }

          return null;
        };

        if (wordDrillEnabled || connectedSpeechEnabled) {
          highlightSentenceAnchor();
          cleanupPronunciationSpacing();
        }
        const clipList = Array.isArray(pronunciationAudio.itemClips)
          ? pronunciationAudio.itemClips
          : [];
        const findClipsForItem = (itemIndex) =>
          clipList.filter(
            (clip) =>
              Number.isInteger(clip?.itemIndex) &&
              Number(clip.itemIndex) === itemIndex,
          );

        const playClip = (url) => {
          const nextUrl = String(url || '').trim();
          if (!nextUrl) return;
          const audio = new Audio(nextUrl);
          void audio.play().catch(() => {});
        };

        const createAudioButton = (clip, fallbackLabel, ariaLabel) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'word-tts-button';
          button.textContent = clip?.label || fallbackLabel;
          button.setAttribute('aria-label', ariaLabel);
          const hasUrl = typeof clip?.url === 'string' && clip.url.trim().length > 0;
          if (hasUrl) {
            button.addEventListener('click', () => playClip(clip?.url));
          } else {
            button.disabled = true;
            button.setAttribute('aria-disabled', 'true');
            button.title = 'Audio clip not generated yet';
          }
          return button;
        };

        const appendClipButtons = (container, clips, fallbackLabel, ariaPrefix, includeClipText = true) => {
          if (!(container instanceof HTMLElement) || !Array.isArray(clips) || clips.length === 0) {
            return;
          }
          for (const clip of clips) {
            const ariaLabel = [ariaPrefix, includeClipText ? clip?.text : null]
              .filter(Boolean)
              .join(' ')
              .trim();
            container.appendChild(
              createAudioButton(
                clip,
                fallbackLabel,
                ariaLabel,
              ),
            );
          }
        };

        const trimTrailingDelimiterInContainer = (container) => {
          if (!(container instanceof HTMLElement)) return;
          let current = container.lastChild;
          while (current) {
            if (current.nodeType === Node.TEXT_NODE) {
              const textValue = current.textContent || '';
              const withoutTrailingDelimiter = textValue.replace(/\\s*[—-]+\\s*$/, '');
              if (withoutTrailingDelimiter !== textValue) {
                current.textContent = withoutTrailingDelimiter;
              }
              if (!(current.textContent || '').trim()) {
                const previous = current.previousSibling;
                container.removeChild(current);
                current = previous;
                continue;
              }
              break;
            }

            if (current instanceof HTMLElement) {
              trimTrailingDelimiterInContainer(current);
              if (!(current.textContent || '').trim()) {
                const previous = current.previousSibling;
                container.removeChild(current);
                current = previous;
                continue;
              }
              break;
            }

            break;
          }
        };

        const buildWordContentNodes = (item, word, transcription) => {
          if (!(item instanceof HTMLElement)) return null;
          const sourceRoot =
            item.children.length === 1 && item.firstElementChild?.tagName === 'P'
              ? item.firstElementChild
              : item;
          const content = document.createElement('span');
          content.className = 'pronunciation-word-content';
          let foundBoundary = false;

          for (const node of Array.from(sourceRoot.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
              const textValue = node.textContent || '';
              const transcriptionIndex = textValue.indexOf(transcription);
              if (transcriptionIndex >= 0) {
                const beforeTranscription = textValue
                  .slice(0, transcriptionIndex)
                  .replace(/\\s+$/, '');
                if (beforeTranscription.trim()) {
                  content.appendChild(document.createTextNode(beforeTranscription));
                }
                foundBoundary = true;
                break;
              }

              if (textValue.trim()) {
                content.appendChild(document.createTextNode(textValue));
              }
              continue;
            }

            if (node instanceof HTMLElement && (node.textContent || '').includes(transcription)) {
              break;
            }

            content.appendChild(node.cloneNode(true));
          }

          if (!foundBoundary) {
            trimTrailingDelimiterInContainer(content);
            if ((content.textContent || '').trim()) {
              return content;
            }
            const fallbackLabel = document.createElement('span');
            fallbackLabel.className = 'pronunciation-word-label';
            fallbackLabel.textContent = word;
            content.appendChild(fallbackLabel);
            return content;
          }
          trimTrailingDelimiterInContainer(content);
          if (!(content.textContent || '').trim()) {
            const fallbackLabel = document.createElement('span');
            fallbackLabel.className = 'pronunciation-word-label';
            fallbackLabel.textContent = word;
            content.appendChild(fallbackLabel);
          }
          return content;
        };

        const normalizeWordLabel = (value) =>
          String(value || '')
            .replace(/^\\d+\\.\\s*/, '')
            .replace(/[—-]\\s*$/, '')
            .split(String.fromCharCode(96))
            .join('')
            .trim();

        const parseWordDrillLine = (rawLine) => {
          const normalized = String(rawLine || '').trim();
          if (!normalized) return null;

          const transcriptionTailMatch = /(\\/[^/\\n]+\\/)(?:\\s+(.+))?$/.exec(normalized);
          if (!transcriptionTailMatch?.[1]) return null;

          const transcription = transcriptionTailMatch[1].trim();
          const note = (transcriptionTailMatch[2] || '').trim();
          const rawWord = normalizeWordLabel(normalized.slice(0, transcriptionTailMatch.index));
          if (!rawWord) return null;

          return {
            word: rawWord,
            transcription,
            note,
          };
        };

        const parseContourCue = (note) => {
          const normalized = String(note || '').trim();
          const match = /^Contour cue:\\s*(.+)$/i.exec(normalized);
          if (!match || !match[1]) return null;
          return match[1].trim();
        };

        const parseMinimalPairLine = (rawLine) => {
          const normalized = String(rawLine || '')
            .replace(/^\\d+\\.\\s*/, '')
            .trim();
          if (!normalized) return null;

          // Accepts em-dash (—), en-dash (–), or hyphen (-) as the pair
          // separator in source text; the rendered separator is always em-dash.
          const pairMatch =
            /^(.+?)\\s+(\\/[^/\\n]+\\/)\\s+[—–-]\\s+(.+?)\\s+(\\/[^/\\n]+\\/)(?:\\s+(.+))?$/.exec(
              normalized,
            );
          if (!pairMatch) return null;

          return {
            left: {
              // Groups are already isolated by the regex; use trim() directly
              // to avoid the redundant leading-digit / trailing-dash strip that
              // normalizeWordLabel applies (those patterns can't appear here).
              word: String(pairMatch[1]).trim(),
              transcription: pairMatch[2].trim(),
              note: '',
            },
            right: {
              word: String(pairMatch[3]).trim(),
              transcription: pairMatch[4].trim(),
              note: (pairMatch[5] || '').trim(),
            },
          };
        };

        const parseConnectedSpeechLine = (rawLine) => {
          const normalized = String(rawLine || '')
            .replace(/^\\d+\\.\\s*/, '')
            .trim();
          if (!normalized) return null;

          const arrowMatch = /^["“]?(.+?)["”]?\\s*(?:→|->)\\s*(.+)$/.exec(normalized);
          if (!arrowMatch) return null;

          return {
            careful: String(arrowMatch[1] || '').trim(),
            connected: String(arrowMatch[2] || '').trim(),
            note: '',
          };
        };


        const createFallbackWordContent = (word) => {
          const content = document.createElement('span');
          content.className = 'pronunciation-word-content';

          const label = document.createElement('span');
          label.className = 'pronunciation-word-label';
          label.textContent = word;
          content.appendChild(label);

          return content;
        };

        const createWordMain = (word, transcription, note, wordContent, clips, ariaLabel = null) => {
          const controls = document.createElement('span');
          controls.className = 'pronunciation-word-tts';
          appendClipButtons(
            controls,
            clips,
            'Play',
            ariaLabel || 'Play pronunciation for',
            !ariaLabel,
          );
          if (transcription) {
            const transcriptionBadge = document.createElement('span');
            transcriptionBadge.className = 'word-tts-transcription';
            transcriptionBadge.textContent = transcription;
            transcriptionBadge.setAttribute('aria-hidden', 'true');
            controls.appendChild(transcriptionBadge);
          }

          if (note) {
            const noteText = document.createElement('span');
            noteText.className = 'pronunciation-word-note';
            noteText.textContent = note;
            controls.appendChild(noteText);
          }

          const wordMain = document.createElement('span');
          wordMain.className = 'pronunciation-word-main';
          if (wordContent instanceof HTMLElement) {
            wordMain.appendChild(wordContent);
          }
          wordMain.appendChild(controls);

          return wordMain;
        };

        const createSentenceLine = (word, transcription, note, wordContent, clips) => {
          const lineMain = document.createElement('span');
          lineMain.className = 'pronunciation-line-main';

          const textContent =
            wordContent instanceof HTMLElement ? wordContent : createFallbackWordContent(word);
          textContent.classList.add('pronunciation-line-text');
          lineMain.appendChild(textContent);

          const meta = document.createElement('span');
          meta.className = 'pronunciation-line-meta';
          appendClipButtons(meta, clips, 'Play', 'Play pronunciation for');

          const transcriptionBadge = document.createElement('span');
          transcriptionBadge.className = 'word-tts-transcription';
          transcriptionBadge.textContent = transcription;
          transcriptionBadge.setAttribute('aria-hidden', 'true');
          meta.appendChild(transcriptionBadge);

          const contourCue = parseContourCue(note);
          if (contourCue) {
            const cueBadge = document.createElement('span');
            cueBadge.className = 'pronunciation-contour-badge';
            cueBadge.textContent = contourCue;
            meta.appendChild(cueBadge);
          } else if (note) {
            const noteText = document.createElement('span');
            noteText.className = 'pronunciation-word-note';
            noteText.textContent = note;
            meta.appendChild(noteText);
          }

          lineMain.appendChild(meta);
          return lineMain;
        };

        const createConnectedSpeechLine = (careful, connected, note, clips) => {
          const lineMain = document.createElement('span');
          lineMain.className = 'pronunciation-connected-line';

          const textRow = document.createElement('span');
          textRow.className = 'pronunciation-connected-text';

          const carefulText = document.createElement('span');
          carefulText.className = 'pronunciation-connected-careful';
          carefulText.textContent = '"' + careful + '"';
          textRow.appendChild(carefulText);

          const arrow = document.createElement('span');
          arrow.className = 'pronunciation-connected-arrow';
          arrow.textContent = '→';
          textRow.appendChild(arrow);

          const connectedText = document.createElement('span');
          connectedText.className = 'pronunciation-connected-target';
          connectedText.textContent = connected;
          textRow.appendChild(connectedText);

          lineMain.appendChild(textRow);

          const meta = document.createElement('span');
          meta.className = 'pronunciation-line-meta';
          appendClipButtons(meta, clips, 'Play', 'Play connected speech line');

          if (note) {
            const noteText = document.createElement('span');
            noteText.className = 'pronunciation-word-note';
            noteText.textContent = note;
            meta.appendChild(noteText);
          }

          lineMain.appendChild(meta);
          return lineMain;
        };

        const listItems = [];
        const seen = new Set();
        sectionElements.forEach((element) => {
          element.querySelectorAll('li').forEach((item) => {
            if (!(item instanceof HTMLElement)) return;
            if (item.querySelector('li')) return;
            if (seen.has(item)) return;
            seen.add(item);
            listItems.push(item);
          });
        });

        let drillItemIndex = 0;
        listItems.forEach((item) => {
          if (!(item instanceof HTMLElement)) return;
          if (
            item.querySelector(
              '.word-tts-button, .pronunciation-word-main, .pronunciation-word-pair, .pronunciation-line-main, .pronunciation-connected-line',
            )
          ) {
            return;
          }
          const raw = (item.textContent || '').replace(/\\s+/g, ' ').trim();
          if (/^(?:mode|target|focus|action|deliverable)s*:/i.test(raw)) {
            return;
          }

          if (wordDrillEnabled) {
            if (pronunciationMode === 'minimal_pair') {
              const parsedPair = parseMinimalPairLine(raw);
              if (parsedPair) {
                const clips = findClipsForItem(drillItemIndex);
                drillItemIndex += 1;
                const leftClips = clips.filter((clip) => clip.kind === 'pair_left');
                const rightClips = clips.filter((clip) => clip.kind === 'pair_right');
                const pair = document.createElement('span');
                pair.className = 'pronunciation-word-pair';

                pair.appendChild(
                  createWordMain(
                    parsedPair.left.word,
                    parsedPair.left.transcription,
                    parsedPair.left.note,
                    createFallbackWordContent(parsedPair.left.word),
                    leftClips,
                    'Play pronunciation for ' + parsedPair.left.word + ' ' + parsedPair.left.transcription,
                  ),
                );

                const separator = document.createElement('span');
                separator.className = 'pronunciation-word-pair-separator';
                separator.textContent = '—';
                pair.appendChild(separator);

                pair.appendChild(
                  createWordMain(
                    parsedPair.right.word,
                    parsedPair.right.transcription,
                    parsedPair.right.note,
                    createFallbackWordContent(parsedPair.right.word),
                    rightClips,
                    'Play pronunciation for ' + parsedPair.right.word + ' ' + parsedPair.right.transcription,
                  ),
                );

                item.classList.add('pronunciation-word-item');
                while (item.firstChild) {
                  item.removeChild(item.firstChild);
                }
                item.appendChild(pair);
                return;
              }
            }

            const parsed = parseWordDrillLine(raw);
            if (parsed) {
              const clips = findClipsForItem(drillItemIndex);
              drillItemIndex += 1;
              const word = parsed.word;
              const transcription = parsed.transcription;
              const note = parsed.note;
              if (!word) return;

              const wordContent = buildWordContentNodes(item, word, transcription);
              const wordMain =
                pronunciationMode === 'intonation' ||
                pronunciationMode === 'rhythm_chunking' ||
                pronunciationMode === 'sentence_stress'
                  ? createSentenceLine(word, transcription, note, wordContent, clips)
                  : createWordMain(word, transcription, note, wordContent, clips);

              item.classList.add('pronunciation-word-item');
              while (item.firstChild) {
                item.removeChild(item.firstChild);
              }
              item.appendChild(wordMain);
              return;
            }
          }

          if (connectedSpeechEnabled) {
            const parsedConnected = parseConnectedSpeechLine(raw);
            if (!parsedConnected?.careful || !parsedConnected.connected) return;
            const clips = findClipsForItem(drillItemIndex);
            drillItemIndex += 1;

            item.classList.add('pronunciation-word-item');
            while (item.firstChild) {
              item.removeChild(item.firstChild);
            }
            item.appendChild(
              createConnectedSpeechLine(
                parsedConnected.careful,
                parsedConnected.connected,
                parsedConnected.note,
                clips,
              ),
            );
          }
        });
      }
    }
  } catch {}
`;
}
