# Auto Content Studio

Auto Content Studio is a local-first Next.js application for turning recent message context and saved social-media references into original carousel artwork. It combines an Aletheia message export, an Apify-derived reference library, and OpenAI analysis and image generation in one guided workflow.

## Project roadmap

See the [generation prototype roadmap](TODO.md) for the current baseline, prioritized backlog, and next milestone.

## What works today

The current workflow is:

1. Start a draft, load the newest 50 messages from the GFNF/Aletheia JSONL export, and select the source message group.
2. Choose a storytelling style.
3. Select one image from the reference library as the visual anchor.
4. Name a carousel, choose 3–10 slides, and create the carousel session.
5. For a three-product GFNF brief, resolve official product photos or upload approved replacements, review AI-proposed trademark covers, and approve every prepared asset.
6. Render each planned slide individually. Authentic-product slides use deterministic text and composition; other drafts retain optional generative revision instructions.
7. Keep approved slides and continue until the carousel is complete.
8. Browse generated test images and saved carousel sets in **Generations**.

Reference images are used as visual inspiration. The generation prompt asks for original compositions and explicitly avoids copying logos, characters, branded artwork, exact wording, packaging, or recognizable intellectual property.

Reference galleries display normalized WebP images through a local disk-backed media handler. The handler refreshes Instagram previews from the permanent post media endpoint and TikTok previews through public oEmbed before validating and caching them on first use. Broken responses fall back to an explicit unavailable state instead of leaving an empty card. Video references show only their poster thumbnail; the original Instagram or TikTok post handles playback.

Generated images can be reviewed and sent to the connected TikTok account through Zernio. Add the server-only `ZERNIO_API_KEY` in `.env.local`, open an image in the generation library, and choose **Send to TikTok**. The composer shows the exact photo, account, TikTok-provided privacy choices, caption, interaction settings, and required confirmations. Because the prototype creates AI imagery, it sends photo posts to TikTok Creator Inbox; review the received draft, apply TikTok's AI-generated content label, and publish in the TikTok app.

For rendered slides, the raw reference pixels are not sent to the image generator. OpenAI vision first reduces the source to a reusable visual brief—palette, composition, typography, lighting, and texture—then the image model renders a new composition for the carousel's target brand. Style-close mode preserves that palette, spatial hierarchy, focal-zone placement, grouping rhythm, negative space, and copy zone while replacing recognizable intellectual property with original category-neutral forms. Deterministic copy follows the reference's detected upper, center, or lower text region rather than using one universal panel. Source handles, promotional calls to action, logos, characters, packaging, fake app interfaces, and marketplace UI remain excluded.

For an authentic-product GFNF brief, the selected GFNF attachment instead supplies a locally derived visual system. The app persists an exact three-slide plan, attempts to resolve each SKU from its official product page, and requests an upload when the official page blocks server access. Vision proposes trademark and character-art mask regions, but a user must review and approve them. Sharp then preserves the remaining product pixels, applies Locked-In Supply cover panels, and composes exact SVG text without asking the image model to redraw packaging.

## Current carousel behavior

Selecting a reference does **not** immediately generate a full carousel. It sets the anchor and opens the carousel builder. Creating the carousel produces the slide records, and the user then generates and approves each slide manually.

The **Retry slide** action can generate another image for slide 1 or any other slide. At present, the newest result replaces that slide's active database pointer. Older image files may remain on disk, but there is no variation history or UI for comparing and selecting previous alternatives.

## Daily GFNF automation

The automation workflow polls the current local day’s GFNF/Aletheia export hourly, groups messages and attachments, and stores each source story with a stable fingerprint. Urgent qualifying ideas are sent to Discord immediately; routine ideas remain available for the daily generation pass. A candidate qualifies when it contains an event signal (`drop`, `stock`, `raffle`, `draw`, `release`, `restock`, `preorder`, or `loaded`) plus either an urgency signal or at least two factual-detail signals. Related updates are consolidated, and explicit corrections can supersede stale timing signals before ranking one source story.

