import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_DESIGN_CONTEXT_LENGTH } from "@/lib/content-model";
import { getServerConfig } from "@/server/config/env";
import { GeminiContentModelAnalyzer } from "@/server/integrations/llm/gemini-content-model-analyzer";
import { ContentModelService } from "@/server/services/content-model.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  designContext: z.object({
    fileKey: z.string().trim().min(1).max(256),
    nodeId: z.string().trim().min(1).max(256),
    sourceUrl: z.string().url().max(2048),
    toolName: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(MAX_DESIGN_CONTEXT_LENGTH),
  }),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid JSON request body." }, { status: 400 });
  }

  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: `Provide the design context returned by Figma MCP (maximum ${MAX_DESIGN_CONTEXT_LENGTH.toLocaleString()} characters).` },
      { status: 400 },
    );
  }

  try {
    const config = getServerConfig();
    if (!config.geminiApiKey) {
      return NextResponse.json(
        { error: "Gemini is not configured. Add GEMINI_API_KEY to .env.local, then restart the development server." },
        { status: 503 },
      );
    }

    const analyzer = new GeminiContentModelAnalyzer(config.geminiApiKey, config.geminiModel);
    const service = new ContentModelService(analyzer);
    const contentModel = await service.analyze(parsedBody.data.designContext);

    return NextResponse.json({ contentModel, analyzedAt: new Date().toISOString(), model: config.geminiModel });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze the selected design.";
    const status = message.startsWith("The Figma context is too large") ? 413 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
