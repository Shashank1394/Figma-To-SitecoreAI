import { NextResponse } from "next/server";
import { getServerConfig } from "@/server/config/env";
import { checkGeminiApiConnection } from "@/server/integrations/llm/gemini-api-connection-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = getServerConfig();
    if (!config.geminiApiKey) {
      return NextResponse.json(
        {
          ok: false,
          model: config.geminiModel,
          checkedAt: new Date().toISOString(),
          latencyMs: 0,
          code: "MISSING_API_KEY",
          message: "Gemini API key is not configured. Add GEMINI_API_KEY to .env.local and restart the server.",
        },
        { status: 400 },
      );
    }

    const result = await checkGeminiApiConnection({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
    });

    console.info("[FrameForge] Gemini connection test", {
      ok: result.ok,
      model: result.model,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      code: result.code,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    console.error("[FrameForge] Gemini connection test could not start", {
      message: error instanceof Error ? error.message : "Unknown configuration error",
    });
    return NextResponse.json(
      {
        ok: false,
        model: process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        code: "CONFIGURATION_ERROR",
        message: "Could not start the Gemini test. Check server environment configuration and restart the development server.",
      },
      { status: 500 },
    );
  }
}
