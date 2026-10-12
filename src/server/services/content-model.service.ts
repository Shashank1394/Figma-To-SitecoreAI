import { contentModelSchema, MAX_DESIGN_CONTEXT_LENGTH, type ContentModel } from "@/lib/content-model";

export type DesignContextForAnalysis = {
  fileKey: string;
  nodeId: string;
  sourceUrl: string;
  toolName: string;
  text: string;
};

/** Port for the configured LLM provider. */
export interface ContentModelAnalyzer {
  analyze(input: DesignContextForAnalysis): Promise<unknown>;
}

/** Application use case: validate incoming context and validate the LLM's proposal. */
export class ContentModelService {
  constructor(private readonly analyzer: ContentModelAnalyzer) {}

  async analyze(input: DesignContextForAnalysis): Promise<ContentModel> {
    if (input.text.length > MAX_DESIGN_CONTEXT_LENGTH) {
      throw new Error(
        `The Figma context is too large to analyze in one request. Keep it under ${MAX_DESIGN_CONTEXT_LENGTH.toLocaleString()} characters and select a smaller frame if needed.`,
      );
    }

    const proposedModel = await this.analyzer.analyze(input);
    const result = contentModelSchema.safeParse(proposedModel);

    if (!result.success) {
      throw new Error("Gemini's proposal did not match the required content-model schema. Analyze the design again or select a more specific frame.");
    }

    return result.data;
  }
}
