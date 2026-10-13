import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { parseNameStatusZ } from '../check/workspace-change-scope.mjs';
import { loadDocsCheckConfig } from './docs-check-lib.mjs';

const MARKDOWN = /\.md$/iu;

export function checkChangedMarkdownLinks({
  repoRoot = process.cwd(),
  from,
  to,
  changedFiles,
  config: suppliedConfig,
}) {
  if (!from || !to || !Array.isArray(changedFiles)) {
    throw new Error('PR Markdown link checking requires from, to, and changedFiles');
  }

  const base = git(repoRoot, ['merge-base', from, to]).trim();
  const changedRecords = parseNameStatusZ(
    git(repoRoot, [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      '--find-copies',
      '--diff-filter=ACDMRTUXB',
      `${from}...${to}`,
    ]),
  );
  const renamedFromByPath = new Map();
  for (const record of changedRecords) {
    if (record.status.startsWith('R')) {
      renamedFromByPath.set(normalizePath(record.paths[1]), normalizePath(record.paths[0]));
    }
  }
  const config = suppliedConfig ?? loadDocsCheckConfig(repoRoot);
  const changedPaths = new Set(changedFiles.map(normalizePath));
  const changedMarkdown = new Set([...changedPaths].filter((file) => MARKDOWN.test(file)));
  const baseFileCache = new Map();
  const readBaseFile = (file) => {
    const relativePath = normalizePath(
      path.isAbsolute(file) ? path.relative(repoRoot, file) : file,
    );
    if (!baseFileCache.has(relativePath)) {
      baseFileCache.set(relativePath, readGitFile(repoRoot, base, relativePath));
    }
    return baseFileCache.get(relativePath);
  };
  const existsAtBase = (file) => readBaseFile(file) !== null;
  const markdownFiles = git(repoRoot, ['ls-files', '-z'])
    .split('\0')
    .filter((file) => file && MARKDOWN.test(file) && !isExcludedMarkdown(file))
    .map(normalizePath);
  const sources = new Set([...markdownFiles, ...changedMarkdown]);
  const errors = [];
  let filesChecked = 0;

  for (const source of [...sources].sort()) {
    const currentPath = path.join(repoRoot, source);
    if (!fs.existsSync(currentPath) || isExcludedMarkdown(source)) continue;
    filesChecked += 1;
    const currentLinks = extractMarkdownLinks(fs.readFileSync(currentPath, 'utf8'));
    const baseSourcePath = renamedFromByPath.get(source) ?? source;
    const baseSource = changedMarkdown.has(source) ? readBaseFile(baseSourcePath) : null;
    const baseLinks = baseSource === null ? [] : extractMarkdownLinks(baseSource);

    if (changedMarkdown.has(source)) {
      const priorByDestination = new Map();
      for (const link of baseLinks) {
        const destination = localLinkDestination({
          link,
          source: baseSourcePath,
          repoRoot,
          readFile: readBaseFile,
          exists: existsAtBase,
        });
        const priorLinks = priorByDestination.get(destination) ?? [];
        priorLinks.push(link);
        priorByDestination.set(destination, priorLinks);
      }
      const occurrences = new Map();
      for (const link of currentLinks) {
        const destination = localLinkDestination({
          link,
          source,
          repoRoot,
          readFile: readCurrentFile,
          exists: fs.existsSync,
        });
        const occurrence = occurrences.get(destination) ?? 0;
        occurrences.set(destination, occurrence + 1);
        if (isValidLink({ link, source, repoRoot, config, readFile: readCurrentFile })) {
          continue;
        }
        const prior = priorByDestination.get(destination)?.[occurrence];
        if (
          prior &&
          !isValidLink({
            link: prior,
            source: baseSourcePath,
            repoRoot,
            config,
            readFile: readBaseFile,
            exists: existsAtBase,
          })
        )
          continue;
        errors.push(`[broken-local-link] ${source} -> ${link.target}`);
      }
      continue;
    }

    for (const link of currentLinks) {
      const targets = resolveLinkPaths({
        link: { target: decodeTarget(link.target.split('#')[0].split('?')[0]) || source },
        source,
        repoRoot,
        readFile: () => null,
        includeMissing: true,
      });
      if (!targets.some((target) => changedPaths.has(target))) continue;

      const baseValidity = isValidLink({
        link,
        source,
        repoRoot,
        config,
        readFile: readBaseFile,
        exists: existsAtBase,
      });
      if (
        !baseValidity ||
        isValidLink({
          link,
          source,
          repoRoot,
          config,
          readFile: readCurrentFile,
        })
      )
        continue;

      errors.push(`[broken-local-link] ${source} -> ${link.target}`);
    }
  }

  return { filesChecked, errors };
}

export function extractMarkdownLinks(markdown) {
  const content = stripInlineCode(stripFencedAndIndentedCode(markdown));
  const definitions = new Map();
  const definitionLines = content.split('\n').map((line) => {
    const match = line.match(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/u);
    if (!match) return line;
    definitions.set(normalizeReference(match[1]), { target: match[2] ?? match[3] });
    return '';
  });
  const body = definitionLines.join('\n');
  const links = [];

  for (const match of body.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|(?:\\.|[^\s)])+)/gu)) {
    const raw = match[1] ?? '';
    links.push({ target: raw.startsWith('<') ? raw.slice(1, -1) : raw.replaceAll('\\ ', ' ') });
  }

  for (const match of body.matchAll(/!?\[([^\]]+)\](?:\[([^\]]*)\])?/gu)) {
    const end = (match.index ?? 0) + match[0].length;
    if (body[end] === '(') continue;
    const reference = normalizeReference(match[2] || match[1]);
    const definition = definitions.get(reference);
    if (definition) links.push(definition);
  }

  return links;
}

