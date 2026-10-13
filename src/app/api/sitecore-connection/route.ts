import { NextResponse } from "next/server";
import { getServerConfig } from "@/server/config/env";
import { SitecoreAuthoringClient } from "@/server/integrations/sitecore/sitecore-authoring-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const config = getServerConfig();
  const result = await new SitecoreAuthoringClient(config).testConnection();

  console.info("[FrameForge] Sitecore connection test", {
    ok: result.ok,
    host: result.host,
    statusCode: result.statusCode,
    code: result.code,
    latencyMs: result.latencyMs,
  });

  return NextResponse.json({ ...result, renderingsParentPath: config.sitecoreRenderingsParentPath }, { status: result.ok ? 200 : 502 });
}
