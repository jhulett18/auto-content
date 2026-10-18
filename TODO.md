# Generation Prototype Roadmap

This roadmap is optimized for a small internal team. The immediate goal is one safe, coherent, editable three-slide carousel; hosted SaaS infrastructure remains deferred until the generation workflow is reliable.

## Codex working agreement

Codex must read this roadmap whenever a new session begins in this repository and reference it in the first progress update to the user. That update should explain:

- what already works in the current baseline;
- which milestone is recommended next and what it is intended to accomplish;
- how the current request advances, changes, or sits outside that milestone; and
- when work is resumed, which roadmap item is being continued, what has already been completed, and what remains.

The root `AGENTS.md` enforces this startup behavior for the project. Before returning work to the user, Codex should update roadmap status only for changes verified in the repository; partial work must remain unchecked.

## Current baseline

- [x] **Reference grouping:** organize saved references by creator and group generated analyses, test images, and carousel sets by their source reference.
- [x] **Target-brand storage:** collect and persist a target brand for each carousel.
- [x] **Neutral reference analysis:** reduce source media to reusable visual and storytelling traits instead of passing raw reference pixels to carousel generation.
- [x] **Brand-safety prompting:** prohibit source identities, logos, characters, branded packaging, fake interfaces, and other recognizable third-party elements in generated artwork.
- [x] **Manual slide generation:** create and retry one slide at a time with an optional revision instruction.
- [x] **Slide approval:** keep individual slides and mark the carousel complete when every slide is kept.
- [x] **Local generation storage:** save reference analyses and carousel metadata in SQLite and generated PNGs on local disk.
- [x] **Guarded TikTok handoff:** preview one saved generation, confirm its caption and TikTok consent fields, and send it through Zernio to the connected account's Creator Inbox for final AI labeling and publishing.

## P0 — Production-quality generation

- [ ] Generate and persist a structured carousel plan before rendering, including each slide's purpose, exact copy, factual support, and visual direction.
- [x] Feed user-selected GFNF/Aletheia message groups and their attachments into the persisted content brief.
- [ ] Add a reusable brand profile containing colors, typography, logo policy, voice, and prohibited elements.
- [ ] Separate generated artwork from deterministic text rendering so approved headlines and body copy appear exactly as written.
- [ ] Define and carry one shared visual system—palette, type scale, layout grid, illustration treatment, and recurring motifs—across every slide.
- [ ] Add automated pre-approval review for OCR/text accuracy, trademark or source-brand leakage, fake UI, and unsupported claims.

### Acceptance criteria for the P0 milestone

- [ ] A user can create one three-slide plan and review its exact copy and source-backed claims before rendering.
- [ ] All three slides use the saved brand profile and an observably consistent visual system.
- [ ] Rendered headlines and body copy match the approved plan exactly.
- [ ] Every factual claim is supported by selected Aletheia context or explicitly labeled as unsupported before generation.
- [ ] Automated review finds no source-brand or trademark leakage, fake UI, prohibited brand elements, or material OCR mismatch.
- [ ] The user can keep a reviewed result as one complete, safe, consistent, factual three-slide carousel.

## P1 — Editing and iteration

- [ ] Preserve multiple variations for each slide instead of overwriting its active output.
- [ ] Compare, select, reject, and restore slide variations.
- [ ] Edit copy without regenerating artwork.
- [ ] Reorder, add, and remove slides while preserving the carousel plan.
- [ ] Batch-generate a planned carousel with progress reporting, retry, cancel, and partial-failure handling.
- [ ] Export individual PNGs, a ZIP set, and accompanying caption and source notes.

## P1 — Daily editorial automation

- [x] Add an idempotent full-day GFNF ingestion and keyword-ranking core with one nightly generation cron and one morning approval cron.
- [x] Persist a nightly source candidate and two complete three-slide variations with deterministic copy and automated pre-approval review.
- [x] Add saved-reference names, Telegram A/B approval and reference-change commands, and an automation status view.
- [x] Add guarded Instagram carousel scheduling through Zernio after approval.
- [ ] Complete one live end-to-end Telegram approval and scheduled Instagram publication with production credentials.

## P1 — References and context

- [ ] Add the missing Apify ingestion and refresh workflow.
- [ ] Cache source media reliably and support reference tags, search, filtering, and removal.
- [ ] Let users choose which Aletheia messages inform a draft and show the resulting source brief.
- [ ] Track each factual claim back to the supplied message context that supports it.

## P2 — Reliability and evaluation

- [ ] Add unit tests for prompt sanitization, brand rules, carousel planning, and database migrations.
- [ ] Add mocked API integration tests and an end-to-end test of the normal three-slide workflow.
- [ ] Build a fixed evaluation set for source-brand leakage, exact text, factuality, and cross-slide consistency.
- [ ] Persist the model, prompt version, generation parameters, duration, cost metadata, and review results for every render.
- [ ] Replace ad-hoc schema changes with versioned migrations and clean up orphaned image files safely.

