import crypto from "node:crypto";
import fs from "node:fs";
import type { TextStreamPart } from "ai";
import type {
  AgendaActionInput,
} from "@/server/agenda";
import { getConfig } from "@/server/config";
import type { ToolStreamError } from "@/server/ui-stream";
import type { RemcoChatMessageMetadata } from "@/domain/chats/types";
import type { OvNlToolOutput } from "@/domain/ov-nl/types";
import {
  allowedReasoningEfforts,
  normalizeReasoningEffort,
  type ReasoningEffort,
} from "@/lib/reasoning-effort";
import { isOvNlErrorLikeOutput } from "@/lib/ov-nl-recovery";
import type {
  ChatMessage,
  StreamTextToolSet,
} from "@/server/chat/types";

const WEB_TOOL_NAMES = new Set([
  "perplexity_search",
  "web_search",
  "web_fetch",
  "google_search",
  "url_context",
  "exa_search",
  "brave_search",
]);

export function messageText(message: ChatMessage) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

export function lastUserTextFromMessages(messages: ChatMessage[]): string {
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIndex < 0) return "";
  const msg = messages[lastUserIndex];
  return msg ? messageText(msg) : "";
}

export function ovConstraintNoMatchQuestion(output: unknown): string {
  if (!isOvNlErrorLikeOutput(output) || output.kind !== "error") return "";
  if (output.error?.code !== "constraint_no_match") return "";
  const details =
    output.error?.details && typeof output.error.details === "object"
      ? (output.error.details as Record<string, unknown>)
      : null;
  const suggested = Array.isArray(details?.suggestedRelaxations)
    ? details.suggestedRelaxations
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
    : [];
  if (suggested.length > 0) {
    return `No exact match with your strict constraints. Should I relax this: ${suggested[0]}?`;
  }
  return "No exact match with your strict constraints. Which one constraint should I relax?";
}

export function formatOvFastPathRecoveryPrompt(input: {
  userText: string;
  command: { action: string; args?: Record<string, unknown> };
  lastOvOutput: unknown;
  allowRetry: boolean;
  retriesRemaining: number;
}): string {
  return [
    "The previous ovNlGateway fast-path call needs recovery.",
    input.userText ? `Original user request: ${input.userText}` : "",
    "Previous ovNlGateway command:",
    JSON.stringify(
      {
        action: input.command.action,
        args: input.command.args ?? {},
      },
      null,
      2,
    ),
    "Previous ovNlGateway output:",
    JSON.stringify(input.lastOvOutput, null, 2),
    input.allowRetry
      ? [
          `You may retry ovNlGateway at most ${input.retriesRemaining} time if there is an obvious safe repair you can infer from the user's wording.`,
          "Safe repair example: strip a leading 'station ' token from station names in from/to/station fields.",
          "If no safe repair is obvious, do not call tools. Ask one concise clarification question in the user's language.",
          "Do not use any tool other than ovNlGateway.",
        ].join("\n")
      : "Do not call any tools now. Ask one concise clarification question in the user's language.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function fastPathContinuationMessageMetadata(
  input?: RemcoChatMessageMetadata,
) {
  return ({ part }: { part: TextStreamPart<StreamTextToolSet> }) => {
    if (part.type === "start") return input;
    if (part.type === "finish") {
      return input
        ? {
            ...input,
            usage: part.totalUsage,
          }
        : undefined;
    }
    return undefined;
  };
}

export function previousUserMessageText(
  messages: ChatMessage[],
  currentUserMessageId: string,
) {
  if (!currentUserMessageId) return "";
  const index = messages.findIndex((m) => m.id === currentUserMessageId);
  if (index <= 0) return "";
  for (let i = index - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    return messageText(msg);
  }
  return "";
}

export function extractExplicitBashCommand(text: string): string | null {
  const value = String(text ?? "").trim();
  if (!value) return null;

  if (/^\/bash\b/i.test(value)) {
    const command = value.replace(/^\/bash\b\s*/i, "").trim();
    return command || null;
  }

  const bashPrefixed = value.match(/^bash\s*:\s*([\s\S]{1,8000})$/i);
  if (bashPrefixed?.[1]) return bashPrefixed[1].trim();

  const isQuestionLike =
    /\?\s*$/.test(value) ||
    /^(how|what|why|when|where|who|which|can|could|would|should|do|does|did|is|are)\b/i.test(
      value,
    );
  if (isQuestionLike) return null;

  const inlineCandidates = Array.from(
    value.matchAll(/`([^`\n]{1,4000})`/g),
    (m) => String(m[1] ?? "").trim(),
  ).filter(Boolean);
  const fenced = value.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]{1,8000}?)```/);
  const markdownCommand =
    inlineCandidates.length > 0
      ? (() => {
          const withWhitespace = inlineCandidates.filter((candidate) =>
            /\s/.test(candidate),
          );
          return (withWhitespace.length > 0
            ? withWhitespace[withWhitespace.length - 1]
            : inlineCandidates[inlineCandidates.length - 1])!;
        })()
      : fenced?.[1]?.trim() ?? null;

  if (!markdownCommand) return null;

  const hasStrongOptIn =
    /\b(use|call)\s+the\s+bash\s+tool\b/i.test(value) ||
    /\b(run|execute)\s+(this|the)\s+command\b/i.test(value) ||
    (/\b(run|execute)\b/i.test(value) &&
      /\b(exactly|verbatim|without changes)\b/i.test(value));

  if (!hasStrongOptIn) return null;

  return markdownCommand;
}

