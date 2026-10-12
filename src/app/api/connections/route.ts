import { NextResponse } from "next/server";
import { getServerConfig } from "@/server/config/env";
import { FigmaMcpClient } from "@/server/integrations/figma/figma-mcp-client";
import { ConnectionStatusService } from "@/server/services/connection-status.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getServerConfig();
    const figmaClient = new FigmaMcpClient(config.figmaMcpUrl);
    const service = new ConnectionStatusService(figmaClient, config);
    const status = await service.check();
    return NextResponse.json(status);
  } catch {
    return NextResponse.json(
      { error: "Could not check integrations. Review the server environment configuration." },
      { status: 500 },
    );
  }
}
