import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEditorPreviewSync,
  extractMarkdownHeadings,
  filterHeadings,
  getSlideIndexAtCursor,
  syncEditorToPreview,
  syncPreviewToEditor,
} from "../src/outline-and-sync.ts";

describe("outline-and-sync: extractMarkdownHeadings", () => {
  it("extracts H1-H3 headings with exact 1-based line numbers and 0-based offsets", () => {
    const md = [
      "# Lecture 1: Algorithms",
      "Intro paragraph.",
      "## 1.1 Sorting",
      "### QuickSort ###",
      "#### Ignored H4",
      "#NoSpaceIgnored",
      "    # FourSpacesIndentedIgnored",
      "  ## Indented Two Spaces",
      "###   ",
    ].join("\n");

    const headings = extractMarkdownHeadings(md);
    assert.deepEqual(headings, [
      {
        level: 1,
        text: "Lecture 1: Algorithms",
        line: 1,
        offset: md.indexOf("# Lecture 1: Algorithms"),
      },
      {
        level: 2,
        text: "1.1 Sorting",
        line: 3,
        offset: md.indexOf("## 1.1 Sorting"),
      },
      {
        level: 3,
        text: "QuickSort",
        line: 4,
        offset: md.indexOf("### QuickSort ###"),
      },
      {
        level: 2,
        text: "Indented Two Spaces",
        line: 8,
        offset: md.indexOf("  ## Indented Two Spaces"),
      },
    ]);
  });

  it("skips leading YAML frontmatter including hash comments inside it", () => {
    const md = [
      "---",
      "# YAML comment that looks like H1",
      "title: 情報工学概論",
      "## Another YAML comment",
      "---",
      "",
      "# 第1章 はじめに",
      "## 1.1 概要",
    ].join("\n");

    const headings = extractMarkdownHeadings(md);
    assert.deepEqual(headings, [
      {
        level: 1,
        text: "第1章 はじめに",
        line: 7,
        offset: md.indexOf("# 第1章 はじめに"),
      },
      {
        level: 2,
        text: "1.1 概要",
        line: 8,
        offset: md.indexOf("## 1.1 概要"),
      },
    ]);
  });

  it("does not drop headings if a leading --- is unclosed", () => {
    const md = ["---", "# Real Heading"].join("\n");
    const headings = extractMarkdownHeadings(md);
    assert.equal(headings.length, 1);
    assert.equal(headings[0].text, "Real Heading");
    assert.equal(headings[0].line, 2);
  });

  it("skips headings inside backtick and tilde fenced code blocks including nested fences", () => {
    const md = [
      "# Before Code",
      "```python",
      "# python comment",
      "## not a heading",
      "```",
      "## Between Code",
      "````markdown",
      "```",
      "# nested inside 4-backtick fence",
      "```",
      "## still inside 4-backtick fence",
      "````",
      "~~~bash",
      "# bash comment",
      "~~~",
      "### After Code",
    ].join("\n");

    const headings = extractMarkdownHeadings(md);
    assert.deepEqual(
      headings.map((h) => ({ level: h.level, text: h.text, line: h.line })),
      [
        { level: 1, text: "Before Code", line: 1 },
        { level: 2, text: "Between Code", line: 6 },
        { level: 3, text: "After Code", line: 16 },
      ]
    );
  });

  it("preserves exact UTF-16 offsets with CRLF line endings", () => {
    const md = "---\r\ntitle: CRLF\r\n---\r\n# First\r\nBody\r\n## Second";
    const headings = extractMarkdownHeadings(md);
    assert.deepEqual(headings, [
      {
        level: 1,
        text: "First",
        line: 4,
        offset: md.indexOf("# First"),
      },
      {
        level: 2,
        text: "Second",
        line: 6,
        offset: md.indexOf("## Second"),
      },
    ]);
  });
});

