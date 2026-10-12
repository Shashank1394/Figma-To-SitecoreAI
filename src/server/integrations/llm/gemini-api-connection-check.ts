/** Result of a minimal server-side request that verifies Gemini API access. */
export type GeminiApiConnectionResult = {
  ok: boolean;
  model: string;
  checkedAt: string;
  latencyMs: number;
  statusCode?: number;
  code?: string;
  message: string;
};

type CheckOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { code?: number; message?: string; status?: string };
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Tests the configured key/model with a tiny GenerateContent request.
 * This intentionally bypasses the analyzer prompt and its output schema so
 * connectivity/auth/model availability can be diagnosed independently.
 */
export async function checkGeminiApiConnection({
  apiKey,
  model,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CheckOptions): Promise<GeminiApiConnectionResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with exactly: OK" }] }],
          // Gemini 3.x may use output tokens for internal thinking before emitting text.
          // A budget of 8 can return HTTP 200 with no visible candidate text.
          // 128 matches the successful minimal PowerShell test.
          generationConfig: { maxOutputTokens: 128 },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const latencyMs = Date.now() - startedAt;
    const payload = await readResponse(response);

    if (response.ok) {
      const generatedText = payload.candidates?.[0]?.content?.parts
        ?.some((part) => typeof part.text === "string" && part.text.length > 0);

      if (!generatedText) {
        return {
          ok: false,
          model,
          checkedAt: new Date().toISOString(),
          latencyMs,
          statusCode: response.status,
          code: "EMPTY_GENERATION",
          message: "Gemini API responded, but the test request returned no generated text. Check whether the configured model is available for text generation.",
        };
      }

      return {
        ok: true,
        model,
        checkedAt: new Date().toISOString(),
        latencyMs,
        statusCode: response.status,
        message: "Gemini API connection succeeded. The configured key and model completed a minimal generation request.",
      };
    }

    return buildHttpFailure({
      model,
      statusCode: response.status,
      latencyMs,
      providerMessage: payload.error?.message,
      providerStatus: payload.error?.status,
      providerCode: payload.error?.code,
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const details = getErrorDetails(error);
    const isTimeout = controller.signal.aborted || details.code === "UND_ERR_HEADERS_TIMEOUT" || details.name === "TimeoutError";
    const code = details.code ?? (isTimeout ? "TIMEOUT" : "NETWORK_ERROR");
    const message = isTimeout
      ? `Gemini connection test timed out after ${latencyMs} ms. Check network/proxy/VPN/TLS inspection, or retry if the Google service is under load.`
      : `Node.js could not complete the Gemini connection test (${code}). Check internet access, DNS, proxy/VPN, firewall rules, and TLS inspection.`;

    return {
      ok: false,
      model,
      checkedAt: new Date().toISOString(),
      latencyMs,
      code,
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponse(response: Response): Promise<GeminiResponse> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") return body as GeminiResponse;
  } catch {
    // An unparseable body is represented as an empty response below.
  }
  return {};
}

function buildHttpFailure({
  model,
  statusCode,
  latencyMs,
  providerMessage,
  providerStatus,
  providerCode,
}: {
  model: string;
  statusCode: number;
  latencyMs: number;
  providerMessage?: string;
  providerStatus?: string;
  providerCode?: number;
}): GeminiApiConnectionResult {
  const detail = redact(providerMessage ?? providerStatus ?? "No additional details were returned.").slice(0, 220);
  const shared = {
    ok: false,
    model,
    checkedAt: new Date().toISOString(),
    latencyMs,
    statusCode,
    ...(providerStatus ? { code: providerStatus } : providerCode ? { code: String(providerCode) } : {}),
  };

  if (/API_KEY_INVALID|api key not valid|invalid api key/i.test(detail) || statusCode === 401 || statusCode === 403) {
    return { ...shared, message: `Gemini rejected the API key or its permissions (HTTP ${statusCode}). Verify GEMINI_API_KEY and the Google AI Studio project/key restrictions. ${detail}` };
  }
  if (statusCode === 404) {
    return { ...shared, message: `Gemini could not find model "${model}" (HTTP 404). Check GEMINI_MODEL and confirm that the model is available to this API project. ${detail}` };
  }
  if (statusCode === 429) {
    return { ...shared, message: `Gemini was reached, but rate limits or quota prevented the test (HTTP 429). Check the project's quota/billing or wait before retrying. ${detail}` };
  }
  if (statusCode >= 500) {
    return { ...shared, message: `Gemini was reached, but the service returned HTTP ${statusCode}. Retry shortly; this is a provider/service response, not a local DNS failure. ${detail}` };
  }
  if (statusCode === 400) {
    return { ...shared, message: `Gemini was reached but rejected the minimal test request (HTTP 400). Check GEMINI_MODEL and the API project's access/configuration. ${detail}` };
  }
  return { ...shared, message: `Gemini connection test failed with HTTP ${statusCode}. ${detail}` };
}

function getErrorDetails(error: unknown): { name: string; message: string; code?: string } {
  let current: unknown = error;
  const seen = new Set<unknown>();
  let root: { name: string; message: string; code?: string } = {
    name: "Error",
    message: error instanceof Error ? error.message : String(error),
  };

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    if (candidate.name || candidate.message || candidate.code) {
      root = {
        name: typeof candidate.name === "string" ? candidate.name : root.name,
        message: typeof candidate.message === "string" ? candidate.message : root.message,
        ...(typeof candidate.code === "string" || typeof candidate.code === "number"
          ? { code: String(candidate.code) }
          : {}),
      };
    }
    current = candidate.cause;
  }
  return { ...root, message: redact(root.message) };
}

function redact(value: string): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}
