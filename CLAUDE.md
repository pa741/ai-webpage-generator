# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is an AI-powered webpage generator built on two separate runtimes that communicate:

**SvelteKit frontend (`src/`)** — deployed as a server-rendered app. Every URL hit triggers `src/routes/[...slug]/+page.server.ts`, which calls `PageGenerator.ts` to run a two-phase pipeline:
1. **Page Designer** — an LLM agent that reads the URL route, queries the MCP server for available components, and emits a JSON `PageSpec` describing page sections.
2. **HTML Generator** — a single-shot LLM call that turns the `PageSpec` into raw HTML.

The resulting HTML is injected into the page via `{@html}` in `+page.svelte`. Component `<script>` tags are loaded from signed Firebase Storage URLs via `resolveComponentScripts()` in `component-loader.ts`.

**Firebase Functions (`functions/src/`)** — runs the backend agents and exposes an MCP server. Key exports from `index.ts`:
- `mcp` — stateless MCP endpoint that the page designer connects to for component CRUD tools.
- `generateContent` / `createScene` — callable functions for text and Three.js scene generation.
- `evaluateFeedback` — routes user free-form feedback into per-user component overrides or stored preferences (via `SaveUserPreference` / `UpdateComponent`).
- `initializeComponents` / `updateComponents` / `resetComponents` — operator-only functions for seeding the shared component library.

**Component system** — reusable components are AI-generated JavaScript web components (native `HTMLElement` subclasses, always wrapped with Twind for Tailwind CSS). They are stored in Firestore and Firebase Storage. Two scopes exist:
- Default scope (`components/` collection) — shared library, written only by `CreateComponent` and `updateComponents`.
- User scope (`users/{uid}/components/` subcollection) — per-user overrides written by `UpdateComponent` when called with a `userId`.

**Domain toolkit** (`functions/src/toolkits/`) — a single `activeToolkit` export in `active.ts` controls which domain tools are registered on the MCP server and injected into system prompts. Swap the active toolkit here to change the site's domain (currently `dictionaryToolkit`). The `DomainToolkit` interface is in `types.ts`.

**Model routing** — all models are identified by string IDs from environment variables. `resolveLanguageModel()` (in both `src/lib/AI/model-provider.ts` and `functions/src/ai-model-provider.ts`) dispatches to Google Gemini if the model ID contains `gemini`, otherwise to Cerebras.

**Prompts** are `.md` files loaded at startup via `?raw` imports (SvelteKit) or `loadPrompt()` (functions). The six function-side prompts are in `functions/prompts/`; the five SvelteKit-side prompts are in `prompts/`.

**Built-in components** (`google-login`, `feedback-fab`) are Svelte custom elements compiled into the page bundle from `src/Components/`. They are registered in `BUILT_IN_COMPONENTS` in `component-manager.ts` and `BUILT_IN_COMPONENT_IDS` in `component-loader.ts` — both must be kept in sync. The component loader skips them so no dynamic `<script>` is injected.

## Commands

### SvelteKit app
```bash
npm run dev          # start dev server (Vite)
npm run build        # production build
npm run check        # svelte-check type checking
npm run check:watch  # type checking in watch mode
```

### Firebase Functions
```bash
cd functions
npm run build        # compile TypeScript
npm run build:watch  # compile in watch mode
```

### Full local emulation
```bash
npm run emulate      # builds functions, starts Firebase emulators with local data
```
Requires `GOOGLE_APPLICATION_CREDENTIALS=credential.json` (set automatically by the script) and Firebase emulator data in `./emulator-data/`.

### Deploy functions only
```bash
cd functions && npm run deploy
```

## Environment Variables

Copy `.env.example` to `.env` and `functions/.env.example` to `functions/.env`. Key variables:

- Firebase config: `PUBLIC_FIREBASE_*` (SvelteKit public env)
- `RUNWARE_API_KEY` — image generation
- Per-prompt model selection: `PAGE_DESIGNER_MODEL`, `HTML_GENERATOR_MODEL`, `ACTION_RUNNER_MODEL`, `IMAGE_DESCRIPTION_MODEL`, `IMAGE_GENERATION_MODEL` (SvelteKit side)
- `COMPONENT_DESIGNER_MODEL`, `COMPONENT_CODEGEN_MODEL`, `COMPONENT_EVALUATOR_MODEL`, `FEEDBACK_EVALUATOR_MODEL`, `COMPONENT_INITIALIZER_MODEL`, `COMPONENT_CURATOR_MODEL` (functions side)
- `MCP_ENDPOINT` — optional override for the MCP URL (defaults to the Firebase Function URL derived from `PUBLIC_FIREBASE_PROJECT_ID`)

## Component Generation Pipeline

When `CreateComponent` or `UpdateComponent` is called, it runs three sequential LLM phases in `component-manager.ts`:
1. **Designer** (agentic, with component library tools) → outputs `ComponentSpec` JSON
2. **Codegen** (single-shot) → outputs raw JavaScript for a `HTMLElement` subclass
3. **Evaluator** (single-shot) → validates the code; on failure, codegen retries once with feedback

The final JS is patched by `ensureTwind()` to add Twind imports and extend `withTwind(HTMLElement)`, then saved to Firebase Storage with a `gs://` path recorded in Firestore.