function isValidLink({ link, source, repoRoot, config, readFile, exists = fs.existsSync }) {
  const target = link.target.trim();
  if (!target || /^(?:https?:|mailto:|tel:|data:)/iu.test(target)) return true;
  if (target.startsWith('file://')) return false;

  const hashAt = target.indexOf('#');
  const pathname = (hashAt === -1 ? target : target.slice(0, hashAt)).split('?')[0];
  const fragment = hashAt === -1 ? '' : decodeTarget(target.slice(hashAt + 1));
  const decodedPath = decodeTarget(pathname) || source;
  const paths = resolveLinkPaths({
    link: { target: decodedPath },
    source,
    repoRoot,
    readFile,
    exists,
  });
  if (paths.length === 0) {
    return (config.allowed_missing_targets ?? []).includes(decodedPath.replace(/^\//u, ''));
  }
  if (!fragment) return true;
  if (paths.some((file) => !MARKDOWN.test(file))) return true;
  for (const file of paths) {
    if (!MARKDOWN.test(file)) continue;
    const content = readFile(path.join(repoRoot, file));
    if (content !== null && markdownAnchors(content).has(fragment)) return true;
  }
  return false;
}

function resolveLinkPaths({
  link,
  source,
  repoRoot,
  readFile,
  exists = fs.existsSync,
  includeMissing = false,
}) {
  const target = link.target;
  const withoutLine = target.replace(/:(\d+)(?::\d+)?$/u, '');
  const candidates = target.startsWith('/')
    ? [normalizePath(target.slice(1))]
    : [normalizePath(path.posix.join(path.posix.dirname(source), target)), normalizePath(target)];
  const withLine =
    withoutLine === target
      ? []
      : target.startsWith('/')
        ? [normalizePath(withoutLine.slice(1))]
        : [
            normalizePath(path.posix.join(path.posix.dirname(source), withoutLine)),
            normalizePath(withoutLine),
          ];

  for (const candidate of [...candidates, ...withLine]) {
    const absolute = path.join(repoRoot, candidate);
    if (exists(absolute) || readFile(absolute) !== null) return [candidate];
  }
  return includeMissing ? candidates : [];
}

function markdownAnchors(markdown) {
  const content = stripFencedAndIndentedCode(markdown);
  const anchors = new Set();
  const duplicates = new Map();
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const match of line.matchAll(/<a\b[^>]*?\b(?:id|name)=["']([^"']+)["'][^>]*>/giu))
      anchors.add(match[1]);
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    const setext = index + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/u.test(lines[index + 1]);
    const headingText = heading?.[1] ?? (setext ? line.trim() : null);
    if (!headingText) continue;
    const slug = slugHeading(headingText);
    const duplicateCount = duplicates.get(slug) ?? 0;
    duplicates.set(slug, duplicateCount + 1);
    anchors.add(duplicateCount === 0 ? slug : `${slug}-${duplicateCount}`);
  }
  return anchors;
}

function slugHeading(value) {
  return value
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/!?\[([^\]]+)\](?:\[[^\]]*\])?/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/ /gu, '-');
}

function stripFencedAndIndentedCode(markdown) {
  const lines = markdown.split('\n');
  let fence = null;
  const withoutFences = lines
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
      if (fence) {
        const closing = marker && marker[0] === fence[0] && marker.length >= fence.length;
        if (closing) fence = null;
        return '';
      }
      if (marker) {
        fence = marker;
        return '';
      }
      if (/^(?: {4}|\t)/u.test(line)) return '';
      return line;
    })
    .join('\n');
  return withoutFences;
}

function stripInlineCode(markdown) {
  return markdown.replace(/(`+)[^`]*?\1/gu, (code) => ' '.repeat(code.length));
}

function localLinkDestination({ link, source, repoRoot, readFile, exists }) {
  const target = link.target.trim();
  if (/^(?:https?:|mailto:|tel:|data:)/iu.test(target)) return null;
  if (target.startsWith('file://')) return `file:${target}`;
  const hashAt = target.indexOf('#');
  const pathname = (hashAt === -1 ? target : target.slice(0, hashAt)).split('?')[0];
  const fragment = hashAt === -1 ? '' : decodeTarget(target.slice(hashAt + 1));
  const decodedPath = decodeTarget(pathname) || source;
  const paths = resolveLinkPaths({
    link: { target: decodedPath },
    source,
    repoRoot,
    readFile,
    exists,
    includeMissing: true,
  });
  return `${paths[0] ?? decodedPath}#${fragment}`;
}

function normalizeReference(value) {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function decodeTarget(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(value) {
  return path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//u, '');
}

function readCurrentFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isExcludedMarkdown(file) {
  const normalized = normalizePath(file);
  if (normalized === 'scripts/smoke/product-assignment.md') return true;
  if (/(?:^|\/)prompt-assets\//u.test(normalized)) return true;
  const isRawFixture = normalized
    .split('/')
    .some((segment) => ['fixtures', '__fixtures__', 'test-fixtures'].includes(segment));
  return isRawFixture && path.posix.basename(normalized).toLocaleLowerCase('en-US') !== 'readme.md';
}

function readGitFile(repoRoot, revision, file) {
  const relativePath = path.isAbsolute(file) ? path.relative(repoRoot, file) : file;
  try {
    return execFileSync('git', ['show', `${revision}:${normalizePath(relativePath)}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}
