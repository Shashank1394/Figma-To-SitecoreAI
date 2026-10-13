# FrameForge — Figma to SitecoreAI POC

A local-first Next.js application that reads one selected Figma component, asks OpenRouter to infer a reviewable Sitecore content model, and creates the approved template-side structure plus a linked JSON Rendering in SitecoreAI.

## Current workflow

1. **Source design:** validate a Figma URL, read the selected frame through Figma Desktop MCP, and test OpenRouter and SitecoreAI connections.
2. **Analyze fields:** send the design context to OpenRouter's free-model router, validate the response with Zod, and review/edit the proposed fields, repeated item structures, and optional rendering parameters.
3. **Sitecore destinations:** browse the live `/sitecore/templates` tree and `/sitecore/layout/Renderings` tree, select both parent folders, preview the planned structure, explicitly approve creation, and inspect the created item paths and IDs.

## What gets created

Under the selected `/sitecore/templates` folder, FrameForge creates a component template folder and then adds the items required by the reviewed model:

- **Data source template:** always created, with the reviewed editorial fields.
- **Repeated item templates:** one template per inferred repeated structure, such as `Promo Card` in a `Promo Cards` component.
- **Data-folder template and Standard Values:** created when the model includes repeated structures that need a dedicated data folder. Its `__Standard Values` item has `__Masters` set to the single generated data-source template ID, restricting insert options to that template. FrameForge reads the field back to verify the restriction.
- **Rendering Parameters folder and template:** created only when the reviewed model contains explicit author-controlled presentation parameters.

The **JSON Rendering definition is intentionally created in the separate rendering tree**, under the user-selected parent inside `/sitecore/layout/Renderings`. FrameForge creates a component-specific Rendering Folder there, then places the JSON Rendering definition inside it. It links to the generated data source template and, when present, the rendering-parameters template. Sitecore template folders and rendering folders are different item types and belong in different trees.

Before any writes, the service verifies the selected parent against the live item ID, resolves required built-in template IDs from the target environment, and checks all planned paths for conflicts. It never overwrites existing items. After creation it reads each created item back and verifies its ID. A multi-mutation workflow cannot be assumed atomic: if a step fails after prior writes, the response lists the items already created and asks the user to inspect them before attempting a retry. Nothing is automatically published, no pages or datasource content items are created, and no frontend code is generated.

## Stack and structure

- Next.js App Router, React, TypeScript
- Sass modules for styling
- Figma Desktop MCP for design context
- OpenRouter Chat Completions API (`openrouter/free`) for LLM analysis
- SitecoreAI Authoring and Management GraphQL API for template/rendering authoring
- Zod for request and content-model validation

```text
src/
  app/api/
    connections/route.ts            # Figma + configured provider status
    openrouter-connection/route.ts  # Minimal OpenRouter connectivity test
    design-context/route.ts         # Read one selected frame via Figma MCP
    analyze/route.ts                # Validate and analyze design context
    sitecore-connection/route.ts    # OAuth + read-only Authoring API test
    sitecore-template-tree/route.ts # Read direct children in /sitecore/templates
    sitecore-create-component/route.ts # Explicitly approved Sitecore creation workflow
  features/studio/                  # Guided stage UI and Sass module
  lib/                              # Figma URL, content-model, tree and creation-plan schemas
  server/
    config/env.ts                   # Server-only environment configuration
    integrations/figma/             # Figma Desktop MCP client
    integrations/llm/               # OpenRouter analyzer and connection check
    integrations/sitecore/          # Sitecore OAuth, GraphQL transport, connection test and template tree
    services/                       # Workflow orchestration and creation verification
```

The code uses focused modules and a small service layer. It intentionally avoids databases, queues, worker services, and unnecessary class layers for this POC.

## Dependency-upgrade compatibility fixes

- The studio uses `PanelsTopLeft` from Lucide because `lucide-react` does not export a `Figma` icon.
- Figma MCP tool content is treated as external data and narrowed from `unknown` at runtime before reading text/image blocks.

After installing dependencies, run `pnpm typecheck` to validate against the versions resolved in your environment.

## Dependencies

The project is configured for the following version ranges:

| Package | Version range |
|---|---:|
| `next` / `eslint-config-next` | `^16.4.0` |
| `react` / `react-dom` | `^19.3.0` |
| `@modelcontextprotocol/sdk` | `^1.32.1` |
| `lucide-react` | `^1.55.0` |
| `zod` | `^4.6.6` |
| `eslint` | `^10.12.0` |
| `sass` | `^1.105.1` |
| `typescript` | `^7.0.2` |
| `@types/node` | `^26.6.5` |
| `@types/react` / `@types/react-dom` | `^19.3.0` |

The MCP integration remains on the `@modelcontextprotocol/sdk` 1.x line.

## Requirements

- Node.js 22.13+ or 24+
- Figma Desktop with Desktop MCP enabled (normally `http://127.0.0.1:3845/mcp`)
- OpenRouter API key: https://openrouter.ai/keys
- SitecoreAI Environment Automation credentials for the target environment
- A target SitecoreAI instance with the built-in template paths used by this service (Standard template, Common Folder, Standard Rendering Parameters, Rendering Folder and JSON Rendering)

## Run locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000` and configure `.env.local`:

```dotenv
FIGMA_MCP_URL=http://127.0.0.1:3845/mcp
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_MODEL=openrouter/free

SITECORE_AI_CM_HOST=https://your-instance.sitecorecloud.io
SITECORE_AI_CLIENT_ID=your-environment-automation-client-id
SITECORE_AI_CLIENT_SECRET=your-environment-automation-client-secret
```

Keep API keys and Sitecore credentials server-side. Never prefix them with `NEXT_PUBLIC_` and do not commit `.env.local`.

## Safety behavior and limitations

- The model is reviewed and edited by the user before creation; the model does not generate GraphQL mutations. Each distinct fixed CTA is modeled as its own General Link field (including link text and destination), rather than a label-only text field. The analyzer prompt and a deterministic normalization step work together to prevent visually distinct buttons with identical labels from being collapsed into one field. If a design is modeled as repeated cards/list items, its CTA fields stay inside the repeated item model rather than being flattened onto the parent component.
- OpenRouter's free router avoids depending on one model endpoint, but free model availability and rate limits can vary.
- Template tree browsing and connection tests are read-only.
- Creation requires an explicit checkbox confirmation. Existing items are not overwritten.
- Every created item is re-read by path and its returned ID is compared with the mutation result.
- If creation partially fails, created items are left in place and reported; the app does not attempt potentially unsafe automatic rollback.
- Sitecore component registration is created, but the corresponding Next.js frontend component is not generated/deployed. Page Builder availability, page creation, datasource content creation and publishing are outside the current POC scope.

After dependency upgrades, run:

```powershell
pnpm install
pnpm typecheck
pnpm lint
pnpm build
```

Commit the generated `pnpm-lock.yaml` after verifying the resolved dependency graph in your environment.
