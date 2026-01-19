export type PromptHistoryMessage = {
  role: string;
  parts?: Array<{ type: string; text?: string }>;
};

export function extractPromptHistory(
  messages: readonly PromptHistoryMessage[]
): string[] {
  const history: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
    if (!text.trim()) continue;
    history.push(text);
  }
  return history;
}

export function isCaretOnFirstLine(value: string, caretIndex: number): boolean {
  const safeCaret = Math.max(0, Math.min(value.length, caretIndex));
  return !value.slice(0, safeCaret).includes("\n");
}

export function isCaretOnLastLine(value: string, caretIndex: number): boolean {
  const safeCaret = Math.max(0, Math.min(value.length, caretIndex));
  return !value.slice(safeCaret).includes("\n");
}

export type PromptHistoryNavigationResult = {
  cursor: number;
  draft: string;
  value: string;
  didNavigate: boolean;
};

function clampCursor(cursor: number, historyLength: number): number {
  if (!Number.isFinite(cursor)) return historyLength;
  if (cursor < 0) return 0;
  if (cursor > historyLength) return historyLength;
  return cursor;
}

export function navigatePromptHistory(input: {
  direction: "up" | "down";
  history: readonly string[];
  cursor: number;
  draft: string;
  value: string;
}): PromptHistoryNavigationResult {
  const historyLength = input.history.length;
  let cursor = clampCursor(input.cursor, historyLength);
  let draft = input.draft;
  let value = input.value;

  if (historyLength === 0) {
    return { cursor: 0, draft, value, didNavigate: false };
  }

  if (input.direction === "up") {
    if (cursor === 0) return { cursor, draft, value, didNavigate: false };
    if (cursor === historyLength) {
      draft = value;
    }
    cursor -= 1;
    value = input.history[cursor] ?? value;
    return { cursor, draft, value, didNavigate: true };
  }

  if (cursor === historyLength) {
    return { cursor, draft, value, didNavigate: false };
  }

  cursor += 1;
  if (cursor === historyLength) {
    value = draft;
  } else {
    value = input.history[cursor] ?? value;
  }

  return { cursor, draft, value, didNavigate: true };
}