describe("outline-and-sync: filterHeadings", () => {
  const sample = extractMarkdownHeadings(
    ["# Algorithms", "## Binary Search", "### Complexity Analysis", "## Dynamic Programming"].join(
      "\n"
    )
  );

  it("returns all headings for blank queries and filters case-insensitively with multi-term AND", () => {
    assert.equal(filterHeadings(sample, "   ").length, 4);

    const matched = filterHeadings(sample, "binary h2");
    assert.equal(matched.length, 1);
    assert.equal(matched[0].text, "Binary Search");

    assert.equal(filterHeadings(sample, "nonexistent").length, 0);
  });
});

describe("outline-and-sync: getSlideIndexAtCursor", () => {
  it("returns 0 for empty or single-slide documents and clamps out-of-range offsets", () => {
    assert.equal(getSlideIndexAtCursor("", 0), 0);
    assert.equal(getSlideIndexAtCursor("# Only Slide\nHello", -10), 0);
    assert.equal(getSlideIndexAtCursor("# Only Slide\nHello", 999), 0);
  });

  it("tracks 0-based slide index with dedicated Frontmatter cover slide (index 0) and body from index 1", () => {
    const md = [
      "---",
      "title: Slide Deck",
      "author: Prof",
      "---",
      "# Slide 0",
      "Content 0",
      "---",
      "# Slide 1",
      "Content 1",
      "---",
      "# Slide 2",
      "Content 2",
    ].join("\n");

    // Inside frontmatter -> cover slide (index 0)
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("title:")), 0);
    // Body slide 1 -> index 1
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("# Slide 0")), 1);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("Content 0")), 1);
    // Body slide 2 -> index 2
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("# Slide 1")), 2);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("Content 1")), 2);
    // Body slide 3 -> index 3
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("# Slide 2")), 3);
    assert.equal(getSlideIndexAtCursor(md, md.length), 3);

    // Frontmatter without visible header fields (only theme) does NOT add a cover slide
    const themeOnlyMd = ["---", "theme: handout", "---", "# First", "---", "# Second"].join("\n");
    assert.equal(getSlideIndexAtCursor(themeOnlyMd, themeOnlyMd.indexOf("# First")), 0);
    assert.equal(getSlideIndexAtCursor(themeOnlyMd, themeOnlyMd.indexOf("# Second")), 1);
  });

  it("ignores --- lines inside backtick and tilde fenced code blocks", () => {
    const md = [
      "# Slide 0",
      "```yaml",
      "---",
      "key: value",
      "---",
      "```",
      "Still Slide 0",
      "~~~~",
      "---",
      "~~~~",
      "Also Slide 0",
      "---",
      "# Slide 1",
    ].join("\n");

    assert.equal(getSlideIndexAtCursor(md, md.indexOf("key: value")), 0);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("Still Slide 0")), 0);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("Also Slide 0")), 0);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("# Slide 1")), 1);
  });

  it("matches converter.rs split_slides on consecutive, leading, and trailing --- separators", () => {
    // Consecutive separators do not create empty slides
    const consecutive = ["# Slide 0", "---", "---", "# Slide 1"].join("\n");
    assert.equal(getSlideIndexAtCursor(consecutive, consecutive.indexOf("# Slide 0")), 0);
    assert.equal(getSlideIndexAtCursor(consecutive, consecutive.indexOf("# Slide 1")), 1);

    // Leading separator before any content does not create an empty slide 0
    const leading = ["", "---", "# Slide 0", "---", "# Slide 1"].join("\n");
    assert.equal(getSlideIndexAtCursor(leading, leading.indexOf("# Slide 0")), 0);
    assert.equal(getSlideIndexAtCursor(leading, leading.indexOf("# Slide 1")), 1);

    // Trailing separator with no content after it clamps to the last real slide
    const trailing = ["# Slide 0", "---", ""].join("\n");
    assert.equal(getSlideIndexAtCursor(trailing, trailing.length), 0);
  });

  it("handles CRLF line endings accurately", () => {
    const md = "---\r\ntitle: T\r\n---\r\n# S0\r\n---\r\n# S1\r\n---\r\n# S2";
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("title:")), 0);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("# S0")), 1);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("# S1")), 2);
    assert.equal(getSlideIndexAtCursor(md, md.indexOf("# S2")), 3);
  });
});

