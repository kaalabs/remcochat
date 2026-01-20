import {
  getAttachmentForProfile,
  readAttachmentBytes,
  sanitizeFilenameForContentDisposition,
} from "@/server/attachments";

export async function GET(
  req: Request,
  context: { params: Promise<{ attachmentId: string }> }
) {
  const { attachmentId } = await context.params;
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId") ?? "";

  if (!profileId) {
    return Response.json({ error: "Missing profileId." }, { status: 400 });
  }

  try {
    const attachment = getAttachmentForProfile({ profileId, attachmentId });
    const bytes = await readAttachmentBytes(attachment.id);
    const filename = sanitizeFilenameForContentDisposition(
      attachment.originalFilename
    );

    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);

    return new Response(body, {
      headers: {
        "Content-Type": attachment.mediaType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Attachment not found." },
      { status: 404 }
    );
  }
}
