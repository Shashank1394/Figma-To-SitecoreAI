"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowDownRight,
  AlertTriangle,
  BrainCircuit,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Component,
  Figma,
  FileCode2,
  Layers3,
  Link2,
  LoaderCircle,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Workflow,
  XCircle,
} from "lucide-react";
import styles from "./studio-page.module.scss";
import { parseFigmaDesignUrl, type ParsedFigmaUrl } from "@/lib/figma-url";
import { sitecoreFieldTypes, type ContentField, type ContentModel } from "@/lib/content-model";

type Integration = {
  id: "figma" | "gemini" | "sitecore";
  name: string;
  state: "connected" | "configured" | "needs-setup" | "unavailable";
  message: string;
  details?: string[];
};

type ConnectionResponse = { checkedAt: string; integrations: Integration[] };

type GeminiConnectionTest = {
  ok: boolean;
  model: string;
  checkedAt: string;
  latencyMs: number;
  statusCode?: number;
  code?: string;
  message: string;
};

type DesignContext = {
  fileKey: string;
  nodeId: string;
  sourceUrl: string;
  toolName: string;
  text: string;
  characterCount: number;
  imageCount: number;
  receivedAt: string;
};

type LinkState =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "valid"; value: ParsedFigmaUrl };

const steps = [
  { number: "01", title: "Source design", subtitle: "Select a Figma frame" },
  { number: "02", title: "Analyze fields", subtitle: "Infer the content model" },
  { number: "03", title: "Create in Sitecore", subtitle: "Review and create items" },
];

function StateIndicator({ state }: { state: Integration["state"] }) {
  if (state === "connected" || state === "configured") return <span className={`${styles.stateDot} ${styles.stateDotGood}`} />;
  if (state === "unavailable") return <span className={`${styles.stateDot} ${styles.stateDotBad}`} />;
  return <span className={`${styles.stateDot} ${styles.stateDotIdle}`} />;
}

