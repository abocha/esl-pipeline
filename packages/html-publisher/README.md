# @esl-pipeline/html-publisher

Native AssignmentV1 publication authority. Learner presentation and deterministic static HTML are
owned exclusively by [learner-handout](../learner-handout/README.md).

## Exports and ownership

- `renderAssignmentToHtml(assignment, options)`: adapts resolved media and narrow presentation inputs
  into the React Node document renderer.
- `renderAndPublishAssignmentToS3({ assignment, ...options })`: renders and publishes exact HTML bytes.
- `publishHtmlToS3(html, options)`: uploads already-rendered HTML.
- `ASSIGNMENT_HTML_RENDERER_VERSION`: `3` for new native jobs/publications.
- `AssignmentRenderOptions`: study audio, primary pronunciation URL, structured pronunciation clips,
  preview placeholders and explicit h2/h3 preset colors. Broad theme/features/raw HTML options are retired.

Structured primary pronunciation URLs take precedence over the separate pronunciation URL input;
that input supplies the fallback when the structured primary URL is absent. Item clips retain their
IDs, indices and minimal-pair side. Learner-handout admits safe URLs and disables unavailable controls.
Unsafe structured URLs are discarded before precedence selection, preserving the safe URL fallback.

HTML artifact identity is unchanged: SHA-256 over UTF-8 `html-v1:` followed by the exact emitted HTML.
The default object key remains `materials/html/artifacts/<renderHash>.html`, with existing optional
prefix/key/filename overrides. The same HTML bytes are written to the temporary upload file.
Renderer version 3 changes presentation identity, not AssignmentV1 canonical identity or the artifact namespace.

Historical Markdown assignments are read-only records. Already-issued legacy standalone HTML is
independent of this renderer path. There is no string renderer or native fallback renderer.

## Build and focused checks

`learner-handout` is a runtime workspace dependency, with React/React DOM and packaged CSS/playback
assets. Build dependencies before html-publisher; the local `test:unit` setup does this automatically.
Orchestrator declares html-publisher as a runtime dependency and keeps it external to its bundle so
asset URLs resolve beside their owning module. Its local unit setup rebuilds orchestrator itself;
the compiled import check isolates the bundle with only declared production dependencies available.

`pnpm --filter @esl-pipeline/html-publisher test:unit` covers adapter mapping, exact upload bytes/hash/key,
and plain-Node execution through the built package entry across timezones and production/development
React runtimes. The compiled check requires no Vite, DOM, network, ambient clock or hydration.
