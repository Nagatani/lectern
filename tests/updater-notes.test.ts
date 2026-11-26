import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractUpdaterNotes } from "../src/updater-notes.ts";

describe("updater-notes: extractUpdaterNotes", () => {
  it("extracts only the block between HTML comment markers", () => {
    const raw = [
      "## Lectern v0.4.4",
      "",
      "### アップデート内容",
      "<!-- release-notes:start -->",
      "- 目次をテーマ配色に合わせて改善",
      "- Frontmatter の `toc: true` で目次表示を制御",
      "<!-- release-notes:end -->",
      "",
      "### ダウンロードファイル一覧",
      "- Lectern_0.4.4_aarch64.dmg",
    ].join("\n");

    assert.equal(
      extractUpdaterNotes(raw),
      "- 目次をテーマ配色に合わせて改善\n- Frontmatter の `toc: true` で目次表示を制御"
    );
  });

  it("supports <release-notes> XML-style tags as fallback", () => {
    const raw =
      "Header\n<release-notes>\n- バグ修正\n- パフォーマンス改善\n</release-notes>\nFooter";
    assert.equal(extractUpdaterNotes(raw), "- バグ修正\n- パフォーマンス改善");
  });

  it("falls back to trimmed raw body when no markers exist and handles empty input", () => {
    assert.equal(extractUpdaterNotes("  Plain release notes  "), "Plain release notes");
    assert.equal(extractUpdaterNotes(""), "");
    assert.equal(extractUpdaterNotes(null), "");
    assert.equal(extractUpdaterNotes(undefined), "");
  });
});
