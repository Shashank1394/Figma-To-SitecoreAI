import type { ServerConfig } from "@/server/config/env";
import type { SitecoreTemplateTreeNode } from "@/lib/sitecore-template-tree";

const OAUTH_URL = "https://auth.sitecorecloud.io/oauth/token";
const TOKEN_AUDIENCE = "https://api.sitecorecloud.io";
const REQUEST_TIMEOUT_MS = 15_000;
const AUTHORING_QUERY = "query { sites { name } }";
const TEMPLATE_TREE_QUERY = `query TemplateTreeNode($path: String!) {
  item(where: { path: $path }) {
    itemId
    name
    path
    hasChildren
    template { name templateId fullName }
    children(first: 100) {
      nodes {
        itemId
        name
        path
        hasChildren
        template { name templateId fullName }
      }
    }
  }
}`;

type JsonObject = Record<string, unknown>;
export type SitecoreGraphQLResult = {
  statusCode: number;
  data: Record<string, unknown>;
};

export class SitecoreGraphQLRequestError extends Error {
  constructor(message: string, readonly statusCode?: number, readonly code = "SITECORE_GRAPHQL_ERROR") {
    super(message);
    this.name = "SitecoreGraphQLRequestError";
  }
}

type CachedAccessToken = { value: string; expiresAt: number };
const accessTokenCache = new Map<string, CachedAccessToken>();

function isAllowedSitecoreTreePath(path: string): boolean {
  const allowedRoots = ["/sitecore/templates", "/sitecore/layout/Renderings"];
  return allowedRoots.some((root) => path === root || path.startsWith(`${root}/`))
    && !path.split("/").includes("..")
    && !path.includes("\\");
}

export type SitecoreConnectionResult = {
  ok: boolean;
  host: string;
  checkedAt: string;
  latencyMs: number;
  statusCode?: number;
  code: string;
  message: string;
  siteCount?: number;
};

export type SitecoreTemplateTreeResult = {
  ok: boolean;
  host: string;
  checkedAt: string;
  latencyMs: number;
  statusCode?: number;
  code: string;
  message: string;
  node?: SitecoreTemplateTreeNode;
};

/** Owns SitecoreAI connectivity checks and safe, read-only browsing of template and rendering folders. */
export class SitecoreAuthoringClient {
  constructor(
    private readonly config: Pick<ServerConfig, "sitecoreHost" | "sitecoreClientId" | "sitecoreClientSecret">,
  ) {}

  async testConnection(): Promise<SitecoreConnectionResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const host = this.getHost();

    const fail = (code: string, message: string, statusCode?: number): SitecoreConnectionResult => ({
      ok: false,
      host,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      statusCode,
      code,
      message,
    });

    if (!this.config.sitecoreHost || !this.config.sitecoreClientId || !this.config.sitecoreClientSecret) {
      return fail(
        "MISSING_CONFIGURATION",
        "Add SITECORE_AI_CM_HOST, SITECORE_AI_CLIENT_ID, and SITECORE_AI_CLIENT_SECRET to .env.local, then restart the server.",
      );
    }
    if (host === "Invalid host") {
      return fail("INVALID_HOST", "SITECORE_AI_CM_HOST must be a valid HTTPS SitecoreAI environment URL.");
    }

