/**
 * Extracts user-facing release notes for the in-app auto-updater dialog from a
 * GitHub Release body (provided via `latest.json`'s `notes` field).
 *
 * Supported delimiters (case-insensitive):
 * 1. HTML comment markers (invisible on GitHub Release pages):
 *    `<!-- release-notes:start --> ... <!-- release-notes:end -->`
 * 2. XML-style tag fallback:
 *    `<release-notes> ... </release-notes>`
 *
 * Falls back to the trimmed raw body when no markers are present.
 */
export function extractUpdaterNotes(rawBody: string | null | undefined): string {
  if (!rawBody) return "";

  const commentMatch =
    /<!--\s*release-notes:start\s*-->([\s\S]*?)<!--\s*release-notes:end\s*-->/i.exec(rawBody);
  if (commentMatch) {
    return commentMatch[1].trim();
  }

  const tagMatch = /<release-notes>([\s\S]*?)<\/release-notes>/i.exec(rawBody);
  if (tagMatch) {
    return tagMatch[1].trim();
  }

  return rawBody.trim();
}
