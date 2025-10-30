# @esl-pipeline/orchestrator

ESL assignment orchestrator that sequences validation, Notion import, colorization, optional TTS generation, uploads, audio attachment, and manifest creation. The interactive wizard now uses an Enquirer-powered picker for Markdown files and shares that picker with a dedicated CLI command.

## CLI

```
pnpm cli:orchestrator --md ./lessons/unit1.md [--student "Student"] [--preset default] [--with-tts] [--upload s3] [--dry-run]
pnpm cli:orchestrator status --md ./lessons/unit1.md
pnpm cli:orchestrator rerun --md ./lessons/unit1.md --steps tts,upload
```

### Path picker (`select`)

```
pnpm cli:orchestrator select [path] [options]
```

Launch an Enquirer AutoComplete prompt (backed by `globby` and `find-up`) that fuzzy-filters directories or files. The picker powers the wizard’s “Browse manually…” flow and can be scripted directly:

- Select directories ending in `.d`:  
  `pnpm cli:orchestrator select --dir --suffix .d`
- Select directories containing `input.d`:  
  `pnpm cli:orchestrator select --dir --contains input.d`
- Select Markdown files:  
  `pnpm cli:orchestrator select --file --ext .md`
- Select via glob:  
  `pnpm cli:orchestrator select --file --glob '**/*.mp3'`
- Use Git/package roots or the current working directory with `--root git|pkg|cwd`
- Show absolute paths in the prompt/output with `--absolute`
- Include dot-prefixed files/directories with `--include-dot`
- Limit suggestions with `--limit <n>`

The picker ignores common build caches by default:

```
**/node_modules/**
**/.git/**
**/.next/**
**/.turbo/**
**/dist/**
**/build/**
**/coverage/**
**/.pnpm/**
```

## Manifest helper

`manifest.ts` exposes `writeManifest`, `readManifest`, and `manifestPathFor` for re-use by other tools. Manifests include `mdHash`, `pageId`, `audio`, `preset`, and `timestamp` metadata for incremental reruns.
