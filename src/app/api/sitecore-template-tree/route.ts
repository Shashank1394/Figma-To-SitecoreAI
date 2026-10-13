import { NextResponse } from "next/server";
import { getServerConfig } from "@/server/config/env";
import { SitecoreAuthoringClient } from "@/server/integrations/sitecore/sitecore-authoring-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = { path?: unknown };

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST", message: "Request body must be valid JSON." }, { status: 400 });
  }

  const requestedPath = body && typeof body.path === "string" ? body.path.trim() : "";
  const path = requestedPath || "/sitecore/templates";

  if (
    (path !== "/sitecore/templates" && !path.startsWith("/sitecore/templates/")) ||
    path.split("/").includes("..") || path.includes("\\")
  ) {
    return NextResponse.json({
      ok: false,
      code: "INVALID_TEMPLATE_PATH",
      message: "Only folders inside /sitecore/templates can be browsed.",
    }, { status: 400 });
  }

  const result = await new SitecoreAuthoringClient(getServerConfig()).getTemplateTreeNode(path);
  console.info("[FrameForge] Sitecore template tree", {
    ok: result.ok,
    path,
    statusCode: result.statusCode,
    code: result.code,
    latencyMs: result.latencyMs,
    childCount: result.node?.children.length,
  });

  if (!result.ok) {
    const status = result.statusCode === 400 ? 400 : result.statusCode === 401 || result.statusCode === 403 ? result.statusCode : 502;
    return NextResponse.json({ ok: false, code: result.code, message: result.message }, { status });
  }

  return NextResponse.json({
    ok: true,
    host: result.host,
    checkedAt: result.checkedAt,
    latencyMs: result.latencyMs,
    node: result.node,
    message: result.message,
  }, { status: 200 });
}
