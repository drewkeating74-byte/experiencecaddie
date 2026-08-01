/**
 * _shared/perplexity.ts
 *
 * Shared Perplexity client for Edge Functions.
 * Defaults to Agent API (/v1/agent) with JSON Schema structured outputs.
 * Set PERPLEXITY_USE_AGENT_API=false to roll back to Sonar chat completions.
 */

export type PerplexityPreset = "fast" | "low";
export type PerplexityLegacyModel = "sonar" | "sonar-pro";

export type JsonSchemaSpec = {
  name: string;
  schema: Record<string, unknown>;
};

export type AskPerplexityJsonParams = {
  apiKey: string;
  preset: PerplexityPreset;
  legacyModel: PerplexityLegacyModel;
  instructions: string;
  input: string;
  schema: JsonSchemaSpec;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export class PerplexityApiError extends Error {
  status: number;
  bodySnippet: string;

  constructor(status: number, bodySnippet: string) {
    super(`Perplexity API error ${status}: ${bodySnippet}`);
    this.name = "PerplexityApiError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

function useAgentApi(): boolean {
  const flag = (Deno.env.get("PERPLEXITY_USE_AGENT_API") ?? "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "off";
}

/** Strip markdown fences / leading prose so legacy Sonar JSON can still parse. */
export function extractJsonText(raw: string): string {
  let s = raw.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
  if (s.startsWith("{") || s.startsWith("[")) return s;
  const objStart = s.indexOf("{");
  const objEnd = s.lastIndexOf("}");
  const arrStart = s.indexOf("[");
  const arrEnd = s.lastIndexOf("]");
  const hasObj = objStart !== -1 && objEnd > objStart;
  const hasArr = arrStart !== -1 && arrEnd > arrStart;
  if (hasArr && (!hasObj || arrStart < objStart)) {
    return s.slice(arrStart, arrEnd + 1);
  }
  if (hasObj) return s.slice(objStart, objEnd + 1);
  return s;
}

function parseJsonContent<T>(raw: string): T {
  const cleaned = extractJsonText(raw);
  return JSON.parse(cleaned) as T;
}

async function callAgentApi(params: AskPerplexityJsonParams): Promise<string> {
  const body: Record<string, unknown> = {
    preset: params.preset,
    instructions: params.instructions,
    input: params.input,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: params.schema.name,
        schema: params.schema.schema,
      },
    },
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxOutputTokens !== undefined) body.max_output_tokens = params.maxOutputTokens;

  const res = await fetch("https://api.perplexity.ai/v1/agent", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: params.timeoutMs ? AbortSignal.timeout(params.timeoutMs) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PerplexityApiError(res.status, text.slice(0, 200));
  }

  const data = await res.json() as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  // Fallback: pull text from typed output message items
  for (const item of data.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  throw new Error("Perplexity Agent API returned empty content");
}

async function callSonarApi(params: AskPerplexityJsonParams): Promise<string> {
  const body: Record<string, unknown> = {
    model: params.legacyModel,
    messages: [
      { role: "system", content: params.instructions },
      { role: "user", content: params.input },
    ],
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxOutputTokens !== undefined) body.max_tokens = params.maxOutputTokens;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: params.timeoutMs ? AbortSignal.timeout(params.timeoutMs) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PerplexityApiError(res.status, text.slice(0, 200));
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new Error("Perplexity Sonar API returned empty content");
  }
  return String(content);
}

/**
 * Ask Perplexity for JSON matching the given schema.
 * Uses Agent API by default; set PERPLEXITY_USE_AGENT_API=false for Sonar rollback.
 */
export async function askPerplexityJson<T>(params: AskPerplexityJsonParams): Promise<T> {
  const raw = useAgentApi() ? await callAgentApi(params) : await callSonarApi(params);
  return parseJsonContent<T>(raw);
}
