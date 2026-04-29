# CODEBASE KNOWLEDGE — AI Webpage Generator

> **Self-contained reference for implementing features, fixing bugs, and refactoring.**
> Every claim is tied to a specific file, function, or data structure.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Repository Structure](#3-repository-structure)
4. [System Architecture](#4-system-architecture)
5. [Data Flow: Full Request Lifecycle](#5-data-flow-full-request-lifecycle)
6. [Feature-by-Feature Analysis](#6-feature-by-feature-analysis)
   - 6.1 [Dynamic Page Generation](#61-dynamic-page-generation)
   - 6.2 [Reusable Web Component Library](#62-reusable-web-component-library)
   - 6.3 [Intent-Driven Action Handling](#63-intent-driven-action-handling)
   - 6.4 [On-Demand AI Image Generation](#64-on-demand-ai-image-generation)
   - 6.5 [3D Scene Generation (Partially Disabled)](#65-3d-scene-generation-partially-disabled)
   - 6.6 [Dictionary / Word Tools](#66-dictionary--word-tools)
   - 6.7 [Content Generation (Firebase Function)](#67-content-generation-firebase-function)
7. [MCP (Model Context Protocol) Server](#7-mcp-model-context-protocol-server)
8. [Security & Authentication](#8-security--authentication)
9. [AI Model Provider Abstraction](#9-ai-model-provider-abstraction)
10. [Prompt Architecture](#10-prompt-architecture)
11. [Firebase Infrastructure](#11-firebase-infrastructure)
12. [Logging System](#12-logging-system)
13. [Analytics](#13-analytics)
14. [Nuances, Gotchas & Things You Must Know](#14-nuances-gotchas--things-you-must-know)
15. [Technical Reference & Glossary](#15-technical-reference--glossary)
16. [Firestore Schema](#16-firestore-schema)
17. [Environment Variables](#17-environment-variables)

---

## 1. High-Level Overview

**What it is:** A SvelteKit web application that generates a unique HTML page for *every URL route a user visits*, entirely on-the-fly using AI models. There is no pre-authored content — the entire website is synthesized at request time.

**Primary purpose:** Demonstrate and explore an architecture where AI is the content layer. The URL itself is the prompt. Visit `/cats/funny` and an LLM designs and renders an appropriate webpage about funny cats. Visit `/products/shoes` and you get a shoes product page.

**Business model / use case:** General-purpose AI website platform. Developers can adapt it by swapping prompts and MCP tools to build domain-specific sites (e.g., a dictionary site, a 3D asset browser, a product catalog) without writing frontend templates.

**Key insight about the design:** The AI models have no hard-coded knowledge of what the site is "about." They infer the domain entirely by reading the available MCP tool names and descriptions. Changing which tools are registered changes the AI's understanding of the site's purpose.

---

## 2. Tech Stack & Dependencies

### Frontend / SSR
| Concern | Technology |
|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes-based reactivity) |
| Build tool | Vite 6 |
| CSS | Tailwind CSS 4 (`@tailwindcss/postcss`) |
| Markdown rendering | `marked` |
| Type checking | TypeScript 5.8 |

### Backend / Cloud
| Concern | Technology |
|---|---|
| Hosting + SSR | Firebase Hosting with `frameworksBackend` (SvelteKit adapter-auto) |
| Serverless functions | Firebase Functions v2 (Node 22, region `europe-southwest1`) |
| Database | Firestore |
| File storage | Firebase Storage |
| Remote config | Firebase Remote Config |
| Auth | Firebase Auth (ID tokens) |
| Bot protection | Firebase App Check (Cloudflare Turnstile — currently disabled in code) |
| Analytics | Firebase Analytics (client-side) + GA4 Measurement Protocol (server-side) |

### AI & Model Providers
| Provider | Use |
|---|---|
| Cerebras (`@ai-sdk/cerebras`) | Page designer, HTML renderer, action runner, component generator |
| Google Gemini (`@ai-sdk/google`, `@google/genai`) | 3D scene generation, content generation (configurable via Remote Config) |
| Runware (`@runware/sdk-js`) | Image generation (diffusion model) |
| OpenAI (`openai`, via axios) | Text embeddings for 3D model search (hardcoded key — see Gotchas) |

### Protocol & Tooling
| Concern | Technology |
|---|---|
| AI tool interface | MCP (Model Context Protocol) `@modelcontextprotocol/sdk` |
| AI SDK abstraction | Vercel AI SDK v6 (`ai` package) |
| Schema validation | Zod v3 (frontend/SvelteKit), Zod v4 (functions) |
| Fuzzy search | Fuse.js |

---

## 3. Repository Structure

```
ai-webpage-generator/
├── src/                            # SvelteKit app (frontend + SSR)
│   ├── app.html                    # HTML shell
│   ├── app.css                     # Global styles (Tailwind entry)
│   ├── hooks.server.ts             # Request interceptor (images, actions, bots)
│   ├── Components/
│   │   ├── GoogleLogin.svelte      # (Currently unused in routing)
│   │   ├── TextContent.svelte      # Custom element for AI text content
│   │   └── ThreeCanvas.svelte      # Custom element for 3D scenes (DISABLED)
│   ├── lib/
│   │   ├── AI/
│   │   │   ├── PageGenerator.ts    # Core AI orchestration (DesignPage, RequestHtml, HandleAction, GenerateImageFromRoute)
│   │   │   ├── component-loader.ts # Resolves component IDs → signed GCS URLs
│   │   │   └── model-provider.ts   # Cerebras/Google model resolution (SvelteKit side)
│   │   ├── analytics.ts            # Client-side Firebase Analytics helpers
│   │   ├── firebase.ts             # Firebase client SDK init (App Check disabled)
│   │   ├── firebase_admin.ts       # Firebase Admin SDK init (applicationDefault)
│   │   ├── logger.ts               # Structured JSON logger with AsyncLocalStorage
│   │   └── server_analytics.ts     # Server-side GA4 Measurement Protocol
│   └── routes/
│       ├── +layout.server.ts       # App Check cookie validation
│       ├── +layout.svelte          # Root layout, shows "Checking browser" until token valid
│       ├── +layout.ts              # Client-side App Check token fetch
│       ├── api/content-stream/
│       │   └── +server.ts          # Empty (1 line)
│       └── [...slug]/
│           ├── +page.server.ts     # Runs DesignPage + RequestHtml, returns html+componentScripts
│           ├── +page.svelte        # Renders raw HTML via {@html data.html}, injects component <script> tags
│           ├── +page.ts            # Fallback: if no SSR data, fires POST to set App Check cookie
│           └── +server.ts          # POST handler: verifies App Check token, sets __session cookie
│
├── functions/                      # Firebase Functions (separate Node project)
│   ├── src/
│   │   ├── index.ts                # Exports: mcp, generateContent, createScene
│   │   ├── mcp.ts                  # MCP server: registers all tools, handles auth
│   │   ├── component-manager.ts    # Component CRUD + AI generation
│   │   ├── asset-manager.ts        # GetModel (3D), GetHdri (environment maps)
│   │   ├── word-manager.ts         # Dictionary tools (GetWord, SearchWords, etc.)
│   │   ├── ai-model-provider.ts    # Cerebras/Google model resolution (functions side)
│   │   └── logger.ts               # Same structured logger as src/lib/logger.ts
│   └── prompts/
│       └── component_generator.json # Prompt + model for component generation
│
├── prompts/                        # AI prompt files (consumed by SvelteKit SSR)
│   ├── page_designer.json          # Model + prompt for DesignPage
│   ├── html_generator.json         # Model + prompt for RequestHtml
│   ├── action_runner.json          # Model + prompt for HandleAction
│   ├── image_description.json      # Model + prompt for image description step
│   └── image_generation.json       # Model + negative prompt for Runware
│
├── public/                         # Static assets
├── firebase.json                   # Firebase config (hosting, functions, emulators)
├── .firebaserc                     # Firebase project alias
├── storage.rules                   # Firebase Storage rules
└── tailwind.config.js              # Tailwind configuration
```

---

## 4. System Architecture

### Component Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SvelteKit SSR + Hydration                                   │   │
│  │  +layout.svelte  ←── App Check token guard                   │   │
│  │  +page.svelte    ←── Renders {@html data.html}               │   │
│  │                       Injects <script> for each component     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP Request (GET / POST / image)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  FIREBASE HOSTING (SvelteKit SSR)                    │
│                  Region: europe-west1                                │
│                                                                      │
│  hooks.server.ts                                                     │
│  ├── Bot check (blocks all bots except Discordbot)                  │
│  ├── Image request? → GenerateImageFromRoute()                       │
│  ├── Non-GET (without App Check header)? → HandleAction()           │
│  └── GET? → resolve() → +page.server.ts load()                      │
│               ├── App Check cookie validation                        │
│               ├── DesignPage()  ──────────────────┐                 │
│               └── RequestHtml()                   │                 │
│                                                   │                 │
└───────────────────────────────────────────────────┼─────────────────┘
                                                    │ MCP over HTTP
                                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              FIREBASE FUNCTIONS (Node 22, europe-southwest1)         │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  mcp (onRequest)                                             │   │
│  │  ├── Auth: Firebase ID token (Bearer) or emulator bypass     │   │
│  │  ├── Component tools: GetAllComponents, GetComponents,       │   │
│  │  │                    CreateComponent, UpdateComponent       │   │
│  │  └── Word tools: GetWord, SearchWords, GetRandomWord,        │   │
│  │                  WordOfTheDay                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  generateContent (onCall) ← Firebase Remote Config           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  createScene (onCall) ← Gemini + GetModel tool               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Read/Write
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     FIREBASE SERVICES                                │
│                                                                      │
│  Firestore: components, models, hdris, users/{uid}/favoriteWords,   │
│             imageAccessLog                                           │
│  Storage:   components/{id}.js                                       │
│  Remote Config: model IDs, system prompts                            │
│  App Check: session token validation                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### AI Provider Routing

```
Model ID contains "gemini" ?
        │
        ├── YES → @ai-sdk/google (createGoogleGenerativeAI)
        │          Key: GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY
        │
        └── NO  → @ai-sdk/cerebras (createCerebras)
                   Key: CEREBRAS_API_KEY
                   Also used: Cerebras SDK directly for tool-call loops
                   (client.chat.completions.create)
```

---

## 5. Data Flow: Full Request Lifecycle

### 5.1 GET Request → HTML Page

```
Browser GET /some/route
  │
  ▼ hooks.server.ts: handle()
    1. Generate requestId, attach to AsyncLocalStorage
    2. Check User-Agent → 403 if empty
    3. Block bots (204 no content) — except Discordbot
    4. Not an image request, not non-GET → resolve(event)
  │
  ▼ +layout.server.ts: load()
    5. In DEV → return { token: 'dev-token' }
    6. In PROD → verify __session cookie with App Check
       If invalid → delete cookie, return { token: undefined }
  │
  ▼ +layout.ts: load()
    7. If token from server → pass through
    8. If no token AND browser → getToken(check) [App Check client SDK]
       (Currently App Check is DISABLED — check is undefined)
  │
  ▼ +layout.svelte
    9. If no token → show "Checking your browser..." UI (gate)
       (In practice, with App Check disabled, token comes from dev-token or cookie)
  │
  ▼ +page.server.ts: load()
    10. await parent() to get token; abort if no token
    11. pathname === '/' → GenerateHomePage(request)
        otherwise      → GenerateHtml(request, pathname)
    12. resolveComponentScripts(usedComponentIds)
        → Firestore fetch for each component doc
        → signed GCS URLs (1 hr TTL)
    13. Return { html, prompt, token, componentScripts }
  │
  ▼ +page.svelte
    14. Inject component <script src=...> tags into <svelte:head>
    15. {@html data.html} — raw AI-generated HTML injected into DOM
    16. data.prompt hidden in <p class="prompt"> (dev introspection)
```

### 5.2 Non-GET Request → Action

```
Browser POST /favorites/serendipity
  │
  ▼ hooks.server.ts: handle()
    1. Not an image, not App Check POST (no x-__session header)
    2. → HandleAction(event.request)
  │
  ▼ PageGenerator.ts: HandleAction()
    3. Parse body JSON, extract outputFormat field
    4. Build userPrompt: { method, route, body, outputFormat, authenticated }
    5. runMcpToolLoop() with actionRunnerPrompt, allowTool = NOT component tools
    6. AI picks the right MCP tool, calls it
    7. Return JSON 200 matching outputFormat shape
```

### 5.3 Image Request → Generated PNG

```
Browser GET /images/cats/funny.png
  │
  ▼ hooks.server.ts: handle()
    1. Pathname matches /\.(png|jpg|jpeg|gif|webp|avif|svg)$/i
    2. favicon.png/ico → 204 (no content)
    3. → handleImageRequest(event, pathname)
  │
  ▼ hooks.server.ts: handleImageRequest()
    4. Log to Firestore imageAccessLog collection
    5. → GenerateImageFromRoute(event.request, pathname)
  │
  ▼ PageGenerator.ts: GenerateImageFromRoute()
    6. GetImageDescriptionFromRoute(pathname)
       → LLM (qwen-3-32b) converts URL to rich visual description
    7. runware.requestImages({ positivePrompt: description, ... })
       → Runware API returns base64 PNG
    8. Return base64 to hook → decode → Response(imageBuffer)
    Cache-Control: public, max-age=3600, immutable
```

---

## 6. Feature-by-Feature Analysis

### 6.1 Dynamic Page Generation

**Purpose:** Generate a complete, styled HTML page for any URL route using AI, with no pre-written templates.

**Entry point:** `src/routes/[...slug]/+page.server.ts:load()`

**Pipeline:**

```
DesignPage(request, route)
  └── runMcpToolLoop(pageDesignerPrompt, allowTool = COMPONENT_TOOLS | READ_ONLY_DICTIONARY_TOOLS)
        ├── Connect to MCP server (auth: forward Authorization header)
        ├── List available MCP tools
        ├── Loop (max 10 iterations):
        │   ├── Call Cerebras chat completions with tool_choice: 'auto'
        │   ├── If tool_calls → execute each via mcp.callTool(), append results
        │   └── If no tool_calls → done, extract finalText
        └── Return finalText (JSON page spec) + toolInvocations

parsePageSpec(finalText)
  → tries JSON.parse(), strips code fences, extracts { } substring as fallback
  → returns PageSpec { title, description, sections[] }

collectComponentIds(pageSpec, toolInvocations)
  → walks sections tree for component fields
  → also collects IDs from CreateComponent/UpdateComponent tool calls
  → returns string[] of component IDs

RequestHtml(request, pageSpec, usedComponentIds)
  └── generateText(htmlGeneratorPrompt, { pageSpec, availableComponents })
        → Vercel AI SDK, single LLM call (no tools)
        → strips <think>...</think> blocks from output
        → returns raw HTML fragment (no <html>/<head>/<body>)
```

**Key types:**
```typescript
// src/lib/AI/PageGenerator.ts
interface PageSpec {
    title?: string;
    description?: string;
    sections?: PageSection[];
    [key: string]: unknown;
}
interface PageSection {
    component?: string;       // references a component ID
    props?: Record<string, unknown>;
    content?: string;         // inline HTML/text hint
    children?: PageSection[];
}
interface DesignedPage {
    pageSpec: PageSpec;
    rawDesignerOutput: string;
    usedComponentIds: string[];
}
interface GeneratedPage {
    prompt: string;           // rawDesignerOutput
    html: string;             // final HTML fragment
    pageSpec: PageSpec;
    usedComponentIds: string[];
}
```

**Models used:**
- `pageDesignerPrompt.model` = `"gpt-oss-120b"` (Cerebras, via native SDK)
- `htmlGeneratorPrompt.model` = `"gpt-oss-120b"` (Cerebras, via Vercel AI SDK)

**MCP tool loop notes:**
- The loop uses the Cerebras SDK directly (`client.chat.completions.create`) — not the Vercel AI SDK — because it needs to manage conversation history manually with tool results.
- Max iterations: `MAX_TOOL_LOOP_ITERATIONS = 10`
- The designer can create/reuse components during design, collecting their IDs for the renderer.

---

### 6.2 Reusable Web Component Library

**Purpose:** AI-generated, persistently stored JavaScript Web Components that give pages consistent layout and interactive behavior across sessions.

**Business value:** Without this, every page request would invent new markup from scratch. Components give the AI a reusable library to build on, enabling layout consistency and complex interactive elements.

**Component lifecycle:**

```
AI designer calls CreateComponent("my-card", "A card with title, description, image")
  │
  ▼ functions/src/mcp.ts → functions/src/component-manager.ts: CreateComponent()
      → createOrUpdateComponent("create", id, prompt, { depth:0, lineage:[] })
          1. normalizeComponentId: kebab-case, max 64 chars, alphanumeric + - _
          2. If "create" mode AND component already exists in Firestore with gsPath → return cached (NO regeneration)
          3. Read existing source from GCS (for "update" mode)
          4. generateComponentCode({ id, prompt, mode, previousCode, context })
             └── generateText(componentGeneratorPrompt, tools: { GetAllComponents, GetComponents, CreateComponent, UpdateComponent })
                   - Vercel AI SDK agentic loop (stepCountIs(17) stop condition)
                   - Sub-components created recursively (depth+1, lineage tracking)
                   - MAX_RECURSION_DEPTH = 3
                   - MAX_TOOL_CALLS_PER_GENERATION = 16
                   - Returns JSON: { shortDesc, dependencies, code }
          5. storeComponentSource(id, code)
             → Firebase Storage: components/{id}.js
             → Cache-Control: public, max-age=60
          6. Save to Firestore: components/{id} document
          7. Return ComponentSummary { id, shortDesc, gsPath }
```

**Reading components at page render time:**
```
resolveComponentScripts(usedComponentIds)  [src/lib/AI/component-loader.ts]
  → Firestore batch read for each ID
  → signGsPath(gsPath): generate signed URL (v4, 1hr TTL)
    → fallback: public URL https://storage.googleapis.com/...
  → Return ComponentScriptRef[] { id, src, shortDesc }

+page.svelte:
  <svelte:head>
    {#each data.componentScripts as scriptRef}
      <script src={scriptRef.src} defer></script>
    {/each}
  </svelte:head>
```

**Component code contract (from prompt):**
- Single class extending `HTMLElement`, `customElements.define(...)` in the same file
- Props via kebab-case attributes, JSON-decoded for complex types
- Uses Tailwind utility classes (available globally on host page)
- Can make fetch() calls to intent-descriptive routes for server actions
- Response body MUST include `outputFormat` field telling the server what JSON to return
- Returns: `{ shortDesc: string, dependencies: string[], code: string }`

**Cycle / depth protection:**
- `lineage` array tracks the component creation chain
- If `id` already in lineage → `Error: Recursive component cycle detected`
- Depth > 3 → `Error: Max component recursion depth exceeded`

**Important:** `CreateComponent` in "create" mode is idempotent — if a component with that ID already has a `gsPath` in Firestore, it returns the cached version without calling the LLM.

---

### 6.3 Intent-Driven Action Handling

**Purpose:** Handle all non-GET HTTP requests by having an AI pick the right MCP tool based on method, route, and body — no explicit API routing needed.

**Entry point:** `src/hooks.server.ts:handle()` — intercepts non-GET requests that don't carry the `x-__session` App Check header.

**Flow:**
```
HandleAction(request)  [src/lib/AI/PageGenerator.ts]
  1. Parse body JSON; extract outputFormat
  2. Build userPrompt: { method, route, body, rawBody?, outputFormat, authenticated }
  3. runMcpToolLoop(actionRunnerPrompt, allowTool = !COMPONENT_TOOLS)
     → All MCP tools EXCEPT CreateComponent, UpdateComponent, GetAllComponents, GetComponents
  4. parseActionJson(finalText, toolInvocations)
     → If AI returned valid JSON → use it directly
     → If not → synthetic: { ok: bool, message: string, data: lastToolResult }
  5. Return Response(JSON, 200) with Cache-Control: private, no-store
```

**Model:** `actionRunnerPrompt.model` = `"gpt-oss-120b"` (Cerebras)

**Intent-URL convention:** Components POST to routes like `/favorites/serendipity` or `DELETE /comments/42`. The ActionRunner reads the method + route + body together to infer intent. There is no router mapping — the AI decides which tool to call.

**Auth propagation:** The `authenticated` flag in the userPrompt comes from whether the original request carried an `Authorization: Bearer` header. The ActionRunner can use this to decide whether to allow sensitive operations.

---

### 6.4 On-Demand AI Image Generation

**Purpose:** Serve a generated AI image for any URL ending in an image extension. The image content is derived from the URL path itself.

**Entry point:** `src/hooks.server.ts:handleImageRequest()`

**Pipeline:**
```
GET /images/mountain/sunset-landscape.png
  │
  1. Log to Firestore: imageAccessLog { timestamp, method, url, pathname, imageKey }
  2. GetImageDescriptionFromRoute(pathname)
     └── generateText(imageDescriptionPrompt, prompt=pathname)
           Model: qwen-3-32b (Cerebras)
           → "A golden-hour panoramic photograph of jagged mountain peaks..."
  3. runware.ensureConnection()
  4. runware.requestImages({
       model: "runware:100@1",
       positivePrompt: description,
       negativePrompt: "blurry, low quality, ...",
       numberResults: 1,
       CFGScale: 1, steps: 1,
       outputType: 'base64Data',
       outputFormat: 'PNG',
       width: 1024, height: 1024
     })
  5. Return imageBuffer as Response
     Content-Type: image/png
     Cache-Control: public, max-age=3600, immutable
```

**favicon handling:** Requests for `favicon.png` or `favicon.ico` return 204 immediately (no generation).

**Runware model:** `"runware:100@1"` — fast diffusion model, 1 step (very fast, lower quality acceptable for web use).

---

### 6.5 3D Scene Generation (Partially Disabled)

**Purpose:** Generate Three.js scenes with AI-selected low-poly 3D models from Poly Pizza, driven by a text description.

**Status:** The Firebase Function `createScene` is fully implemented. The `ThreeCanvas.svelte` component is registered as `<three-canvas>` but its implementation is entirely commented out.

**`createScene` function (`functions/src/index.ts`):**
```
Input: { description: string }
  │
  1. GetConfig → Remote Config: three_generator_prompt, three_generator_model
  2. Gemini generateContent with tool: GetModel
  3. Tool loop:
     ├── AI requests models by search term via GetModel()
     │   → createEmbedding(search) via OpenAI embeddings API
     │   → Firestore findNearest (COSINE distance on `embedding` vector field)
     │   → Returns storageUrl of .glb file
     └── AI receives model URLs, continues building scene script
  4. Return { script: string } — Three.js JavaScript
```

**`GetHdri` (`functions/src/asset-manager.ts`):** Queries `hdris` Firestore collection by tag array (`array-contains-any`). Declared as a tool in `index.ts` but commented out from the tool list.

**Model data:** The `models` Firestore collection must be pre-populated with `PolyPizzaAsset` documents including `embedding` (vector) and `storageUrl` fields. `LoadHdris()` in asset-manager populates the `hdris` collection from PolyHaven API.

---

### 6.6 Dictionary / Word Tools

**Purpose:** Provide MCP tools that the AI can use when the site's domain involves words (e.g., a vocabulary/dictionary site). The AI discovers these tools via MCP listing and uses them to populate page content.

**Tools (registered in `functions/src/mcp.ts`, implemented in `functions/src/word-manager.ts`):**

| Tool | Description |
|---|---|
| `GetWord` | Exact word lookup + dictionary API definition |
| `SearchWords` | Fuzzy search (Fuse.js, threshold 0.35) with prefix fallback |
| `GetRandomWord` | Random word with optional length range |
| `WordOfTheDay` | Deterministic word of the day by date (SHA256 of date → index) |
| `AddFavoriteWord` | (Commented out — requires auth) |
| `GetFavoriteWords` | (Commented out — requires auth) |

**Word corpus:** `word-list` npm package, loaded into memory and cached on first call. Normalized to lowercase, deduplicated.

**Word of the Day algorithm (`word-manager.ts:GetWordOfTheDay`):**
```typescript
const index = createHash("sha256").update(seedOfDay).digest().readUInt32BE(0);
const wordOfTheDay = words[index % words.length];
```
This is deterministic: the same date always produces the same word, regardless of server instance.

**Dictionary lookups:** Use `dictionary-api-client` npm package. Word must exist exactly in the word-list corpus first (validated by `ensureExactWordMatch`).

**Favorite words (disabled):** Would store per-user favorites in `users/{uid}/favoriteWords` Firestore subcollection. Requires Firebase Auth ID token.

---

### 6.7 Content Generation (Firebase Function)

**Purpose:** Stream AI-generated text content for page elements. Originally intended for `<text-content>` web components that would call this function to fill themselves with AI-written copy.

**Function:** `generateContent` (onCall, `functions/src/index.ts`)
- Input: `{ description: string }`
- Model + prompt: pulled from Firebase Remote Config (`content_writter_prompt`, `content_writter_model`)
- Supports streaming via `request.acceptsStreaming` → `response.sendChunk({ content })`
- Returns full accumulated response array

**Current integration status:** The `+page.svelte` calling code is commented out. The `TextContent.svelte` component and `customElements.define("text-content", ...)` in `+layout.svelte` are also commented out. This feature is not active.

---

## 7. MCP (Model Context Protocol) Server

**What it is:** An HTTP endpoint (`/mcp` Firebase Function, region `europe-southwest1`) that the SvelteKit SSR layer connects to as a tool server. The AI models use it to read data and perform side effects.

**Implementation:** `functions/src/mcp.ts`

**Transport:** `StreamableHTTPServerTransport` (MCP SDK) with `enableJsonResponse: true`

**URL resolution (`PageGenerator.ts:resolveMcpUrl`):**
1. If `MCP_ENDPOINT` env var is set → use it
2. Else if `PUBLIC_FIREBASE_PROJECT_ID` → `https://europe-southwest1-{project}.cloudfunctions.net/mcp`
3. Else → derive from the incoming request host (`/mcp` path on same origin)

**Auth flow:**
- In emulator: `FUNCTIONS_EMULATOR === "true"` → userId = `"emulator-user"` (bypasses token check)
- In production: `Authorization: Bearer <Firebase ID Token>` header required for auth-gated tools
- Currently all registered tools work without a userId (favorites are commented out)
- The SvelteKit SSR layer forwards the original request's `Authorization` header to the MCP server

**Tool registration pattern:**
```typescript
mcp.registerTool("ToolName", {
    description: "...",
    inputSchema: { param: z.string() }
}, instrument("ToolName", async ({ param }) => handler(param)));
```

The `instrument()` wrapper adds timing + error logging uniformly to all tools.

**Tool categories visible to each AI agent:**

| Agent | Allowed tools |
|---|---|
| Page Designer | COMPONENT_TOOLS + READ_ONLY_DICTIONARY_TOOLS |
| HTML Renderer | None (no MCP, uses `generateText` directly) |
| Action Runner | All EXCEPT COMPONENT_TOOLS |
| Component Generator | COMPONENT_TOOLS (via Vercel AI SDK inline tools) |

Where:
```
COMPONENT_TOOLS = { GetAllComponents, GetComponents, CreateComponent, UpdateComponent }
READ_ONLY_DICTIONARY_TOOLS = { GetWord, SearchWords, GetRandomWord, GetWordOfTheDay, GetFavoriteWords }
```

---

## 8. Security & Authentication

### App Check (Bot / Abuse Protection)

The App Check system is designed to ensure only real browsers (verified by Cloudflare Turnstile) can trigger AI generation. **Currently the Cloudflare Turnstile provider is disabled** (`check` is `undefined`).

**Token flow (when enabled):**
```
1. Browser loads page → +layout.ts calls getToken(check) → gets App Check JWT
2. Browser POSTs to [...slug]/+server.ts with x-__session header
3. +server.ts verifies token via getAppCheck().verifyToken(token)
4. Sets __session cookie (httpOnly: false, secure: true, sameSite: none, 1hr TTL)
5. Subsequent GET requests carry __session cookie
6. +layout.server.ts verifies cookie on every page load
```

**In DEV:** `+layout.server.ts` returns `{ token: 'dev-token' }` immediately, bypassing all App Check.

### Bot Blocking (`hooks.server.ts`)

```typescript
const isBot = /bot|crawl|spider|slurp|mediapartners/i.test(userAgent);
const isDiscordBot = /Discordbot/i.test(userAgent);
if (isBot && !isDiscordBot) → return 204 No Content
```

Discord bots are specifically whitelisted so Open Graph previews work (Discord fetches URLs for link previews).

Empty User-Agent → 403.

### Non-GET Request Routing

Non-GET requests that carry `x-__session` or `__session` header are treated as App Check token establishment (POST to `[...slug]/+server.ts`). All other non-GET requests go to `HandleAction`.

### Firebase Auth (for MCP tools)

User-facing authenticated operations (favorites) use Firebase Auth ID tokens in `Authorization: Bearer` header, verified server-side in the MCP handler. Currently disabled via commented-out tool registrations.

### Response Headers (all pages)

```
Cache-Control: private, no-cache
Vary: Cookie, Accept
X-Robots-Tag: noindex, nofollow
```

---

## 9. AI Model Provider Abstraction

Two parallel implementations of the same abstraction (one for SvelteKit, one for Functions):

- `src/lib/AI/model-provider.ts`
- `functions/src/ai-model-provider.ts`

**Interface:**
```typescript
resolveLanguageModel(modelId: string): LanguageModel  // Vercel AI SDK LanguageModel
resolveProviderName(modelId: string): 'google' | 'cerebras'
isGeminiModel(modelId: string): boolean  // regex: /gemini/i
```

**Decision logic:** If model ID contains `"gemini"` (case-insensitive) → use Google provider. Otherwise → use Cerebras.

**Important:** The Page Designer and Action Runner use the Cerebras SDK **directly** (`@cerebras/cerebras_cloud_sdk`) for their tool-call loop — not the Vercel AI SDK abstraction. This is because the native SDK's `client.chat.completions.create` gives direct control over the multi-turn conversation array needed for the tool loop. The `resolveLanguageModel` abstraction is used by `RequestHtml` (single `generateText` call), `GetImageDescriptionFromRoute`, and the component generator.

---

## 10. Prompt Architecture

All system prompts are externalized as JSON files with `{ model, prompt }` structure. This allows swapping models or editing prompts without code changes.

### Prompt Files

| File | Agent | Model | Key instructions |
|---|---|---|---|
| `prompts/page_designer.json` | Page Designer | `gpt-oss-120b` | Infer site purpose from MCP tools. Produce JSON page spec. Use components. |
| `prompts/html_generator.json` | HTML Renderer | `gpt-oss-120b` | Convert page spec to HTML fragment. Use Tailwind. Render components as custom elements. |
| `prompts/action_runner.json` | Action Runner | `gpt-oss-120b` | Pick the right tool for the HTTP intent. Return JSON matching outputFormat. |
| `prompts/image_description.json` | Image Describer | `qwen-3-32b` | Convert URL path to rich visual image description. |
| `prompts/image_generation.json` | (Runware config) | `runware:100@1` | negativePrompt only — no system prompt |
| `functions/prompts/component_generator.json` | Component Generator | `gpt-oss-120b` | Create self-sufficient Web Components. Return JSON: shortDesc, dependencies, code. |

### Key Prompt Design Decisions

1. **"Domain inference from tools"**: The Page Designer prompt explicitly says: *"The available MCP tools are the only source of truth about what this site is about."* This means the AI's behavior changes purely by changing which tools are registered — no prompt edits needed.

2. **Intent-descriptive URLs**: The Component Generator and Action Runner prompts instruct the AI to use routes like `POST /favorites/serendipity` rather than fixed API endpoints. The URL is itself documentation of intent.

3. **outputFormat contract**: Components must include `outputFormat` in their fetch bodies. The Action Runner reads this field to decide what JSON to return. This creates a loose but functional API contract between frontend components and the server AI.

4. **No code fences**: All agents are instructed to return "ONLY a JSON object (no prose, no code fences)." The parser (`parsePageSpec`, `parseActionJson`, `parseGeneratedPayload`) still strips code fences defensively.

---

## 11. Firebase Infrastructure

### Firebase Functions

| Function | Trigger | Region | Timeout |
|---|---|---|---|
| `mcp` | `onRequest` | `europe-southwest1` | 3600s (1hr) |
| `generateContent` | `onCall` | `europe-southwest1` | default |
| `createScene` | `onCall` | `europe-southwest1` | default |

### Firebase Hosting

- Source: `.` (repo root)
- Framework backend region: `europe-west1`
- SvelteKit auto-adapter handles SSR

### Firebase Storage Rules

Defined in `storage.rules` (not read in full, but component JS files stored as `components/{id}.js` with `public, max-age=60` cache).

### Firestore Collections

See [Section 16: Firestore Schema](#16-firestore-schema).

### Firebase Emulator Suite

```
Auth:      9099
Functions: 5001
Firestore: 5003
Hosting:   5000
Storage:   9199
UI:        enabled
```

Start with: `npm run emulate` (sets `GOOGLE_APPLICATION_CREDENTIALS=credential.json`, imports from `./emulator-data`).

### Firebase Remote Config (Functions)

Used by `generateContent` and `createScene` functions to read:
- `content_writter_prompt` (note: typo is intentional in current code)
- `content_writter_model`
- `three_generator_prompt`
- `three_generator_model`

Config is evaluated per-request using `Sec-CH-UA-Platform`, `User-Agent`, `Accept-Language`, `Referer` headers — enabling model/prompt A/B testing by platform or region.

---

## 12. Logging System

**Implementation:** `src/lib/logger.ts` and `functions/src/logger.ts` — identical in structure, duplicated for the two separate Node environments.

**Format:** Structured JSON, one object per line (compatible with Firebase Cloud Logging):
```json
{ "ts": "2026-04-29T10:00:00.000Z", "level": "info", "scope": "app.hooks.request", "msg": "request.done", "requestId": "...", "duration_ms": 245 }
```

**Scoping:** `logger.child('scope')` creates a sub-logger that prepends `parentScope.childScope`.

**Timing pattern:**
```typescript
const stop = log.time('operation', { startFields });
// ... do work ...
stop({ endFields });
// emits: operation.start (debug) and operation.done (info) with duration_ms
```

**Request context:** Uses Node `AsyncLocalStorage` to propagate `requestId` and base fields automatically to all log calls within the same async tree — no need to pass logger instances around.

**Log level:** `LOG_LEVEL` env var (default: `info`). Values: `debug`, `info`, `warn`, `error`.

---

## 13. Analytics

### Client-side (Firebase Analytics)

`src/lib/analytics.ts` — wraps `firebase/analytics logEvent`.

Tracked events:
| Function | Event name |
|---|---|
| `trackPageView` | `page_view` |
| `trackWebsiteGeneration` | `website_generated` |
| `trackAIInteraction` | `ai_interaction` (includes model name) |
| `trackError` | `error_occurred` |
| `trackUserEngagement` | `user_engagement` |

### Server-side (GA4 Measurement Protocol)

`src/lib/server_analytics.ts` — POSTs directly to `https://www.google-analytics.com/mp/collect`.

Used in `hooks.server.ts` for:
- `image_viewed` — every image generation request
- `blocked_access` — requests blocked for no User-Agent
- `bot_access` — bot requests

Requires env vars: `GA_MEASUREMENT_ID`, `GA_API_SECRET`.

---

## 14. Nuances, Gotchas & Things You Must Know

### 1. Hardcoded OpenAI API Key in `asset-manager.ts`

```typescript
// functions/src/asset-manager.ts:99
const apiKey = process.env.OPENAI_API_KEY || "sk-proj-Cbrp-jcr...";
```

**A real API key is hardcoded as a fallback.** This is a security issue. The key is used for text embeddings in `GetModel()`. Always set `OPENAI_API_KEY` in `functions/.env` and never rely on this fallback.

### 2. App Check Is Currently Disabled

`src/lib/firebase.ts` has the Cloudflare Turnstile initialization commented out:
```typescript
//cpo = new CloudflareProviderOptions(HTTP_ENDPOINT, PUBLIC_TURNSTILE_SITE_KEY);
//const provider = new CustomProvider(cpo);
//check = initializeAppCheck(app, { provider });
```

`check` is `undefined`. The `+layout.ts` falls through to `return {}` when `!check`. Pages load without verification. This means the bot-blocking in `hooks.server.ts` is the only protection against AI generation abuse.

### 3. `CreateComponent` Is Idempotent (Intentional Cache)

If you call `CreateComponent("my-component", ...)` and that component already has a `gsPath` in Firestore, the LLM is **not called again** — the cached version is returned immediately. This is by design for performance. To force regeneration, call `UpdateComponent` instead, or delete the Firestore document.

### 4. Component Source Cache TTL Is 60 Seconds

Components stored in GCS have `Cache-Control: public, max-age=60`. Updated components take up to 60 seconds to be served fresh. Signed URLs for delivery have a 1-hour TTL.

### 5. `parseToolJson` Expects MCP Text Content Array

The MCP SDK returns tool results as `{ content: [{ type: "text", text: "..." }] }`. `parseToolJson` in `PageGenerator.ts` extracts text items, joins them, and JSON-parses. If an MCP tool returns binary or non-text content, this silently returns `null`.

### 6. The MCP Loop Uses Cerebras SDK Directly (Not Vercel AI SDK)

The `runMcpToolLoop` function in `PageGenerator.ts` calls `client.chat.completions.create()` (Cerebras native SDK) for conversation management, not `generateText`. This means `model-provider.ts`'s `resolveLanguageModel` is NOT used for the designer/action-runner — those always go to Cerebras, regardless of what `pageDesignerPrompt.model` resolves to via the provider abstraction.

**In practice:** All four prompt JSON files use `"gpt-oss-120b"`, which is a Cerebras model. If you want to switch the designer to Gemini, you'd need to refactor `runMcpToolLoop` to use the Vercel AI SDK or Google's native function-calling API.

### 7. Non-GET Without App Check Header Goes to ActionRunner

The check in `hooks.server.ts` is:
```typescript
const isAppCheckPost = Boolean(
    event.request.headers.get('x-__session') || event.request.headers.get('__session')
);
if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !isAppCheckPost) {
    → HandleAction(event.request);
}
```

Any POST/PUT/DELETE/PATCH that doesn't carry `x-__session` header is routed to the AI ActionRunner. This means if you add any conventional REST API endpoints in SvelteKit routes (like `+server.ts` POST handlers), they will be intercepted by the ActionRunner instead of reaching your handler — unless you add them to a bypass list.

### 8. `+page.ts` Fallback: Reload After Cookie Set

When the server-side `load()` runs without a token (App Check not passed), the client-side `+page.ts:load()` fires a `POST` to `window.location.href` with the App Check token in `x-__session`. After success, it calls `window.location.reload()`. This is a full page reload — not a Svelte navigation. The reload then picks up the cookie and triggers SSR generation.

### 9. Zod Version Mismatch

The root `package.json` depends on `zod: ^3.x`, while `functions/package.json` depends on `zod: ^4.x`. In `functions/src/mcp.ts`, schemas are imported via `zod/v4` subpath to use Zod v4 explicitly:
```typescript
import { z } from "zod/v4";
```
Do not mix Zod v3 and v4 APIs in the functions package.

### 10. All Pages Are `noindex, nofollow`

Every response from the SvelteKit SSR carries:
```
X-Robots-Tag: noindex, nofollow
```
The site is intentionally not indexed by search engines.

### 11. Discord Bot Specifically Whitelisted

`/Discordbot/i` is excluded from bot blocking. This allows Discord to fetch Open Graph metadata when users share links. Other bots (Googlebot, Bingbot, etc.) get 204 No Content.

### 12. `ThreeCanvas.svelte` Is a Dead Component

The `ThreeCanvas` component is compiled as a custom element (`<three-canvas>`) but all its logic is commented out. It imports nothing useful at runtime. It is imported in `+layout.svelte` script section but not rendered or registered via `customElements.define`. Safe to ignore for now.

### 13. `functions/src/logger.ts` Is a Duplicate

`functions/src/logger.ts` is functionally identical to `src/lib/logger.ts`. They exist separately because Firebase Functions is a separate Node.js package that cannot import from the SvelteKit `src/` tree. Any changes to the logger API must be applied to both files.

---

## 15. Technical Reference & Glossary

### Key Functions

| Function | File | Purpose |
|---|---|---|
| `GenerateHtml(request, route)` | `src/lib/AI/PageGenerator.ts` | Full pipeline: design + render HTML for a route |
| `GenerateHomePage(request)` | same | Alias for `GenerateHtml(request, '')` |
| `DesignPage(request, route)` | same | Stage 1: MCP tool loop → JSON page spec |
| `RequestHtml(request, pageSpec, ids)` | same | Stage 2: page spec → HTML fragment |
| `HandleAction(request)` | same | Non-GET requests → AI picks MCP tool |
| `GenerateImageFromRoute(request, route)` | same | URL → description → Runware image → base64 |
| `runMcpToolLoop(input)` | same | Generic Cerebras + MCP agentic loop |
| `resolveMcpUrl(request)` | same | Resolves MCP endpoint URL |
| `withMcpClient(request, action)` | same | Opens MCP session, runs action, closes |
| `resolveComponentScripts(ids)` | `src/lib/AI/component-loader.ts` | IDs → signed GCS URLs |
| `signGsPath(gsPath)` | same | `gs://bucket/path` → signed HTTPS URL |
| `resolveLanguageModel(modelId)` | `src/lib/AI/model-provider.ts` | Model ID → Vercel AI SDK LanguageModel |
| `CreateComponent(id, prompt)` | `functions/src/component-manager.ts` | Create/cache Web Component |
| `UpdateComponent(id, prompt)` | same | Regenerate existing Web Component |
| `GetAllComponents()` | same | List all components from Firestore (max 250) |
| `GetComponents(purpose)` | same | Fuzzy text-score search over component summaries |
| `generateComponentCode(input)` | same | Agentic LLM call → { shortDesc, dependencies, code } |
| `storeComponentSource(id, code)` | same | Save JS to GCS, return `gs://` path |
| `mcpHandler(request, response)` | `functions/src/mcp.ts` | Handle MCP HTTP request |
| `registerTools(mcp, authContext)` | same | Register all tools on MCP server instance |
| `instrument(toolName, handler)` | same | Wrap tool with timing + error logging |
| `GetWord(word)` | `functions/src/word-manager.ts` | Exact dictionary lookup |
| `SearchWords(query, limit)` | same | Fuse.js fuzzy search |
| `GetRandomWord(min, max)` | same | Random word within length bounds |
| `GetWordOfTheDay(date)` | same | Deterministic word by date |
| `GetModel(search, ai)` | `functions/src/asset-manager.ts` | Semantic search for 3D model (.glb URL) |
| `GetHdri(tags)` | same | Tag-based HDRI lookup |

### Glossary

| Term | Meaning |
|---|---|
| **Page Spec** | JSON object `{ title, description, sections[] }` produced by the Page Designer |
| **Page Section** | One entry in `sections[]`: either `{ component, props, children }` or `{ content }` |
| **Component** | AI-generated JavaScript Web Component, stored in Firebase Storage + Firestore |
| **MCP** | Model Context Protocol — standardized HTTP protocol for AI tool use |
| **Tool Loop** | Agentic pattern: LLM calls tools, receives results, calls more tools, until done |
| **ActionRunner** | The AI agent that handles non-GET HTTP requests by picking the right MCP tool |
| **Page Designer** | The AI agent that designs the page structure (JSON spec) for a route |
| **HTML Renderer** | The AI agent that converts a page spec to an HTML fragment |
| **Component Generator** | The AI agent that generates JavaScript Web Component source code |
| **gsPath** | `gs://bucket-name/path/to/file.js` — GCS object reference stored in Firestore |
| **Intent URL** | A fetch route whose path describes the action: `POST /favorites/word` |
| **outputFormat** | A field in POST bodies that tells the ActionRunner what JSON shape to return |
| **App Check** | Firebase feature verifying requests come from genuine app instances |
| **Word corpus** | The full `word-list` npm package word list, loaded and cached in memory |
| **Fuse index** | In-memory Fuse.js search index built over the word corpus |
| **HDRI** | High Dynamic Range Image — used as environment maps in Three.js scenes |
| **`lineage`** | Array tracking component IDs in the current creation chain (cycle detection) |

---

## 16. Firestore Schema

### `components` collection

```
/components/{componentId}
  id:           string     — same as document ID, normalized kebab-case
  shortDesc:    string     — one-sentence human description
  gsPath:       string     — "gs://bucket/components/{id}.js"
  prompt:       string     — original creation prompt
  dependencies: string[]   — IDs of other components this one uses
  createdAt:    Timestamp
  updatedAt:    Timestamp
```

### `models` collection (3D assets)

```
/models/{modelId}
  ID:           string     — Poly Pizza asset ID
  Title:        string
  Description:  string?
  Attribution:  string
  Thumbnail:    string     — URL
  Download:     string     — original download URL
  Tri Count:    number
  Creator:      { Username, DPURL }
  Category:     string
  Tags:         string[]
  Licence:      string
  Animated:     boolean
  storageUrl:   string     — GCS URL for the .glb file
  embedding:    number[]   — OpenAI text-embedding-3-small vector
```

### `hdris` collection (environment maps)

```
/hdris/{hdriKey}
  name:             string
  type:             number
  date_published:   number
  download_count:   number
  files_hash:       string
  authors:          Record<string, string>
  categories:       string[]
  tags:             string[]
  max_resolution:   [number, number]
  dimensions:       [number, number]
  thumbnail_url:    string
  hdriUrl:          string     — direct .hdr download URL (lowest available resolution)
```

### `users/{uid}/favoriteWords` subcollection (disabled)

```
/users/{uid}/favoriteWords/{word}
  word:       string
  createdAt:  Timestamp
  updatedAt:  Timestamp
```

### `imageAccessLog` collection

```
/imageAccessLog/{autoId}
  timestamp:  Timestamp (serverTimestamp)
  method:     string
  url:        string
  pathname:   string
  headers:    Record<string, string>
  imageKey:   string    — path-derived key (slashes replaced with dashes, no extension)
```

---

## 17. Environment Variables

### SvelteKit (`.env` in root)

| Variable | Scope | Required | Purpose |
|---|---|---|---|
| `CEREBRAS_API_KEY` | Private | Yes | Cerebras API for Page Designer, Renderer, ActionRunner |
| `RUNWARE_API_KEY` | Private | Yes | Runware API for image generation |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Private | If using Gemini models | Google AI for Gemini-based generation |
| `GEMINI_API_KEY` | Private | Fallback for above | Alternative Google key name |
| `MCP_ENDPOINT` | Private | No | Override MCP server URL (defaults to derived URL) |
| `GA_MEASUREMENT_ID` | Private | For server analytics | GA4 Measurement ID |
| `GA_API_SECRET` | Private | For server analytics | GA4 API Secret |
| `LOG_LEVEL` | Private | No | Log verbosity (debug/info/warn/error, default: info) |
| `PUBLIC_FIREBASE_API_KEY` | Public | Yes | Firebase client config |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | Public | Yes | Firebase client config |
| `PUBLIC_FIREBASE_PROJECT_ID` | Public | Yes | Firebase project ID (also used for MCP URL) |
| `PUBLIC_FIREBASE_STORAGE_BUCKET` | Public | Yes | Firebase client config |
| `PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Public | Yes | Firebase client config |
| `PUBLIC_FIREBASE_APP_ID` | Public | Yes | Firebase client config |
| `PUBLIC_FIREBASE_MEASUREMENT_ID` | Public | Yes | Firebase Analytics |
| `PUBLIC_TURNSTILE_SITE_KEY` | Public | If App Check enabled | Cloudflare Turnstile site key |

### Firebase Functions (`functions/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `CEREBRAS_API_KEY` | Yes (if Cerebras models) | Cerebras API |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes (if Gemini) | Google Gemini API |
| `GEMINI_API_KEY` | Fallback | Alternative Google key name |
| `OPENAI_API_KEY` | Yes (for GetModel) | OpenAI embeddings for 3D model search |
| `FUNCTIONS_EMULATOR` | Auto-set | `"true"` in emulator, bypasses MCP auth |
| `LOG_LEVEL` | No | Logger verbosity |

---

## Architecture Diagrams

### Page Generation Pipeline

```
Route: /vocabulary/serendipity
           │
           ▼
    [Page Designer] ─── MCP ──▶ GetAllComponents()
    Cerebras native           ──▶ CreateComponent("word-card", "...")
    gpt-oss-120b              ──▶ GetWord("serendipity")
    max 10 iterations         ◀── { word, definition, ... }
           │
           │ JSON PageSpec:
           │ {
           │   title: "Serendipity",
           │   sections: [
           │     { component: "word-card", props: { word: "serendipity" } },
           │     { content: "<p>Word of the day exploration...</p>" }
           │   ]
           │ }
           ▼
    [HTML Renderer]
    Cerebras via Vercel AI SDK
    gpt-oss-120b
    Single generateText call
           │
           │ HTML fragment:
           │ <main class="p-8">
           │   <word-card word="serendipity"></word-card>
           │   <p>Word of the day...</p>
           │ </main>
           ▼
    [component-loader]
    Firestore: get doc "word-card"
    GCS: generate signed URL
           │
           │ ComponentScriptRef:
           │ { id: "word-card", src: "https://storage.googleapis.com/..." }
           ▼
    [+page.svelte]
    <script src="...word-card.js" defer>
    {@html "<main>...<word-card>...</word-card></main>"}
```

### Component Creation Recursion

```
CreateComponent("word-page-layout", prompt)
  depth=0, lineage=[]
  └─ generateComponentCode()
       └─ [LLM decides it needs a card sub-component]
       └─ CreateComponent("info-card", prompt)
            depth=1, lineage=["word-page-layout"]
            └─ generateComponentCode()
                 └─ [LLM satisfied, returns code]
            └─ store in GCS + Firestore
            └─ return { id: "info-card", ... }
       └─ [LLM uses info-card in word-page-layout code]
       └─ returns { shortDesc, dependencies: ["info-card"], code }
  └─ store in GCS + Firestore
  └─ return { id: "word-page-layout", ... }

MAX_RECURSION_DEPTH = 3
MAX_TOOL_CALLS_PER_GENERATION = 16 (per component)
Cycle detection: lineage includes parent IDs
```
