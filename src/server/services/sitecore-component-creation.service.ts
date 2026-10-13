import type { ContentField } from "@/lib/content-model";
import {
  getSitecoreComponentCreationPlan,
  type CreatedSitecoreItem,
  type SitecoreComponentCreationRequest,
  type SitecoreComponentCreationResult,
} from "@/lib/sitecore-component-creation";
import {
  SitecoreAuthoringClient,
  SitecoreGraphQLRequestError,
} from "@/server/integrations/sitecore/sitecore-authoring-client";

const ITEM_AT_PATH_QUERY = `query ItemAtPath($path: String!) {
  item(where: { path: $path }) {
    itemId
    name
    path
    template { name templateId fullName }
  }
}`;

const CREATE_TEMPLATE_FOLDER_MUTATION = `mutation CreateTemplateFolder($input: CreateItemTemplateFolderInput!) {
  createItemTemplateFolder(input: $input) {
    item { itemId name path }
  }
}`;

const CREATE_ITEM_TEMPLATE_MUTATION = `mutation CreateItemTemplate($input: CreateItemTemplateInput!) {
  createItemTemplate(input: $input) {
    itemTemplate { templateId name fullName }
  }
}`;

const CREATE_ITEM_MUTATION = `mutation CreateSitecoreItem($input: CreateItemInput!) {
  createItem(input: $input) {
    item {
      itemId
      name
      path
      template { name templateId fullName }
    }
  }
}`;

const UPDATE_ITEM_MUTATION = `mutation UpdateSitecoreItem($input: UpdateItemInput!) {
  updateItem(input: $input) {
    item { itemId name path }
  }
}`;

const STANDARD_VALUES_FIELDS_QUERY = `query StandardValuesFields($itemId: String!) {
  item(where: { itemId: $itemId }) {
    itemId
    path
    fields(excludeStandardFields: false, ownFields: false, first: 300) {
      nodes { name value }
    }
  }
}`;

const JSON_RENDERING_TEMPLATE_QUERY = `query JsonRenderingTemplate {
  availableRenderings(where: { database: "master" }) {
    itemId
    name
    path
    template { name templateId fullName }
  }
}`;

type JsonRecord = Record<string, unknown>;
type SitecoreItem = { itemId: string; name: string; path: string; templateName?: string; templateId?: string; templateFullName?: string };

export class SitecoreComponentCreationService {
  constructor(private readonly client: SitecoreAuthoringClient) {}

  async create(request: SitecoreComponentCreationRequest): Promise<SitecoreComponentCreationResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const host = this.client.hostForDisplay();
    const createdItems: CreatedSitecoreItem[] = [];
    let currentStep = "Validate the selected destination";

    const fail = (code: string, message: string, statusCode?: number, failedStep?: string): SitecoreComponentCreationResult => ({
      ok: false,
      host,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      statusCode,
      code,
      message,
      failedStep,
      createdItems,
    });

