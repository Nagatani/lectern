import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deleteSelectedLines,
  duplicateSelectedLines,
  expandMatchReplacement,
  getCursorLineCol,
  handleSmartEnter,
  indentOrOutdentSelection,
  moveSelectedLines,
  type ReplaceRangeFn,
  wrapSelectionWithPair,
} from "../src/editor-features.ts";

/**
 * Lightweight mock of HTMLTextAreaElement + ReplaceRangeFn for pure logic testing.
 */
function createMockEditor(initialValue: string, selStart: number, selEnd = selStart) {
  const editor = {
    value: initialValue,
    selectionStart: selStart,
    selectionEnd: selEnd,
  } as HTMLTextAreaElement;

  const replaceRange: ReplaceRangeFn = (text, start, end, nextSelStart, nextSelEnd) => {
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    const defaultPos = start + text.length;
    editor.selectionStart = nextSelStart ?? defaultPos;
    editor.selectionEnd = nextSelEnd ?? defaultPos;
  };

  return { editor, replaceRange };
}

describe("editor-features: indentOrOutdentSelection", () => {
  it("inserts 2 spaces at cursor on single-cursor Tab", () => {
    const { editor, replaceRange } = createMockEditor("hello", 2);
    indentOrOutdentSelection(editor, false, replaceRange);
    assert.equal(editor.value, "he  llo");
    assert.equal(editor.selectionStart, 4);
    assert.equal(editor.selectionEnd, 4);
  });

  it("indents all selected lines on multi-line Tab", () => {
    const { editor, replaceRange } = createMockEditor("line1\nline2\nline3", 2, 10);
    indentOrOutdentSelection(editor, false, replaceRange);
    assert.equal(editor.value, "  line1\n  line2\nline3");
    assert.equal(editor.selectionStart, 4);
    assert.equal(editor.selectionEnd, 14);
  });

  it("outdents 2 spaces, 1 space, or 1 tab on Shift+Tab", () => {
    const { editor, replaceRange } = createMockEditor("  a\n b\n\tc\nd", 0, 11);
    indentOrOutdentSelection(editor, true, replaceRange);
    assert.equal(editor.value, "a\nb\nc\nd");
    assert.equal(editor.selectionStart, 0);
    assert.equal(editor.selectionEnd, 7);
  });

  it("does nothing on Shift+Tab when no lines have leading whitespace", () => {
    const { editor, replaceRange } = createMockEditor("alpha\nbeta", 1, 8);
    indentOrOutdentSelection(editor, true, replaceRange);
    assert.equal(editor.value, "alpha\nbeta");
    assert.equal(editor.selectionStart, 1);
    assert.equal(editor.selectionEnd, 8);
  });
});

describe("editor-features: handleSmartEnter", () => {
  it("returns false when text is selected", () => {
    const { editor, replaceRange } = createMockEditor("- item", 2, 6);
    const handled = handleSmartEnter(editor, replaceRange);
    assert.equal(handled, false);
    assert.equal(editor.value, "- item");
  });

  it("continues unordered lists and clears empty bullet on Enter", () => {
    const { editor, replaceRange } = createMockEditor("  - first", 9);
    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "  - first\n  - ");

    // Pressing Enter again on the empty bullet clears the marker
    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "  - first\n");
  });

  it("continues task lists as unchecked [ ] even after [x]", () => {
    const { editor, replaceRange } = createMockEditor("- [x] done", 10);
    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "- [x] done\n- [ ] ");

    // Empty task marker clears on Enter
    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "- [x] done\n");
  });

  it("increments ordered list numbers and clears empty item", () => {
    const { editor, replaceRange } = createMockEditor("  1. step one", 13);
    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "  1. step one\n  2. ");

    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "  1. step one\n");
  });

  it("continues blockquotes and clears empty blockquote", () => {
    const { editor, replaceRange } = createMockEditor("> quote text", 12);
    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "> quote text\n> ");

    assert.equal(handleSmartEnter(editor, replaceRange), true);
    assert.equal(editor.value, "> quote text\n");
  });

  it("preserves plain indentation and returns false for unindented plain text", () => {
    const indented = createMockEditor("    code()", 10);
    assert.equal(handleSmartEnter(indented.editor, indented.replaceRange), true);
    assert.equal(indented.editor.value, "    code()\n    ");

    const plain = createMockEditor("plain line", 10);
    assert.equal(handleSmartEnter(plain.editor, plain.replaceRange), false);
  });
});

