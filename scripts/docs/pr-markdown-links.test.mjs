import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readChangedFiles } from './docs-check-lib.mjs';
import { checkChangedMarkdownLinks, extractMarkdownLinks } from './pr-markdown-links.mjs';

const config = { allowed_missing_targets: [] };

test('changed Markdown validates decoded paths and duplicate heading anchors while ignoring code and old debt', () => {
  const repo = makeGitRepo({
    'guide one.md':
      '# Start\n\n## Repeat\n\n## Repeat\n\n## Explicit\n\n<a class="anchor" name="custom-anchor"></a>\n<a id="html-anchor"></a>\n',
    'guide.md': [
      '[valid](guide%20one.md#repeat-1)',
      '[explicit](guide%20one.md#custom-anchor)',
      '[html](guide%20one.md#html-anchor)',
      '[reference][dest]',
      '[dest]: <guide one.md#start>',
      '',
      '[existing debt](missing-old.md)',
    ].join('\n'),
  });
  const base = commit(repo, 'base');
  write(
    repo,
    'guide.md',
    [
      '[valid](guide%20one.md#repeat-1)',
      '[explicit](guide%20one.md#custom-anchor)',
      '[html](guide%20one.md#html-anchor)',
      '[reference][dest]',
      '[dest]: <guide one.md#start>',
      '',
      '[existing debt](missing-old.md)',
      '[new regression](missing-new.md)',
      '`[literal](missing-inline.md)`',
      '    [indented example](missing-indented.md)',
      '```md',
      '[example](missing-fenced.md)',
      '```',
    ].join('\n'),
  );
  const head = commit(repo, 'changed guide');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, ['[broken-local-link] guide.md -> missing-new.md']);
  assert.deepEqual(
    extractMarkdownLinks('`[literal](no.md)`\n    [indented](no.md)\n```\n[x](no.md)\n```'),
    [],
  );
});

test('new full, collapsed, and shortcut reference uses do not inherit unused definition debt', () => {
  const repo = makeGitRepo({
    'references.md': [
      '[full]: missing.md',
      '[collapsed]: missing.md',
      '[shortcut]: missing.md',
      '',
      '[old full use][full]',
    ].join('\n'),
  });
  const base = commit(repo, 'unused broken definitions plus one used reference');
  write(
    repo,
    'references.md',
    [
      '[full]: missing.md',
      '[collapsed]: missing.md',
      '[shortcut]: missing.md',
      '',
      '[old full use][full]',
      '[new full use][full]',
      '[collapsed][]',
      '[shortcut]',
    ].join('\n'),
  );
  const head = commit(repo, 'add reference uses');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  assert.deepEqual(extractMarkdownLinks('[unused]: missing.md'), []);
  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, [
    '[broken-local-link] references.md -> missing.md',
    '[broken-local-link] references.md -> missing.md',
    '[broken-local-link] references.md -> missing.md',
  ]);
});

test('heading slugs preserve GitHub punctuation spacing and literal hyphens', () => {
  const repo = makeGitRepo({
    'target.md': '## Build + Code Quality\n\n## A--B\n',
    'guide.md': '# Guide\n',
  });
  const base = commit(repo, 'headings without consumers');
  write(
    repo,
    'guide.md',
    '[punctuation](target.md#build--code-quality)\n[literal hyphens](target.md#a--b)\n',
  );
  const head = commit(repo, 'add heading consumers');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, []);
});

test('heading braces do not create unsupported custom anchors', () => {
  const repo = makeGitRepo({
    'target.md': '## Heading {#custom-id}\n\n<a id="html-anchor"></a>\n',
    'guide.md': '[html anchor](target.md#html-anchor)\n',
  });
  const base = commit(repo, 'base');
  write(repo, 'guide.md', '[unsupported alias](target.md#custom-id)\n');
  const head = commit(repo, 'add unsupported alias');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, ['[broken-local-link] guide.md -> target.md#custom-id']);
});

test('unchanged consumers block when a previously valid anchor is removed', () => {
  const repo = makeGitRepo({
    'target.md': '# Stable\n\n## `Foo`\n\n## [Visible Label](other.md)\n',
    'other.md': '# Other\n',
    'consumer.md': [
      '[stable](target.md#stable)',
      '[code heading](target.md#foo)',
      '[linked heading](target.md#visible-label)',
    ].join('\n'),
    'archives/existing-debt.md': '[already broken](target.md#never-existed)\n',
  });
  const base = commit(repo, 'base');
  write(repo, 'target.md', '# Renamed\n');
  const head = commit(repo, 'rename heading');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config: { ...config, core_docs: ['consumer.md'] },
  });
  assert.deepEqual(result.errors, [
    '[broken-local-link] consumer.md -> target.md#stable',
    '[broken-local-link] consumer.md -> target.md#foo',
    '[broken-local-link] consumer.md -> target.md#visible-label',
  ]);
});

