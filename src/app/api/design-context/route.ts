import { NextResponse } from "next/server";
import { z } from "zod";
import { parseFigmaDesignUrl } from "@/lib/figma-url";
import { getServerConfig } from "@/server/config/env";
import { FigmaMcpClient } from "@/server/integrations/figma/figma-mcp-client";
import { DesignContextService } from "@/server/services/design-context.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ url: z.string().trim().min(1).max(2048) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid JSON request body." }, { status: 400 });
  }

  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Provide a Figma frame or component URL." }, { status: 400 });
  }

  const selection = parseFigmaDesignUrl(parsedBody.data.url);
  if (!selection.valid) {
    return NextResponse.json({ error: selection.message }, { status: 400 });
  }

  try {
    const config = getServerConfig();
    const figmaClient = new FigmaMcpClient(config.figmaMcpUrl);
    const service = new DesignContextService(figmaClient);
    const designContext = await service.read(selection.value);

    return NextResponse.json({ designContext });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the selected Figma design.";
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }
}
