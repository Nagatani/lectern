/**
 * Essential text editor features for Lectern's Markdown <textarea> editor:
 * - Multi-line & single-line Tab / Shift+Tab indent & outdent
 * - Smart Enter (auto-indent + Markdown list / task-list / numbered list / blockquote continuation)
 * - Duplicate line (Cmd/Ctrl+Shift+D), Delete line (Cmd/Ctrl+Shift+K), Move line up/down (Alt+Up/Down)
 * - Wrap selection with paired characters (`*`, `` ` ``, `"`, `(`, `[`, `{`, `「`, `（`, etc.)
 * - Cursor line/column tracking & Go to Line (Cmd/Ctrl+G)
 * - Inline Find & Replace bar (Cmd/Ctrl+F, Cmd/Ctrl+H) with case-sensitive & regex toggles
 *
 * Every text mutation delegates to `replaceRange` (which uses `execCommand("insertText")`
 * under the hood) so OS-native Undo / Redo (`Cmd+Z` / `Cmd+Shift+Z`) works seamlessly.
 */

export type ReplaceRangeFn = (
  text: string,
  start: number,
  end: number,
  nextSelStart?: number,
  nextSelEnd?: number
) => void;

const INDENT = "  ";

function getLineBounds(value: string, start: number, end: number): { blockStart: number; blockEnd: number } {
  const blockStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  // If selection ends right at the start of a new line (after a newline), don't include that extra line
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextNewline = value.indexOf("\n", effectiveEnd);
  const blockEnd = nextNewline === -1 ? value.length : nextNewline;
  return { blockStart, blockEnd };
}

/**
 * Tab / Shift+Tab indent & outdent for both single-line and multi-line selections.
 */
export function indentOrOutdentSelection(
  editor: HTMLTextAreaElement,
  outdent: boolean,
  replaceRange: ReplaceRangeFn
): void {
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = value.slice(start, end);

  // Simple single-cursor Tab -> insert 2 spaces
  if (!outdent && start === end) {
    replaceRange(INDENT, start, end, start + INDENT.length, start + INDENT.length);
    return;
  }

  // Multi-line Tab or any Shift+Tab -> indent/outdent all touched lines
  const { blockStart, blockEnd } = getLineBounds(value, start, end);
  const block = value.slice(blockStart, blockEnd);
  const lines = block.split("\n");

  let firstLineDelta = 0;
  let totalDelta = 0;

  const updatedLines = lines.map((line, idx) => {
    if (!outdent) {
      if (idx === 0) firstLineDelta = INDENT.length;
      totalDelta += INDENT.length;
      return INDENT + line;
    } else {
      let removed = 0;
      if (line.startsWith("\t")) {
        removed = 1;
      } else if (line.startsWith("  ")) {
        removed = 2;
      } else if (line.startsWith(" ")) {
        removed = 1;
      }
      if (idx === 0) firstLineDelta = -removed;
      totalDelta -= removed;
      return line.slice(removed);
    }
  });

  if (totalDelta === 0 && outdent) {
    return;
  }

  const nextBlock = updatedLines.join("\n");
  const nextStart = Math.max(blockStart, start + firstLineDelta);
  const nextEnd = Math.max(nextStart, end + totalDelta);

  // If single-line selection had no newline on Tab, keep whole line selection or adjusted selection
  if (!outdent && !selected.includes("\n")) {
    replaceRange(nextBlock, blockStart, blockEnd, nextStart, nextEnd);
  } else {
    replaceRange(nextBlock, blockStart, blockEnd, nextStart, nextEnd);
  }
}

/**
 * Smart Enter: preserves indentation and continues Markdown lists / task lists / numbered lists / blockquotes.
 * Pressing Enter on an empty list marker clears the marker cleanly.
 * Returns true if handled (preventing default newline), false to let browser insert normal newline.
 */
