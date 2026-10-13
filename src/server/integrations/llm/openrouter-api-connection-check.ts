const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 20_000;

export type OpenRouterConnectionResult = {
  ok: boolean;
  model: string;
  routedModel?: string;
  checkedAt: string;
  latencyMs: number;
  statusCode?: number;
  code: string;
  message: string;
};

export async function checkOpenRouterApiConnection(input: {
  apiKey: string;
  model: string;
}): Promise<OpenRouterConnectionResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const baseResult = { model: input.model, checkedAt };

  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "FrameForge",
        "HTTP-Referer": "http://localhost:3000",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    let body: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = undefined;
    }

    const errorValue = body?.error;
    const providerMessage = errorValue && typeof errorValue === "object"
      ? (errorValue as Record<string, unknown>).message
      : undefined;
    if (!response.ok || errorValue) {
      const message = typeof providerMessage === "string"
        ? providerMessage.slice(0, 300)
        : `OpenRouter returned HTTP ${response.status}.`;
      const code = response.status === 401 || response.status === 403
        ? "AUTHENTICATION_FAILED"
        : response.status === 429
          ? "RATE_LIMITED"
          : response.status >= 500
            ? "PROVIDER_UNAVAILABLE"
            : "REQUEST_REJECTED";
      return {
        ...baseResult,
        ok: false,
        latencyMs: Date.now() - startedAt,
        statusCode: response.status,
        code,
        message: response.status === 429
          ? `OpenRouter rate limit reached. Free-tier availability can vary. ${message}`
          : `OpenRouter request failed. ${message}`,
      };
    }

    const routedModel = typeof body?.model === "string" ? body.model : undefined;
    return {
      ...baseResult,
      ok: true,
      routedModel,
      latencyMs: Date.now() - startedAt,
      statusCode: response.status,
      code: "CONNECTED",
      message: "OpenRouter accepted a minimal chat-completion request. The API key and selected model route are responding.",
    };
  } catch (error) {
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const detail = cause instanceof Error ? cause.message : error instanceof Error ? error.message : "Unknown request error";
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ...baseResult,
      ok: false,
      latencyMs: Date.now() - startedAt,
      code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      message: timedOut
        ? `OpenRouter connection test timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`
        : `Could not reach OpenRouter: ${detail.slice(0, 180)}`,
    };
  }
}