export function shouldAllowDirectBashFastPath(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;

  return (
    /^\/bash\b/i.test(value) ||
    /^bash\s*:/i.test(value) ||
    /\b(run|execute)\s+(this|the)\s+command\b/i.test(value) ||
    /\b(use|call)\s+the\s+bash\s+tool\b/i.test(value)
  );
}

export function explicitSkillNameCandidate(text: string): string | null {
  const raw = String(text ?? "");
  if (!raw.startsWith("/")) return null;
  const match = raw.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+|$)/);
  return match?.[1] ?? null;
}

export function lastAssistantContext(messages: ChatMessage[]) {
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  if (lastUserIndex <= 0) return {};

  for (let i = lastUserIndex - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;

    const lastAssistantText = messageText(msg);
    let lastToolName: string | undefined;
    for (const part of msg.parts) {
      const type = (part as { type?: unknown }).type;
      if (typeof type === "string" && type.startsWith("tool-")) {
        lastToolName = type.slice("tool-".length);
        break;
      }
    }

    return {
      lastAssistantText: lastAssistantText || undefined,
      lastToolName,
    };
  }

  return {};
}

export function lastOvOutputFromMessages(
  messages: ChatMessage[],
): OvNlToolOutput | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    for (let j = msg.parts.length - 1; j >= 0; j -= 1) {
      const part = msg.parts[j] as {
        type?: unknown;
        state?: unknown;
        output?: unknown;
      };
      if (part.type !== "tool-ovNlGateway") continue;
      if (part.state !== "output-available") continue;
      if (!part.output || typeof part.output !== "object") continue;
      return part.output as OvNlToolOutput;
    }
  }
  return null;
}

export function readFileForPrompt(filePath: string, maxBytes: number): string {
  const max = Math.max(1_000, Math.floor(Number(maxBytes ?? 200_000)));
  const buf = fs.readFileSync(filePath);
  if (buf.length <= max) return buf.toString("utf8");
  const clipped = buf.subarray(0, max).toString("utf8");
  return `${clipped}\n\n[SKILL.md truncated: ${buf.length - max} bytes removed]`;
}

