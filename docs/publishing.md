# Publishing Checklist

Use this guide when cutting a release or publishing individual packages.

## 1. Verify Environment

- Node.js 22 and pnpm 8 installed.
- `.env` up to date with valid Notion, ElevenLabs, and AWS credentials.
- Update voice catalog if needed: `pnpm exec tsx --eval "import { syncVoices } from './packages/tts-elevenlabs/src/syncVoices.ts'; (async () => { await syncVoices('configs/elevenlabs.voices.json'); })();"`

## 2. Quality Gates

```bash
pnpm lint
pnpm build
pnpm test
```

All commands must pass on a clean worktree. CI should already enforce this on `main` via `.github/workflows/ci.yml`.

## 3. Versioning

- Decide release scope (single package or full pipeline).
- Update the selected `packages/*/package.json` version (semantic versioning).
- Add entries to `CHANGELOG.md` (create if missing) summarising user-facing changes.

## 4. Tag and Publish

```bash
git commit -am "release: bump packages"
git tag vX.Y.Z
git push origin main --tags
```

- For npm publication, run `pnpm -r --filter <package> publish --access public` (packages are private by default; flip `private` to `false` when ready).
- Attach CI artifacts or release notes if using GitHub Releases.

## 5. Post-Release

- Verify Notion importer with a real Markdown file (dry run + live run).
- Spot-check S3 upload and audio playback.
- Update documentation (`README.md`, `/docs`) to reflect any new flags or workflows.
- Rotate API keys if you surfaced them during manual testing.

---

**Tip:** schedule regular dependency audits (`pnpm audit`, `pnpm outdated`) and refresh the ElevenLabs voice catalog before each release so that voice aliases resolve correctly.