## Deferred — Production platform work

- [ ] Authentication and authorization.
- [ ] Multi-tenancy and team isolation.
- [ ] Billing and usage plans.
- [ ] Hosted database and object storage.
- [ ] Background job workers.
- [ ] Rate limits and abuse controls.
- [ ] Monitoring, alerting, and operational dashboards.
- [ ] Deployment and production environment configuration.

## Next recommended milestone

Complete **P0 — Production-quality generation** as a vertical slice for exactly three slides: persist the plan, derive its brief from selected Aletheia messages, apply one reusable brand profile and visual system, render artwork separately from exact text, and require automated safety and factuality review before any slide can be kept. Defer batch generation, richer editing, and hosted infrastructure until this path meets every P0 acceptance criterion.

### Latest validation evidence

On 2026-09-29, a manual end-to-end run produced and kept a coherent three-slide **Locked-In Supply** carousel from recent GFNF news and a saved visual reference. All three final slides used the same blue, yellow, and black editorial system, preserved the supplied limits and timing caveat, and omitted source creators, retailers, franchises, and logos. The run still required manual GFNF-message selection and human image review; the first slide also required a retry after prohibited product-box imagery appeared. This validates the prototype baseline while leaving the P0 planning, automatic context selection, deterministic text, and automated safety-review items open.

The follow-up authentic-product implementation now groups GFNF messages with adjacent attachments, persists a source-backed three-slide plan, derives a visual system from the GFNF product reference, attempts exact-SKU official photo resolution, falls back to approved uploads, proposes trademark masks with vision, and blocks rendering until a human approves all product derivatives. Exact copy and product placement are deterministic for this path. General carousel planning, a reusable brand profile, post-render OCR/safety review, and deterministic rendering for non-product drafts remain open.

Reference and generation galleries now use a shared image-failure boundary. Instagram previews are recovered from the permanent post media endpoint, TikTok previews use public oEmbed, and resulting images are validated, normalized to WebP, and cached locally. Video references display only their cached thumbnail and send playback to the original platform. A full Apify ingestion/refresh workflow is still required before the broader reference-management backlog item can be considered complete.

New image renders now persist Images API token usage and a calculated USD cost, show that cost directly on gallery cards and previews, and contribute to a locally configured image budget. The UI warns below $3 remaining. Historical renders without usage remain labeled “Cost not recorded,” and the broader metadata backlog stays open until prompt versions, parameters, duration, and review results are also persisted.

On 2026-09-30, the Zernio integration loaded TikTok's creator-specific privacy choices for `@lockin.supply1`, uploaded the newest kept carousel slide, and successfully delivered one photo to TikTok Creator Inbox. The generation library now includes an exact-image preview, title and caption fields, interaction controls, and explicit preview, consent, and AI-label confirmations. Direct public posting remains intentionally disabled because Zernio documents that TikTok direct photo posts reject the AI disclosure flag; the user completes AI labeling and publishing in TikTok.

On 2026-10-06, the repository added the daily GFNF automation foundation: semantic qualification and ranking, database leases and idempotency, named saved references, two persisted three-slide variants, deterministic copy compositing, automated vision review, Telegram polling/approval/reference replacement, Instagram scheduling, and a run-status page. On 2026-10-07, the scan was simplified to one complete previous-day export at 12:05 AM ET plus a Telegram-only approval pass at 8:00 AM; same-day story consolidation and correction-aware ranking were added. Unit tests, lint, and the production build pass. The external Telegram-to-Zernio path still requires configured credentials and one live scheduled-post validation before it is considered production-verified.

On 2026-10-15, a private Discord Gateway worker registered a guild-scoped `/generate topic reference` command. It creates a persisted, deterministic three-slide educational plan, generates slides sequentially from one saved image reference, reports progress, preserves partial successes, retries failed positions, and can keep the successful set without scheduling or publishing it. Command registration and the running worker were verified against Discord; one live user-invoked three-slide generation and button flow still remain before this path is considered end-to-end verified. The broader batch-generation item remains open because cancellation and the main editor workflow are not yet covered.

On 2026-10-16, `/generate` was replaced by a persisted `/start` Discord workflow: hourly GFNF synchronization, up to five saved topic choices with safe evergreen reframing, five-image reference browsing, explicit three/four-slide selection, exact-copy plan review, a slide-one style gate, per-slide automated and human approval, feedback-driven retries with attempt history, final caption review, collision-aware weekly slot proposals, and explicit Instagram scheduling approval. The live worker registered `/start`, imported 10 recent stories with four eligible choices, and successfully queried the connected Zernio schedule. Unit tests, lint, and the production build pass. A user-driven Discord walkthrough through real image generation and the final scheduled Instagram post is still required before the path is end-to-end verified.
