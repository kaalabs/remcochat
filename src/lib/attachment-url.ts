export const ATTACHMENT_URL_PREFIX = "remcochat://attachment/";

export function makeAttachmentUrl(attachmentId: string): string {
  return `${ATTACHMENT_URL_PREFIX}${attachmentId}`;
}

export function parseAttachmentUrl(url: string): string | null {
  const value = String(url ?? "").trim();
  if (!value.startsWith(ATTACHMENT_URL_PREFIX)) return null;
  const id = value.slice(ATTACHMENT_URL_PREFIX.length).trim();
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

