import { z } from "zod";

const optionalUrl = z.string().url().optional();
const optionalSecret = z.string().trim().optional();

const serverEnvSchema = z.object({
  FIGMA_MCP_URL: optionalUrl,
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL: z.string().trim().optional(),
  SITECORE_AI_CM_HOST: optionalUrl,
  SITECORE_AI_CLIENT_ID: optionalSecret,
  SITECORE_AI_CLIENT_SECRET: optionalSecret,
});

export type ServerConfig = {
  figmaMcpUrl: string;
  geminiApiKey?: string;
  geminiModel: string;
  sitecoreHost?: string;
  sitecoreClientId?: string;
  sitecoreClientSecret?: string;
};

export function getServerConfig(): ServerConfig {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error("One or more integration environment variables are invalid.");
  }

  const env = parsed.data;
  return {
    figmaMcpUrl: env.FIGMA_MCP_URL ?? "http://127.0.0.1:3845/mcp",
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || "gemini-3.6-flash",
    sitecoreHost: env.SITECORE_AI_CM_HOST,
    sitecoreClientId: env.SITECORE_AI_CLIENT_ID,
    sitecoreClientSecret: env.SITECORE_AI_CLIENT_SECRET,
  };
}
