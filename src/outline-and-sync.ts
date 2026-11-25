/// <reference types="vite/client" />

// Load component styles only in browser/Vite environments so pure helpers
// remain directly importable in Node's `node:test` runner without CSS loaders.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  void import("./outline-and-sync.css").catch(() => {
    // Ignore when running under mocked DOM environments without CSS loader support
  });
}

// ============================================================================
// Public Types
// ============================================================================

export interface HeadingItem {
  level: 1 | 2 | 3;
  text: string;
  /** 1-based line number in the markdown document. */
  line: number;
  /** 0-based UTF-16 character offset of the start of the heading line. */
  offset: number;
}

export type SyncRenderMode = "document" | "slide";

export interface OutlineQuickJumpDeps {
  /** Return the current markdown document content. */
  getMarkdown: () => string;
  /** Called when the user selects a heading to jump to. */
  onSelectHeading: (heading: HeadingItem) => void;
  /** Optional: return current 1-based cursor line to pre-highlight the active heading. */
  getCurrentLine?: () => number;
  /** Optional: callback for status bar notifications. */
  onStatus?: (message: string) => void;
}

export interface OutlineQuickJumpController {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
  element: HTMLDialogElement;
}

export interface SyncPreviewToEditorOptions {
  /** Whether synchronization is enabled (defaults to true). */
  enabled?: boolean;
  /** Active preview mode ("document" | "slide"). */
  mode: SyncRenderMode;
  /** Markdown editor textarea (or minimal compatible object for testing). */
  editor: Pick<
    HTMLTextAreaElement,
    "value" | "selectionStart" | "scrollTop" | "scrollHeight" | "clientHeight"
  >;
  /** Preview scroll container (used in "document" mode). */
  previewViewport: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight"> & {
    scrollTo?: (options: ScrollToOptions) => void;
  };
  /** Current active slide index in "slide" mode (avoids redundant callbacks). */
  currentSlideIndex?: number;
  /** Callback invoked in "slide" mode when the cursor moves to a different slide. */
  onSlideChange?: (slideIndex: number) => void;
  /** Use smooth scroll behavior in "document" mode (defaults to false for responsive scroll tracking). */
  smooth?: boolean;
}

export interface SyncEditorToPreviewOptions {
  /** Whether synchronization is enabled (defaults to true). */
  enabled?: boolean;
  /** Active preview mode ("document" | "slide"). */
  mode: SyncRenderMode;
  /** Markdown editor textarea (or minimal compatible object for testing). */
  editor: Pick<HTMLTextAreaElement, "scrollTop" | "scrollHeight" | "clientHeight"> & {
    scrollTo?: (options: ScrollToOptions) => void;
  };
  /** Preview scroll container (used in "document" mode). */
  previewViewport: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;
  /** Use smooth scroll behavior in "document" mode (defaults to false for responsive scroll tracking). */
  smooth?: boolean;
}

export interface SyncPreviewResult {
  synced: boolean;
  mode: SyncRenderMode;
  scrollRatio?: number;
  targetScrollTop?: number;
  slideIndex?: number;
}

export interface EditorPreviewSyncDeps {
  editor: HTMLTextAreaElement;
  previewViewport: HTMLElement;
  getMode: () => SyncRenderMode;
  getCurrentSlideIndex: () => number;
  onSlideChange: (slideIndex: number) => void;
  /** Optional callback invoked immediately after preview-to-editor scroll updates `editor.scrollTop`. */
  onEditorScrolled?: () => void;
  /** Initial enabled state (defaults to true, or restored from storageKey if provided). */
  initialEnabled?: boolean;
  /** Optional localStorage key to persist the enabled toggle. */
  storageKey?: string;
  /** Optional callback when enabled state changes. */
  onEnabledChange?: (enabled: boolean) => void;
}

export interface EditorPreviewSyncController {
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => boolean;
  syncNow: (opts?: { smooth?: boolean }) => SyncPreviewResult;
  destroy: () => void;
}

// ============================================================================
// Internal Line & Fence Helpers (matching src-tauri/src/converter.rs)
// ============================================================================

interface IndexedLine {
  text: string;
  startOffset: number;
  endOffset: number;
  line: number;
}