The selected story becomes two separate, persisted three-slide carousel sets. Both use the same exact, source-backed copy with different visual directions. Generated artwork is text-free; Sharp applies deterministic headline, body, brand, and slide-number text afterward. Each slide then passes a vision review for text accuracy, readability, source-brand leakage, prohibited packaging or characters, and fake interfaces before Telegram receives it.

In the reference library, use **Save for automation** to name the image references available to the bot. Telegram shows the selected reference and both carousel variations. Approval buttons select A or B; `/refs` lists available references, and `/ref <name>` regenerates both variations with another saved reference. Telegram updates are consumed on the next cron run.

If `DISCORD_OUTPUT_WEBHOOK_URL` is configured, Discord receives urgent alerts, the nightly summary, complete A/B image previews, and the daily Lock-In Supply report. Keep this channel separate from the Discord channel represented by the Aletheia export so generated messages cannot be re-imported as GFNF source material. After approval, the webhook receives the selected variation, publish time, Zernio post ID, and automation run ID.

### Guided carousel workflow in Discord

The separate Discord worker adds one guided command:

```text
/start
```

The worker synchronizes recent GFNF/Aletheia context hourly. `/start` reads only that saved context, presents up to five unique safe topics, reframes expired alerts into evergreen education, and lets the approver choose from all saved visual references in five-item pages. Each reference is shown as a title, a directly attached cached thumbnail, and a link to the original post; the title falls back from its saved name to its source caption and then its creator/platform label. After choosing three or four slides, Discord shows the exact plan and caption before any image spend. Slide 1 acts as the style proof; approval unlocks the remaining slides, and every slide must pass automated review plus human approval.

After final carousel review, the bot proposes an open Instagram time. Current topics use the earliest safe 10:00 AM ET slot; evergreen topics use an open Monday, Wednesday, Friday, or Sunday at 10:00 AM ET. Rejecting the proposal offers three alternatives. Only **Approve and schedule** uploads the ordered carousel and creates the real Zernio post.

Create a bot in the Discord Developer Portal, install it in the private server with the `bot` and `applications.commands` scopes, and give it View Channel, Send Messages, Attach Files, and Use Application Commands permissions. No Message Content intent is needed. Enable Developer Mode in Discord to copy the server, channel, and user IDs, then configure the four `DISCORD_*` values shown in `.env.example`.

Run the worker beside the Next.js app:

```bash
npm run discord:bot
```

It registers `/start` directly in `DISCORD_GUILD_ID`, so command changes appear immediately. Only users in the comma-separated `DISCORD_APPROVER_USER_IDS` allowlist can run it, only in `DISCORD_APPROVAL_CHANNEL_ID`, and only one generation can run at a time. The legacy singular `DISCORD_APPROVER_USER_ID` remains accepted and is merged into the allowlist. Sessions and generation attempts are persisted per user so approvals survive worker restarts. The **Generate slide 1** and retry buttons explicitly authorize image-generation spend.

Choosing **Cancel** asks whether to save the current session for later or discard it. Saved sessions retain their exact workflow stage without blocking a new workflow. When saved sessions exist, `/start` offers **Resume session** or **Start new**; the resume picker shows each session's topic, progress, reference, slide count, and saved time before restoring it. Discarding closes the session without scheduling anything.

After approval, the chosen three-slide carousel is uploaded and scheduled to the connected Instagram Business or Creator account through Zernio. The default is 10:00 AM America/New_York on the same day as the overnight generation. A source message can override that with `publish: YYYY-MM-DD HH:mm am|pm`. A time that has already passed rolls forward to the next default slot.

Configure the server-only variables shown in `.env.example`, keep the Next.js server running, and install these local cron entries:

```cron
0 * * * * cd /absolute/path/to/auto-content && npm run automation:cron -- --mode=intake
0 20 * * * cd /absolute/path/to/auto-content && npm run automation:cron -- --mode=generate
0 21 * * * cd /absolute/path/to/auto-content && npm run automation:cron -- --mode=report
*/15 * * * * cd /absolute/path/to/auto-content && npm run automation:cron -- --mode=approval
```

The command calls the protected `/api/automation/cron` route. Visit `/automation` to inspect imported candidates, ranking signals, references, variation reviews, approvals, schedules, Zernio post IDs, and failures. The nightly mode fetches GFNF once; the morning approval mode only reads Telegram and never re-generates content. Cron execution is protected by a database lease and external events are processed idempotently.

