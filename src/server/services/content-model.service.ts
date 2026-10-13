import { contentModelSchema, MAX_DESIGN_CONTEXT_LENGTH, type ContentModel } from "@/lib/content-model";
import { normalizeCtaFields } from "@/lib/cta-inference";

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
      throw new Error("OpenRouter's proposal did not match the required content-model schema. Analyze the design again or select a more specific frame.");
    }

    // Ensure each visually distinct CTA in Figma is represented by its own
    // General Link field, even if the LLM collapses repeated labels into one text field.
    const normalizedModel = normalizeCtaFields(result.data, input.text);
    const validatedModel = contentModelSchema.safeParse(normalizedModel);
    if (!validatedModel.success) {
      throw new Error("The normalized content model did not match the required Sitecore schema. Analyze the design again or review the CTA fields.");
    }

    return validatedModel.data;
  }
}