function splitLinesWithOffsets(markdown: string): IndexedLine[] {
  const lines: IndexedLine[] = [];
  let start = 0;
  let lineNum = 1;

  while (start <= markdown.length) {
    const nlIdx = markdown.indexOf("\n", start);
    if (nlIdx === -1) {
      const raw = markdown.slice(start);
      const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      lines.push({
        text,
        startOffset: start,
        endOffset: markdown.length,
        line: lineNum,
      });
      break;
    }

    const raw = markdown.slice(start, nlIdx);
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    lines.push({
      text,
      startOffset: start,
      endOffset: nlIdx,
      line: lineNum,
    });
    start = nlIdx + 1;
    lineNum += 1;
  }

  return lines;
}

/**
 * Returns the 0-based line index of the closing `---` of a leading YAML frontmatter block,
 * or -1 if the document does not start with a closed YAML frontmatter block.
 */
function findFrontmatterEndLineIndex(lines: IndexedLine[]): number {
  if (lines.length < 2 || lines[0].text !== "---") {
    return -1;
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].text === "---") {
      return i;
    }
  }
  return -1;
}

/**
 * CommonMark fenced code block tracker mirroring `FenceTracker` in `converter.rs`.
 * Tracks both fence character (`` ` `` or `~`) and opening fence length (>= 3).
 */
class FenceTracker {
  private active: { char: "`" | "~"; len: number } | null = null;

  isInFence(): boolean {
    return this.active !== null;
  }

  /**
   * Processes one line and returns true if this line is inside a fenced code block
   * (including both the opening and closing fence lines).
   */
  processLine(line: string): boolean {
    const trimmed = line.trimStart();

    if (this.active) {
      const { char, len } = this.active;
      let count = 0;
      while (count < trimmed.length && trimmed[count] === char) {
        count += 1;
      }
      if (count >= len && trimmed.slice(count).trim().length === 0) {
        this.active = null;
      }
      return true;
    }

    const first = trimmed[0];
    if (first === "`" || first === "~") {
      let count = 0;
      while (count < trimmed.length && trimmed[count] === first) {
        count += 1;
      }
      const info = trimmed.slice(count);
      // CommonMark: backtick fence info string cannot contain backticks
      if (count >= 3 && (first === "~" || !info.includes("`"))) {
        this.active = { char: first, len: count };
        return true;
      }
    }

    return false;
  }
}

// ============================================================================
// 1. Pure Helpers: Heading Extraction, Filtering & Cursor Slide Index
// ============================================================================

