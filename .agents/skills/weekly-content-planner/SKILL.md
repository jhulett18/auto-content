---
name: weekly-content-planner
description: Plan and maintain a source-backed four-post weekly carousel calendar for Locked-In Supply. Use when the user asks to plan next week's content, organize or replenish the topic bank, choose carousel references, or prepare generation-ready weekly briefs. Do not use for one-off image generation or for running the production GFNF automation.
---

# Weekly Content Planner

Build a reviewable weekly editorial plan from the repository's persistent topic bank. Optimize for audience growth and trust; do not schedule posts in the production application or require a GFNF scan.

## Load planning context

1. Read [references/editorial-policy.md](references/editorial-policy.md).
2. Run `node .agents/skills/weekly-content-planner/scripts/collect-planning-context.mjs` from the repository root.
3. Treat `content/topic-bank.json` as the source of truth for ideas and the most recent eight files in `content/plans/` as repetition history.
4. The helper may also return locally saved image references from ignored SQLite data. If none are available, leave the primary reference unresolved and ask the user to choose one; never invent an ID.

## Plan the week

- Interpret “next week” as the next Monday-through-Sunday period in `America/New_York` unless the user supplies another week or timezone.
- Plan four Instagram carousel posts for Monday, Wednesday, Friday, and Sunday at 10:00 AM local time.
- Exclude parked, expired, already planned, or recently repeated ideas. Prefer one idea from each editorial pillar. Use no more than two ideas from one pillar when a complete four-pillar mix is impossible.
- Research every current or factual claim before drafting. Prefer primary authoritative sources, record the URL and access date, and remove claims that cannot be supported. Stored source links are starting points, not proof that a claim is still current.
- Prepare exactly three slides per post. Supply each slide's purpose, exact headline and body copy, visual direction, and claim-to-source mapping. Also supply a caption and one clear CTA.
- Choose one primary image reference for the whole carousel. Up to two secondary references may be listed only as non-renderer art-direction notes with one explicit role each.
- Use the template at [assets/weekly-plan-template.md](assets/weekly-plan-template.md) for the saved plan.

## Review before writing

Present the proposed calendar and briefs in chat before changing planning state. Call out unresolved sources or references. On approval:

1. Save the complete plan as `content/plans/YYYY-MM-DD.md`, using the Monday date.
2. Update each selected topic in `content/topic-bank.json` to `planned` and set `lastPlannedFor` to that Monday date.
3. Add any user-approved new ideas to the topic bank. Never persist Codex-proposed ideas without approval.

If the user explicitly asks to save an already approved calendar, do not request another approval.

## Maintain the idea bank

- Accept rough user ideas and refine them into useful premises without adding unsupported factual claims.
- When fewer than eight eligible backlog ideas remain, propose enough evergreen ideas to restore a four-week reserve of sixteen eligible ideas.
- Keep IDs stable, lowercase, and hyphenated. Preserve published and parked records as history instead of deleting them.
- A user may move an item from `planned` to `published`, return it to `backlog`, or park it. Do not infer publication from the passage of time.

## Boundaries

- This skill creates editorial artifacts only. It does not call GFNF ingestion, image generation, Discord, Telegram, Zernio, or application scheduling.
- Do not present market commentary as financial advice or invent prices, availability, release dates, retailer rules, or performance analytics.
- The current renderer accepts one anchor reference. Secondary references are guidance for a human or future multi-reference implementation and must not be described as renderer inputs.