export function handleSmartEnter(
  editor: HTMLTextAreaElement,
  replaceRange: ReplaceRangeFn
): boolean {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start !== end) return false;

  const value = editor.value;
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const beforeCursor = value.slice(lineStart, start);

  // 1. Task list: `  - [ ] text` or `  - [x] text`
  const taskMatch = /^(\s*[-*+]\s+\[[ xX]\]\s+)(.*)$/.exec(beforeCursor);
  if (taskMatch) {
    const [, prefix, rest] = taskMatch;
    if (rest.trim() === "") {
      // Clear empty task list marker
      replaceRange("", lineStart, start, lineStart, lineStart);
      return true;
    }
    const nextPrefix = prefix.replace(/\[[xX]\]/, "[ ]");
    const insertion = `\n${nextPrefix}`;
    replaceRange(insertion, start, end, start + insertion.length, start + insertion.length);
    return true;
  }

  // 2. Unordered list: `  - item`, `  * item`, `  + item`
  const ulMatch = /^(\s*[-*+]\s+)(.*)$/.exec(beforeCursor);
  if (ulMatch) {
    const [, prefix, rest] = ulMatch;
    if (rest.trim() === "") {
      replaceRange("", lineStart, start, lineStart, lineStart);
      return true;
    }
    const insertion = `\n${prefix}`;
    replaceRange(insertion, start, end, start + insertion.length, start + insertion.length);
    return true;
  }

  // 3. Ordered list: `  1. item`
  const olMatch = /^(\s*)(\d+)(\.\s+)(.*)$/.exec(beforeCursor);
  if (olMatch) {
    const [, indent, numStr, dotSpace, rest] = olMatch;
    if (rest.trim() === "") {
      replaceRange("", lineStart, start, lineStart, lineStart);
      return true;
    }
    const nextNum = parseInt(numStr, 10) + 1;
    const insertion = `\n${indent}${nextNum}${dotSpace}`;
    replaceRange(insertion, start, end, start + insertion.length, start + insertion.length);
    return true;
  }

  // 4. Blockquote: `> text`
  const quoteMatch = /^(\s*>+\s?)(.*)$/.exec(beforeCursor);
  if (quoteMatch) {
    const [, prefix, rest] = quoteMatch;
    if (rest.trim() === "") {
      replaceRange("", lineStart, start, lineStart, lineStart);
      return true;
    }
    const insertion = `\n${prefix}`;
    replaceRange(insertion, start, end, start + insertion.length, start + insertion.length);
    return true;
  }

  // 5. Plain auto-indent (preserve leading whitespace)
  const indentMatch = /^([ \t]+)/.exec(beforeCursor);
  if (indentMatch) {
    const insertion = `\n${indentMatch[1]}`;
    replaceRange(insertion, start, end, start + insertion.length, start + insertion.length);
    return true;
  }

  return false;
}

/**
 * Duplicate current line or selected lines below (`Cmd/Ctrl+Shift+D`).
 */
export function duplicateSelectedLines(
  editor: HTMLTextAreaElement,
  replaceRange: ReplaceRangeFn
): void {
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const { blockStart, blockEnd } = getLineBounds(value, start, end);
  const block = value.slice(blockStart, blockEnd);
  const insertion = `\n${block}`;
  const shift = block.length + 1;
  replaceRange(insertion, blockEnd, blockEnd, start + shift, end + shift);
}

/**
 * Delete current line or selected lines (`Cmd/Ctrl+Shift+K`).
 */
export function deleteSelectedLines(
  editor: HTMLTextAreaElement,
  replaceRange: ReplaceRangeFn
): void {
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const { blockStart, blockEnd } = getLineBounds(value, start, end);

  let delStart = blockStart;
  let delEnd = blockEnd;
  if (delEnd < value.length && value[delEnd] === "\n") {
    delEnd += 1;
  } else if (delStart > 0 && value[delStart - 1] === "\n") {
    delStart -= 1;
  }

  replaceRange("", delStart, delEnd, delStart, delStart);
}

/**
 * Move current line or selected lines up (-1) or down (+1) (`Alt+ArrowUp` / `Alt+ArrowDown`).
 */
