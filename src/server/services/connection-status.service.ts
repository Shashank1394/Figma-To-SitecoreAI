import { getServerConfig, type ServerConfig } from "@/server/config/env";
import type { FigmaConnectionResult } from "@/server/integrations/figma/figma-mcp-client";

export interface FigmaConnectionChecker {
  checkConnection(): Promise<FigmaConnectionResult>;
}

export type IntegrationStatus = {
  id: "figma" | "gemini" | "sitecore";
  name: string;
  state: "connected" | "configured" | "needs-setup" | "unavailable";
  message: string;
  details?: string[];
};

export type ConnectionStatus = {
  checkedAt: string;
  integrations: IntegrationStatus[];
};

/** Coordinates status checks; protocol-specific behavior stays in integration adapters. */
export class ConnectionStatusService {
  constructor(
    private readonly figmaClient: FigmaConnectionChecker,
    private readonly config: ServerConfig = getServerConfig(),
  ) {}

  async check(): Promise<ConnectionStatus> {
    const figmaResult = await this.figmaClient.checkConnection();
    const geminiConfigured = Boolean(this.config.geminiApiKey);
    const sitecoreConfigured = Boolean(
      this.config.sitecoreHost && this.config.sitecoreClientId && this.config.sitecoreClientSecret,
    );

    return {
      checkedAt: new Date().toISOString(),
      integrations: [
        {
          id: "figma",
          name: "Figma Desktop MCP",
          state: figmaResult.connected ? "connected" : "unavailable",
          message: figmaResult.message,
          details: figmaResult.toolNames,
        },
        {
          id: "gemini",
          name: "Google Gemini API",
          state: geminiConfigured ? "configured" : "needs-setup",
          message: geminiConfigured
            ? `API key is configured. Analysis will use ${this.config.geminiModel}.`
            : "Add GEMINI_API_KEY to .env.local to enable content-model analysis.",
        },
        {
          id: "sitecore",
          name: "SitecoreAI Authoring API",
          state: sitecoreConfigured ? "configured" : "needs-setup",
          message: sitecoreConfigured
            ? "Required environment values are present. API authentication has not been tested yet."
            : "Add the SitecoreAI host and OAuth client credentials to .env.local.",
        },
      ],
    };
  }
}
