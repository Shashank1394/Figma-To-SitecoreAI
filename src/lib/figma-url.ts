export type ParsedFigmaUrl = {
  fileKey: string;
  nodeId: string;
  normalizedUrl: string;
};

export type FigmaUrlResult =
  | { valid: true; value: ParsedFigmaUrl }
  | { valid: false; message: string };

/** Parses a frame URL locally. It does not call Figma or claim the design was analyzed. */
export function parseFigmaDesignUrl(rawUrl: string): FigmaUrlResult {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { valid: false, message: "Paste a valid Figma design or file URL." };
  }

  const isFigmaHost = url.hostname === "figma.com" || url.hostname.endsWith(".figma.com");
  if (!isFigmaHost || url.protocol !== "https:") {
    return { valid: false, message: "The URL must be an HTTPS link from figma.com." };
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (!(["design", "file"].includes(pathParts[0] ?? "")) || !pathParts[1]) {
    return { valid: false, message: "Use a Figma Design or File link, not a prototype or community page." };
  }

  const nodeId = url.searchParams.get("node-id");
  if (!nodeId) {
    return { valid: false, message: "This link has no node-id. Copy a link directly to the frame or component." };
  }

  return {
    valid: true,
    value: {
      fileKey: pathParts[1],
      nodeId: nodeId.replace(/-/g, ":"),
      normalizedUrl: url.toString(),
    },
  };
}
