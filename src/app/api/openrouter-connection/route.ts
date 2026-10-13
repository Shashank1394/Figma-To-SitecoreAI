import { NextResponse } from "next/server";
import { getServerConfig } from "@/server/config/env";
import { checkOpenRouterApiConnection } from "@/server/integrations/llm/openrouter-api-connection-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = getServerConfig();
    if (!config.openRouterApiKey) {
      return NextResponse.json({
        ok: false,
        model: config.openRouterModel,
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        code: "MISSING_API_KEY",
        message: "OpenRouter API key is not configured. Add OPENROUTER_API_KEY to .env.local and restart the server.",
      }, { status: 400 });
    }

    const result = await checkOpenRouterApiConnection({
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
    });

    console.info("[FrameForge] OpenRouter connection test", {
      ok: result.ok,
      model: result.model,
      routedModel: result.routedModel,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      code: result.code,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({
      ok: false,
      model: process.env.OPENROUTER_MODEL?.trim() || "openrouter/free",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      code: "CONFIGURATION_ERROR",
      message: "Could not start the OpenRouter test. Check server environment configuration and restart the development server.",
    }, { status: 500 });
  }
}