    try {
      const tokenResult = await this.requestAccessToken(host);
      if (!tokenResult.ok) {
        return fail(tokenResult.code, tokenResult.message, tokenResult.statusCode);
      }
      const accessToken = tokenResult.accessToken;

      const authoringResponse = await fetch(`${host}/sitecore/api/authoring/graphql/v1/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: AUTHORING_QUERY }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      const authoringBody = await this.readJson(authoringResponse);

      if (!authoringResponse.ok) {
        return fail(
          authoringResponse.status === 401 || authoringResponse.status === 403 ? "AUTHORING_UNAUTHORIZED" : "AUTHORING_HTTP_ERROR",
          authoringResponse.status === 401 || authoringResponse.status === 403
            ? "OAuth succeeded, but the SitecoreAI Authoring API denied access. Verify that the Automation credential targets this environment."
            : this.messageFrom(authoringBody) ?? `SitecoreAI Authoring API returned HTTP ${authoringResponse.status}.`,
          authoringResponse.status,
        );
      }

      const errors = Array.isArray(authoringBody?.errors) ? authoringBody.errors : [];
      if (errors.length > 0) {
        const firstError = errors[0] && typeof errors[0] === "object"
          ? (errors[0] as JsonObject).message
          : undefined;
        const message = typeof firstError === "string"
          ? firstError
          : "The SitecoreAI Authoring API rejected the connection query.";
        return fail("GRAPHQL_QUERY_FAILED", message, authoringResponse.status);
      }

      const data = authoringBody?.data && typeof authoringBody.data === "object"
        ? authoringBody.data as JsonObject
        : undefined;
      const sites = data?.sites;
      const siteCount = Array.isArray(sites)
        ? sites.length
        : sites && typeof sites === "object" && Array.isArray((sites as JsonObject).nodes)
          ? ((sites as JsonObject).nodes as unknown[]).length
          : undefined;

      if (siteCount === undefined) {
        return fail("UNEXPECTED_RESPONSE", "SitecoreAI responded, but the expected sites query result was missing.", authoringResponse.status);
      }

      return {
        ok: true,
        host,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        statusCode: authoringResponse.status,
        code: "CONNECTED",
        message: `SitecoreAI OAuth and Authoring API are connected. ${siteCount} site(s) returned; no items were changed.`,
        siteCount,
      };
    } catch (error) {
      const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
      const detail = cause instanceof Error ? (cause as Error & { code?: string }).code : undefined;
      const message = error instanceof Error ? error.message : "Unknown connection error.";
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return fail(
        isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        isTimeout
          ? `A SitecoreAI connection request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`
          : `Could not complete the SitecoreAI connection request${detail ? ` (${detail})` : ""}. Check the environment host and network configuration. ${message.slice(0, 160)}`,
      );
    }
  }

  async getTemplateTreeNode(path: string): Promise<SitecoreTemplateTreeResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const host = this.getHost();
    const fail = (code: string, message: string, statusCode?: number): SitecoreTemplateTreeResult => ({
      ok: false,
      host,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      statusCode,
      code,
      message,
    });

    const normalizedPath = path.trim().replace(/\/+$/, "") || "/";
    if (!this.config.sitecoreHost || !this.config.sitecoreClientId || !this.config.sitecoreClientSecret) {
      return fail(
        "MISSING_CONFIGURATION",
        "Add SITECORE_AI_CM_HOST, SITECORE_AI_CLIENT_ID, and SITECORE_AI_CLIENT_SECRET to .env.local, then restart the server.",
      );
    }
    if (host === "Invalid host") {
      return fail("INVALID_HOST", "SITECORE_AI_CM_HOST must be a valid HTTPS SitecoreAI environment URL.");
    }
    if (!isAllowedSitecoreTreePath(normalizedPath)) {
      return fail("INVALID_TREE_PATH", "Only folders inside /sitecore/templates or /sitecore/layout/Renderings can be browsed.", 400);
    }

    try {
      const tokenResult = await this.requestAccessToken(host);
      if (!tokenResult.ok) {
        return fail(tokenResult.code, tokenResult.message, tokenResult.statusCode);
      }

      const response = await fetch(`${host}/sitecore/api/authoring/graphql/v1/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenResult.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: TEMPLATE_TREE_QUERY, variables: { path: normalizedPath } }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      const body = await this.readJson(response);

      if (!response.ok) {
        const unauthorized = response.status === 401 || response.status === 403;
        return fail(
          unauthorized ? "AUTHORING_UNAUTHORIZED" : "AUTHORING_HTTP_ERROR",
          unauthorized
            ? "SitecoreAI denied access to the template tree. Verify that the Automation credential can read template items."
            : this.messageFrom(body) ?? `SitecoreAI Authoring API returned HTTP ${response.status}.`,
          response.status,
        );
      }

      const errors = Array.isArray(body?.errors) ? body.errors : [];
      if (errors.length) {
        const first = errors[0] && typeof errors[0] === "object" ? (errors[0] as JsonObject).message : undefined;
        return fail(
          "TEMPLATE_TREE_QUERY_FAILED",
          typeof first === "string" ? first.slice(0, 300) : "SitecoreAI rejected the template tree query.",
          response.status,
        );
      }

      const data = body?.data && typeof body.data === "object" ? body.data as JsonObject : undefined;
      const item = data?.item;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return fail("TEMPLATE_ROOT_NOT_FOUND", `Could not find a Sitecore item at ${normalizedPath}.`, response.status);
      }

