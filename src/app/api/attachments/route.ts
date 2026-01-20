import { getConfig } from "@/server/config";
import { getProfile } from "@/server/profiles";
import { getChat } from "@/server/chats";
import { makeAttachmentUrl, storeAttachment } from "@/server/attachments";

function isWebFile(value: unknown): value is File {
  if (!value || typeof value !== "object") return false;
  const v = value as { arrayBuffer?: unknown; name?: unknown; size?: unknown };
  return (
    typeof v.arrayBuffer === "function" &&
    typeof v.name === "string" &&
    typeof v.size === "number"
  );
}

function inferMediaType(file: File): string {
  const explicit = String(file.type ?? "").trim();
  if (explicit) return explicit;

  const name = String(file.name ?? "").toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "";
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.length === 0) return false;

  let nulCount = 0;
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) nulCount += 1;
    if (b < 9 || (b > 13 && b < 32)) suspicious += 1;
  }
  if (nulCount > 0) return true;
  return suspicious / sample.length > 0.3;
}

function assertPdf(bytes: Buffer) {
  if (bytes.length < 5) throw new Error("Invalid PDF.");
  if (bytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
    throw new Error("Invalid PDF.");
  }
}

export async function POST(req: Request) {
  const cfg = getConfig().attachments;
  if (!cfg.enabled) {
    return Response.json({ error: "Attachments are disabled." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data." }, { status: 400 });
  }

  const profileId = String(form.get("profileId") ?? "").trim();
  const chatId = String(form.get("chatId") ?? "").trim();
  const temporarySessionId = String(form.get("temporarySessionId") ?? "").trim();

  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  // Ensure profile exists.
  try {
    getProfile(profileId);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid profile." },
      { status: 400 }
    );
  }

  if (!chatId && !temporarySessionId) {
    return Response.json(
      { error: "Missing chatId or temporarySessionId." },
      { status: 400 }
    );
  }
  if (chatId && temporarySessionId) {
    return Response.json(
      { error: "Provide either chatId or temporarySessionId (not both)." },
      { status: 400 }
    );
  }

  if (chatId) {
    try {
      const chat = getChat(chatId);
      if (chat.profileId !== profileId) {
        return Response.json({ error: "Chat does not belong to this profile." }, { status: 400 });
      }
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Invalid chat." },
        { status: 400 }
      );
    }
  }

  const rawFiles = form.getAll("files");
  const files = rawFiles.filter(isWebFile);
  if (files.length === 0) {
    return Response.json({ error: "Missing files." }, { status: 400 });
  }
  if (files.length > cfg.maxFilesPerMessage) {
    return Response.json(
      { error: `Too many files. Max is ${cfg.maxFilesPerMessage}.` },
      { status: 400 }
    );
  }

  const totalBytes = files.reduce((acc, f) => acc + Number(f.size ?? 0), 0);
  if (totalBytes > cfg.maxTotalSizeBytes) {
    return Response.json(
      { error: `Total upload is too large. Max is ${cfg.maxTotalSizeBytes} bytes.` },
      { status: 400 }
    );
  }

  for (const file of files) {
    if (file.size > cfg.maxFileSizeBytes) {
      return Response.json(
        { error: `File "${file.name}" is too large. Max is ${cfg.maxFileSizeBytes} bytes.` },
        { status: 400 }
      );
    }
  }

  try {
    const stored = [];
    for (const file of files) {
      const mediaType = inferMediaType(file);
      if (!mediaType) {
        throw new Error(`Unsupported attachment type: ${file.type || "unknown"}`);
      }
      if (!cfg.allowedMediaTypes.some((t) => t.toLowerCase() === mediaType.toLowerCase())) {
        throw new Error(`Unsupported attachment type: ${mediaType}`);
      }

      const bytes = Buffer.from(await file.arrayBuffer());

      if (mediaType === "application/pdf") {
        assertPdf(bytes);
      } else {
        if (looksBinary(bytes)) {
          throw new Error(`File "${file.name}" does not look like text.`);
        }
      }

      const attachment = await storeAttachment({
        profileId,
        chatId: chatId || null,
        temporarySessionId: temporarySessionId || null,
        originalFilename: file.name,
        mediaType,
        bytes,
      });
      stored.push(attachment);
    }

    return Response.json({
      attachments: stored.map((a) => ({
        id: a.id,
        filename: a.originalFilename,
        mediaType: a.mediaType,
        sizeBytes: a.sizeBytes,
        attachmentUrl: makeAttachmentUrl(a.id),
        downloadUrl: `/api/attachments/${a.id}?profileId=${encodeURIComponent(profileId)}`,
        createdAt: a.createdAt,
      })),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to upload attachments." },
      { status: 400 }
    );
  }
}

