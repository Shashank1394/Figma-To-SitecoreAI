import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type FigmaConnectionResult = {
  connected: boolean;
  message: string;
  toolNames: string[];
};

export type FigmaDesignContext = {
  fileKey: string;
  nodeId: string;
  sourceUrl: string;
  toolName: string;
  text: string;
  characterCount: number;
  imageCount: number;
  receivedAt: string;
};

type ToolDefinition = {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

/** Owns MCP protocol details; application services receive typed design context. */
export class FigmaMcpClient {
  constructor(private readonly endpoint: string) {}

  async checkConnection(): Promise<FigmaConnectionResult> {
    const client = new Client({ name: "figma-sitecoreai-poc", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.endpoint));

    try {
      await client.connect(transport);
      const result = await client.listTools();
      const toolNames = result.tools.map((tool) => tool.name);

      return {
        connected: true,
        message: "Connected to Figma Desktop MCP.",
        toolNames,
      };
    } catch {
      return {
        connected: false,
        message: "Could not reach Figma Desktop MCP. Make sure Figma is open and its desktop MCP server is enabled.",
        toolNames: [],
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async readDesignContext(selection: {
    fileKey: string;
    nodeId: string;
    sourceUrl: string;
  }): Promise<FigmaDesignContext> {
    const client = new Client({ name: "figma-sitecoreai-poc", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.endpoint));

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const tool = tools.find((candidate) => candidate.name === "get_design_context");

      if (!tool) {
        throw new Error(
          'Figma MCP does not expose "get_design_context". Update or enable the Figma Desktop MCP server, then check its available tools.',
        );
      }

      const args = buildDesignContextArguments(tool as ToolDefinition, selection);
      const result = await client.callTool({ name: tool.name, arguments: args });
      const content = result.content ?? [];
      const textParts = content.flatMap((block) =>
        block.type === "text" && block.text.trim() ? [block.text] : [],
      );
      const imageCount = content.filter((block) => block.type === "image").length;
      const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
      const text = textParts.join("\n\n").trim() || stringifyStructuredContent(structuredContent);

      if (result.isError) {
        throw new Error(text || "Figma MCP returned an error while reading the selected design.");
      }
      if (!text) {
        throw new Error("Figma MCP returned no readable design context for this selection.");
      }

      return {
        ...selection,
        toolName: tool.name,
        text,
        characterCount: text.length,
        imageCount,
        receivedAt: new Date().toISOString(),
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

function buildDesignContextArguments(
  tool: ToolDefinition,
  selection: { fileKey: string; nodeId: string; sourceUrl: string },
): Record<string, unknown> {
  const properties = tool.inputSchema?.properties ?? {};
  const args: Record<string, unknown> = {};

  const nodeIdProperty = Object.keys(properties).find((key) => normalizeKey(key) === "nodeid");
  if (!nodeIdProperty) {
    throw new Error(
      'The available "get_design_context" tool does not declare a node ID parameter. Check that the selected Figma MCP server supports link-based selection.',
    );
  }
  args[nodeIdProperty] = selection.nodeId;

  setIfSupported(args, properties, ["fileKey", "file_key"], selection.fileKey);
  setIfSupported(args, properties, ["url", "figmaUrl", "designUrl", "figma_url"], selection.sourceUrl);

  // Some MCP variants require a prompt. Keep it scoped to extracting design information;
  // Sitecore field decisions belong to the later LLM analysis stage.
  setIfSupported(
    args,
    properties,
    ["prompt", "instructions", "userPrompt"],
    "Read this selected Figma design for CMS content modeling. Preserve the layer hierarchy, visible text, media, repeated structures, component properties, and relevant layout/style context. Do not choose CMS field types or generate application code; that will be handled by a separate analysis stage.",
  );

  const required = tool.inputSchema?.required ?? [];
  const missingRequired = required.filter((key) => !(key in args));
  if (missingRequired.length > 0) {
    throw new Error(
      `The available Figma MCP tool requires unsupported input(s): ${missingRequired.join(", ")}. Update the MCP adapter to match this tool version.`,
    );
  }

  return args;
}

function setIfSupported(
  args: Record<string, unknown>,
  properties: Record<string, unknown>,
  names: string[],
  value: string,
): void {
  const matchingName = Object.keys(properties).find((key) =>
    names.some((name) => normalizeKey(name) === normalizeKey(key)),
  );
  if (matchingName) args[matchingName] = value;
}

function normalizeKey(value: string): string {
  return value.replace(/[_-]/g, "").toLowerCase();
}

function stringifyStructuredContent(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
