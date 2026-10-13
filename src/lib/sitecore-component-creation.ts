import { z } from "zod";
import { contentModelSchema } from "@/lib/content-model";

export const selectedTemplateFolderSchema = z.object({
  itemId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(150),
  path: z.string().trim().min(1).max(600),
  templateFullName: z.string().trim().min(1).max(300),
});

export const sitecoreComponentCreationRequestSchema = z.object({
  selectedTemplateFolder: selectedTemplateFolderSchema,
  contentModel: contentModelSchema,
});

export type SitecoreComponentCreationRequest = z.infer<typeof sitecoreComponentCreationRequestSchema>;

export type SitecoreCreationItemKind =
  | "template-folder"
  | "data-template"
  | "repeated-item-template"
  | "data-folder-template"
  | "rendering-parameters-folder"
  | "rendering-parameters-template"
  | "rendering-folder"
  | "json-rendering";

export type CreatedSitecoreItem = {
  kind: SitecoreCreationItemKind;
  name: string;
  path: string;
  itemId: string;
};

export type SitecoreComponentCreationResult = {
  ok: boolean;
  host: string;
  checkedAt: string;
  latencyMs: number;
  statusCode?: number;
  code: string;
  message: string;
  failedStep?: string;
  createdItems: CreatedSitecoreItem[];
};

export type SitecoreComponentCreationPlan = {
  componentFolderName: string;
  dataTemplateName: string;
  repeatedItemTemplateNames: string[];
  dataFolderTemplateName?: string;
  renderingParametersFolderName?: string;
  renderingParametersTemplateName?: string;
  renderingFolderName: string;
  renderingName: string;
};

/** Turn the AI's safe identifier into the readable Sitecore item names shown in Content Editor. */
export function toSitecoreItemName(identifier: string): string {
  return identifier
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSitecoreComponentCreationPlan(
  model: SitecoreComponentCreationRequest["contentModel"],
): SitecoreComponentCreationPlan {
  const componentFolderName = toSitecoreItemName(model.componentName);
  const hasRepeatedStructures = model.repeatedStructures.length > 0;
  const hasRenderingParameters = model.renderingParameters.length > 0;

  return {
    componentFolderName,
    dataTemplateName: toSitecoreItemName(model.templateName),
    repeatedItemTemplateNames: model.repeatedStructures.map((structure) => toSitecoreItemName(structure.itemTemplateName)),
    dataFolderTemplateName: hasRepeatedStructures ? `${componentFolderName} Folder` : undefined,
    renderingParametersFolderName: hasRenderingParameters ? "Rendering Parameters" : undefined,
    renderingParametersTemplateName: hasRenderingParameters ? `${componentFolderName} Parameters` : undefined,
    renderingFolderName: componentFolderName,
    renderingName: componentFolderName,
  };
}
