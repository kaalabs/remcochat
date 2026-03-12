export function mergeChatTransportBody(
  currentBody: Record<string, unknown> | null | undefined,
  requestBody: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    ...(currentBody ?? {}),
    ...(requestBody ?? {}),
  };
}
