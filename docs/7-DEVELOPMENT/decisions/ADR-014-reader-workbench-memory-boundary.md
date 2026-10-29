# ADR-014: Source reading workspace and opt-in Mei boundary

- **Status**: Accepted
- **Date**: 2026-10
- **Related**: ADR-002, PDR-001, PDR-002

## Context

Extracted PDF text can lose mathematical layout and page boundaries. Readers also need multiple source-scoped conversations, selectable text, a translation assistant with a separate model, and an optional connection to existing personal memory without sending private history automatically.

## Decision

- Render the original PDF with pinned, same-origin PDF.js resources and retain extracted text as a fallback. Quotes include the source and physical PDF page numbers; no automatic model call follows selection.
- Keep main and reader-assistant conversations in the existing source-chat storage, separated by an immutable purpose. The assistant receives only its own history and user-submitted text, not the full source or main-chat context.
- Expose only native, known reasoning capabilities. An unsupported level is disabled and rejected server-side, not emulated by prompting or silently mapped to another level. Interactive chat does not silently replace the selected model.
- Enable Mei only when an operator explicitly configures `OPEN_NOTEBOOK_MEI_ROOT`. Its narrow bridge accepts fixed operations and runs only for loopback clients. Browser requests must also have a trusted loopback Origin, independent of the application's general CORS setting; the default trusts the local frontend on port 3000, and additional local origins can be explicitly configured with `OPEN_NOTEBOOK_MEI_TRUSTED_ORIGINS`. Requests without an Origin are for trusted local tools, not browser access control. GUI1/GUI2 access is limited to configured index/summary files; snippets require preview, hash revalidation and user confirmation before model transmission.
- Short-term snapshots contain page, session and quote references/hashes, not chat logs or private document text. Long-term claims become Mei review candidates with evidence and never apply themselves to canonical memory.

## Alternatives considered

- Rendering extracted Markdown as the primary reading view loses original layout and accurate page locations.
- Reusing the full-source chat for translation would silently send much more context than the selected excerpt.
- Automatically injecting all available personal memories or directly applying a generated claim would cross privacy and review boundaries.

## Consequences

- PDF.js resources and their original license files must remain available with their pinned version. Their distribution terms require separate review before publication or redistribution.
- Reasoning support is intentionally narrow; custom endpoints may reject even a model's documented native capability, and `ultra` is not represented as a supported provider value.
- Conversation turns for a given session are protected by an in-process lock. A multi-process or multi-host deployment needs a shared lease before concurrent writes are safe.
- The Mei integration is optional, local-machine oriented, and is not an authentication or operating-system sandbox. Operators must restrict access independently and preserve Mei's review workflow.