describe("outline-and-sync: syncPreviewToEditor", () => {
  it("proportionally syncs previewViewport.scrollTop in document mode", () => {
    const editor = {
      value: "",
      selectionStart: 0,
      scrollTop: 250,
      scrollHeight: 1500,
      clientHeight: 500, // maxScroll = 1000 -> ratio = 0.25
    };
    const previewViewport = {
      scrollTop: 0,
      scrollHeight: 2600,
      clientHeight: 600, // maxScroll = 2000 -> expected = 500
    };

    const res = syncPreviewToEditor({
      enabled: true,
      mode: "document",
      editor,
      previewViewport,
    });

    assert.equal(res.synced, true);
    assert.equal(res.scrollRatio, 0.25);
    assert.equal(res.targetScrollTop, 500);
    assert.equal(previewViewport.scrollTop, 500);
  });

  it("uses scrollTo with smooth behavior when smooth: true in document mode", () => {
    const calls: ScrollToOptions[] = [];
    const editor = {
      value: "",
      selectionStart: 0,
      scrollTop: 500,
      scrollHeight: 1500,
      clientHeight: 500, // ratio = 0.5
    };
    const previewViewport = {
      scrollTop: 0,
      scrollHeight: 1600,
      clientHeight: 600, // maxScroll = 1000 -> target = 500
      scrollTo(options: ScrollToOptions) {
        calls.push(options);
      },
    };

    const res = syncPreviewToEditor({
      enabled: true,
      mode: "document",
      editor,
      previewViewport,
      smooth: true,
    });

    assert.equal(res.synced, true);
    assert.equal(res.targetScrollTop, 500);
    assert.deepEqual(calls, [{ top: 500, behavior: "smooth" }]);
  });

  it("calls onSlideChange in slide mode only when cursor moves to a different slide", () => {
    const md = "# Slide 0\n---\n# Slide 1\n---\n# Slide 2";
    const changedTo: number[] = [];
    const previewViewport = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };

    // Cursor moves from slide 0 -> slide 2
    const res1 = syncPreviewToEditor({
      enabled: true,
      mode: "slide",
      editor: {
        value: md,
        selectionStart: md.indexOf("# Slide 2"),
        scrollTop: 0,
        scrollHeight: 500,
        clientHeight: 500,
      },
      previewViewport,
      currentSlideIndex: 0,
      onSlideChange: (idx) => changedTo.push(idx),
    });

    assert.equal(res1.synced, true);
    assert.equal(res1.slideIndex, 2);
    assert.deepEqual(changedTo, [2]);

    // Cursor stays on slide 2 -> no redundant callback
    const res2 = syncPreviewToEditor({
      enabled: true,
      mode: "slide",
      editor: {
        value: md,
        selectionStart: md.indexOf("# Slide 2") + 4,
        scrollTop: 0,
        scrollHeight: 500,
        clientHeight: 500,
      },
      previewViewport,
      currentSlideIndex: 2,
      onSlideChange: (idx) => changedTo.push(idx),
    });

    assert.equal(res2.synced, false);
    assert.equal(res2.slideIndex, 2);
    assert.deepEqual(changedTo, [2]);
  });

  it("does nothing when enabled is false", () => {
    const previewViewport = { scrollTop: 123, scrollHeight: 2000, clientHeight: 500 };
    let slideChanged = false;

    const docRes = syncPreviewToEditor({
      enabled: false,
      mode: "document",
      editor: {
        value: "",
        selectionStart: 0,
        scrollTop: 500,
        scrollHeight: 1500,
        clientHeight: 500,
      },
      previewViewport,
    });
    assert.equal(docRes.synced, false);
    assert.equal(previewViewport.scrollTop, 123);

    const slideRes = syncPreviewToEditor({
      enabled: false,
      mode: "slide",
      editor: {
        value: "# S0\n---\n# S1",
        selectionStart: 12,
        scrollTop: 0,
        scrollHeight: 500,
        clientHeight: 500,
      },
      previewViewport,
      currentSlideIndex: 0,
      onSlideChange: () => {
        slideChanged = true;
      },
    });
    assert.equal(slideRes.synced, false);
    assert.equal(slideChanged, false);
  });
});

