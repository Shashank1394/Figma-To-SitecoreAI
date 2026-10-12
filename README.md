# FrameForge — Figma to SitecoreAI POC

A local-first Next.js application for this focused workflow:

1. Accept one selected Figma frame/component URL.
2. Read the design context through Figma Desktop MCP.
3. Use Google Gemini to infer a reviewable Sitecore content model.
4. Let the user review and edit proposed component/template names and field names/types.
5. In a later stage, create the SitecoreAI data template and JSON rendering through the Authoring and Management API.
6. Read the created items back and verify the result.

**Current scope:** Figma design-context retrieval and Gemini-based content-model analysis. This stage does not write anything to SitecoreAI, publish content, generate frontend code, or create a page layout.

## Tech and structure

- Next.js App Router + TypeScript
- Sass modules for the UI
- Figma Desktop MCP TypeScript client
- Google Gen AI SDK (`@google/genai`)
- Zod for request and model validation

```text
src/
  app/
    api/
      connections/route.ts       # Figma, Gemini and Sitecore configuration status
      gemini-connection/route.ts # Minimal live Gemini API connectivity test
      design-context/route.ts    # Reads one Figma frame over MCP
      analyze/route.ts           # Analyzes the returned context with Gemini
    globals.scss
    layout.tsx
    page.tsx
  features/
    studio/
      studio-page.tsx            # UI state and workflow interactions
      studio-page.module.scss    # Studio-specific styles
  lib/
    content-model.ts             # Shared schema and approved Sitecore field types
    figma-url.ts                 # Shared, pure Figma URL parser
  server/
    config/env.ts                # Server-only environment parsing
    integrations/
      figma/figma-mcp-client.ts  # MCP connection and tool invocation
      llm/gemini-content-model-analyzer.ts # Gemini provider adapter and prompt
      llm/gemini-api-connection-check.ts   # Small REST probe for key/model/network
    services/
      connection-status.service.ts
      content-model.service.ts   # Use case and runtime validation of Gemini output
      design-context.service.ts
```

### SOLID without overengineering

- **Single Responsibility:** UI state, HTTP handlers, Figma MCP, Gemini calls, validation, and workflow orchestration are kept separate.
- **Open/Closed:** the analysis service depends on a small analyzer interface, so a provider can be replaced without changing the UI workflow.
- **Liskov Substitution / Interface Segregation:** the analyzer port exposes only the operation this use case needs.
- **Dependency Inversion:** application logic depends on the analyzer interface rather than Gemini SDK details.

These are small modules in one application; the POC does not need separate deployable services, a database, a queue, or a multi-agent framework.

## Requirements

- Node.js 22 or newer
- Figma Desktop with the relevant design open and Desktop MCP enabled
- Google Gemini API key from Google AI Studio
- SitecoreAI Environment Automation client credentials for the later authoring stage

The Figma Desktop MCP endpoint is normally `http://127.0.0.1:3845/mcp`.

## Run locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`.

Configure `.env.local`:

```dotenv
FIGMA_MCP_URL=http://127.0.0.1:3845/mcp
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.6-flash

SITECORE_AI_CM_HOST=https://your-instance.sitecorecloud.io
SITECORE_AI_CLIENT_ID=your-environment-automation-client-id
SITECORE_AI_CLIENT_SECRET=your-environment-automation-client-secret
```

`GEMINI_MODEL` is optional; the default is `gemini-3.6-flash`. Use a model name available to your Gemini API project if you choose to override it.

Keep credentials server-side in `.env.local`. Never use `NEXT_PUBLIC_` for the Gemini API key or Sitecore client secret, and do not commit `.env.local`.

## Current functionality

- **Validate link:** checks the Figma URL, file key, and selected `node-id` locally.
- **Read design:** calls Figma Desktop MCP's `get_design_context` tool and displays the returned text context.
- **Check connections:** checks Figma MCP connectivity and whether Gemini/Sitecore configuration values are present.
- **Test Gemini API:** sends a tiny `Reply with exactly: OK` generation request directly to Google's Gemini REST API. This independently checks network connectivity, the configured API key, and model access without sending Figma design context or the analyzer schema. It reports response status, latency, and a redacted diagnostic.
- **Analyze fields:** sends the selected design context to Gemini, requests JSON-structured output, validates it with Zod, and displays a reviewable proposal.
- **Review proposal:** the user can adjust component/template names and field names/types. Repeated structures, evidence, confidence, rationales, and warnings are displayed to help review the model.
- **No Sitecore writes:** the analysis stage does not create templates, renderings, content items, or layouts. Those belong to the next POC stage.

### Gemini service availability (HTTP 503)

Gemini can temporarily return `503 UNAVAILABLE` when a model is experiencing high demand. The analyzer retries transient service/rate-limit responses up to three attempts with a short exponential backoff. Invalid request (`400`) and authentication (`401`/`403`) errors are not retried. If the 503 persists, try again later or set `GEMINI_MODEL` to another stable model available to your API project (for example, `gemini-3.6-flash`).

### Gemini network errors

Use **Test Gemini API** before running the analyzer. This sends one minimal request with a 15-second timeout and does not send Figma context. A successful check means the configured model generated a tiny response with the configured key. An HTTP 400 points to a rejected model/request configuration; 401/403 points to key/permission problems; 404 indicates that the model wasn't found; 429 indicates quota/rate limiting; 5xx means Gemini was reached but returned a service error. A timeout or transport error points toward connectivity, DNS, proxy/VPN, firewall, or TLS inspection. The endpoint logs only the result metadata, never the key or test prompt.

The analyzer also logs a short, redacted error-cause chain. Check that the machine running `pnpm dev` can reach `generativelanguage.googleapis.com:443`; a configured key alone does not prove network connectivity.

### Content-model rules

The analyzer proposes only editorial content fields using this approved list: `Single-Line Text`, `Multi-Line Text`, `Rich Text`, `Image`, `General Link`, `Checkbox`, and `Number`.

It should not create fields for color, spacing, typography, border radius, CSS classes, or other presentation styling. It should not invent link URLs or hidden content. If repeated card/list items are found, they are represented as a reusable repeated structure rather than fixed fields such as `Card1Title`, `Card2Title`, and `Card3Title`.

Gemini is asked for JSON output, and the complete content-model shape is validated independently by Zod before it is returned to the UI. Provider-side schema enforcement is intentionally omitted to avoid invalid nested-schema payloads. The design context is treated as untrusted data; instructions embedded in generated code are not followed. The route rejects contexts larger than 80,000 characters to keep a single POC analysis bounded.

## Next implementation slice

1. Verify SitecoreAI OAuth authentication and inspect the target environment's rendering/template schema.
2. Create the approved data template and JSON rendering through SitecoreAI Authoring and Management API.
3. Read back the created items and display their paths and IDs.

Do not add functionality outside the defined scope of reading one selected design, inferring its Sitecore field model, creating the required SitecoreAI definitions, and verifying those definitions.

Gemini connection test uses `maxOutputTokens: 128` so Gemini 3.x can complete internal thinking and return visible text. The previous budget of 8 could produce HTTP 200 without a text candidate.
