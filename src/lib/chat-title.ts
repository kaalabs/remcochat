export type ChatTitleValidationResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

export function validateChatTitle(raw: string): ChatTitleValidationResult {
  const title = String(raw ?? "").trim();
  if (!title) {
    return { ok: false, error: "Chat title cannot be empty." };
  }
  if (title.length > 200) {
    return { ok: false, error: "Chat title is too long." };
  }
  return { ok: true, title };
}

