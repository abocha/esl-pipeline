# @esl-pipeline/notion-add-audio

Stub that will add (or replace) an external audio block beneath the `"study-text"` toggle in Notion.  
Currently, it validates inputs and returns whether a replace or append action would occur without touching Notion.

## CLI

```
pnpm cli:add-audio --page-id <id> --url https://cdn.example/audio.mp3 [--replace]
```

## TODO

- Fetch the target page and toggle block through the Notion API.
- Insert or update audio blocks with proper ordering.
- Respect additional targets and dry-run previews.
