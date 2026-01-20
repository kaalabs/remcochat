import type { UIMessage } from "ai";
import type { RemcoChatMessageMetadata } from "@/lib/types";
import {
  bindAttachmentToMessage,
  getAttachmentForProfile,
  parseAttachmentUrl,
  readAttachmentBytes,
} from "@/server/attachments";
import { extractTextInSandbox } from "@/server/attachment-processing";

function textPart(text: string) {
  return { type: "text" as const, text };
}

function formatAttachmentText(input: {
  filename: string;
  mediaType: string;
  text: string;
  truncated: boolean;
}) {
  const header = `Attachment: ${input.filename} (${input.mediaType})`;
  const note = "Use only the extracted text below; do not try to open this attachment as a file path.";
  const body = (input.text ?? "").trimEnd();
  const trunc = input.truncated ? "\n\n[Attachment text truncated]" : "";
  return `${header}\n${note}\n\n\`\`\`text\n${body}\n\`\`\`${trunc}`;
}

export async function replaceAttachmentPartsWithExtractedText(input: {
  profileId: string;
  messages: UIMessage<RemcoChatMessageMetadata>[];
}): Promise<UIMessage<RemcoChatMessageMetadata>[]> {
  const profileId = String(input.profileId ?? "").trim();
  if (!profileId) throw new Error("Missing profileId.");

  const cache = new Map<string, { text: string; truncated: boolean; filename: string; mediaType: string }>();

  const out: UIMessage<RemcoChatMessageMetadata>[] = [];
  for (const message of input.messages) {
    const nextParts: UIMessage<RemcoChatMessageMetadata>["parts"] = [];

    for (const part of message.parts) {
      if (part.type !== "file") {
        nextParts.push(part);
        continue;
      }

      const attachmentId = parseAttachmentUrl(part.url);
      if (!attachmentId) {
        throw new Error("Only server-stored attachments are allowed.");
      }

      // Bind attachment to message id (best effort; not required for extraction).
      if (message.role === "user") {
        try {
          bindAttachmentToMessage({ profileId, attachmentId, messageId: message.id });
        } catch {
          // ignore
        }
      }

      const cached = cache.get(attachmentId);
      if (cached) {
        nextParts.push(
          textPart(
            formatAttachmentText({
              filename: cached.filename,
              mediaType: cached.mediaType,
              text: cached.text,
              truncated: cached.truncated,
            })
          )
        );
        continue;
      }

      const attachment = getAttachmentForProfile({ profileId, attachmentId });
      const bytes = await readAttachmentBytes(attachmentId);
      const extracted = await extractTextInSandbox({
        attachmentId,
        mediaType: attachment.mediaType,
        bytes,
      });

      cache.set(attachmentId, {
        text: extracted.text,
        truncated: extracted.truncated,
        filename: attachment.originalFilename,
        mediaType: attachment.mediaType,
      });

      nextParts.push(
        textPart(
          formatAttachmentText({
            filename: attachment.originalFilename,
            mediaType: attachment.mediaType,
            text: extracted.text,
            truncated: extracted.truncated,
          })
        )
      );
    }

    out.push({ ...message, parts: nextParts });
  }

  return out;
}