describe("outline-and-sync: syncEditorToPreview (bidirectional)", () => {
  it("proportionally syncs editor.scrollTop from previewViewport.scrollTop in document mode", () => {
    const editor = {
      scrollTop: 0,
      scrollHeight: 1500,
      clientHeight: 500, // maxScroll = 1000 -> expected = 500
    };
    const previewViewport = {
      scrollTop: 1000,
      scrollHeight: 2600,
      clientHeight: 600, // maxScroll = 2000 -> ratio = 0.5
    };

    const res = syncEditorToPreview({
      enabled: true,
      mode: "document",
      editor,
      previewViewport,
    });

    assert.equal(res.synced, true);
    assert.equal(res.scrollRatio, 0.5);
    assert.equal(res.targetScrollTop, 500);
    assert.equal(editor.scrollTop, 500);
  });

  it("does nothing when enabled is false or mode is slide", () => {
    const editor = {
      scrollTop: 80,
      scrollHeight: 1500,
      clientHeight: 500,
    };
    const previewViewport = {
      scrollTop: 1000,
      scrollHeight: 2600,
      clientHeight: 600,
    };

    const disabledRes = syncEditorToPreview({
      enabled: false,
      mode: "document",
      editor,
      previewViewport,
    });
    assert.equal(disabledRes.synced, false);
    assert.equal(editor.scrollTop, 80);

    const slideRes = syncEditorToPreview({
      enabled: true,
      mode: "slide",
      editor,
      previewViewport,
    });
    assert.equal(slideRes.synced, false);
    assert.equal(editor.scrollTop, 80);
  });

  it("wires bidirectional scroll events without feedback loops and respects enabled=false", () => {
    const makeScrollTarget = (scrollHeight: number, clientHeight: number) => {
      const listeners = new Map<string, Set<() => void>>();
      return {
        value: "",
        selectionStart: 0,
        scrollTop: 0,
        scrollHeight,
        clientHeight,
        addEventListener(type: string, fn: () => void) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(fn);
        },
        removeEventListener(type: string, fn: () => void) {
          listeners.get(type)?.delete(fn);
        },
        dispatch(type: string) {
          for (const fn of listeners.get(type) ?? []) fn();
        },
      };
    };

    const editor = makeScrollTarget(1500, 500); // maxScroll = 1000
    const preview = makeScrollTarget(2600, 600); // maxScroll = 2000
    let editorScrolledCalls = 0;

    const controller = createEditorPreviewSync({
      editor: editor as unknown as HTMLTextAreaElement,
      previewViewport: preview as unknown as HTMLElement,
      getMode: () => "document",
      getCurrentSlideIndex: () => 0,
      onSlideChange: () => {},
      onEditorScrolled: () => {
        editorScrolledCalls += 1;
      },
      initialEnabled: true,
    });

    try {
      // 1. Preview scrolls to 50% -> editor follows to 50% (500)
      preview.scrollTop = 1000;
      preview.dispatch("scroll");
      assert.equal(editor.scrollTop, 500);
      assert.equal(editorScrolledCalls, 1);

      // Programmatic editor scroll event immediately afterwards must NOT bounce back to preview
      preview.scrollTop = 1005;
      editor.dispatch("scroll");
      assert.equal(preview.scrollTop, 1005);

      // 2. When disabled, neither direction syncs
      controller.setEnabled(false);
      editor.scrollTop = 0;
      preview.scrollTop = 1800;
      preview.dispatch("scroll");
      assert.equal(editor.scrollTop, 0);

      editor.scrollTop = 750;
      editor.dispatch("scroll");
      assert.equal(preview.scrollTop, 1800);
    } finally {
      controller.destroy();
    }
  });
});
