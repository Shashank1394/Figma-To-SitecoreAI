import type { ContentField, ContentModel } from "@/lib/content-model";

type DetectedCta = {
  label: string;
  textNodeId?: string;
  controlNodeId?: string;
  hasSolidBackground: boolean;
  hasBorder: boolean;
  groupKey?: string;
  sourceIndex: number;
};

/**
 * Detect styled CTA controls in Figma MCP's generated JSX/HTML context.
 * The LLM remains responsible for general content modeling; this deterministic
 * guard prevents multiple visible button controls from collapsing into a single
 * label-only field when the source exposes their structure.
 */
export function normalizeCtaFields(model: ContentModel, designContext: string): ContentModel {
  // Repeated item structures are handled by the LLM's reusable-item model. Avoid
  // flattening their repeated CTA controls into fixed fields on the parent template.
  if (model.repeatedStructures.length > 0) return model;

  const detectedControls = detectStyledCtaControls(designContext);
  if (detectedControls.length === 0) return model;

  // Normalize only a single CTA or sibling CTAs within the same design group. This
  // avoids mistaking unrelated links in the same frame for a fixed CTA pair.
  const siblingGroup = largestSharedCtaGroup(detectedControls);
  const controls = siblingGroup.length >= 2
    ? siblingGroup
    : detectedControls.length === 1
      ? detectedControls
      : [];
  if (controls.length === 0) return model;

  // This POC represents fixed, individually visible CTA controls as separate General Link fields.
  const orderedControls = orderCtas(controls);
  const ctaFields = orderedControls.map((control, index) => createCtaField(control, index));
  const nonCtaFields = model.fields.filter((field) => !isCtaLabelOnlyField(field));
  const existingWarnings = model.warnings.filter((warning) => !/cta.*destination|button.*destination|call.?to.?action.*destination/i.test(warning));
  const ctaWarnings = [
    "Each visible CTA is represented by its own General Link field. The design does not define the destination URLs, so configure each link destination in Sitecore.",
  ];
  if (orderedControls.some((control) => isPlaceholderLabel(control.label))) {
    ctaWarnings.push("One or more CTA labels appear to be placeholder text (for example, 'Button'); confirm the final link text during content entry.");
  }

  return {
    ...model,
    fields: [...nonCtaFields, ...ctaFields],
    warnings: [...new Set([...ctaWarnings, ...existingWarnings])].slice(0, 12),
  };
}

function detectStyledCtaControls(context: string): DetectedCta[] {
  const controls: DetectedCta[] = [];
  const elementPattern = /<(p|span|button|a)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let match: RegExpExecArray | null;

  while ((match = elementPattern.exec(context)) !== null) {
    const tagName = match[1].toLowerCase();
    const attributes = match[2] ?? "";
    const inner = match[3] ?? "";
    const label = cleanVisibleText(inner);
    if (!label) continue;

    // A real button/link is strongest evidence. Figma-generated code commonly
    // uses a styled <div><p>Label</p></div>, so inspect the closest div wrapper too.
    const elementStart = match.index;
    const ownOpeningTag = context.slice(elementStart, context.indexOf(">", elementStart) + 1);
    const parentOpeningTag = findClosestDivOpeningTag(context, elementStart);
    const openingTag = tagName === "button" || tagName === "a" ? ownOpeningTag : parentOpeningTag ?? ownOpeningTag;
    const className = readAttribute(openingTag, "className") ?? readAttribute(openingTag, "class") ?? "";
    const role = readAttribute(openingTag, "role") ?? readAttribute(attributes, "role") ?? "";
    const dataName = readAttribute(openingTag, "data-name") ?? readAttribute(attributes, "data-name") ?? "";
    const ariaLabel = readAttribute(openingTag, "aria-label") ?? readAttribute(attributes, "aria-label") ?? "";

    const semanticallyInteractive = tagName === "button"
      || role.toLowerCase() === "button"
      || /button|cta|call.?to.?action/i.test(`${dataName} ${ariaLabel}`)
      || /(?:^|\s)(?:button|cta)(?:\s|$)/i.test(className);
    const visuallyStyledButton = /rounded(?:-[^\s]+)?/i.test(className)
      && /justify-center|items-center/i.test(className)
      && /(?:^|\s)px-/i.test(className)
      && /(?:^|\s)(?:bg-|border(?:-|\s|$))/i.test(className);

    // Do not infer CTA roles from arbitrary paragraphs or inline links.
    if (!semanticallyInteractive && !visuallyStyledButton) continue;

    const textNodeId = readAttribute(attributes, "data-node-id");
    const controlNodeId = readAttribute(openingTag, "data-node-id") ?? (tagName === "button" || tagName === "a" ? textNodeId : undefined);
    const backgrounds = Array.from(className.matchAll(/(?:^|\s)bg-([^\s]+)/gi), (entry) => entry[1].toLowerCase());
    const hasSolidBackground = backgrounds.some((background) =>
      background !== "transparent" && !background.includes("rgba(0,0,0,0)") && !background.includes("rgba(0, 0, 0, 0)"),
    );
    const hasBorder = /(?:^|\s)border(?:-|\s|$)/i.test(className);
    const sourceIndex = match.index;
    const divStack = getDivNodeStackAt(context, elementStart);
    const groupIndex = tagName === "button" || tagName === "a" ? divStack.length - 1 : Math.max(0, divStack.length - 3);
    const groupKey = groupIndex >= 0 ? divStack[groupIndex]?.key : undefined;

    // The same element can be visible via overlapping <a>/<button> and child
    // labels in some MCP outputs. Collapse detections by their control node ID.
    const identity = controlNodeId ?? `${label}:${sourceIndex}`;
    if (controls.some((control) => (control.controlNodeId ?? `${control.label}:${control.sourceIndex}`) === identity)) continue;

    controls.push({ label, textNodeId, controlNodeId, hasSolidBackground, hasBorder, groupKey, sourceIndex });
  }

  return controls;
}