describe("editor-features: duplicateSelectedLines / deleteSelectedLines / moveSelectedLines", () => {
  it("duplicates current line and shifts cursor to duplicated line", () => {
    const { editor, replaceRange } = createMockEditor("one\ntwo\nthree", 5);
    duplicateSelectedLines(editor, replaceRange);
    assert.equal(editor.value, "one\ntwo\ntwo\nthree");
    assert.equal(editor.selectionStart, 9);
    assert.equal(editor.selectionEnd, 9);
  });

  it("duplicates multi-line selection", () => {
    const { editor, replaceRange } = createMockEditor("a\nb\nc", 0, 3);
    duplicateSelectedLines(editor, replaceRange);
    assert.equal(editor.value, "a\nb\na\nb\nc");
  });

  it("deletes middle, first, and last lines cleanly", () => {
    // Middle line
    const mid = createMockEditor("one\ntwo\nthree", 5);
    deleteSelectedLines(mid.editor, mid.replaceRange);
    assert.equal(mid.editor.value, "one\nthree");
    assert.equal(mid.editor.selectionStart, 4);

    // Last line (removes preceding newline)
    const last = createMockEditor("one\ntwo", 5);
    deleteSelectedLines(last.editor, last.replaceRange);
    assert.equal(last.editor.value, "one");
    assert.equal(last.editor.selectionStart, 3);

    // Single line
    const only = createMockEditor("solo", 2);
    deleteSelectedLines(only.editor, only.replaceRange);
    assert.equal(only.editor.value, "");
    assert.equal(only.editor.selectionStart, 0);
  });

  it("moves lines up and down and respects document boundaries", () => {
    const { editor, replaceRange } = createMockEditor("first\nsecond\nthird", 8);
    // Move "second" up -> "second\nfirst\nthird"
    moveSelectedLines(editor, -1, replaceRange);
    assert.equal(editor.value, "second\nfirst\nthird");
    assert.equal(editor.selectionStart, 2);

    // Moving up at top line is a no-op
    moveSelectedLines(editor, -1, replaceRange);
    assert.equal(editor.value, "second\nfirst\nthird");

    // Move "second" down twice -> bottom
    moveSelectedLines(editor, 1, replaceRange);
    assert.equal(editor.value, "first\nsecond\nthird");
    moveSelectedLines(editor, 1, replaceRange);
    assert.equal(editor.value, "first\nthird\nsecond");

    // Moving down at bottom line is a no-op
    moveSelectedLines(editor, 1, replaceRange);
    assert.equal(editor.value, "first\nthird\nsecond");
  });
});

describe("editor-features: wrapSelectionWithPair", () => {
  it("wraps selected text with matching pair and preserves inner selection", () => {
    const cases: Array<[string, string, string]> = [
      ["*", "hello", "*hello*"],
      ["`", "code", "`code`"],
      ["(", "expr", "(expr)"],
      ["[", "link", "[link]"],
      ["「", "重要", "「重要」"],
      ["（", "補足", "（補足）"],
      ["$", "x+1", "$x+1$"],
    ];

    for (const [open, word, expected] of cases) {
      const { editor, replaceRange } = createMockEditor(`a ${word} b`, 2, 2 + word.length);
      const handled = wrapSelectionWithPair(editor, open, replaceRange);
      assert.equal(handled, true);
      assert.equal(editor.value, `a ${expected} b`);
      assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), word);
    }
  });

  it("returns false when no text is selected or key is not a pair", () => {
    const noSel = createMockEditor("hello", 2, 2);
    assert.equal(wrapSelectionWithPair(noSel.editor, "*", noSel.replaceRange), false);

    const nonPair = createMockEditor("hello", 1, 4);
    assert.equal(wrapSelectionWithPair(nonPair.editor, "a", nonPair.replaceRange), false);
  });
});

describe("editor-features: getCursorLineCol", () => {
  it("computes 1-based line and column accurately across lines and CJK characters", () => {
    const text = "一行目\nsecond line\n三行目";
    assert.deepEqual(getCursorLineCol({ value: text, selectionStart: 0 } as HTMLTextAreaElement), {
      line: 1,
      col: 1,
    });
    assert.deepEqual(getCursorLineCol({ value: text, selectionStart: 3 } as HTMLTextAreaElement), {
      line: 1,
      col: 4,
    });
    assert.deepEqual(getCursorLineCol({ value: text, selectionStart: 4 } as HTMLTextAreaElement), {
      line: 2,
      col: 1,
    });
    assert.deepEqual(getCursorLineCol({ value: text, selectionStart: 16 } as HTMLTextAreaElement), {
      line: 3,
      col: 1,
    });
    assert.deepEqual(getCursorLineCol({ value: text, selectionStart: text.length } as HTMLTextAreaElement), {
      line: 3,
      col: 4,
    });
  });
});

describe("editor-features: regression tests (empty first line & regex replacement)", () => {
  it("handles empty first line at offset 0 without corrupting text", () => {
    // Duplicate empty first line
    const dup = createMockEditor("\nhello", 0);
    duplicateSelectedLines(dup.editor, dup.replaceRange);
    assert.equal(dup.editor.value, "\n\nhello");
    assert.equal(dup.editor.selectionStart, 1);

    // Delete empty first line
    const del = createMockEditor("\nhello", 0);
    deleteSelectedLines(del.editor, del.replaceRange);
    assert.equal(del.editor.value, "hello");
    assert.equal(del.editor.selectionStart, 0);

    // Move line 2 up into empty line 1
    const mov = createMockEditor("\nhello", 3);
    moveSelectedLines(mov.editor, -1, mov.replaceRange);
    assert.equal(mov.editor.value, "hello\n");
    assert.equal(mov.editor.selectionStart, 2);

    // Smart Enter at offset 0 on empty first line returns false cleanly
    const ent = createMockEditor("\nhello", 0);
    assert.equal(handleSmartEnter(ent.editor, ent.replaceRange), false);
    assert.equal(ent.editor.value, "\nhello");

    // Shift+Tab at offset 0 on empty first line is a clean no-op
    const out = createMockEditor("\nhello", 0);
    indentOrOutdentSelection(out.editor, true, out.replaceRange);
    assert.equal(out.editor.value, "\nhello");
  });

  it("expands regex capture groups when useRegex is true and preserves literals when false", () => {
    assert.equal(
      expandMatchReplacement("item-42", "(\\w+)-(\\d+)", "$2:$1", true, false),
      "42:item"
    );
    assert.equal(
      expandMatchReplacement("FOO-7", "(foo)-(\\d+)", "$2_$1", true, false),
      "7_FOO"
    );
    assert.equal(
      expandMatchReplacement("item-42", "item-42", "$2:$1", false, false),
      "$2:$1"
    );
  });
});