test('unchanged consumers block when a linked target is moved or deleted', () => {
  const repo = makeGitRepo({
    'target.md': '# Here\n',
    'consumer.md': '[here](target.md#here)\n',
  });
  const base = commit(repo, 'base');
  fs.renameSync(path.join(repo, 'target.md'), path.join(repo, 'renamed.md'));
  const head = commit(repo, 'move target');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, ['[broken-local-link] consumer.md -> target.md#here']);
});

test('renamed sources preserve old debt when the local destination stays the same', () => {
  const repo = makeGitRepo({ 'docs/old/source.md': '[old debt](../missing.md)\n' });
  const base = commit(repo, 'base');
  fs.mkdirSync(path.join(repo, 'docs/new'), { recursive: true });
  fs.renameSync(path.join(repo, 'docs/old/source.md'), path.join(repo, 'docs/new/source.md'));
  const head = commit(repo, 'rename source at same depth');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const status = execFileSync(
    'git',
    ['diff', '--name-status', '-z', '--find-renames', '--find-copies', `${base}...${head}`],
    { cwd: repo, encoding: 'utf8' },
  );
  assert.match(status, /^R\d+\0docs\/old\/source\.md\0docs\/new\/source\.md\0/u);

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, []);
});

test('renamed sources block when moving changes the broken link destination', () => {
  const repo = makeGitRepo({ 'docs/old/source.md': '[old debt](../missing.md)\n' });
  const base = commit(repo, 'base');
  write(repo, 'docs/new/deep/source.md', '[old debt](../missing.md)\n');
  fs.unlinkSync(path.join(repo, 'docs/old/source.md'));
  const head = commit(repo, 'move source to a different relative depth');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, ['[broken-local-link] docs/new/deep/source.md -> ../missing.md']);
});

test('renamed sources block when a previously valid relative link becomes broken', () => {
  const repo = makeGitRepo({
    'docs/missing.md': '# Exists at base\n',
    'docs/old/source.md': '[now broken](../missing.md)\n',
  });
  const base = commit(repo, 'base');
  write(repo, 'docs/new/deep/source.md', '[now broken](../missing.md)\n');
  fs.unlinkSync(path.join(repo, 'docs/old/source.md'));
  const head = commit(repo, 'move source out of relative target scope');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, ['[broken-local-link] docs/new/deep/source.md -> ../missing.md']);
});

test('raw fixture and prompt Markdown are excluded while README guidance remains in scope', () => {
  const repo = makeGitRepo({
    'fixtures/ok.md': '# fixture\n',
    'packages/example/prompt-assets/template.md': '# prompt\n',
    'scripts/smoke/product-assignment.md': '# smoke fixture\n',
    'packages/example/README.md': '# guidance\n',
  });
  const base = commit(repo, 'base');
  write(repo, 'fixtures/ok.md', '[bad](missing.md)\n');
  write(repo, 'packages/example/prompt-assets/template.md', '[bad](missing.md)\n');
  write(repo, 'scripts/smoke/product-assignment.md', '[bad](missing.md)\n');
  write(repo, 'packages/example/README.md', '[bad](missing.md)\n');
  const head = commit(repo, 'add links');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, ['[broken-local-link] packages/example/README.md -> missing.md']);
});

test('changed non-Markdown targets recheck consumers without treating fragments as headings', () => {
  const repo = makeGitRepo({
    'README.md': [
      '[removed source](src/removed.ts#L10)',
      '[existing source](src/existing.ts#L10)',
      '[page](page.html#settings)',
    ].join('\n'),
    'src/removed.ts': 'export {};\n',
    'src/existing.ts': 'export {};\n',
    'page.html': '<main id="settings"></main>\n',
  });
  const base = commit(repo, 'base');
  fs.unlinkSync(path.join(repo, 'src/removed.ts'));
  const head = commit(repo, 'remove source');
  const changedFiles = readChangedFiles({ repoRoot: repo, from: base, to: head });

  const result = checkChangedMarkdownLinks({
    repoRoot: repo,
    from: base,
    to: head,
    changedFiles,
    config,
  });
  assert.deepEqual(result.errors, ['[broken-local-link] README.md -> src/removed.ts#L10']);
});

function makeGitRepo(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-markdown-links-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'docs-test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Docs Test'], { cwd: repo });
  for (const [relativePath, content] of Object.entries(files)) write(repo, relativePath, content);
  return repo;
}

function write(repo, relativePath, content) {
  const absolutePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');
}

function commit(repo, message) {
  execFileSync('git', ['add', '--all'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', message], { cwd: repo });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}