const ATX_HEADING_RE = /^[ \t]{0,3}(#{1,3})[ \t]+(.+?)$/;

/**
 * Extracts H1-H3 ATX markdown headings while accurately skipping leading YAML
 * frontmatter (`--- ... ---`) and CommonMark fenced code blocks (`` ` `` / `~`).
 */
export function extractMarkdownHeadings(markdown: string): HeadingItem[] {
  if (!markdown) return [];

  const lines = splitLinesWithOffsets(markdown);
  const fmEnd = findFrontmatterEndLineIndex(lines);
  const startIdx = fmEnd >= 0 ? fmEnd + 1 : 0;

  const fence = new FenceTracker();
  const headings: HeadingItem[] = [];

  for (let i = startIdx; i < lines.length; i += 1) {
    const entry = lines[i];
    if (fence.processLine(entry.text)) {
      continue;
    }

    const match = ATX_HEADING_RE.exec(entry.text);
    if (!match) continue;

    const level = match[1].length as 1 | 2 | 3;
    // Strip optional CommonMark closing `#` sequence preceded by space/tab
    const text = match[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (!text) continue;

    headings.push({
      level,
      text,
      line: entry.line,
      offset: entry.startOffset,
    });
  }

  return headings;
}

/**
 * Filters headings by case-insensitive, whitespace-separated query tokens.
 */
export function filterHeadings(headings: HeadingItem[], query: string): HeadingItem[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return headings;

  return headings.filter((h) => {
    const haystack = `${h.text} h${h.level} l${h.line}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Computes the 0-based slide index at `cursorOffset`, skipping leading YAML
 * frontmatter and fenced code blocks, and splitting on standalone `---` lines
 * (matching `split_slides` in `src-tauri/src/converter.rs`).
 */
export function getSlideIndexAtCursor(markdown: string, cursorOffset: number): number {
  if (!markdown) return 0;

  const clampedOffset = Math.max(0, Math.min(cursorOffset, markdown.length));
  const lines = splitLinesWithOffsets(markdown);
  const fmEnd = findFrontmatterEndLineIndex(lines);

  if (fmEnd >= 0 && clampedOffset <= lines[fmEnd].endOffset) {
    return 0;
  }

  const startIdx = fmEnd >= 0 ? fmEnd + 1 : 0;
  const fence = new FenceTracker();

  let currentSlideIndex = 0;
  let currentHasContent = false;
  let cursorSlideIndex: number | null = null;

  for (let i = startIdx; i < lines.length; i += 1) {
    const entry = lines[i];
    const wasInFence = fence.isInFence();
    const isFenceLine = fence.processLine(entry.text);
    const isSeparator = !wasInFence && !isFenceLine && entry.text.trim() === "---";

    if (cursorSlideIndex === null && clampedOffset <= entry.endOffset) {
      cursorSlideIndex = currentSlideIndex;
    }

    if (isSeparator) {
      if (currentHasContent) {
        currentSlideIndex += 1;
        currentHasContent = false;
      }
      continue;
    }

    if (entry.text.trim().length > 0) {
      currentHasContent = true;
    }
  }

  const totalSlides =
    currentHasContent || currentSlideIndex === 0 ? currentSlideIndex + 1 : currentSlideIndex;
  const resolved = cursorSlideIndex ?? currentSlideIndex;
  return Math.max(0, Math.min(resolved, totalSlides - 1));
}

// ============================================================================
// 2. Editor-to-Preview Synchronization
// ============================================================================

/**
 * Synchronizes the preview pane with the editor's scroll or cursor position:
 * - In `"document"` mode: proportionally maps `editor.scrollTop` to `previewViewport.scrollTop`.
 * - In `"slide"` mode: computes the 0-based slide index at `editor.selectionStart` and calls
 *   `onSlideChange(idx)` when the cursor enters a different slide.
 */
export function syncPreviewToEditor(opts: SyncPreviewToEditorOptions): SyncPreviewResult {
  if (opts.enabled === false) {
    return { synced: false, mode: opts.mode };
  }

  if (opts.mode === "document") {
    const editorMaxScroll = Math.max(0, opts.editor.scrollHeight - opts.editor.clientHeight);
    const previewMaxScroll = Math.max(
      0,
      opts.previewViewport.scrollHeight - opts.previewViewport.clientHeight
    );

    const scrollRatio =
      editorMaxScroll > 0 ? Math.min(1, Math.max(0, opts.editor.scrollTop / editorMaxScroll)) : 0;
    const targetScrollTop = Math.round(scrollRatio * previewMaxScroll);

    if (opts.smooth && typeof opts.previewViewport.scrollTo === "function") {
      opts.previewViewport.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    } else {
      opts.previewViewport.scrollTop = targetScrollTop;
    }

    return {
      synced: true,
      mode: "document",
      scrollRatio,
      targetScrollTop,
    };
  }

  // Slide mode
  const slideIndex = getSlideIndexAtCursor(opts.editor.value, opts.editor.selectionStart ?? 0);
  if (
    opts.onSlideChange &&
    (opts.currentSlideIndex === undefined || slideIndex !== opts.currentSlideIndex)
  ) {
    opts.onSlideChange(slideIndex);
    return {
      synced: true,
      mode: "slide",
      slideIndex,
    };
  }

  return {
    synced: false,
    mode: "slide",
    slideIndex,
  };
}

/**
 * Synchronizes the editor scroll position with the preview viewport in `"document"` mode:
 * proportionally maps `previewViewport.scrollTop` to `editor.scrollTop`.
 */
export function syncEditorToPreview(opts: SyncEditorToPreviewOptions): SyncPreviewResult {
  if (opts.enabled === false || opts.mode !== "document") {
    return { synced: false, mode: opts.mode };
  }

  const previewMaxScroll = Math.max(
    0,
    opts.previewViewport.scrollHeight - opts.previewViewport.clientHeight
  );
  const editorMaxScroll = Math.max(0, opts.editor.scrollHeight - opts.editor.clientHeight);

  const scrollRatio =
    previewMaxScroll > 0
      ? Math.min(1, Math.max(0, opts.previewViewport.scrollTop / previewMaxScroll))
      : 0;
  const targetScrollTop = Math.round(scrollRatio * editorMaxScroll);

  if (opts.smooth && typeof opts.editor.scrollTo === "function") {
    opts.editor.scrollTo({ top: targetScrollTop, behavior: "smooth" });
  } else {
    opts.editor.scrollTop = targetScrollTop;
  }

  return {
    synced: true,
    mode: "document",
    scrollRatio,
    targetScrollTop,
  };
}

/**
 * Wires live editor & preview scroll and cursor events for bidirectional synchronization
 * with rAF throttling, feedback-loop locking, and a toggleable `enabled` flag.
 */
export function createEditorPreviewSync(deps: EditorPreviewSyncDeps): EditorPreviewSyncController {
  let enabled = deps.initialEnabled ?? true;
  if (deps.storageKey && typeof localStorage !== "undefined") {
    try {
      const saved = localStorage.getItem(deps.storageKey);
      if (saved === "true") enabled = true;
      else if (saved === "false") enabled = false;
    } catch {
      // Ignore storage access errors
    }
  }

  let editorScrollRafId: number | null = null;
  let previewScrollRafId: number | null = null;
  let slideRafId: number | null = null;

  // Direction lock prevents programmatic scrollTop updates from triggering a feedback loop.
  let activeScrollSource: "editor" | "preview" | null = null;
  let scrollLockTimer: ReturnType<typeof setTimeout> | null = null;

  const lockScrollSource = (source: "editor" | "preview", durationMs = 120): void => {
    activeScrollSource = source;
    if (scrollLockTimer !== null) {
      clearTimeout(scrollLockTimer);
    }
    scrollLockTimer = setTimeout(() => {
      activeScrollSource = null;
      scrollLockTimer = null;
    }, durationMs);
  };

  const runSync = (smooth = false): SyncPreviewResult => {
    if (enabled && deps.getMode() === "document") {
      lockScrollSource("editor", smooth ? 350 : 120);
    }
    return syncPreviewToEditor({
      enabled,
      mode: deps.getMode(),
      editor: deps.editor,
      previewViewport: deps.previewViewport,
      currentSlideIndex: deps.getCurrentSlideIndex(),
      onSlideChange: deps.onSlideChange,
      smooth,
    });
  };

  const runReverseSync = (smooth = false): SyncPreviewResult => {
    if (enabled && deps.getMode() === "document") {
      lockScrollSource("preview", smooth ? 350 : 120);
    }
    const res = syncEditorToPreview({
      enabled,
      mode: deps.getMode(),
      editor: deps.editor,
      previewViewport: deps.previewViewport,
      smooth,
    });
    if (res.synced) {
      deps.onEditorScrolled?.();
    }
    return res;
  };

  const handleEditorScroll = (): void => {
    if (!enabled || deps.getMode() !== "document") return;
    if (activeScrollSource === "preview") return;
    lockScrollSource("editor", 120);
    if (editorScrollRafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      editorScrollRafId = requestAnimationFrame(() => {
        editorScrollRafId = null;
        runSync(false);
      });
    } else {
      runSync(false);
    }
  };

  const handlePreviewScroll = (): void => {
    if (!enabled || deps.getMode() !== "document") return;
    if (activeScrollSource === "editor") return;
    lockScrollSource("preview", 120);
    if (previewScrollRafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      previewScrollRafId = requestAnimationFrame(() => {
        previewScrollRafId = null;
        runReverseSync(false);
      });
    } else {
      runReverseSync(false);
    }
  };

  const handleCursorMove = (): void => {
    if (!enabled || deps.getMode() !== "slide") return;
    if (slideRafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      slideRafId = requestAnimationFrame(() => {
        slideRafId = null;
        runSync(false);
      });
    } else {
      runSync(false);
    }
  };

  deps.editor.addEventListener("scroll", handleEditorScroll, { passive: true });
  deps.previewViewport.addEventListener("scroll", handlePreviewScroll, { passive: true });
  deps.editor.addEventListener("keyup", handleCursorMove);
  deps.editor.addEventListener("click", handleCursorMove);
  deps.editor.addEventListener("input", handleCursorMove);

  const persistEnabled = (): void => {
    if (deps.storageKey && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(deps.storageKey, String(enabled));
      } catch {
        // Ignore storage write errors
      }
    }
    deps.onEnabledChange?.(enabled);
  };

  return {
    isEnabled: () => enabled,
    setEnabled(next: boolean) {
      enabled = next;
      persistEnabled();
      if (enabled) {
        runSync(deps.getMode() === "document");
      }
    },
    toggle() {
      enabled = !enabled;
      persistEnabled();
      if (enabled) {
        runSync(deps.getMode() === "document");
      }
      return enabled;
    },
    syncNow(opts?: { smooth?: boolean }) {
      return runSync(opts?.smooth ?? false);
    },
    destroy() {
      deps.editor.removeEventListener("scroll", handleEditorScroll);
      deps.previewViewport.removeEventListener("scroll", handlePreviewScroll);
      deps.editor.removeEventListener("keyup", handleCursorMove);
      deps.editor.removeEventListener("click", handleCursorMove);
      deps.editor.removeEventListener("input", handleCursorMove);
      if (editorScrollRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(editorScrollRafId);
        editorScrollRafId = null;
      }
      if (previewScrollRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(previewScrollRafId);
        previewScrollRafId = null;
      }
      if (slideRafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(slideRafId);
        slideRafId = null;
      }
      if (scrollLockTimer !== null) {
        clearTimeout(scrollLockTimer);
        scrollLockTimer = null;
      }
      activeScrollSource = null;
    },
  };
}

// ============================================================================
// 3. Outline Quick-Jump Modal UI (VSCode-style Cmd/Ctrl+Shift+O)
// ============================================================================

function buildHighlightedTextFragment(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    if (match.index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const mark = document.createElement("mark");
    mark.className = "outline-match";
    mark.textContent = match[0];
    frag.appendChild(mark);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  return frag;
}

function attachClosedByAnyFallback(dialog: HTMLDialogElement): void {
  if (typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype) {
    return;
  }
  const isOutside = (e: PointerEvent): boolean => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (e) => {
    pressedOutside = isOutside(e);
  });
  dialog.addEventListener("pointerup", (e) => {
    if (pressedOutside && isOutside(e)) {
      dialog.close();
    }
  });
}

/**
 * Creates a VSCode-style Outline Quick-Jump modal (`<dialog id="modal-outline">`)
 * displaying H1-H3 headings with indentation, line numbers, IME-safe filtering,
 * and ArrowUp / ArrowDown / Enter / Esc keyboard navigation.
 */
export function createOutlineQuickJump(deps: OutlineQuickJumpDeps): OutlineQuickJumpController {
  let dialog = document.getElementById("modal-outline") as HTMLDialogElement | null;
  let createdByUs = false;

  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "modal-outline";
    dialog.className = "modal-dialog modal-outline";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-label", "アウトライン クイックジャンプ");
    document.body.appendChild(dialog);
    createdByUs = true;
  } else {
    dialog.classList.add("modal-dialog", "modal-outline");
    dialog.setAttribute("closedby", "any");
  }

  dialog.innerHTML = `
    <div class="outline-shell">
      <div class="outline-header">
        <span class="outline-symbol" aria-hidden="true">#</span>
        <input
          type="search"
          class="outline-filter-input"
          placeholder="見出しを検索... (↑↓ で選択 / Enter でジャンプ)"
          aria-label="見出しを検索"
          autocomplete="off"
          spellcheck="false"
        />
        <span class="outline-count" aria-live="polite">0</span>
        <button type="button" class="outline-close-btn" title="閉じる (Esc)" aria-label="閉じる">✕</button>
      </div>
      <ul class="outline-list" role="listbox" aria-label="ドキュメント見出し一覧"></ul>
      <div class="outline-empty" hidden>見出しが見つかりません</div>
      <div class="outline-footer">
        <div class="outline-hints">
          <span><kbd>↑</kbd><kbd>↓</kbd> 選択</span>
          <span><kbd>Enter</kbd> ジャンプ</span>
          <span><kbd>Esc</kbd> 閉じる</span>
        </div>
        <span>H1–H3 アウトライン</span>
      </div>
    </div>
  `;

  attachClosedByAnyFallback(dialog);

  const elFilter = dialog.querySelector<HTMLInputElement>(".outline-filter-input")!;
  const elCount = dialog.querySelector<HTMLSpanElement>(".outline-count")!;
  const elCloseBtn = dialog.querySelector<HTMLButtonElement>(".outline-close-btn")!;
  const elList = dialog.querySelector<HTMLUListElement>(".outline-list")!;
  const elEmpty = dialog.querySelector<HTMLDivElement>(".outline-empty")!;

  let allHeadings: HeadingItem[] = [];
  let filteredHeadings: HeadingItem[] = [];
  let selectedIndex = 0;

  const updateSelectionClasses = (scrollIntoView = true): void => {
    const items = elList.querySelectorAll<HTMLLIElement>(".outline-item");
    items.forEach((li, idx) => {
      const isSelected = idx === selectedIndex;
      li.classList.toggle("is-selected", isSelected);
      li.setAttribute("aria-selected", String(isSelected));
      if (isSelected && scrollIntoView && typeof li.scrollIntoView === "function") {
        li.scrollIntoView({ block: "nearest" });
      }
    });
  };

  const commitSelection = (index: number): void => {
    const target = filteredHeadings[index];
    if (!target) return;
    if (dialog && dialog.open) {
      dialog.close();
    }
    deps.onSelectHeading(target);
    deps.onStatus?.(`見出しへジャンプしました (L${target.line}): ${target.text}`);
  };

  const renderList = (query: string, preferredLine?: number): void => {
    filteredHeadings = filterHeadings(allHeadings, query);

    if (allHeadings.length === 0) {
      elCount.textContent = "0";
      elEmpty.textContent = "このドキュメントには見出し (H1–H3) がありません";
      elEmpty.hidden = false;
      elList.innerHTML = "";
      selectedIndex = -1;
      return;
    }

    elCount.textContent =
      query.trim().length > 0
        ? `${filteredHeadings.length} / ${allHeadings.length}`
        : `${allHeadings.length}`;

    if (filteredHeadings.length === 0) {
      elEmpty.textContent = `「${query.trim()}」に一致する見出しがありません`;
      elEmpty.hidden = false;
      elList.innerHTML = "";
      selectedIndex = -1;
      return;
    }

    elEmpty.hidden = true;

    if (preferredLine !== undefined) {
      let bestIdx = 0;
      for (let i = 0; i < filteredHeadings.length; i += 1) {
        if (filteredHeadings[i].line <= preferredLine) {
          bestIdx = i;
        } else {
          break;
        }
      }
      selectedIndex = bestIdx;
    } else {
      selectedIndex = 0;
    }

    const frag = document.createDocumentFragment();
    filteredHeadings.forEach((heading, idx) => {
      const li = document.createElement("li");
      li.className = `outline-item outline-level-${heading.level}`;
      if (idx === selectedIndex) {
        li.classList.add("is-selected");
      }
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(idx === selectedIndex));
      li.dataset.index = String(idx);

      const badge = document.createElement("span");
      badge.className = "outline-level-badge";
      badge.textContent = `H${heading.level}`;

      const textSpan = document.createElement("span");
      textSpan.className = "outline-item-text";
      textSpan.appendChild(buildHighlightedTextFragment(heading.text, query));

      const lineSpan = document.createElement("span");
      lineSpan.className = "outline-item-line";
      lineSpan.textContent = `L${heading.line}`;

      li.appendChild(badge);
      li.appendChild(textSpan);
      li.appendChild(lineSpan);

      li.addEventListener("click", () => {
        commitSelection(idx);
      });

      frag.appendChild(li);
    });

    elList.innerHTML = "";
    elList.appendChild(frag);
    updateSelectionClasses(true);
  };

  const handleFilterInput = (): void => {
    renderList(elFilter.value);
  };

  const handleFilterKeydown = (e: KeyboardEvent): void => {
    // IME safety: never intercept keys while Japanese/CJK composition is active
    if (e.isComposing || e.keyCode === 229) {
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredHeadings.length > 0) {
        selectedIndex = (selectedIndex + 1 + filteredHeadings.length) % filteredHeadings.length;
        updateSelectionClasses(true);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredHeadings.length > 0) {
        selectedIndex = (selectedIndex - 1 + filteredHeadings.length) % filteredHeadings.length;
        updateSelectionClasses(true);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredHeadings.length) {
        commitSelection(selectedIndex);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (dialog && dialog.open) {
        dialog.close();
      }
    }
  };

  const handleCloseClick = (): void => {
    if (dialog && dialog.open) {
      dialog.close();
    }
  };

  elFilter.addEventListener("input", handleFilterInput);
  elFilter.addEventListener("keydown", handleFilterKeydown);
  elCloseBtn.addEventListener("click", handleCloseClick);

  return {
    open() {
      allHeadings = extractMarkdownHeadings(deps.getMarkdown());
      elFilter.value = "";
      const currentLine = deps.getCurrentLine?.();
      renderList("", currentLine);

      if (!dialog!.open) {
        dialog!.returnValue = "";
        dialog!.showModal();
      }
      elFilter.focus({ preventScroll: true });
      updateSelectionClasses(true);
    },
    close() {
      if (dialog!.open) {
        dialog!.close();
      }
    },
    isOpen() {
      return dialog!.open;
    },
    destroy() {
      elFilter.removeEventListener("input", handleFilterInput);
      elFilter.removeEventListener("keydown", handleFilterKeydown);
      elCloseBtn.removeEventListener("click", handleCloseClick);
      if (dialog!.open) {
        dialog!.close();
      }
      if (createdByUs && dialog!.parentNode) {
        dialog!.parentNode.removeChild(dialog!);
      }
    },
    element: dialog,
  };
}
