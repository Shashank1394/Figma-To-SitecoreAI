"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Component,
  FileCode2,
  Figma,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plug,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Workflow,
  XCircle,
} from "lucide-react";
import styles from "./studio-page.module.scss";
import { parseFigmaDesignUrl, type ParsedFigmaUrl } from "@/lib/figma-url";
import { sitecoreFieldTypes, type ContentField, type ContentModel } from "@/lib/content-model";

type Stage = 1 | 2 | 3;

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

const stages: { number: Stage; title: string; shortTitle: string; description: string }[] = [
  { number: 1, title: "Source design", shortTitle: "Source", description: "Choose a frame in Figma" },
  { number: 2, title: "Analyze fields", shortTitle: "Content model", description: "Let AI propose the fields" },
  { number: 3, title: "Sitecore output", shortTitle: "Sitecore", description: "Review the definitions" },
];

function StateIndicator({ state }: { state: Integration["state"] }) {
  const className = state === "connected" || state === "configured"
    ? styles.statusDotGood
    : state === "unavailable"
      ? styles.statusDotBad
      : styles.statusDotIdle;
  return <span className={`${styles.statusDot} ${className}`} aria-hidden="true" />;
}

function StatusPill({ kind, children }: { kind: "success" | "warning" | "neutral" | "error"; children: ReactNode }) {
  const className = kind === "success" ? styles.pillSuccess : kind === "warning" ? styles.pillWarning : kind === "error" ? styles.pillError : styles.pillNeutral;
  return <span className={`${styles.statusPill} ${className}`}>{children}</span>;
}