function getDivNodeStackAt(context: string, beforeIndex: number): Array<{ key: string; nodeId?: string }> {
  const stack: Array<{ key: string; nodeId?: string }> = [];
  const tagPattern = /<\/?div\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(context)) !== null && match.index < beforeIndex) {
    const tag = match[0];
    if (/^<\//.test(tag)) {
      stack.pop();
      continue;
    }
    const nodeId = readAttribute(tag, "data-node-id");
    stack.push({ key: nodeId ?? `anonymous-div-${match.index}`, nodeId });
  }
  return stack;
}

function largestSharedCtaGroup(controls: DetectedCta[]): DetectedCta[] {
  const groups = new Map<string, DetectedCta[]>();
  for (const control of controls) {
    if (!control.groupKey) continue;
    const group = groups.get(control.groupKey) ?? [];
    group.push(control);
    groups.set(control.groupKey, group);
  }

  return [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
}

function findClosestDivOpeningTag(context: string, beforeIndex: number): string | undefined {
  const start = context.lastIndexOf("<div", beforeIndex);
  if (start < 0) return undefined;
  const end = context.indexOf(">", start);
  if (end < 0 || end >= beforeIndex) return undefined;
  return context.slice(start, end + 1);
}

function readAttribute(source: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b${escapedName}\\s*=\\s*["']([^"']*)["']`, "i").exec(source);
  return match?.[1];
}

function cleanVisibleText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function orderCtas(controls: DetectedCta[]): DetectedCta[] {
  return [...controls].sort((left, right) => {
    // Prefer a solid-filled control as the primary CTA and an outlined control
    // as secondary; preserve MCP source order when styling does not distinguish them.
    const leftPriority = left.hasSolidBackground ? 0 : left.hasBorder ? 1 : 2;
    const rightPriority = right.hasSolidBackground ? 0 : right.hasBorder ? 1 : 2;
    return leftPriority - rightPriority || left.sourceIndex - right.sourceIndex;
  });
}

function createCtaField(control: DetectedCta, index: number): ContentField {
  const role = index === 0 ? "Primary" : index === 1 ? "Secondary" : index === 2 ? "Tertiary" : `CTA${index + 1}`;
  const evidenceParts = [`Visible button text: '${truncate(control.label, 70)}'`];
  if (control.textNodeId) evidenceParts.push(`text node ${control.textNodeId}`);
  if (control.controlNodeId && control.controlNodeId !== control.textNodeId) evidenceParts.push(`control node ${control.controlNodeId}`);

  return {
    name: `${role}CTA`,
    title: `${role} CTA`,
    type: "General Link",
    description: `${role} call-to-action link. The General Link field stores the editable link text and destination together.`,
    rationale: "This is a distinct button in the design, so it needs its own Sitecore General Link field. Do not merge it with other buttons, even if their visible labels are identical.",
    sourceEvidence: evidenceParts.join("; ").slice(0, 300),
    confidence: control.controlNodeId && control.textNodeId ? "high" : "medium",
    requiresReview: true,
  };
}

function isCtaLabelOnlyField(field: ContentField): boolean {
  const identity = `${field.name} ${field.title}`;
  return /cta|call.?to.?action|button\s*(?:label|text|link)?|(?:primary|secondary|tertiary)\s*link/i.test(identity);
}

function isPlaceholderLabel(label: string): boolean {
  return /^(?:button|click here|learn more|cta|link)(?:\s*\d+)?$/i.test(label.trim());
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}
