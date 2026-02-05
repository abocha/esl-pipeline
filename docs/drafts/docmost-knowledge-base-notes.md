# Docmost As Knowledge Base Option

Date: 2026-02-05

## Context
- Notion was the student homepage for assignments, theory, and payment history.
- Notion is blocked for many students in Russia, so it cannot be the primary platform.
- Anytype was explored as a replacement but has a 100 MB cloud-sharing limit and does not render homework as expected.
- We currently generate clean HTML ourselves and host it on S3, which works but is not a long-term solution on its own.

## Goal
Provide a Notion-like, student-facing knowledge base that is accessible in Russia and can host assignments and theory content reliably.

## Candidate: Docmost
Docmost is an open-source, self-hosted Notion/Confluence alternative that can run via Docker. It provides a collaborative knowledge base and public sharing.

## Where It Fits
- Use Docmost as the knowledge base (assignments + theory pages).
- Keep the existing pipeline UI for tutor workflows (pipeline, student management, invoices).
- Student-facing experience is reading content in Docmost (public links or shared access).

## Pros
- Notion-like editing and organization.
- Self-hosted, accessible to students in Russia.
- Reduces need to build a custom knowledge base UI.

## Gaps / Risks
- Docmost is a wiki/KB, not a workflow system.
- Auth/SSO features may be limited (enterprise-only for some options).
- If heavily modified and deployed, license terms may apply (AGPL).

## Near-Term Plan
1. Spin up Docmost via Docker.
2. Import a sample assignment (Markdown/HTML) and validate rendering quality.
3. Test public sharing flow for student access.
4. Decide if Docmost becomes the long-term knowledge base or remains a temporary solution.

## Open Questions
- How well does Docmost render our homework formatting (callouts, tables, audio links)?
- Does Docmost handle student access cleanly without admin overhead?
- Is the license acceptable if we integrate more deeply later?
