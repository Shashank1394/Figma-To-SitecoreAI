import { z } from "zod";

const optionalUrl = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value, z.string().url().optional());
const optionalSecret = z.string().trim().optional();
const optionalPath = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value, z.string().optional());

const serverEnvSchema = z.object({
  FIGMA_MCP_URL: optionalUrl,
  OPENROUTER_API_KEY: optionalSecret,
  OPENROUTER_MODEL: z.string().trim().optional(),
  SITECORE_AI_CM_HOST: optionalUrl,
  SITECORE_AI_CLIENT_ID: optionalSecret,
  SITECORE_AI_CLIENT_SECRET: optionalSecret,
  SITECORE_AI_RENDERINGS_PARENT_PATH: optionalPath,
});

export type ServerConfig = {
  figmaMcpUrl: string;
  openRouterApiKey?: string;
  openRouterModel: string;
  sitecoreHost?: string;
  sitecoreClientId?: string;
  sitecoreClientSecret?: string;
  sitecoreRenderingsParentPath: string;
};

export function getServerConfig(): ServerConfig {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error("One or more integration environment variables are invalid.");
  }

  const env = parsed.data;
  return {
    figmaMcpUrl: env.FIGMA_MCP_URL ?? "http://127.0.0.1:3845/mcp",
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterModel: env.OPENROUTER_MODEL || "openrouter/free",
    sitecoreHost: env.SITECORE_AI_CM_HOST,
    sitecoreClientId: env.SITECORE_AI_CLIENT_ID,
    sitecoreClientSecret: env.SITECORE_AI_CLIENT_SECRET,
    sitecoreRenderingsParentPath: env.SITECORE_AI_RENDERINGS_PARENT_PATH || "/sitecore/layout/Renderings/Feature",
  };
}
