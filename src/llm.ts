const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface CallOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly jsonMode?: boolean;
  readonly timeoutMs?: number;
}

export async function callChat(options: CallOptions): Promise<string> {
  const body = buildRequestBody(options);
  const response = await postWithTimeout(OPENROUTER_URL, options.apiKey, body, options.timeoutMs);
  return await extractContent(response);
}

export async function callJson<T>(options: CallOptions): Promise<T> {
  const content = await callChat({ ...options, jsonMode: true });
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    console.error("callJson: failed to parse LLM response as JSON", err);
    throw new Error(`llm response was not valid json: ${content.slice(0, 200)}`);
  }
}

function buildRequestBody(options: CallOptions): string {
  const payload: Record<string, unknown> = {
    model: options.model,
    messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (options.maxTokens !== undefined) {
    payload["max_tokens"] = options.maxTokens;
  }
  if (options.temperature !== undefined) {
    payload["temperature"] = options.temperature;
  }
  if (options.jsonMode === true) {
    payload["response_format"] = { type: "json_object" };
  }
  return JSON.stringify(payload);
}

async function postWithTimeout(url: string, apiKey: string, body: string, timeoutMs?: number): Promise<Response> {
  const controller = new AbortController();
  const effectiveTimeoutMs = timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function extractContent(response: Response): Promise<string> {
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`openrouter returned ${response.status}: ${errorBody.slice(0, 200)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("llm returned empty content");
  }
  return content;
}