export function moveSelectedLines(
  editor: HTMLTextAreaElement,
  direction: -1 | 1,
  replaceRange: ReplaceRangeFn
): void {
  const value = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const { blockStart, blockEnd } = getLineBounds(value, start, end);
  const block = value.slice(blockStart, blockEnd);

  if (direction === -1) {
    if (blockStart === 0) return;
    const prevLineEnd = blockStart - 1;
    const prevLineStart = prevLineEnd === 0 ? 0 : value.lastIndexOf("\n", prevLineEnd - 1) + 1;
    const prevLine = value.slice(prevLineStart, prevLineEnd);
    const swapped = `${block}\n${prevLine}`;
    const delta = -(prevLine.length + 1);
    replaceRange(swapped, prevLineStart, blockEnd, start + delta, end + delta);
  } else {
    if (blockEnd >= value.length) return;
    const nextLineStart = blockEnd + 1;
    const nextNewline = value.indexOf("\n", nextLineStart);
    const nextLineEnd = nextNewline === -1 ? value.length : nextNewline;
    const nextLine = value.slice(nextLineStart, nextLineEnd);
    const swapped = `${nextLine}\n${block}`;
    const delta = nextLine.length + 1;
    replaceRange(swapped, blockStart, nextLineEnd, start + delta, end + delta);
  }
}

const WRAP_PAIRS: Record<string, string> = {
  "`": "`",
  "*": "*",
  "_": "_",
  "~": "~",
  '"': '"',
  "'": "'",
  "(": ")",
  "[": "]",
  "{": "}",
  "「": "」",
  "（": "）",
  "$": "$",
};

/**
 * If text is currently selected and the user types an opening pair character,
 * wrap the selected text instead of overwriting it.
 */
export function wrapSelectionWithPair(
  editor: HTMLTextAreaElement,
  key: string,
  replaceRange: ReplaceRangeFn
): boolean {
  const close = WRAP_PAIRS[key];
  if (!close) return false;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start === end) return false;

  const selected = editor.value.slice(start, end);
  const wrapped = `${key}${selected}${close}`;
  replaceRange(wrapped, start, end, start + key.length, end + key.length);
  return true;
}

export function getCursorLineCol(editor: HTMLTextAreaElement): { line: number; col: number } {
  const before = editor.value.slice(0, editor.selectionStart);
  const lastNl = before.lastIndexOf("\n");
  const line = before.split("\n").length;
  const col = lastNl === -1 ? before.length + 1 : before.length - lastNl;
  return { line, col };
}

export function scrollEditorToOffset(editor: HTMLTextAreaElement, offset: number): void {
  const before = editor.value.slice(0, offset);
  const lineIndex = before.split("\n").length - 1;
  const computed = window.getComputedStyle(editor);
  const lineHeight = parseFloat(computed.lineHeight) || 21.6;
  const targetTop = Math.max(0, lineIndex * lineHeight - editor.clientHeight * 0.35);
  editor.scrollTop = targetTop;
  editor.dispatchEvent(new Event("scroll"));
}

export function jumpToLine(editor: HTMLTextAreaElement, targetLine: number): void {
  const lines = editor.value.split("\n");
  const clamped = Math.min(lines.length, Math.max(1, targetLine));
  let offset = 0;
  for (let i = 0; i < clamped - 1; i++) {
    offset += lines[i].length + 1;
  }
  const lineEnd = offset + lines[clamped - 1].length;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(offset, lineEnd);
  scrollEditorToOffset(editor, offset);
}

// ============================================================================
// Inline Find & Replace Controller
// ============================================================================

export interface FindReplaceController {
  openFind: (showReplace?: boolean) => void;
  close: () => void;
  refreshMatches: () => void;
}

interface MatchSpan {
  start: number;
  end: number;
}

export function expandMatchReplacement(
  matchedText: string,
  query: string,
  replacement: string,
  useRegex: boolean,
  caseSensitive: boolean
): string {
  if (!useRegex) {
    return replacement;
  }
  try {
    return matchedText.replace(new RegExp(query, caseSensitive ? "" : "i"), replacement);
  } catch (_) {
    return replacement;
  }
}

