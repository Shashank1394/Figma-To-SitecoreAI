import { z } from "zod";

/** Keep this list aligned with the Sitecore field types supported by the POC. */
export const sitecoreFieldTypes = [
  "Single-Line Text",
  "Multi-Line Text",
  "Rich Text",
  "Image",
  "General Link",
  "Checkbox",
  "Number",
] as const;

export const sitecoreFieldTypeSchema = z.enum(sitecoreFieldTypes);
export type SitecoreFieldType = z.infer<typeof sitecoreFieldTypeSchema>;

const sitecoreNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(50, "Name must be 50 characters or fewer.")
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Use letters, numbers, and underscores; start with a letter.");

export const contentFieldSchema = z.object({
  name: sitecoreNameSchema,
  title: z.string().trim().min(1).max(100),
  type: sitecoreFieldTypeSchema,
  description: z.string().trim().min(1).max(300),
  rationale: z.string().trim().min(1).max(400),
  sourceEvidence: z.string().trim().min(1).max(300),
  confidence: z.enum(["high", "medium", "low"]),
  requiresReview: z.boolean(),
});

export type ContentField = z.infer<typeof contentFieldSchema>;

const repeatedStructureSchema = z.object({
  name: sitecoreNameSchema,
  itemTemplateName: sitecoreNameSchema,
  description: z.string().trim().min(1).max(300),
  sourceEvidence: z.string().trim().min(1).max(300),
  fields: z.array(contentFieldSchema).max(20),
  confidence: z.enum(["high", "medium", "low"]),
  requiresReview: z.boolean(),
});

export type RepeatedStructure = z.infer<typeof repeatedStructureSchema>;

function ensureUniqueFieldNames(
  fields: ContentField[],
  path: (string | number)[],
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const normalizedName = field.name.toLowerCase();
    if (seen.has(normalizedName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, "name"],
        message: `Field name "${field.name}" is duplicated.`,
      });
    }
    seen.add(normalizedName);
  });
}

export const contentModelSchema = z
  .object({
    componentName: sitecoreNameSchema,
    templateName: sitecoreNameSchema,
    summary: z.string().trim().min(1).max(400),
    fields: z.array(contentFieldSchema).max(30),
    repeatedStructures: z.array(repeatedStructureSchema).max(10),
    warnings: z.array(z.string().trim().min(1).max(400)).max(12),
  })
  .superRefine((model, context) => {
    ensureUniqueFieldNames(model.fields, ["fields"], context);

    const repeatedNames = new Set<string>();
    const itemTemplateNames = new Set<string>();
    model.repeatedStructures.forEach((structure, index) => {
      ensureUniqueFieldNames(structure.fields, ["repeatedStructures", index, "fields"], context);

      const groupName = structure.name.toLowerCase();
      if (repeatedNames.has(groupName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repeatedStructures", index, "name"],
          message: `Repeated structure name "${structure.name}" is duplicated.`,
        });
      }
      repeatedNames.add(groupName);

      const itemTemplateName = structure.itemTemplateName.toLowerCase();
      if (itemTemplateNames.has(itemTemplateName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repeatedStructures", index, "itemTemplateName"],
          message: `Item template name "${structure.itemTemplateName}" is duplicated.`,
        });
      }
      itemTemplateNames.add(itemTemplateName);
    });
  });

export type ContentModel = z.infer<typeof contentModelSchema>;

export const MAX_DESIGN_CONTEXT_LENGTH = 80_000;