      const node = this.toTemplateTreeNode(item as JsonObject);
      return {
        ok: true,
        host,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        statusCode: response.status,
        code: "SITECORE_TREE_LOADED",
        message: `Loaded ${node.children.length} direct child item(s) from ${node.path}.`,
        node,
      };
    } catch (error) {
      const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
      const detail = cause instanceof Error ? (cause as Error & { code?: string }).code : undefined;
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return fail(
        isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        isTimeout
          ? `The SitecoreAI template tree request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`
          : `Could not load the SitecoreAI template tree${detail ? ` (${detail})` : ""}. ${error instanceof Error ? error.message.slice(0, 160) : "Unknown request error."}`,
      );
    }
  }

  hostForDisplay(): string {
    return this.getHost();
  }

  /** Execute a schema-verified Authoring API query or mutation using the shared OAuth transport. */
  async requestGraphQL(query: string, variables: Record<string, unknown> = {}): Promise<SitecoreGraphQLResult> {
    const host = this.getHost();
    if (!this.config.sitecoreHost || !this.config.sitecoreClientId || !this.config.sitecoreClientSecret) {
      throw new SitecoreGraphQLRequestError(
        "Add SITECORE_AI_CM_HOST, SITECORE_AI_CLIENT_ID, and SITECORE_AI_CLIENT_SECRET to .env.local, then restart the server.",
        400,
        "MISSING_CONFIGURATION",
      );
    }
    if (host === "Invalid host") {
      throw new SitecoreGraphQLRequestError("SITECORE_AI_CM_HOST must be a valid HTTPS SitecoreAI environment URL.", 400, "INVALID_HOST");
    }

    const tokenResult = await this.requestAccessToken(host);
    if (!tokenResult.ok) {
      throw new SitecoreGraphQLRequestError(tokenResult.message, tokenResult.statusCode, tokenResult.code);
    }

    const response = await fetch(`${host}/sitecore/api/authoring/graphql/v1/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const body = await this.readJson(response);

    if (!response.ok) {
      const message = this.messageFrom(body) ?? `SitecoreAI Authoring API returned HTTP ${response.status}.`;
      throw new SitecoreGraphQLRequestError(message, response.status, response.status === 401 || response.status === 403 ? "AUTHORING_UNAUTHORIZED" : "AUTHORING_HTTP_ERROR");
    }

    const errors = Array.isArray(body?.errors) ? body.errors : [];
    if (errors.length > 0) {
      const firstError = errors[0] && typeof errors[0] === "object" ? (errors[0] as JsonObject).message : undefined;
      const message = typeof firstError === "string" ? firstError : "SitecoreAI returned a GraphQL error.";
      throw new SitecoreGraphQLRequestError(message.slice(0, 500), response.status, "GRAPHQL_QUERY_FAILED");
    }

    const data = body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new SitecoreGraphQLRequestError("SitecoreAI returned an unexpected GraphQL response without data.", response.status, "UNEXPECTED_GRAPHQL_RESPONSE");
    }

    return { statusCode: response.status, data: data as Record<string, unknown> };
  }

  private async requestAccessToken(host: string): Promise<
    | { ok: true; accessToken: string }
    | { ok: false; code: string; message: string; statusCode?: number }
  > {
    const cacheKey = `${host}|${this.config.sitecoreClientId ?? ""}`;
    const cached = accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return { ok: true, accessToken: cached.value };
    }

    const response = await fetch(OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.sitecoreClientId ?? "",
        client_secret: this.config.sitecoreClientSecret ?? "",
        audience: TOKEN_AUDIENCE,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = await this.readJson(response);

    if (!response.ok) {
      const rejected = response.status === 401 || response.status === 403;
      return {
        ok: false,
        code: rejected ? "OAUTH_REJECTED" : "OAUTH_FAILED",
        message: rejected
          ? "SitecoreAI OAuth rejected the client credentials. Verify the Environment Automation client ID and secret."
          : this.messageFrom(body) ?? `SitecoreAI OAuth returned HTTP ${response.status}.`,
        statusCode: response.status,
      };
    }

    const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
    if (!accessToken) {
      return { ok: false, code: "OAUTH_TOKEN_MISSING", message: "SitecoreAI OAuth responded without an access token.", statusCode: response.status };
    }

    const expiresIn = typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
    accessTokenCache.set(cacheKey, { value: accessToken, expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000 });
    return { ok: true, accessToken };
  }

  private toTemplateTreeNode(value: JsonObject): SitecoreTemplateTreeNode {
    const template = value.template && typeof value.template === "object" && !Array.isArray(value.template)
      ? value.template as JsonObject
      : {};
    const name = typeof value.name === "string" ? value.name : "Unnamed item";
    const path = typeof value.path === "string" ? value.path : "/sitecore/templates";
    const itemId = typeof value.itemId === "string" ? value.itemId : "";
    const templateName = typeof template.name === "string" ? template.name : "Unknown template";
    const templateFullName = typeof template.fullName === "string" ? template.fullName : templateName;
    const hasChildren = value.hasChildren === true;
    const childConnection = value.children && typeof value.children === "object" && !Array.isArray(value.children)
      ? value.children as JsonObject
      : undefined;
    const rawNodes = Array.isArray(childConnection?.nodes) ? childConnection.nodes : [];
    const children = rawNodes
      .filter((child): child is JsonObject => Boolean(child) && typeof child === "object" && !Array.isArray(child))
      .map((child) => this.toTemplateTreeNode(child));
    const identity = `${templateName} ${templateFullName}`.toLowerCase();
    const isTemplatesTree = path === "/sitecore/templates" || path.startsWith("/sitecore/templates/");
    const isRenderingTree = path === "/sitecore/layout/Renderings" || path.startsWith("/sitecore/layout/Renderings/");
    const isTreeRoot = path === "/sitecore/templates" || path === "/sitecore/layout/Renderings";
    const isTemplateFolder = identity.includes("template folder") || identity.includes("templates folder") || templateName.toLowerCase() === "folder";
    const isRenderingFolder = identity.includes("rendering folder") || templateName.toLowerCase() === "rendering folder";
    const selectable = isTreeRoot || (isTemplatesTree && isTemplateFolder) || (isRenderingTree && isRenderingFolder);

    return {
      itemId,
      name,
      path,
      hasChildren,
      templateName,
      templateFullName,
      selectable,
      children,
      childrenLoaded: Boolean(childConnection) || !hasChildren,
    };
  }

  private getHost(): string {
    if (!this.config.sitecoreHost) return "Not configured";
    try {
      const parsed = new URL(this.config.sitecoreHost);
      return parsed.protocol === "https:" ? parsed.origin : "Invalid host";
    } catch {
      return "Invalid host";
    }
  }

  private async readJson(response: Response): Promise<JsonObject | undefined> {
    try {
      const value: unknown = await response.json();
      return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
    } catch {
      return undefined;
    }
  }

  private messageFrom(body: JsonObject | undefined): string | undefined {
    if (!body) return undefined;
    const errorValue = body.error;
    if (typeof errorValue === "string") return errorValue.slice(0, 300);
    if (errorValue && typeof errorValue === "object") {
      const message = (errorValue as JsonObject).message ?? (errorValue as JsonObject).error_description;
      if (typeof message === "string") return message.slice(0, 300);
    }
    if (typeof body.message === "string") return body.message.slice(0, 300);
    return undefined;
  }
}
