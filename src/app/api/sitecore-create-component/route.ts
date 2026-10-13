import { NextResponse } from "next/server";
import { sitecoreComponentCreationRequestSchema } from "@/lib/sitecore-component-creation";
import { getServerConfig } from "@/server/config/env";
import { SitecoreAuthoringClient } from "@/server/integrations/sitecore/sitecore-authoring-client";
import { SitecoreComponentCreationService } from "@/server/services/sitecore-component-creation.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "Request body must be valid JSON.", createdItems: [] }, { status: 400 });
  }

  const parsed = sitecoreComponentCreationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      ok: false,
      code: "INVALID_CREATION_REQUEST",
      message: "The reviewed content model or selected template folder is invalid. Return to the review stage and correct the highlighted values.",
      createdItems: [],
    }, { status: 400 });
  }

  const config = getServerConfig();
  const client = new SitecoreAuthoringClient(config);
  const service = new SitecoreComponentCreationService(client);
  const result = await service.create(parsed.data);

  console.info("[FrameForge] Sitecore component creation", {
    ok: result.ok,
    code: result.code,
    host: result.host,
    latencyMs: result.latencyMs,
    createdCount: result.createdItems.length,
    failedStep: result.failedStep,
  });

  const status = result.ok ? 200 : result.statusCode === 400 || result.statusCode === 409 ? result.statusCode : 502;
  return NextResponse.json(result, { status });
}