function StageHeading({ eyebrow, title, description, right }: { eyebrow: string; title: ReactNode; description: string; right?: ReactNode }) {
  return (
    <div className={styles.stageHeading}>
      <div className={styles.stageHeadingCopy}>
        <div className={styles.eyebrow}><Sparkles size={16} />{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {right ? <div className={styles.stageHeadingAside}>{right}</div> : null}
    </div>
  );
}

export function StudioPage() {
  const [activeStage, setActiveStage] = useState<Stage>(1);
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
      if (!response.ok || !body.designContext) throw new Error(body.error ?? "Could not read the selected Figma design.");
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
      if (!response.ok || !body.contentModel) throw new Error(body.error ?? "Could not analyze the selected design.");
      setContentModel(body.contentModel);
      setAnalysisModel(body.model ?? "Google Gemini");
      setAnalysisState("loaded");
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Could not analyze the selected design.");
      setAnalysisState("error");
    }
  }

  function updateField(fieldIndex: number, updates: Partial<ContentField>) {
    setContentModel((current) => current ? {
      ...current,
      fields: current.fields.map((field, index) => index === fieldIndex ? { ...field, ...updates } : field),
    } : current);
  }

  function updateRepeatedField(structureIndex: number, fieldIndex: number, updates: Partial<ContentField>) {
    setContentModel((current) => current ? {
      ...current,
      repeatedStructures: current.repeatedStructures.map((structure, groupIndex) => groupIndex !== structureIndex
        ? structure
        : { ...structure, fields: structure.fields.map((field, index) => index === fieldIndex ? { ...field, ...updates } : field) }),
    } : current);
  }

  function updateModelName(key: "componentName" | "templateName", value: string) {
    setContentModel((current) => current ? { ...current, [key]: value } : current);
  }

  async function checkConnections() {
    setConnectionState("loading");
    setConnectionError("");
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      const body = (await response.json()) as ConnectionResponse | { error: string };
      if (!response.ok || !("integrations" in body)) throw new Error("error" in body ? body.error : "Connection check failed.");
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
      const response = await fetch("/api/gemini-connection", { method: "POST", cache: "no-store" });
      const body = (await response.json()) as GeminiConnectionTest;
      setGeminiTest(body);
      setGeminiTestState(body.ok ? "success" : "error");
    } catch (error) {
      setGeminiTest({
        ok: false, model: "Configured model", checkedAt: new Date().toISOString(), latencyMs: 0,
        code: "LOCAL_REQUEST_FAILED", message: error instanceof Error ? error.message : "The Gemini connection test could not be completed.",
      });
      setGeminiTestState("error");
    }
  }

  function renderFieldCard(field: ContentField, fieldKey: string, onUpdate: (updates: Partial<ContentField>) => void) {
    const confidenceClass = field.confidence === "high" ? styles.confidenceHigh : field.confidence === "medium" ? styles.confidenceMedium : styles.confidenceLow;
    return (
      <article className={styles.fieldCard} key={fieldKey}>
        <div className={styles.fieldCardHeader}>
          <div className={styles.fieldSequence}>{fieldKey.startsWith("repeat") ? "↳" : "▦"}</div>
          <div className={styles.fieldCardHeading}><h3>{field.title || field.name || "Untitled field"}</h3><p>{field.description}</p></div>
          <span className={`${styles.confidencePill} ${confidenceClass}`}>{field.confidence} confidence</span>
        </div>
        <div className={styles.fieldEditorGrid}>
          <label className={styles.formField}>Sitecore field name
            <input value={field.name} onChange={(event) => onUpdate({ name: event.target.value })} pattern="[A-Za-z][A-Za-z0-9_]{0,49}" aria-label={`${field.title} Sitecore field name`} />
          </label>
          <label className={styles.formField}>Editor-facing title
            <input value={field.title} onChange={(event) => onUpdate({ title: event.target.value })} aria-label={`${field.name} editor-facing title`} />
          </label>
          <label className={`${styles.formField} ${styles.fullField}`}>Sitecore field type
            <select value={field.type} onChange={(event) => onUpdate({ type: event.target.value as ContentField["type"] })} aria-label={`${field.title} Sitecore field type`}>
              {sitecoreFieldTypes.map((fieldType) => <option key={fieldType} value={fieldType}>{fieldType}</option>)}
            </select>
          </label>
        </div>
        <p className={styles.fieldRationale}>{field.rationale}</p>
        <div className={styles.fieldEvidence}><span>DESIGN EVIDENCE</span><code>{field.sourceEvidence}</code></div>
        {field.requiresReview && <div className={styles.fieldReview}><AlertTriangle size={15} /><span>Review recommended before creating Sitecore items.</span></div>}
      </article>
    );
  }

  const figmaStatus = integrations.find((integration) => integration.id === "figma");
  const sitecoreStatus = integrations.find((integration) => integration.id === "sitecore");
  const geminiStatus = integrations.find((integration) => integration.id === "gemini");
  const completedStages = [designState === "loaded", analysisState === "loaded", false];
  const checkedTimeLabel = checkedAt ? new Date(checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <main className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><Component size={24} strokeWidth={2.2} /></div>
          <div><div className={styles.brandName}>FrameForge</div><div className={styles.brandCaption}>FIGMA TO SITECOREAI</div></div>
        </div>

        <div className={styles.workspaceLabel}>WORKSPACE</div>
        <div className={styles.workspaceName}><Layers3 size={18} /><span>Component builder</span></div>
        <div className={styles.sidebarDivider} />
        <div className={styles.workspaceLabel}>YOUR WORKFLOW</div>
        <nav className={styles.stageNav} aria-label="Workflow stages">
          {stages.map((stage) => {
            const active = activeStage === stage.number;
            const complete = completedStages[stage.number - 1];
            const allowed = stage.number === 1 || (stage.number === 2 && Boolean(designContext)) || (stage.number === 3 && Boolean(contentModel));
            return (
              <button key={stage.number} type="button" className={`${styles.navStage} ${active ? styles.navStageActive : ""}`} onClick={() => setActiveStage(stage.number)} aria-current={active ? "step" : undefined}>
                <span className={`${styles.navStageNumber} ${complete ? styles.navStageDone : ""}`}>{complete ? <Check size={16} /> : `0${stage.number}`}</span>
                <span className={styles.navStageCopy}><strong>{stage.title}</strong><small>{stage.description}</small></span>
                {active && <ChevronRight size={17} className={styles.navChevron} />}
                {!active && !allowed && <span className={styles.navStagePending} />}
              </button>
            );
          })}
        </nav>

        <div className={styles.sidebarGuide}>
          <div className={styles.guideIcon}><Workflow size={20} /></div>
          <strong>One focused workflow</strong>
          <p>Read a design. Infer content fields. Prepare the Sitecore definitions.</p>
        </div>
        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarFooterIcon}><LockKeyhole size={17} /></div>
          <div><strong>Local-first workspace</strong><p>Credentials stay on your machine.</p></div>
        </div>
      </aside>

      <section className={styles.mainArea}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}><span>Workspace</span><ChevronRight size={14} /><strong>{stages[activeStage - 1].title}</strong></div>
          <div className={styles.topbarRight}>
            <span className={styles.localBadge}><span />Local workspace</span>
            <button type="button" className={styles.helpButton} title="View Sitecore output preview" aria-label="View Sitecore output preview" onClick={() => setActiveStage(3)}><CircleHelp size={19} /></button>
          </div>
        </header>

        <div className={styles.pageContent}>
          <div className={styles.progressHeader}>
            <div className={styles.progressCaption}><span>COMPONENT WORKFLOW</span><span>STEP 0{activeStage} OF 03</span></div>
            <div className={styles.progressTrack} aria-label={`Step ${activeStage} of 3`}><span style={{ width: `${(activeStage / 3) * 100}%` }} /></div>
          </div>

          {activeStage === 1 && (
            <>
              <StageHeading
                eyebrow="01 / SOURCE DESIGN"
                title={<>Start with the <span className={styles.titleAccent}>design.</span></>}
                description="Choose a Figma frame or component. FrameForge reads the selected design and prepares it for AI analysis."
                right={<div className={styles.heroIconPair}><div className={styles.heroIconFigma}><Figma size={31} /></div><ArrowRight size={21} /><div className={styles.heroIconSitecore}><Component size={29} /></div></div>}
              />
              <div className={styles.sectionIntro}><div><h2>Connect your source</h2><p>Choose one frame with a specific node ID to keep the analysis focused.</p></div><StatusPill kind="neutral">PHASE 1 · INPUT</StatusPill></div>

              <div className={styles.sourceGrid}>
                <section className={`${styles.panel} ${styles.sourcePanel}`}>
                  <div className={styles.panelHeading}>
                    <div className={`${styles.panelIcon} ${styles.figmaIcon}`}><Figma size={21} /></div>
                    <div><h2>Figma design URL</h2><p>Paste the link to your selected frame</p></div>
                    <StatusPill kind="neutral">Required</StatusPill>
                  </div>
                  <form onSubmit={validateLink} noValidate>
                    <label className={styles.formField} htmlFor="figma-url">Selected frame or component
                      <div className={`${styles.urlInputWrap} ${linkState.status === "invalid" ? styles.urlInputError : linkState.status === "valid" ? styles.urlInputValid : ""}`}>
                        <Link2 size={20} />
                        <input id="figma-url" type="url" placeholder="https://www.figma.com/design/..." value={figmaUrl} onChange={(event) => {
                          setFigmaUrl(event.target.value); setLinkState({ status: "idle" }); setDesignContext(null); setDesignError(""); setDesignState("idle"); setContentModel(null); setAnalysisState("idle"); setAnalysisError("");
                        }} autoComplete="url" spellCheck={false} />
                        {linkState.status === "valid" && <CheckCircle2 size={19} className={styles.inputSuccess} />}
                        {linkState.status === "invalid" && <XCircle size={19} className={styles.inputErrorIcon} />}
                      </div>
                    </label>
                    {linkState.status === "invalid" && <p className={styles.formError}>{linkState.message}</p>}
                    {linkState.status === "valid" && (
                      <div className={styles.parsedDetails}>
                        <div className={styles.parsedTitle}><CheckCircle2 size={18} /><strong>Figma link structure is valid</strong></div>
                        <div className={styles.parsedValues}><div><small>FILE KEY</small><code>{linkState.value.fileKey}</code></div><div><small>NODE ID</small><code>{linkState.value.nodeId}</code></div></div>
                        <p>This validates the link only. The design context is retrieved when you choose Read design.</p>
                      </div>
                    )}
                    <div className={styles.formButtonRow}>
                      <button type="submit" className={styles.buttonSecondary}>Validate link <ArrowRight size={17} /></button>
                      <button type="button" className={styles.buttonPrimary} onClick={readDesignContext} disabled={designState === "loading"}>
                        {designState === "loading" ? <LoaderCircle className={styles.spin} size={18} /> : <FileCode2 size={18} />}
                        {designState === "loading" ? "Reading design…" : designState === "loaded" ? "Read design again" : "Read design"}
                      </button>
                    </div>
                  </form>
                  <p className={styles.panelFootnote}><CircleHelp size={16} /> In Figma, use <strong>Copy link to selection</strong> so the URL includes a node ID.</p>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHeading}>
                    <div className={`${styles.panelIcon} ${styles.connectionIcon}`}><Plug size={21} /></div>
                    <div><h2>Service connections</h2><p>Required integrations for this workflow</p></div>
                    <StatusPill kind={connectionState === "loaded" ? "success" : connectionState === "error" ? "error" : "neutral"}>{connectionState === "loading" ? "Checking" : connectionState === "loaded" ? "Checked" : connectionState === "error" ? "Error" : "Not checked"}</StatusPill>
                  </div>
                  <div className={styles.integrationList}>
                    <IntegrationRow icon={<Figma size={20} />} tone="figma" title="Figma Desktop MCP" state={figmaStatus?.state} message={figmaStatus?.message ?? "Connect to the local Figma MCP endpoint."} />
                    <IntegrationRow icon={<BrainCircuit size={20} />} tone="gemini" title="Google Gemini API" state={geminiTest?.ok ? "connected" : geminiStatus?.state} message={geminiTest?.ok ? `Model ${geminiTest.model} responded in ${geminiTest.latencyMs} ms.` : geminiStatus?.message ?? "Configured model for field analysis."} />
                    <IntegrationRow icon={<Component size={20} />} tone="sitecore" title="SitecoreAI Authoring API" state={sitecoreStatus?.state} message={sitecoreStatus?.message ?? "Required for the upcoming authoring stage."} />
                  </div>
                  {connectionError && <div className={styles.inlineError}><XCircle size={17} />{connectionError}</div>}
                  <div className={styles.connectionButtons}>
                    <button type="button" className={styles.buttonSecondary} onClick={checkConnections} disabled={connectionState === "loading"}>{connectionState === "loading" ? <LoaderCircle className={styles.spin} size={17} /> : <RefreshCw size={17} />}{connectionState === "loading" ? "Checking…" : "Check connections"}</button>
                    <button type="button" className={styles.textButton} onClick={testGeminiConnection} disabled={geminiTestState === "loading"}>{geminiTestState === "loading" ? <LoaderCircle className={styles.spin} size={16} /> : <BrainCircuit size={16} />}{geminiTestState === "loading" ? "Testing Gemini…" : "Test Gemini API"}</button>
                  </div>
                  {checkedTimeLabel && <p className={styles.lastChecked}>Connections checked at {checkedTimeLabel}.</p>}
                  {geminiTest && (
                    <div className={`${styles.geminiTestResult} ${geminiTest.ok ? styles.geminiTestSuccess : styles.geminiTestFailure}`} role={geminiTest.ok ? "status" : "alert"}>
                      {geminiTest.ok ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                      <div><strong>{geminiTest.ok ? "Gemini API test passed" : "Gemini API test needs attention"}</strong><p>{geminiTest.message}</p><span>{geminiTest.model}{geminiTest.statusCode ? ` · HTTP ${geminiTest.statusCode}` : ""}{geminiTest.code ? ` · ${geminiTest.code}` : ""} · {geminiTest.latencyMs.toLocaleString()} ms</span></div>
                    </div>
                  )}
                </section>
              </div>

              {designState === "error" && <div className={styles.errorBanner}><XCircle size={21} /><div><strong>We couldn't read this design</strong><p>{designError}</p><span>Confirm the Figma Desktop MCP server is running and the selected design is open.</span></div></div>}
              {designContext && designState === "loaded" && (
                <section className={`${styles.panel} ${styles.designReadyPanel}`}>
                  <div className={styles.designReadyIcon}><CheckCircle2 size={25} /></div>
                  <div className={styles.designReadyCopy}><StatusPill kind="success">Design retrieved</StatusPill><h2>Your design context is ready</h2><p>Figma returned {designContext.characterCount.toLocaleString()} characters{designContext.imageCount ? ` and ${designContext.imageCount} image block(s)` : ""}. You can now ask Gemini to infer the editable content fields.</p><div className={styles.designFacts}><span><small>NODE ID</small><code>{designContext.nodeId}</code></span><span><small>MCP TOOL</small><code>{designContext.toolName}</code></span></div></div>
                  <button type="button" className={styles.buttonPrimary} onClick={() => setActiveStage(2)}>Continue to analysis <ArrowRight size={18} /></button>
                </section>
              )}
              <div className={styles.safetyStrip}><ShieldCheck size={20} /><p><strong>Your work stays in your control.</strong> This stage only reads design context. It does not create or change anything in SitecoreAI.</p></div>
            </>
          )}

          {activeStage === 2 && (
            <>
              <StageHeading
                eyebrow="02 / CONTENT MODEL"
                title={<>Turn design into <span className={styles.titleAccent}>content.</span></>}
                description="Gemini identifies what an editor should be able to manage, then proposes a Sitecore-ready data model for your review."
                right={<StatusPill kind={analysisState === "loaded" ? "success" : "neutral"}>{analysisState === "loaded" ? "Analysis complete" : "Review before authoring"}</StatusPill>}
              />
              {!designContext ? (
                <section className={`${styles.panel} ${styles.emptyStage}`}>
                  <div className={styles.emptyStageIcon}><Figma size={30} /></div><h2>Read a design to begin</h2><p>The analyzer needs the selected Figma frame's design context. Go back to the source stage, validate a frame URL, and read the design first.</p><button type="button" className={styles.buttonPrimary} onClick={() => setActiveStage(1)}><ArrowLeft size={18} /> Back to source design</button>
                </section>
              ) : (
                <>
                  <section className={styles.designReferenceBar}>
                    <div className={styles.referenceIcon}><Figma size={21} /></div>
                    <div className={styles.referenceCopy}><strong>Source design connected</strong><span>Node {designContext.nodeId} · {designContext.characterCount.toLocaleString()} characters of context</span></div>
                    <button type="button" className={styles.textButton} onClick={() => setActiveStage(1)}><ArrowLeft size={16} /> Change source</button>
                  </section>

                  {analysisState !== "loaded" && (
                    <section className={styles.analyzeCallout}>
                      <div className={styles.analyzeIllustration}><BrainCircuit size={36} /><Sparkles size={18} /></div>
                      <div className={styles.analyzeCalloutCopy}><h2>{analysisState === "loading" ? "Gemini is analyzing the design" : analysisState === "error" ? "Analysis needs another try" : "Infer the content fields"}</h2><p>{analysisState === "loading" ? "Reviewing text, button patterns, repeated structures, and content types. This can take a few moments." : analysisState === "error" ? analysisError : "We'll separate editorial content from visual styling and propose only fields that make sense for Sitecore authors."}</p>{analysisState === "loading" && <div className={styles.loadingTrack}><span /></div>}</div>
                      <button type="button" className={styles.buttonPrimary} onClick={analyzeDesign} disabled={analysisState === "loading"}>{analysisState === "loading" ? <LoaderCircle size={18} className={styles.spin} /> : analysisState === "error" ? <RefreshCw size={18} /> : <Sparkles size={18} />}{analysisState === "loading" ? "Analyzing…" : analysisState === "error" ? "Retry analysis" : "Analyze fields"}</button>
                    </section>
                  )}

                  {contentModel && analysisState === "loaded" && (
                    <>
                      <section className={styles.modelOverview}>
                        <div className={styles.modelOverviewTop}><div className={styles.modelIcon}><BrainCircuit size={23} /></div><div className={styles.modelOverviewCopy}><div className={styles.modelEyebrow}>AI-GENERATED PROPOSAL</div><h2>Proposed Sitecore content model</h2><p>Generated with {analysisModel}. Review the inferred fields and adjust names or types before proceeding.</p></div><StatusPill kind="warning">Draft · review</StatusPill></div>
                        <p className={styles.modelSummary}>{contentModel.summary}</p>
                        <div className={styles.modelNameGrid}>
                          <label className={styles.formField}>Component name<input value={contentModel.componentName} onChange={(event) => updateModelName("componentName", event.target.value)} pattern="[A-Za-z][A-Za-z0-9_]{0,49}" /></label>
                          <label className={styles.formField}>Data template name<input value={contentModel.templateName} onChange={(event) => updateModelName("templateName", event.target.value)} pattern="[A-Za-z][A-Za-z0-9_]{0,49}" /></label>
                        </div>
                      </section>

                      <div className={styles.fieldsSectionHeading}><div><h2>Editable content fields</h2><p>Adjust each field's Sitecore type, name and editor-facing title.</p></div><StatusPill kind="neutral">{contentModel.fields.length} fields</StatusPill></div>
                      {contentModel.fields.length === 0 ? <div className={styles.emptyFields}>No editable content fields were confidently identified. Check the warnings below before continuing.</div> : <div className={styles.fieldsGrid}>{contentModel.fields.map((field, index) => renderFieldCard(field, `field-${field.name}-${index}`, (updates) => updateField(index, updates)))}</div>}

                      {contentModel.repeatedStructures.length > 0 && (
                        <section className={styles.repeatedSection}><div className={styles.fieldsSectionHeading}><div><h2>Repeated content structures</h2><p>Reusable item models for repeated cards or list items.</p></div><StatusPill kind="neutral">{contentModel.repeatedStructures.length} groups</StatusPill></div>
                          {contentModel.repeatedStructures.map((structure, groupIndex) => <div className={styles.repeatedCard} key={`${structure.name}-${groupIndex}`}><div className={styles.repeatedHeader}><div><h3>{structure.name}</h3><p>Item template: {structure.itemTemplateName}</p></div>{structure.requiresReview && <StatusPill kind="warning"><AlertTriangle size={14} /> Review recommended</StatusPill>}</div><p className={styles.repeatedDescription}>{structure.description}</p><p className={styles.fieldRationale}>Evidence: {structure.sourceEvidence}</p>{structure.fields.length > 0 && <div className={styles.fieldsGrid}>{structure.fields.map((field, index) => renderFieldCard(field, `repeat-${groupIndex}-${field.name}-${index}`, (updates) => updateRepeatedField(groupIndex, index, updates)))}</div>}</div>)}
                        </section>
                      )}

                      {contentModel.warnings.length > 0 && <section className={styles.warningsPanel}><div className={styles.warningsHeading}><AlertTriangle size={20} /><div><h3>Items to review</h3><p>Resolve these points before treating the model as ready for authoring.</p></div></div><ul>{contentModel.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></section>}
                      <div className={styles.modelSafetyNote}><ShieldCheck size={20} /><p><strong>Nothing has been written to SitecoreAI.</strong> This is a draft model. You can edit the fields before moving to the output preview.</p></div>
                    </>
                  )}
                </>
              )}
              <div className={styles.pageActions}><button type="button" className={styles.buttonSecondary} onClick={() => setActiveStage(1)}><ArrowLeft size={18} /> Back to source</button><span className={styles.actionsSpacer} />{contentModel && analysisState === "loaded" && <button type="button" className={styles.buttonPrimary} onClick={() => setActiveStage(3)}>Review Sitecore output <ArrowRight size={18} /></button>}</div>
            </>
          )}

          {activeStage === 3 && (
            <>
              <StageHeading
                eyebrow="03 / SITECORE DEFINITIONS"
                title={<>Review the <span className={styles.titleAccent}>Sitecore output.</span></>}
                description="Preview the Sitecore items that will be created from your reviewed content model. Actual authoring mutations are the next implementation milestone."
                right={<StatusPill kind="warning">Preview only</StatusPill>}
              />
              {!contentModel || analysisState !== "loaded" ? (
                <section className={`${styles.panel} ${styles.emptyStage}`}><div className={styles.emptyStageIcon}><Layers3 size={30} /></div><h2>Your content model is not ready yet</h2><p>Analyze a Figma design and review the proposed fields before previewing the Sitecore definitions.</p><button type="button" className={styles.buttonPrimary} onClick={() => setActiveStage(designContext ? 2 : 1)}>{designContext ? <BrainCircuit size={18} /> : <ArrowLeft size={18} />}{designContext ? "Go to content model" : "Back to source design"} <ArrowRight size={17} /></button></section>
              ) : (
                <>
                  <section className={styles.outputReadyBanner}><div className={styles.outputReadyIcon}><CheckCircle2 size={25} /></div><div><StatusPill kind="success">Model prepared</StatusPill><h2>{contentModel.componentName} is ready for authoring review</h2><p>The current model contains {contentModel.fields.length} top-level fields and {contentModel.repeatedStructures.length} repeated structure(s). Review the definitions below. No Sitecore mutations have run.</p></div></section>
                  <div className={styles.outputCardsGrid}>
                    <article className={styles.outputCard}><div className={`${styles.outputCardIcon} ${styles.templateTone}`}><Layers3 size={23} /></div><div className={styles.outputCardTop}><StatusPill kind="success">Proposed</StatusPill><span>01</span></div><h2>Data source template</h2><p>Stores the editorial content inferred from the Figma design.</p><div className={styles.outputProperty}><span>Template name</span><strong>{contentModel.templateName}</strong></div><div className={styles.outputProperty}><span>Fields</span><strong>{contentModel.fields.length}</strong></div><div className={styles.outputProperty}><span>Repeated structures</span><strong>{contentModel.repeatedStructures.length}</strong></div></article>
                    <article className={styles.outputCard}><div className={`${styles.outputCardIcon} ${styles.renderingTone}`}><Component size={23} /></div><div className={styles.outputCardTop}><StatusPill kind="success">Proposed</StatusPill><span>02</span></div><h2>JSON rendering</h2><p>Connects the Sitecore rendering to the component's data source template.</p><div className={styles.outputProperty}><span>Component name</span><strong>{contentModel.componentName}</strong></div><div className={styles.outputProperty}><span>Data source</span><strong>{contentModel.templateName}</strong></div><div className={styles.outputProperty}><span>Frontend component</span><strong>Not generated in this POC</strong></div></article>
                    <article className={styles.outputCard}><div className={`${styles.outputCardIcon} ${styles.parametersTone}`}><SlidersHorizontal size={23} /></div><div className={styles.outputCardTop}><StatusPill kind="neutral">As required</StatusPill><span>03</span></div><h2>Rendering parameters</h2><p>Only needed if the component requires editor-controlled presentation options.</p><div className={styles.parametersNote}>Parameter fields are not inferred or created by this version of the POC.</div></article>
                  </div>
                  <section className={styles.outputFieldTable}><div className={styles.outputTableHeading}><div><h2>Template field preview</h2><p>This is a read-only summary of your current reviewed model.</p></div><StatusPill kind="neutral">{contentModel.fields.length} fields</StatusPill></div><div className={styles.fieldTableWrap}><table><thead><tr><th>Field name</th><th>Editor-facing title</th><th>Sitecore type</th><th>Confidence</th></tr></thead><tbody>{contentModel.fields.map((field, index) => <tr key={`${field.name}-${index}`}><td><code>{field.name}</code></td><td>{field.title}</td><td><span className={styles.typeBadge}>{field.type}</span></td><td><span className={`${styles.tableConfidence} ${field.confidence === "high" ? styles.tableConfidenceHigh : field.confidence === "medium" ? styles.tableConfidenceMedium : styles.tableConfidenceLow}`}>{field.confidence}</span></td></tr>)}</tbody></table></div></section>
                  <section className={styles.authoringStatusPanel}><div className={styles.authoringStatusIcon}><LockKeyhole size={23} /></div><div><h2>Sitecore authoring is not connected to this workflow yet</h2><p>This screen is a transparent output preview for the demo. The next development stage will authenticate with the SitecoreAI Authoring API, create the data template and JSON rendering, then read the created items back for verification.</p></div><StatusPill kind="warning">Not implemented</StatusPill></section>
                  {contentModel.warnings.length > 0 && <section className={styles.warningsPanel}><div className={styles.warningsHeading}><AlertTriangle size={20} /><div><h3>Review warnings remain</h3><p>These warnings will need attention before creating the Sitecore items.</p></div></div><ul>{contentModel.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></section>}
                </>
              )}
              <div className={styles.pageActions}><button type="button" className={styles.buttonSecondary} onClick={() => setActiveStage(contentModel ? 2 : 1)}><ArrowLeft size={18} /> {contentModel ? "Back to content model" : "Back to source"}</button><span className={styles.actionsSpacer} /><StatusPill kind="neutral"><LockKeyhole size={14} /> Creation is not enabled</StatusPill></div>
            </>
          )}

          <footer className={styles.pageFooter}><span><strong>FRAMEFORGE</strong><span>·</span> INTERNAL DEMO</span><span>AI-assisted content modeling · Human-reviewed output</span></footer>
        </div>
      </section>
    </main>
  );
}

function IntegrationRow({ icon, tone, title, state, message }: { icon: ReactNode; tone: "figma" | "gemini" | "sitecore"; title: string; state?: Integration["state"]; message: string }) {
  const stateText = state === "connected" ? "Connected" : state === "configured" ? "Configured" : state === "unavailable" ? "Unavailable" : "Not checked";
  return <div className={styles.integrationRow}><div className={`${styles.integrationIcon} ${tone === "figma" ? styles.integrationFigma : tone === "gemini" ? styles.integrationGemini : styles.integrationSitecore}`}>{icon}</div><div className={styles.integrationCopy}><strong>{title}</strong><p>{message}</p></div><div className={styles.integrationStatus}><StateIndicator state={state ?? "needs-setup"} /><span>{stateText}</span></div></div>;
}