export function getEffectiveReasoning(input: {
  config: {
    enabled: boolean;
    effort: string;
    exposeToClient: boolean;
    openaiSummary: string | null;
    anthropicBudgetTokens: number | null;
    googleThinkingBudget: number | null;
  };
  resolved: {
    modelType: string;
    providerModelId: string;
    capabilities: { reasoning: boolean };
  };
  requestedEffort?: string;
}) {
  const webToolsEnabled = Boolean(getConfig().webTools?.enabled);
  const webSearchIsEnabled =
    webToolsEnabled &&
    (input.resolved.modelType === "openai_responses" ||
      (input.resolved.modelType === "vercel_ai_gateway" &&
        input.resolved.providerModelId.startsWith("openai/")));

  const allowed = allowedReasoningEfforts({
    modelType: input.resolved.modelType,
    providerModelId: input.resolved.providerModelId,
    webToolsEnabled,
  });
  const normalized = normalizeReasoningEffort(input.requestedEffort, allowed);
  const requested = String(input.requestedEffort ?? "").trim().toLowerCase();

  if (webSearchIsEnabled && requested === "minimal") {
    const coercedEffort = "low" as ReasoningEffort;
    return {
      requestedEffort: input.requestedEffort ?? "",
      normalizedEffort: normalized,
      effectiveEffort: coercedEffort,
      effectiveReasoning: {
        ...input.config,
        effort: coercedEffort,
      },
    };
  }

  const effectiveEffort =
    input.config.enabled && input.resolved.capabilities.reasoning
      ? normalized === "auto"
        ? input.config.effort
        : normalized
      : input.config.effort;
  const coercedEffort = effectiveEffort as ReasoningEffort;

  return {
    requestedEffort: input.requestedEffort ?? "",
    normalizedEffort: normalized,
    effectiveEffort,
    effectiveReasoning: {
      ...input.config,
      effort: coercedEffort,
    },
  };
}

export function needsMemoryContext(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/\s/.test(trimmed)) return false;
  const stripped = trimmed.replace(/[.!?,;:]+$/g, "");
  if (!stripped) return true;
  return /^[A-Za-z][A-Za-z'-]*$/.test(stripped);
}

export function isAgendaMutation(action: AgendaActionInput["action"]) {
  return action !== "list";
}

export function hash8(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isWebToolName(toolName: string) {
  return WEB_TOOL_NAMES.has(toolName);
}

export function formatToolErrorsForPrompt(toolErrors: ToolStreamError[]) {
  const lines = toolErrors.slice(0, 5).map((error) => {
    const name = error.toolName ? `${error.toolName}` : "unknown_tool";
    const stage = error.stage === "input" ? "input" : "output";
    const message = String(error.errorText ?? "").trim() || "Tool failed.";
    return `- ${name} (${stage}): ${message}`;
  });

  return [
    "A tool call failed during the previous step.",
    "Do not call any tools now. Respond with a helpful explanation and next steps, in plain text.",
    "",
    "Errors:",
    ...lines,
  ].join("\n");
}

export function shouldFinalizeAfterToolOnlyRun(input: {
  finishReason: unknown;
  hasTextDelta: boolean;
  toolErrors: ToolStreamError[];
  toolOutputsByName: Map<string, unknown[]>;
  toolName: string;
}): { outputs: unknown[] } | null {
  if (input.hasTextDelta) return null;
  if (input.toolErrors.length > 0) return null;
  const reason = typeof input.finishReason === "string" ? input.finishReason : "";
  if (reason !== "stop" && reason !== "tool-calls") return null;
  const outputs = input.toolOutputsByName.get(input.toolName) ?? [];
  if (!Array.isArray(outputs) || outputs.length === 0) return null;
  return { outputs };
}

export function formatObsidianOutputsForPrompt(outputs: unknown[]) {
  const items = Array.isArray(outputs) ? outputs : [];
  const last = items.slice(Math.max(0, items.length - 8));
  const maxPerStdout = 10_000;
  const maxPerStderr = 2_000;
  const lines: string[] = [];

  for (let i = 0; i < last.length; i += 1) {
    const out = last[i] as {
      stdout?: unknown;
      stderr?: unknown;
      exitCode?: unknown;
    };
    const stdout = String(out?.stdout ?? "").slice(0, maxPerStdout);
    const stderr = String(out?.stderr ?? "").slice(0, maxPerStderr);
    const exitCode =
      typeof out?.exitCode === "number" ? out.exitCode : Number(out?.exitCode ?? NaN);
    const exit = Number.isFinite(exitCode) ? String(exitCode) : "unknown";

    const block = [
      `Call ${items.length - last.length + i + 1}/${items.length} (exitCode=${exit})`,
      stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
      stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    lines.push(block);
  }

  return lines.join("\n\n---\n\n");
}

export function formatStdoutStderrExitCodeOutputsForPrompt(outputs: unknown[]) {
  return formatObsidianOutputsForPrompt(outputs);
}
