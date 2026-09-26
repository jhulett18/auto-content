# Auto Content Studio

Auto Content Studio is a local-first Next.js application for turning recent message context and saved social-media references into original carousel artwork. It combines an Aletheia message export, an Apify-derived reference library, and OpenAI analysis and image generation in one guided workflow.

## What works today

The current workflow is:

1. Start a draft and load the newest messages from an Aletheia JSONL export.
2. Choose a storytelling style.
3. Select one image from the reference library as the visual anchor.
4. Name a carousel, choose 3–10 slides, and create the carousel session.
5. Generate each slide individually, optionally supplying a revision instruction.
6. Keep approved slides and continue until the carousel is complete.
7. Browse generated test images and saved carousel sets in **Generations**.

Reference images are used as visual inspiration. The generation prompt asks for original compositions and explicitly avoids copying logos, characters, branded artwork, exact wording, packaging, or recognizable intellectual property.

## Current carousel behavior

Selecting a reference does **not** immediately generate a full carousel. It sets the anchor and opens the carousel builder. Creating the carousel produces the slide records, and the user then generates and approves each slide manually.

The **Retry slide** action can generate another image for slide 1 or any other slide. At present, the newest result replaces that slide's active database pointer. Older image files may remain on disk, but there is no variation history or UI for comparing and selecting previous alternatives.

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
```

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

The entire `data/` directory, `.env.local`, build output, and dependencies are ignored by Git. A fresh clone therefore starts without the current local reference library or generated images. Credentials are read only on the server and must never be committed.

The current repository does not include an Apify import command. The reference picker expects `reference_assets` to have been populated in the local SQLite database by the existing ingestion process.

Source reference media is downloaded by the server and sent to OpenAI when analysis or image generation is requested. Review the source platform's terms and your OpenAI data settings before using production or sensitive media.

## Known limitations

- Carousel slides are generated one at a time rather than as an automatic batch.
- Only one image reference can anchor a carousel; video references cannot be selected in this workflow.
- Slide retries do not preserve selectable variation history.
- SQLite and generated files are local to one application instance.
- The Apify ingestion process and sample reference data are not included yet.
- There is no user authentication, hosted object storage, deployment configuration, or background job queue yet.
- Existing local references and generations are intentionally not included in this repository.