export function setupFindReplaceBar(
  editor: HTMLTextAreaElement,
  replaceRange: ReplaceRangeFn,
  onStatus: (msg: string) => void
): FindReplaceController {
  const elBar = document.getElementById("find-replace-bar") as HTMLElement;
  const elFindInput = document.getElementById("find-input") as HTMLInputElement;
  const elReplaceRow = document.getElementById("replace-row") as HTMLDivElement;
  const elReplaceInput = document.getElementById("replace-input") as HTMLInputElement;
  const elMatchCount = document.getElementById("find-match-count") as HTMLSpanElement;
  const btnCase = document.getElementById("btn-find-case") as HTMLButtonElement;
  const btnRegex = document.getElementById("btn-find-regex") as HTMLButtonElement;
  const btnPrev = document.getElementById("btn-find-prev") as HTMLButtonElement;
  const btnNext = document.getElementById("btn-find-next") as HTMLButtonElement;
  const btnToggleReplace = document.getElementById("btn-toggle-replace") as HTMLButtonElement;
  const btnClose = document.getElementById("btn-find-close") as HTMLButtonElement;
  const btnReplaceOne = document.getElementById("btn-replace-one") as HTMLButtonElement;
  const btnReplaceAll = document.getElementById("btn-replace-all") as HTMLButtonElement;

  let caseSensitive = false;
  let useRegex = false;
  let matches: MatchSpan[] = [];
  let currentMatchIdx = -1;

  function buildSearchRegex(query: string): RegExp | null {
    if (!query) return null;
    const flags = caseSensitive ? "g" : "gi";
    try {
      const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(pattern, flags);
    } catch (_) {
      return null;
    }
  }

  function computeMatches(): void {
    const query = elFindInput.value;
    matches = [];
    elFindInput.classList.remove("invalid");

    if (!query) {
      currentMatchIdx = -1;
      elMatchCount.textContent = "0 / 0";
      return;
    }

    const regex = buildSearchRegex(query);
    if (!regex) {
      currentMatchIdx = -1;
      elFindInput.classList.add("invalid");
      elMatchCount.textContent = "正規表現エラー";
      return;
    }

    const text = editor.value;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (matches.length >= 5000) break;
    }

    if (matches.length === 0) {
      currentMatchIdx = -1;
      elMatchCount.textContent = "0 / 0";
    } else {
      if (currentMatchIdx < 0 || currentMatchIdx >= matches.length) {
        const cursor = editor.selectionStart;
        const nextIdx = matches.findIndex((s) => s.start >= cursor);
        currentMatchIdx = nextIdx === -1 ? 0 : nextIdx;
      }
      elMatchCount.textContent = `${currentMatchIdx + 1} / ${matches.length}`;
    }
  }

  function selectMatch(idx: number, focusEditor = false): void {
    if (matches.length === 0) return;
    currentMatchIdx = ((idx % matches.length) + matches.length) % matches.length;
    const span = matches[currentMatchIdx];
    elMatchCount.textContent = `${currentMatchIdx + 1} / ${matches.length}`;
    if (focusEditor) {
      editor.focus({ preventScroll: true });
    }
    editor.setSelectionRange(span.start, span.end);
    scrollEditorToOffset(editor, span.start);
  }

  function findNext(): void {
    computeMatches();
    if (matches.length === 0) return;
    const cursor = editor.selectionEnd;
    const nextIdx = matches.findIndex((s) => s.start >= cursor);
    selectMatch(nextIdx === -1 ? 0 : nextIdx, false);
  }

  function findPrev(): void {
    computeMatches();
    if (matches.length === 0) return;
    const cursor = editor.selectionStart;
    let prevIdx = -1;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].start < cursor) {
        prevIdx = i;
        break;
      }
    }
    selectMatch(prevIdx === -1 ? matches.length - 1 : prevIdx, false);
  }

  function replaceCurrent(): void {
    computeMatches();
    if (matches.length === 0) return;

    // Check if current editor selection already matches one of the spans
    const selStart = editor.selectionStart;
    const selEnd = editor.selectionEnd;
    let targetIdx = matches.findIndex((s) => s.start === selStart && s.end === selEnd);
    if (targetIdx === -1) {
      selectMatch(currentMatchIdx >= 0 ? currentMatchIdx : 0, false);
      return;
    }

    const span = matches[targetIdx];
    const matchedText = editor.value.slice(span.start, span.end);
    const replacement = expandMatchReplacement(
      matchedText,
      elFindInput.value,
      elReplaceInput.value,
      useRegex,
      caseSensitive
    );
    replaceRange(replacement, span.start, span.end, span.start + replacement.length, span.start + replacement.length);
    computeMatches();
    if (matches.length > 0) {
      selectMatch(targetIdx < matches.length ? targetIdx : 0, false);
    }
    elFindInput.focus();
  }

  function replaceAll(): void {
    const query = elFindInput.value;
    const regex = buildSearchRegex(query);
    if (!regex) return;

    const original = editor.value;
    const replacement = elReplaceInput.value;
    let count = 0;
    const replaced = original.replace(regex, (match) => {
      count += 1;
      return expandMatchReplacement(match, query, replacement, useRegex, caseSensitive);
    });

    if (count === 0) {
      onStatus("置換対象が見つかりませんでした");
      return;
    }

    replaceRange(replaced, 0, original.length, 0, 0);
    computeMatches();
    onStatus(`${count} 件を置換しました (Cmd+Z / Ctrl+Z で元に戻せます)`);
    elFindInput.focus();
  }

  function openFind(showReplace = false): void {
    elBar.hidden = false;
    elReplaceRow.hidden = !showReplace;
    btnToggleReplace.setAttribute("aria-expanded", String(showReplace));

    // Pre-fill with current single-line selection if available
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selected && !selected.includes("\n") && selected.length <= 120) {
      elFindInput.value = selected;
    }

    computeMatches();
    if (showReplace && elFindInput.value) {
      elReplaceInput.focus();
      elReplaceInput.select();
    } else {
      elFindInput.focus();
      elFindInput.select();
    }
  }

  function close(): void {
    elBar.hidden = true;
    editor.focus({ preventScroll: true });
  }

  // Event bindings
  elFindInput.addEventListener("input", () => {
    currentMatchIdx = -1;
    computeMatches();
    if (matches.length > 0) {
      selectMatch(currentMatchIdx, false);
    }
  });

  // IME-safe Enter handling in Find input (`isComposing || keyCode === 229`)
  elFindInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
    }
  });

  elReplaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) return;
      replaceCurrent();
    }
  });

  btnCase.addEventListener("click", () => {
    caseSensitive = !caseSensitive;
    btnCase.setAttribute("aria-pressed", String(caseSensitive));
    currentMatchIdx = -1;
    computeMatches();
  });

  btnRegex.addEventListener("click", () => {
    useRegex = !useRegex;
    btnRegex.setAttribute("aria-pressed", String(useRegex));
    currentMatchIdx = -1;
    computeMatches();
  });

  btnNext.addEventListener("click", () => findNext());
  btnPrev.addEventListener("click", () => findPrev());
  btnToggleReplace.addEventListener("click", () => {
    const nextShow = elReplaceRow.hidden;
    elReplaceRow.hidden = !nextShow;
    btnToggleReplace.setAttribute("aria-expanded", String(nextShow));
    if (nextShow) {
      elReplaceInput.focus();
    }
  });
  btnClose.addEventListener("click", () => close());
  btnReplaceOne.addEventListener("click", () => replaceCurrent());
  btnReplaceAll.addEventListener("click", () => replaceAll());

  return {
    openFind,
    close,
    refreshMatches: () => {
      if (!elBar.hidden) computeMatches();
    },
  };
}
