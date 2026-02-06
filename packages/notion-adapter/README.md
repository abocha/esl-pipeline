# @esl-pipeline/notion-adapter

Notion adapter used by the ESL pipeline to create/update lesson pages and attach structured content.

## Responsibilities

- Validate and import markdown into Notion pages (`runImport`)
- Convert markdown blocks to Notion blocks (`mdToBlocks`)
- Resolve data sources / student relations
- Map frontmatter properties to database schema
- Apply heading color presets
- Attach or replace audio block under study text

## Main exports

- `runImport`
- `mdToBlocks`
- `applyHeadingPreset`, `loadPreset`
- `addOrReplaceAudioUnderStudyText`
- `createNotionClient`
- `resolveDataSourceId`, `resolveStudentId`, `findStudentPageId`

## Notes

- Uses `@esl-pipeline/md-validator` for pre-import validation.
- Uses `@esl-pipeline/pmd` for canonical markdown source normalization.