export function StudioPage() {
  const [figmaUrl, setFigmaUrl] = useState("");
  const [linkState, setLinkState] = useState<LinkState>({ status: "idle" });
  const [connectionState, setConnectionState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [geminiTestState, setGeminiTestState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [geminiTest, setGeminiTest] = useState<GeminiConnectionTest | null>(null);
  const [designState, setDesignState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [designContext, setDesignContext] = useState<DesignContext | null>(null);
  const [designError, setDesignError] = useState("");
  const [showFullContext, setShowFullContext] = useState(false);
  const [analysisState, setAnalysisState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [contentModel, setContentModel] = useState<ContentModel | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisModel, setAnalysisModel] = useState("");

  function validateLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseFigmaDesignUrl(figmaUrl);
    setLinkState(result.valid ? { status: "valid", value: result.value } : { status: "invalid", message: result.message });
    setDesignContext(null);
    setDesignError("");
    setDesignState("idle");
    setAnalysisState("idle");
    setContentModel(null);
    setAnalysisError("");
  }

  async function readDesignContext() {
    const result = parseFigmaDesignUrl(figmaUrl);
    if (!result.valid) {
      setLinkState({ status: "invalid", message: result.message });
      return;
    }

    setLinkState({ status: "valid", value: result.value });
    setDesignState("loading");
    setDesignError("");
    setDesignContext(null);
    setShowFullContext(false);
    setAnalysisState("idle");
    setContentModel(null);
    setAnalysisError("");

    try {
      const response = await fetch("/api/design-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.value.normalizedUrl }),
        cache: "no-store",
      });
      const body = (await response.json()) as { designContext?: DesignContext; error?: string };
      if (!response.ok || !body.designContext) {
        throw new Error(body.error ?? "Could not read the selected Figma design.");
      }
      setDesignContext(body.designContext);
      setDesignState("loaded");
    } catch (error) {
      setDesignError(error instanceof Error ? error.message : "Could not read the selected Figma design.");
      setDesignState("error");
    }
  }

  async function analyzeDesign() {
    if (!designContext) return;

    setAnalysisState("loading");
    setAnalysisError("");
    setContentModel(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designContext: {
            fileKey: designContext.fileKey,
            nodeId: designContext.nodeId,
            sourceUrl: designContext.sourceUrl,
            toolName: designContext.toolName,
            text: designContext.text,
          },
        }),
        cache: "no-store",
      });
      const body = (await response.json()) as { contentModel?: ContentModel; model?: string; error?: string };
      if (!response.ok || !body.contentModel) {
        throw new Error(body.error ?? "Could not analyze the selected design.");
      }

      setContentModel(body.contentModel);
      setAnalysisModel(body.model ?? "Google Gemini");
      setAnalysisState("loaded");
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Could not analyze the selected design.");
      setAnalysisState("error");
    }
  }

  function updateField(fieldIndex: number, updates: Partial<ContentField>) {
    setContentModel((current) => {
      if (!current) return current;
      return {
        ...current,
        fields: current.fields.map((field, index) => index === fieldIndex ? { ...field, ...updates } : field),
      };
    });
  }

  function updateRepeatedField(structureIndex: number, fieldIndex: number, updates: Partial<ContentField>) {
    setContentModel((current) => {
      if (!current) return current;
      return {
        ...current,
        repeatedStructures: current.repeatedStructures.map((structure, groupIndex) => groupIndex !== structureIndex
          ? structure
          : {
              ...structure,
              fields: structure.fields.map((field, index) => index === fieldIndex ? { ...field, ...updates } : field),
            }),
      };
    });
  }

  function updateModelName(key: "componentName" | "templateName", value: string) {
    setContentModel((current) => current ? { ...current, [key]: value } : current);
  }

  function renderFieldCard(
    field: ContentField,
    fieldKey: string,
    onUpdate: (updates: Partial<ContentField>) => void,
  ) {
    return (
      <article className={styles.modelField} key={fieldKey}>
        <div className={styles.modelFieldTop}>
          <div className={styles.modelFieldNameGroup}>
            <label className={styles.modelInputLabel}>
              Field name
              <input
                className={styles.modelTextInput}
                value={field.name}
                onChange={(event) => onUpdate({ name: event.target.value })}
                pattern="[A-Za-z][A-Za-z0-9_]{0,49}"
                aria-label={`${field.title} Sitecore field name`}
              />
            </label>
            <label className={styles.modelInputLabel}>
              Editor-facing title
              <input
                className={styles.modelTextInput}
                value={field.title}
                onChange={(event) => onUpdate({ title: event.target.value })}
                aria-label={`${field.name} editor-facing title`}
              />
            </label>
          </div>
          <label className={styles.modelInputLabel}>
            Sitecore field type
            <select
              className={styles.modelTypeSelect}
              value={field.type}
              onChange={(event) => onUpdate({ type: event.target.value as ContentField["type"] })}
              aria-label={`${field.title} Sitecore field type`}
            >
              {sitecoreFieldTypes.map((fieldType) => <option key={fieldType} value={fieldType}>{fieldType}</option>)}
            </select>
          </label>
        </div>
        <p className={styles.modelFieldDescription}>{field.description}</p>
        <p className={styles.modelFieldRationale}>{field.rationale}</p>
        <div className={styles.modelEvidence}><span>DESIGN EVIDENCE</span><code>{field.sourceEvidence}</code></div>
        <div className={styles.modelFieldFooter}>
          <span className={`${styles.confidencePill} ${field.confidence === "high" ? styles.confidenceHigh : field.confidence === "medium" ? styles.confidenceMedium : styles.confidenceLow}`}>
            {field.confidence} confidence
          </span>
          {field.requiresReview && <span className={styles.reviewPill}><AlertTriangle size={12} /> Review recommended</span>}
        </div>
      </article>
    );
  }

  async function checkConnections() {
    setConnectionState("loading");
    setConnectionError("");
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      const body = (await response.json()) as ConnectionResponse | { error: string };
      if (!response.ok || !("integrations" in body)) {
        throw new Error("error" in body ? body.error : "Connection check failed.");
      }
      setIntegrations(body.integrations);
      setCheckedAt(body.checkedAt);
      setConnectionState("loaded");
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Connection check failed.");
      setConnectionState("error");
    }
  }

  async function testGeminiConnection() {
    setGeminiTestState("loading");
    setGeminiTest(null);

    try {
      const response = await fetch("/api/gemini-connection", {
        method: "POST",
        cache: "no-store",
      });
      const body = (await response.json()) as GeminiConnectionTest;
      setGeminiTest(body);
      setGeminiTestState(body.ok ? "success" : "error");
    } catch (error) {
      setGeminiTest({
        ok: false,
        model: "Configured model",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        code: "LOCAL_REQUEST_FAILED",
        message: error instanceof Error ? error.message : "The Gemini connection test could not be completed.",
      });
      setGeminiTestState("error");
    }
  }

  const figmaStatus = integrations.find((integration) => integration.id === "figma");
  const sitecoreStatus = integrations.find((integration) => integration.id === "sitecore");
  const geminiStatus = integrations.find((integration) => integration.id === "gemini");
  const activeStepIndex = designContext && designState === "loaded" ? 1 : 0;

  return (
    <main className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><Component size={21} strokeWidth={2.3} /></div>
          <div>
            <div className={styles.brandName}>FrameForge</div>
            <div className={styles.brandCaption}>FIGMA → SITECOREAI</div>
          </div>
        </div>

        <div className={styles.sidebarSectionLabel}>WORKSPACE</div>
        <div className={`${styles.navItem} ${styles.navItemActive}`}>
          <Layers3 size={17} />
          <span>Component builder</span>
          <span className={styles.navActiveMark} />
        </div>

        <div className={styles.sidebarDivider} />
        <div className={styles.sidebarSectionLabel}>IN THIS POC</div>
        <div className={styles.sidebarNote}>
          <div className={styles.sidebarNoteIcon}><Workflow size={16} /></div>
          <div>
            <strong>One focused workflow</strong>
            <p>Read a design, infer fields, create Sitecore definitions.</p>
          </div>
        </div>

        <div className={styles.sidebarFooter}>
          <div className={styles.footerIcon}><ShieldCheck size={17} /></div>
          <div>
            <strong>Local-first workspace</strong>
            <p>Credentials stay on the server.</p>
          </div>
        </div>
      </aside>

      <section className={styles.mainArea}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}><span>Workspace</span><span className={styles.breadcrumbSlash}>/</span><strong>Component builder</strong></div>
          <div className={styles.topbarRight}>
            <span className={styles.localPill}><span /> Local workspace</span>
            <button className={styles.helpButton} type="button" title="Project flow" aria-label="Project flow"><CircleHelp size={18} /></button>
          </div>
        </header>

        <div className={styles.content}>
          <div className={styles.pageIntro}>
            <div>
              <div className={styles.eyebrow}><Sparkles size={14} /> DESIGN-TO-CONTENT WORKFLOW</div>
              <h1>From Figma to <span>SitecoreAI.</span></h1>
              <p>Turn a selected design into a proposed content model and Sitecore component definition—with you in control at every step.</p>
            </div>
            <div className={styles.introDecor} aria-hidden="true">
              <div className={styles.decorTile}><Figma size={28} /></div>
              <ArrowRight size={19} className={styles.decorArrow} />
              <div className={styles.decorTileSitecore}><Component size={27} /></div>
            </div>
          </div>

          <section className={styles.stepper} aria-label="Workflow stages">
            {steps.map((step, index) => (
              <div className={styles.step} key={step.number}>
                <div className={`${styles.stepNumber} ${index === activeStepIndex || index < activeStepIndex ? styles.stepNumberActive : ""}`}>{index < activeStepIndex ? <Check size={15} /> : step.number}</div>
                <div className={styles.stepText}><strong>{step.title}</strong><span>{step.subtitle}</span></div>
                {index < steps.length - 1 && <div className={styles.stepConnector} />}
              </div>
            ))}
          </section>

          <div className={styles.sectionHeading}>
            <div><h2>Start with your design</h2><p>Choose one frame or component to define the Sitecore content model.</p></div>
            <span className={styles.pocTag}>POC · PHASE 1</span>
          </div>

          <div className={styles.workspaceGrid}>
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleIcon}><Figma size={18} /></div>
                <div className={styles.cardTitleGroup}><h3>Figma source</h3><p>Link to a specific frame or component</p></div>
                <span className={styles.requiredTag}>REQUIRED</span>
              </div>

              <form onSubmit={validateLink} noValidate>
                <label className={styles.fieldLabel} htmlFor="figma-url">Figma frame URL</label>
                <div className={`${styles.inputWrap} ${linkState.status === "invalid" ? styles.inputWrapError : linkState.status === "valid" ? styles.inputWrapValid : ""}`}>
                  <Link2 size={17} />
                  <input
                    id="figma-url"
                    name="figma-url"
                    type="url"
                    placeholder="https://www.figma.com/design/..."
                    value={figmaUrl}
                    onChange={(event) => {
                      setFigmaUrl(event.target.value);
                      setLinkState({ status: "idle" });
                      setDesignContext(null);
                      setDesignError("");
                      setDesignState("idle");
                      setContentModel(null);
                      setAnalysisState("idle");
                      setAnalysisError("");
                    }}
                    autoComplete="url"
                    spellCheck={false}
                  />
                  {linkState.status === "valid" && <CheckCircle2 className={styles.inputSuccess} size={18} />}
                  {linkState.status === "invalid" && <XCircle className={styles.inputError} size={18} />}
                </div>
                {linkState.status === "invalid" && <p className={styles.fieldError}>{linkState.message}</p>}
                {linkState.status === "valid" && (
                  <div className={styles.validatedPanel}>
                    <div className={styles.validatedHeader}><CheckCircle2 size={16} /><strong>Link structure is valid</strong></div>
                    <div className={styles.parsedGrid}>
                      <div><span>FILE KEY</span><code>{linkState.value.fileKey}</code></div>
                      <div><span>NODE ID</span><code>{linkState.value.nodeId}</code></div>
                    </div>
                    <p>The link is parsed locally. Read the design to fetch its actual Figma context; field analysis comes next.</p>
                  </div>
                )}
                <div className={styles.formActions}>
                  <button className={styles.secondaryButton} type="submit">Validate link <ArrowRight size={16} /></button>
                  {linkState.status === "valid" && (
                    <button className={styles.primaryButton} type="button" onClick={readDesignContext} disabled={designState === "loading"}>
                      {designState === "loading" ? <LoaderCircle size={15} className={styles.spin} /> : <FileCode2 size={15} />}
                      {designState === "loading" ? "Reading design…" : designState === "loaded" ? "Read again" : "Read design"}
                    </button>
                  )}
                  <span className={styles.helperText}>Use “Copy link to selection” in Figma.</span>
                </div>
              </form>

              <div className={styles.cardFooterHint}><CircleHelp size={15} /><span>The link must include a <code>node-id</code> so the analyzer knows which design to read.</span></div>
            </section>

            <section className={`${styles.card} ${styles.connectionsCard}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleIcon}><Plug size={18} /></div>
                <div className={styles.cardTitleGroup}><h3>Connections</h3><p>Required services for this workflow</p></div>
                <span className={`${styles.connectionBadge} ${connectionState === "loaded" ? styles.connectionBadgeChecked : ""}`}>
                  {connectionState === "loading" ? <LoaderCircle size={12} className={styles.spin} /> : <span className={styles.connectionBadgeDot} />}
                  {connectionState === "loading" ? "CHECKING" : connectionState === "loaded" ? "CHECKED" : connectionState === "error" ? "ERROR" : "NOT CHECKED"}
                </span>
              </div>

              <div className={styles.integrationList}>
                <div className={styles.integrationRow}>
                  <div className={`${styles.integrationIcon} ${styles.integrationIconFigma}`}><Figma size={18} /></div>
                  <div className={styles.integrationDetails}><strong>Figma Desktop MCP</strong><p>{figmaStatus?.message ?? "Connect to the local Figma MCP endpoint."}</p></div>
                  <div className={styles.integrationState}><StateIndicator state={figmaStatus?.state ?? "needs-setup"} /><span>{figmaStatus?.state === "connected" ? "Connected" : figmaStatus?.state === "unavailable" ? "Unavailable" : "Pending"}</span></div>
                </div>
                <div className={styles.integrationRow}>
                  <div className={`${styles.integrationIcon} ${styles.integrationIconGemini}`}><BrainCircuit size={18} /></div>
                  <div className={styles.integrationDetails}><strong>Google Gemini API</strong><p>{geminiStatus?.message ?? "Configure GEMINI_API_KEY to analyze design content."}</p></div>
                  <div className={styles.integrationState}><StateIndicator state={geminiStatus?.state ?? "needs-setup"} /><span>{geminiStatus?.state === "configured" ? "Configured" : "Pending"}</span></div>
                </div>
                <div className={styles.integrationRow}>
                  <div className={`${styles.integrationIcon} ${styles.integrationIconSitecore}`}><Component size={18} /></div>
                  <div className={styles.integrationDetails}><strong>SitecoreAI Authoring API</strong><p>{sitecoreStatus?.message ?? "Uses your SitecoreAI environment and OAuth client credentials."}</p></div>
                  <div className={styles.integrationState}><StateIndicator state={sitecoreStatus?.state ?? "needs-setup"} /><span>{sitecoreStatus?.state === "configured" ? "Configured" : "Pending"}</span></div>
                </div>
              </div>

              {connectionError && <div className={styles.connectionError}><XCircle size={15} />{connectionError}</div>}

              <div className={styles.connectionActions}>
                <button className={styles.primaryButton} type="button" onClick={checkConnections} disabled={connectionState === "loading"}>
                  {connectionState === "loading" ? <LoaderCircle size={16} className={styles.spin} /> : <RefreshCw size={15} />}
                  {connectionState === "loading" ? "Checking services…" : connectionState === "loaded" ? "Check again" : "Check connections"}
                </button>
                <button className={styles.secondaryButton} type="button" onClick={testGeminiConnection} disabled={geminiTestState === "loading"}>
                  {geminiTestState === "loading" ? <LoaderCircle size={15} className={styles.spin} /> : <BrainCircuit size={15} />}
                  {geminiTestState === "loading" ? "Testing Gemini…" : "Test Gemini API"}
                </button>
                {checkedAt && <span className={styles.checkedTime}><Clock3 size={13} />{new Date(checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              {geminiTest && (
                <div className={`${styles.geminiTestResult} ${geminiTest.ok ? styles.geminiTestSuccess : styles.geminiTestFailure}`} role={geminiTest.ok ? "status" : "alert"}>
                  {geminiTest.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <div>
                    <strong>{geminiTest.ok ? "Gemini API connection successful" : "Gemini API connection failed"}</strong>
                    <p>{geminiTest.message}</p>
                    <span>
                      Model: {geminiTest.model}
                      {typeof geminiTest.statusCode === "number" ? ` · HTTP ${geminiTest.statusCode}` : ""}
                      {geminiTest.code ? ` · ${geminiTest.code}` : ""}
                      {` · ${geminiTest.latencyMs} ms`}
                    </span>
                  </div>
                </div>
              )}
              <p className={styles.connectionDisclaimer}>“Check connections” checks configuration. “Test Gemini API” sends a tiny prompt directly to Google to verify network access, key, and model; it does not send Figma design context.</p>
            </section>
          </div>

          {designState === "error" && (
            <section className={`${styles.designContextPanel} ${styles.designContextPanelError}`} role="alert">
              <div className={styles.designContextHeading}><XCircle size={18} /><div><h3>Could not read this design</h3><p>{designError}</p></div></div>
              <p className={styles.designContextHelp}>Confirm the Figma Desktop MCP connection, open the relevant design in Figma, and try again.</p>
            </section>
          )}

          {designContext && designState === "loaded" && (
            <section className={styles.designContextPanel} aria-live="polite">
              <div className={styles.designContextTop}>
                <div className={styles.designContextHeading}><CheckCircle2 size={18} /><div><h3>Design context retrieved</h3><p>{analysisState === "loaded" ? "Gemini has proposed a reviewable content model below. Nothing has been written to Sitecore." : "Figma returned content for the selected frame. Read the context, then ask Gemini to infer the editable content fields."}</p></div></div>
                <span className={styles.designContextBadge}>READ COMPLETE</span>
              </div>
              <div className={styles.designContextMeta}>
                <div><span>MCP TOOL</span><code>{designContext.toolName}</code></div>
                <div><span>NODE ID</span><code>{designContext.nodeId}</code></div>
                <div><span>CONTEXT SIZE</span><code>{designContext.characterCount.toLocaleString()} characters</code></div>
                {designContext.imageCount > 0 && <div><span>IMAGE BLOCKS</span><code>{designContext.imageCount}</code></div>}
              </div>
              <pre className={styles.contextPreview}>{showFullContext ? designContext.text : `${designContext.text.slice(0, 5000)}${designContext.text.length > 5000 ? "\n\n… Preview truncated. Show full context to inspect the complete response." : ""}`}</pre>
              {designContext.text.length > 5000 && (
                <button className={styles.textButton} type="button" onClick={() => setShowFullContext((current) => !current)}>
                  {showFullContext ? "Show preview" : "Show full context"}
                </button>
              )}
              <div className={styles.analysisActions}>
                <div className={styles.analysisActionCopy}>
                  <strong>Ready to infer Sitecore fields?</strong>
                  <span>Gemini will propose a structured model. No Sitecore items will be created.</span>
                </div>
                <button className={styles.primaryButton} type="button" onClick={analyzeDesign} disabled={analysisState === "loading"}>
                  {analysisState === "loading" ? <LoaderCircle size={15} className={styles.spin} /> : <BrainCircuit size={15} />}
                  {analysisState === "loading" ? "Analyzing fields…" : analysisState === "loaded" ? "Analyze again" : "Analyze fields"}
                </button>
              </div>
            </section>
          )}

          {analysisState === "error" && (
            <section className={`${styles.modelPanel} ${styles.modelPanelError}`} role="alert">
              <div className={styles.modelPanelHeading}><XCircle size={18} /><div><h3>Could not analyze the design</h3><p>{analysisError}</p></div></div>
            </section>
          )}

          {contentModel && analysisState === "loaded" && (
            <section className={styles.modelPanel} aria-live="polite">
              <div className={styles.modelPanelTop}>
                <div className={styles.modelPanelHeading}><BrainCircuit size={19} /><div><h3>Proposed Sitecore content model</h3><p>Generated with {analysisModel}. Review the inferred fields and adjust names or types before the Sitecore authoring stage.</p></div></div>
                <span className={styles.modelPanelBadge}>DRAFT · REVIEW</span>
              </div>
              <p className={styles.modelSummary}>{contentModel.summary}</p>
              <div className={styles.modelNamesGrid}>
                <label className={styles.modelInputLabel}>Component name
                  <input className={styles.modelTextInput} value={contentModel.componentName} onChange={(event) => updateModelName("componentName", event.target.value)} pattern="[A-Za-z][A-Za-z0-9_]{0,49}" />
                </label>
                <label className={styles.modelInputLabel}>Data template name
                  <input className={styles.modelTextInput} value={contentModel.templateName} onChange={(event) => updateModelName("templateName", event.target.value)} pattern="[A-Za-z][A-Za-z0-9_]{0,49}" />
                </label>
              </div>

              <div className={styles.modelSectionHeading}><h4>Editable content fields</h4><span>{contentModel.fields.length} fields</span></div>
              {contentModel.fields.length === 0 ? (
                <p className={styles.modelEmptyState}>No editable content fields were confidently identified. Review the design evidence and warnings before proceeding.</p>
              ) : (
                <div className={styles.modelFieldsGrid}>
                  {contentModel.fields.map((field, index) => renderFieldCard(field, `field-${field.name}-${index}`, (updates) => updateField(index, updates)))}
                </div>
              )}

              {contentModel.repeatedStructures.length > 0 && (
                <div className={styles.repeatedModelSection}>
                  <div className={styles.modelSectionHeading}><h4>Repeated content structures</h4><span>{contentModel.repeatedStructures.length} groups</span></div>
                  {contentModel.repeatedStructures.map((structure, groupIndex) => (
                    <div className={styles.repeatedStructure} key={`${structure.name}-${groupIndex}`}>
                      <div className={styles.repeatedStructureHeader}><div><strong>{structure.name}</strong><span>Item template: {structure.itemTemplateName}</span></div>{structure.requiresReview && <span className={styles.reviewPill}><AlertTriangle size={12} /> Review recommended</span>}</div>
                      <p>{structure.description}</p>
                      <p className={styles.modelFieldRationale}>Evidence: {structure.sourceEvidence}</p>
                      {structure.fields.length > 0 && <div className={styles.modelFieldsGrid}>{structure.fields.map((field, index) => renderFieldCard(field, `repeat-${groupIndex}-${field.name}-${index}`, (updates) => updateRepeatedField(groupIndex, index, updates)))}</div>}
                    </div>
                  ))}
                </div>
              )}

              {contentModel.warnings.length > 0 && (
                <div className={styles.modelWarnings}>
                  <div><AlertTriangle size={15} /><strong>Items to review</strong></div>
                  <ul>{contentModel.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
                </div>
              )}
              <p className={styles.modelSafetyNote}><ShieldCheck size={15} /> This is a proposal only. Nothing has been written to SitecoreAI, and this version does not generate frontend code.</p>
            </section>
          )}

          <section className={styles.outputSection}>
            <div className={styles.outputIntro}><div className={styles.outputIcon}><FileCode2 size={19} /></div><div><h3>What this workflow will create</h3><p>Only the Sitecore definitions required by the selected design.</p></div></div>
            <div className={styles.outputItems}>
              <div className={styles.outputItem}><div className={styles.outputItemIcon}><Layers3 size={17} /></div><div><strong>Data source template</strong><span>Fields inferred from editorial content</span></div><ChevronDown size={15} /></div>
              <div className={styles.outputItem}><div className={styles.outputItemIcon}><Component size={17} /></div><div><strong>JSON rendering</strong><span>Connected to the data source template</span></div><ChevronDown size={15} /></div>
              <div className={styles.outputItem}><div className={styles.outputItemIcon}><SlidersIcon /></div><div><strong>Rendering parameters</strong><span>Only when the design requires them</span></div><span className={styles.optionalLabel}>OPTIONAL</span></div>
            </div>
          </section>

          <div className={styles.bottomNotice}><ShieldCheck size={16} /><span><strong>Safe by design.</strong> The model will be reviewed before any Sitecore items are created. No publishing or frontend code generation is included in this POC.</span></div>
          <footer className={styles.pageFooter}><span>FRAMEFORGE <span className={styles.footerDot}>·</span> INTERNAL POC</span><span>Focused scope. Explicit review. Verified output.</span></footer>
        </div>
      </section>
    </main>
  );
}

function SlidersIcon() {
  return <ArrowDownRight size={17} />;
}
