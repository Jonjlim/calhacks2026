import { z } from "zod";
import type { AppErrorCode } from "../../lib/contracts";

export class AgentFailure extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export type ModelRole = "buyer" | "extractor" | "recipient";
export interface ModelRequest {
  role: ModelRole;
  instructions: string;
  input: unknown;
}
export type ModelTransport = (request: ModelRequest) => Promise<unknown>;

/** Only server configuration controls the URL; model/user content cannot select tools or hosts. */
export function createModelTransport(
  config: { baseUrl?: string; apiKey?: string; model?: string },
  fetcher: typeof fetch = fetch,
): ModelTransport {
  return async (request) => {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new AgentFailure("unknown", "Model provider is not configured.");
    }
    const url = new URL(
      `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
    );
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new AgentFailure(
        "validation_failed",
        "Model endpoint must use HTTPS.",
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetcher(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.instructions },
            { role: "user", content: JSON.stringify(request.input) },
          ],
        }),
      });
      if (!response.ok)
        throw new AgentFailure(
          "unknown",
          `Model provider returned HTTP ${response.status}.`,
        );
      // Bound response reads, including providers that ignore their output budget.
      const reader = response.body?.getReader();
      if (!reader)
        throw new AgentFailure(
          "validation_failed",
          "Model returned an empty response.",
        );
      const decoder = new TextDecoder();
      let body = "";
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 128_000) {
          await reader.cancel();
          throw new AgentFailure(
            "validation_failed",
            "Model response exceeded its limit.",
          );
        }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
      const envelope = z
        .object({
          choices: z
            .array(
              z.object({
                finish_reason: z.string(),
                message: z.object({
                  content: z.string().nullable(),
                  refusal: z.string().nullable().optional(),
                }),
              }),
            )
            .min(1)
            .max(1),
        })
        .parse(JSON.parse(body));
      const choice = envelope.choices[0]!;
      if (choice.message.refusal)
        throw new AgentFailure("refused", "Model declined the request.");
      if (choice.finish_reason !== "stop" || !choice.message.content)
        throw new AgentFailure(
          "validation_failed",
          "Model response was incomplete.",
        );
      return JSON.parse(choice.message.content) as unknown;
    } catch (error) {
      if (error instanceof AgentFailure) throw error;
      if (controller.signal.aborted)
        throw new AgentFailure("provider_timeout", "Model request timed out.");
      if (error instanceof SyntaxError || error instanceof z.ZodError)
        throw new AgentFailure(
          "validation_failed",
          "Model returned invalid JSON.",
        );
      throw new AgentFailure("unknown", "Model provider could not be reached.");
    } finally {
      clearTimeout(timeout);
    }
  };
}

/** Retry malformed output once. Never echo private output or provider errors into repair prompts. */
export async function validatedModelCall<T>(
  transport: ModelTransport,
  request: ModelRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await transport({
        ...request,
        instructions:
          request.instructions +
          (attempt
            ? "\nThe previous response failed validation. Return only JSON matching the supplied schema; no additional fields."
            : ""),
      });
      const result = schema.safeParse(raw);
      if (result.success) return result.data;
    } catch (error) {
      if (
        !(error instanceof AgentFailure) ||
        error.code !== "validation_failed"
      )
        throw error;
    }
  }
  throw new AgentFailure(
    "validation_failed",
    "Model output failed validation twice.",
  );
}

export function configuredModel(): ModelTransport {
  return createModelTransport({
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
  });
}