    try {
      const selectedPath = normalizeSitecorePath(request.selectedTemplateFolder.path);
      if (!isTemplatePath(selectedPath)) {
        return fail("INVALID_TEMPLATE_DESTINATION", "Choose a destination folder inside /sitecore/templates.", 400, currentStep);
      }
      if (selectedPath.split("/").includes("..") || selectedPath.includes("\\")) {
        return fail("INVALID_TEMPLATE_DESTINATION", "The selected template path contains an invalid path segment.", 400, currentStep);
      }

      const renderingRootPath = normalizeSitecorePath(request.selectedRenderingFolder.path);
      if (!isRenderingPath(renderingRootPath) || renderingRootPath.split("/").includes("..") || renderingRootPath.includes("\\")) {
        return fail("INVALID_RENDERINGS_DESTINATION", "Choose a rendering-folder destination inside /sitecore/layout/Renderings.", 400, currentStep);
      }

      const model = request.contentModel;
      const plan = getSitecoreComponentCreationPlan(model);
      const templateFolderPath = `${selectedPath}/${plan.componentFolderName}`;
      const dataTemplatePath = `${templateFolderPath}/${plan.dataTemplateName}`;
      const repeatedTemplatePaths = plan.repeatedItemTemplateNames.map((name) => `${templateFolderPath}/${name}`);
      const dataFolderTemplatePath = plan.dataFolderTemplateName ? `${templateFolderPath}/${plan.dataFolderTemplateName}` : undefined;
      const parametersFolderPath = plan.renderingParametersFolderName ? `${templateFolderPath}/${plan.renderingParametersFolderName}` : undefined;
      const parametersTemplatePath = parametersFolderPath && plan.renderingParametersTemplateName
        ? `${parametersFolderPath}/${plan.renderingParametersTemplateName}`
        : undefined;
      const renderingFolderPath = `${renderingRootPath}/${plan.renderingFolderName}`;
      const renderingPath = `${renderingFolderPath}/${plan.renderingName}`;

      currentStep = "Verify the selected folder";
      const selectedFolder = await this.getItemByPath(selectedPath);
      if (!selectedFolder || selectedFolder.itemId.toLowerCase() !== request.selectedTemplateFolder.itemId.toLowerCase()) {
        return fail("TEMPLATE_DESTINATION_CHANGED", "The selected folder could not be verified against SitecoreAI. Refresh the template tree and select the folder again.", 409, currentStep);
      }
      const selectedIdentity = `${selectedFolder.templateName ?? ""} ${selectedFolder.templateFullName ?? ""}`.toLowerCase();
      const selectedIsTemplateFolder = selectedPath === "/sitecore/templates" || selectedIdentity.includes("template folder") || selectedIdentity.includes("templates folder") || selectedFolder.templateName?.toLowerCase() === "folder";
      if (!selectedIsTemplateFolder) {
        return fail("INVALID_TEMPLATE_DESTINATION", "The selected item is not a template folder. Choose a folder from the /sitecore/templates tree.", 400, currentStep);
      }

      currentStep = "Verify the selected rendering destination";
      const renderingParent = await this.getItemByPath(renderingRootPath);
      if (!renderingParent || renderingParent.itemId.toLowerCase() !== request.selectedRenderingFolder.itemId.toLowerCase()) {
        return fail("RENDERING_DESTINATION_CHANGED", "The selected rendering folder could not be verified against SitecoreAI. Refresh the rendering tree and select the folder again.", 409, currentStep);
      }
      const renderingIdentity = `${renderingParent.templateName ?? ""} ${renderingParent.templateFullName ?? ""}`.toLowerCase();
      const selectedIsRenderingFolder = renderingRootPath === "/sitecore/layout/Renderings" || renderingIdentity.includes("rendering folder");
      if (!selectedIsRenderingFolder) {
        return fail("INVALID_RENDERINGS_DESTINATION", "The selected item is not a Rendering Folder. Choose a folder from the /sitecore/layout/Renderings tree.", 400, currentStep);
      }

      currentStep = "Validate the creation plan";
      const siblingNames = [
        plan.dataTemplateName,
        ...plan.repeatedItemTemplateNames,
        ...(plan.dataFolderTemplateName ? [plan.dataFolderTemplateName] : []),
        ...(plan.renderingParametersFolderName ? [plan.renderingParametersFolderName] : []),
      ];
      const duplicateName = siblingNames.find((name, index) => siblingNames.findIndex((other) => other.toLocaleLowerCase() === name.toLocaleLowerCase()) !== index);
      if (duplicateName) {
        return fail("DUPLICATE_PLANNED_NAME", `The generated structure contains a duplicate item name: ${duplicateName}. Rename the content model before creating it.`, 400, currentStep);
      }

      currentStep = "Resolve Sitecore base templates and rendering definitions";
      const standardTemplate = await this.requireItem(
        "/sitecore/templates/System/Templates/Standard template",
        "The standard Sitecore template could not be found. No items were created.",
      );
      const renderingFolderTemplate = await this.requireItem(
        "/sitecore/templates/System/Layout/Renderings/Rendering Folder",
        "The standard Rendering Folder template could not be found. No items were created.",
      );
      const dataFolderBaseTemplate = dataFolderTemplatePath
        ? await this.requireItem(
            "/sitecore/templates/Common/Folder",
            "The common Folder template is required for repeated-content data folders, but it could not be found. No items were created.",
          )
        : undefined;
      let standardRenderingParametersTemplate: SitecoreItem | undefined;
      if (parametersTemplatePath) {
        standardRenderingParametersTemplate = await this.requireItem(
          "/sitecore/templates/System/Layout/Rendering Parameters/Standard Rendering Parameters",
          "The Standard Rendering Parameters template could not be found. No items were created.",
        );
      }
      const jsonRenderingTemplateId = await this.resolveJsonRenderingTemplateId();

      currentStep = "Check for existing items";
      const plannedPaths = [
        templateFolderPath,
        dataTemplatePath,
        ...repeatedTemplatePaths,
        ...(dataFolderTemplatePath ? [dataFolderTemplatePath] : []),
        ...(parametersFolderPath ? [parametersFolderPath] : []),
        ...(parametersTemplatePath ? [parametersTemplatePath] : []),
        renderingFolderPath,
        renderingPath,
      ];
      for (const path of plannedPaths) {
        const existing = await this.getItemByPath(path);
        if (existing) {
          return fail(
            "ITEM_ALREADY_EXISTS",
            `An item already exists at ${path}. FrameForge does not overwrite existing Sitecore items. Choose a different component name or destination. No items were created.`,
            409,
            currentStep,
          );
        }
      }

      currentStep = "Create the component template folder";
      const componentFolder = await this.createTemplateFolder(selectedFolder.itemId, plan.componentFolderName, templateFolderPath);
      createdItems.push({ kind: "template-folder", ...componentFolder });

      for (let index = 0; index < model.repeatedStructures.length; index += 1) {
        const repeated = model.repeatedStructures[index];
        const name = plan.repeatedItemTemplateNames[index];
        currentStep = `Create repeated item template: ${name}`;
        const item = await this.createItemTemplate({
          parentId: componentFolder.itemId,
          name,
          path: repeatedTemplatePaths[index],
          baseTemplates: [standardTemplate.itemId],
          sectionName: "Data",
          fields: repeated.fields,
        });
        createdItems.push({ kind: "repeated-item-template", ...item });
      }

      currentStep = `Create data source template: ${plan.dataTemplateName}`;
      const dataTemplate = await this.createItemTemplate({
        parentId: componentFolder.itemId,
        name: plan.dataTemplateName,
        path: dataTemplatePath,
        baseTemplates: [standardTemplate.itemId],
        sectionName: "Data",
        fields: model.fields,
      });
      createdItems.push({ kind: "data-template", ...dataTemplate });

      if (plan.dataFolderTemplateName && dataFolderTemplatePath && dataFolderBaseTemplate) {
        currentStep = `Create data folder template: ${plan.dataFolderTemplateName}`;
        const dataFolderTemplate = await this.createItemTemplate({
          parentId: componentFolder.itemId,
          name: plan.dataFolderTemplateName,
          path: dataFolderTemplatePath,
          baseTemplates: [dataFolderBaseTemplate.itemId],
          sectionName: "Data",
          fields: [],
          createStandardValuesItem: true,
        });
        createdItems.push({ kind: "data-folder-template", ...dataFolderTemplate });

        currentStep = "Verify the data-folder Standard Values item";
        const standardValuesPath = `${dataFolderTemplatePath}/__Standard Values`;
        const standardValues = await this.getItemByPath(standardValuesPath);
        if (!standardValues) {
          throw new CreationError(
            `Sitecore did not create the expected Standard Values item at ${standardValuesPath}. The component template and data-folder template were created, but insert options were not configured.`,
            "STANDARD_VALUES_NOT_CREATED",
            502,
          );
        }
        createdItems.push({ kind: "data-folder-standard-values", name: standardValues.name, path: standardValues.path, itemId: standardValues.itemId });

        currentStep = "Restrict data-folder insert options to the data template";
        await this.updateItemField(standardValues.itemId, "__Masters", toSitecoreGuid(dataTemplate.itemId));
        await this.verifyDataFolderInsertOption(standardValues.itemId, dataTemplate.itemId, standardValuesPath);
      }

      if (plan.renderingParametersFolderName && parametersFolderPath && parametersTemplatePath && standardRenderingParametersTemplate) {
        currentStep = "Create the Rendering Parameters template folder";
        const folder = await this.createTemplateFolder(componentFolder.itemId, plan.renderingParametersFolderName, parametersFolderPath);
        createdItems.push({ kind: "rendering-parameters-folder", ...folder });

        currentStep = `Create rendering parameters template: ${plan.renderingParametersTemplateName}`;
        const parameters = await this.createItemTemplate({
          parentId: folder.itemId,
          name: plan.renderingParametersTemplateName ?? `${plan.componentFolderName} Parameters`,
          path: parametersTemplatePath,
          baseTemplates: [standardRenderingParametersTemplate.itemId],
          sectionName: "Parameters",
          fields: model.renderingParameters,
        });
        createdItems.push({ kind: "rendering-parameters-template", ...parameters });
      }

      currentStep = "Create the JSON Rendering folder";
      const renderingFolder = await this.createSitecoreItem({
        name: plan.renderingFolderName,
        path: renderingFolderPath,
        parentId: renderingParent.itemId,
        templateId: renderingFolderTemplate.itemId,
        fields: [],
        kind: "rendering-folder",
      });
      createdItems.push(renderingFolder);

      currentStep = "Create the JSON Rendering definition";
      const datasourceLocation = plan.dataFolderTemplateName
        ? `query:$site/*[@@name='Data']/*[@@templatename='${plan.dataFolderTemplateName}']|query:$sharedSites/*[@@name='Data']/*[@@templatename='${plan.dataFolderTemplateName}']`
        : "query:$site/*[@@name='Data']|query:$sharedSites/*[@@name='Data']";
      const renderingFields = [
        { name: "componentName", value: model.componentName },
        { name: "Datasource Template", value: dataTemplatePath },
        { name: "Datasource Location", value: datasourceLocation },
        ...(parametersTemplatePath ? [{ name: "Parameters Template", value: parametersTemplatePath }] : []),
      ];
      const rendering = await this.createSitecoreItem({
        name: plan.renderingName,
        path: renderingPath,
        parentId: renderingFolder.itemId,
        templateId: jsonRenderingTemplateId,
        fields: renderingFields,
        kind: "json-rendering",
      });
      createdItems.push(rendering);

      currentStep = "Verify created items";
      for (const created of createdItems) {
        const verified = await this.getItemByPath(created.path);
        if (!verified || verified.itemId.toLowerCase() !== created.itemId.toLowerCase()) {
          throw new Error(`Read-back verification failed for ${created.path}. The items created so far were left in place; no rollback was attempted.`);
        }
      }

      return {
        ok: true,
        host,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        statusCode: 200,
        code: "COMPONENT_STRUCTURE_CREATED",
        message: `Created and verified ${createdItems.length} Sitecore item(s). The template-side structure is under ${templateFolderPath}; the JSON Rendering is under ${renderingPath}. No publishing or frontend code generation was performed.`,
        createdItems,
      };
    } catch (error) {
      const errorStatus = error instanceof SitecoreGraphQLRequestError || error instanceof CreationError ? error.statusCode : undefined;
      const errorCode = error instanceof SitecoreGraphQLRequestError || error instanceof CreationError ? error.code : undefined;
      const detail = error instanceof Error ? error.message : "Unknown Sitecore creation error.";
      const hasPartialWrites = createdItems.length > 0;
      return fail(
        hasPartialWrites ? "PARTIAL_CREATION" : errorCode ?? "SITECORE_CREATION_FAILED",
        hasPartialWrites
          ? `Creation stopped during “${currentStep}”. ${detail} ${createdItems.length} item(s) were created before the failure and were not rolled back. Review the created-item list before retrying.`
          : detail,
        hasPartialWrites ? 502 : errorStatus ?? 502,
        currentStep,
      );
    }
  }

  private async getItemByPath(path: string): Promise<SitecoreItem | null> {
    const result = await this.client.requestGraphQL(ITEM_AT_PATH_QUERY, { path });
    const value = result.data.item;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as JsonRecord;
    if (typeof raw.itemId !== "string" || typeof raw.path !== "string" || typeof raw.name !== "string") return null;
    const template = raw.template && typeof raw.template === "object" && !Array.isArray(raw.template)
      ? raw.template as JsonRecord
      : {};
    return {
      itemId: raw.itemId,
      name: raw.name,
      path: raw.path,
      templateName: typeof template.name === "string" ? template.name : undefined,
      templateId: typeof template.templateId === "string" ? template.templateId : undefined,
      templateFullName: typeof template.fullName === "string" ? template.fullName : undefined,
    };
  }

  private async requireItem(path: string, missingMessage: string): Promise<SitecoreItem> {
    const item = await this.getItemByPath(path);
    if (!item) throw new CreationError(missingMessage, "SITECORE_REQUIRED_ITEM_MISSING", 400);
    return item;
  }

  private async resolveJsonRenderingTemplateId(): Promise<string> {
    const knownTemplatePath = "/sitecore/templates/Foundation/JavaScript Services/Json Rendering";
    const template = await this.getItemByPath(knownTemplatePath);
    if (template) return template.itemId;

    const result = await this.client.requestGraphQL(JSON_RENDERING_TEMPLATE_QUERY);
    const raw = result.data.availableRenderings;
    const candidates = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? firstArray((raw as JsonRecord).nodes, (raw as JsonRecord).results)
        : [];
    for (const value of candidates) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as JsonRecord;
      const templateObject = item.template && typeof item.template === "object" && !Array.isArray(item.template)
        ? item.template as JsonRecord
        : {};
      if (typeof templateObject.name === "string" && templateObject.name.toLowerCase() === "json rendering" && typeof templateObject.templateId === "string") {
        return templateObject.templateId;
      }
    }
    throw new CreationError("Could not resolve the JSON Rendering template ID in this SitecoreAI environment. No items were created.", "JSON_RENDERING_TEMPLATE_NOT_FOUND", 400);
  }

  private async createTemplateFolder(parentId: string, name: string, expectedPath: string): Promise<Omit<CreatedSitecoreItem, "kind">> {
    const response = await this.client.requestGraphQL(CREATE_TEMPLATE_FOLDER_MUTATION, {
      input: { parent: parentId, name, database: "master", language: "en" },
    });
    const payload = asRecord(response.data.createItemTemplateFolder);
    const item = asRecord(payload?.item);
    const itemId = typeof item?.itemId === "string" ? item.itemId : "";
    const path = typeof item?.path === "string" ? item.path : expectedPath;
    if (!itemId) throw new Error(`Sitecore did not return an item ID after creating ${expectedPath}.`);
    return { name, path, itemId };
  }

  private async createItemTemplate(input: {
    parentId: string;
    name: string;
    path: string;
    baseTemplates: string[];
    sectionName: string;
    fields: ContentField[];
    createStandardValuesItem?: boolean;
  }): Promise<Omit<CreatedSitecoreItem, "kind">> {
    const sections = input.fields.length > 0
      ? [{
          name: input.sectionName,
          sortOrder: 100,
          fields: input.fields.map((field, index) => ({
            name: field.name,
            title: field.title,
            type: field.type,
            description: field.description,
            sortOrder: (index + 1) * 100,
          })),
        }]
      : [];
    const response = await this.client.requestGraphQL(CREATE_ITEM_TEMPLATE_MUTATION, {
      input: {
        parent: input.parentId,
        name: input.name,
        baseTemplates: input.baseTemplates,
        sections,
        createStandardValuesItem: input.createStandardValuesItem ?? false,
        database: "master",
        language: "en",
      },
    });
    const payload = asRecord(response.data.createItemTemplate);
    const template = asRecord(payload?.itemTemplate);
    const templateId = typeof template?.templateId === "string" ? template.templateId : "";
    if (!templateId) throw new Error(`Sitecore did not return a template ID after creating ${input.path}.`);
    return { name: input.name, path: input.path, itemId: templateId };
  }

  private async updateItemField(itemId: string, name: string, value: string): Promise<void> {
    const response = await this.client.requestGraphQL(UPDATE_ITEM_MUTATION, {
      input: {
        database: "master",
        language: "en",
        itemId,
        fields: [{ name, value }],
      },
    });
    const payload = asRecord(response.data.updateItem);
    const item = asRecord(payload?.item);
    if (!item || typeof item.itemId !== "string" || item.itemId.toLowerCase() !== itemId.toLowerCase()) {
      throw new Error(`Sitecore did not confirm updating the ${name} field on item ${itemId}.`);
    }
  }

  private async verifyDataFolderInsertOption(standardValuesItemId: string, allowedTemplateId: string, path: string): Promise<void> {
    const response = await this.client.requestGraphQL(STANDARD_VALUES_FIELDS_QUERY, { itemId: standardValuesItemId });
    const item = asRecord(response.data.item);
    const fieldsConnection = asRecord(item?.fields);
    const nodes = Array.isArray(fieldsConnection?.nodes) ? fieldsConnection.nodes : [];
    const mastersField = nodes
      .map(asRecord)
      .find((field) => typeof field?.name === "string" && field.name.toLowerCase() === "__masters");
    const value = typeof mastersField?.value === "string" ? mastersField.value : "";
    const actualIds = value.split("|").map((part) => part.replace(/[{}-]/g, "").trim().toUpperCase()).filter(Boolean);
    const expectedId = allowedTemplateId.replace(/[{}-]/g, "").toUpperCase();
    if (actualIds.length !== 1 || actualIds[0] !== expectedId) {
      throw new CreationError(
        `The insert options on ${path} could not be verified. Expected only ${allowedTemplateId}, but Sitecore returned "${value || "<empty>"}".`,
        "DATA_FOLDER_INSERT_OPTIONS_NOT_VERIFIED",
        502,
      );
    }
  }

  private async createSitecoreItem(input: {
    parentId: string;
    templateId: string;
    name: string;
    path: string;
    fields: Array<{ name: string; value: string }>;
    kind: "rendering-folder" | "json-rendering";
  }): Promise<CreatedSitecoreItem> {
    const response = await this.client.requestGraphQL(CREATE_ITEM_MUTATION, {
      input: {
        database: "master",
        language: "en",
        name: input.name,
        parent: input.parentId,
        templateId: input.templateId,
        fields: input.fields,
      },
    });
    const payload = asRecord(response.data.createItem);
    const item = asRecord(payload?.item);
    const itemId = typeof item?.itemId === "string" ? item.itemId : "";
    if (!itemId) throw new Error(`Sitecore did not return an item ID after creating ${input.path}.`);
    const path = typeof item?.path === "string" ? item.path : input.path;
    return { kind: input.kind, name: input.name, path, itemId };
  }
}

class CreationError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message);
    this.name = "CreationError";
  }
}

function normalizeSitecorePath(value: string): string {
  return value.trim().replace(/\/+$/, "") || "/";
}

function isTemplatePath(path: string): boolean {
  return path === "/sitecore/templates" || path.startsWith("/sitecore/templates/");
}

function isRenderingPath(path: string): boolean {
  return path === "/sitecore/layout/Renderings" || path.startsWith("/sitecore/layout/Renderings/");
}

function toSitecoreGuid(itemId: string): string {
  const hex = itemId.replace(/[{}-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(hex)) {
    throw new CreationError(`Sitecore returned an unexpected template ID format: ${itemId}.`, "INVALID_TEMPLATE_ID", 502);
  }
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find((value): value is unknown[] => Array.isArray(value)) ?? [];
}
