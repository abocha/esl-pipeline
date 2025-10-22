# @esl-pipeline/notion-colorizer

Stub module that will eventually apply preset colors to headings and toggles in Notion homework pages.  
Current implementation reads an optional presets JSON file, validates flags, and returns a zero-count result so downstream tooling has a predictable shape.

## CLI

```
pnpm cli:colorizer --page-id <id> --preset <name> [--presets-path ./configs/presets.json]
```

Outputs JSON describing whether a preset was applied and per-heading counts.

## TODO

- Load preset definitions from disk and update Notion blocks via the official API.
- Support bulk presets and dry-run previews.
- Honor additional environment configuration once real APIs are wired up.