## Technology

- Next.js 16 App Router and React
- TypeScript
- Zustand for persisted browser workflow state
- SQLite via `better-sqlite3`
- OpenAI vision and image APIs
- Motion for interface transitions
- Yet Another React Lightbox for reference previews

## Local setup

Requirements:

- Node.js 22 or a compatible current Node.js release
- npm
- An Aletheia export endpoint and bearer token
- An OpenAI API key with access to the configured vision and image models

Install dependencies and create the local environment file:

```bash
npm install
cp .env.example .env.local
```

Configure `.env.local`:

```dotenv
ALETHEIA_API_TOKEN=your-server-side-token
ALETHEIA_EXPORT_URL=https://your-aletheia-host/example/export.jsonl
OPENAI_API_KEY=your-server-side-token
OPENAI_VISION_MODEL=your-vision-model
OPENAI_IMAGE_MODEL=your-image-model
OPENAI_IMAGE_BUDGET_USD=10
ZERNIO_API_KEY=your-server-side-token
ZERNIO_INSTAGRAM_ACCOUNT_ID=your-connected-instagram-account-id
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-private-approval-chat-id
DISCORD_OUTPUT_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-id/your-webhook-token
DISCORD_BOT_TOKEN=your-discord-application-bot-token
DISCORD_GUILD_ID=your-private-server-id
DISCORD_APPROVAL_CHANNEL_ID=your-generation-channel-id
DISCORD_APPROVER_USER_ID=your-discord-user-id
DISCORD_APPROVER_USER_IDS=your-discord-user-id,another-authorized-user-id
AUTOMATION_CRON_SECRET=your-long-random-secret
AUTOMATION_APP_URL=http://localhost:3000
AUTOMATION_TIMEZONE=America/New_York
AUTOMATION_DEFAULT_POST_TIME=10:00
```

Set the current image budget in the app or provide `OPENAI_IMAGE_BUDGET_USD` as an initial default. The app subtracts newly recorded Images API costs and warns whenever the tracked remainder falls below $3. Updating the balance in the UI establishes a new baseline, so only later generations are subtracted. OpenAI does not expose prepaid credit balance through a regular project API key, so this is an application budget rather than a live billing-portal balance.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
npm run lint
npm run build
```

## Storage and privacy

Reference metadata, analyses, carousel state, and output metadata are stored in `data/references.sqlite3`. Generated PNG files are stored under `data/generations/` and `data/carousels/`.

User-supplied custom references are stored under `data/custom-references/`, grouped as **Custom References** in the library, and passed through the same normalized local media cache as imported references.

The entire `data/` directory, `.env.local`, build output, and dependencies are ignored by Git. A fresh clone therefore starts without the current local reference library or generated images. Credentials are read only on the server and must never be committed.

The current repository does not include an Apify import command. The reference picker expects `reference_assets` to have been populated in the local SQLite database by the existing ingestion process.

Source reference media is downloaded by the server and sent to OpenAI when analysis or image generation is requested. Review the source platform's terms and your OpenAI data settings before using production or sensitive media.

## Known limitations

- Carousel slides are generated one at a time rather than as an automatic batch.
- Official Pokémon Center pages may block server-side image resolution; authentic-product drafts then require approved uploads.
- Trademark masks require human review before authentic product photos can be used.
- Previously imported social URLs can expire before their first local cache; an Apify refresh is still required to recover those source images.
- Only one image reference can anchor a carousel; video references cannot be selected in this workflow.
- Slide retries do not preserve selectable variation history.
- SQLite and generated files are local to one application instance.
- The Apify ingestion process and sample reference data are not included yet.
- There is no user authentication, hosted object storage, deployment configuration, or background job queue yet.
- Daily automation requires a continuously running local Next.js server, system cron, a private Telegram bot chat, and an Instagram account connected to Zernio.
- Discord slash-command generation requires the lightweight `npm run discord:bot` worker to remain running beside the Next.js app.
- Existing local references and generations are intentionally not included in this repository.
