import type { ParsedFigmaUrl } from "@/lib/figma-url";
import type { FigmaDesignContext } from "@/server/integrations/figma/figma-mcp-client";

export interface FigmaDesignContextReader {
  readDesignContext(selection: {
    fileKey: string;
    nodeId: string;
    sourceUrl: string;
  }): Promise<FigmaDesignContext>;
}

/** Application use case for reading a single user-selected Figma design. */
export class DesignContextService {
  constructor(private readonly figmaClient: FigmaDesignContextReader) {}

  read(selection: ParsedFigmaUrl): Promise<FigmaDesignContext> {
    return this.figmaClient.readDesignContext({
      fileKey: selection.fileKey,
      nodeId: selection.nodeId,
      sourceUrl: selection.normalizedUrl,
    });
  }
}
