import type { OvNlErrorCode, OvNlToolOutput } from "@/lib/types";

type OvNlErrorLikeOutput = Extract<
  OvNlToolOutput,
  { kind: "error" } | { kind: "disambiguation" }
>;

const OV_NL_RECOVERABLE_ERROR_CODES = new Set<OvNlErrorCode>([
  "invalid_tool_input",
  "station_not_found",
  "station_ambiguous",
  "upstream_unreachable",
  "upstream_http_error",
  "upstream_invalid_response",
  "unknown",
]);

const OV_NL_NON_RECOVERABLE_ERROR_CODES = new Set<OvNlErrorCode>([
  "config_error",
  "access_denied",
]);

export function isOvNlErrorLikeOutput(output: unknown): output is OvNlErrorLikeOutput {
  if (!output || typeof output !== "object") return false;
  const kind = (output as { kind?: unknown }).kind;
  return kind === "error" || kind === "disambiguation";
}

export function isOvNlRecoverableErrorCode(code: unknown): code is OvNlErrorCode {
  if (typeof code !== "string") return false;
  return OV_NL_RECOVERABLE_ERROR_CODES.has(code as OvNlErrorCode);
}

export function isOvNlNonRecoverableErrorCode(code: unknown): code is OvNlErrorCode {
  if (typeof code !== "string") return false;
  return OV_NL_NON_RECOVERABLE_ERROR_CODES.has(code as OvNlErrorCode);
}

export function isOvNlAutoRecoverableOutput(output: unknown): boolean {
  if (!isOvNlErrorLikeOutput(output)) return false;
  if (output.kind === "disambiguation") return false;

  const code = output.error?.code;
  if (isOvNlNonRecoverableErrorCode(code)) return false;
  return isOvNlRecoverableErrorCode(code);
}

export function shouldContinueOvRecovery(input: {
  finishReason: unknown;
  lastOvOutput: unknown;
  hasTextDelta: boolean;
}): boolean {
  return (
    input.finishReason === "tool-calls" &&
    !input.hasTextDelta &&
    isOvNlErrorLikeOutput(input.lastOvOutput)
  );
}

export function shouldRetryOvAutoRecovery(input: {
  lastOvOutput: unknown;
  retriesRemaining: number;
  hasTextDelta: boolean;
}): boolean {
  if (input.hasTextDelta) return false;
  if (input.retriesRemaining <= 0) return false;
  return isOvNlAutoRecoverableOutput(input.lastOvOutput);
}

export function shouldSuppressAssistantTextForOvOutput(output: unknown): boolean {
  return !isOvNlErrorLikeOutput(output);
}
