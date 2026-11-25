import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import katex from "katex";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";
import { highlightLectureMarkdown } from "./editor-highlight";
import {
  deleteSelectedLines,
  duplicateSelectedLines,
  type FindReplaceController,
  getCursorLineCol,
  handleSmartEnter,
  indentOrOutdentSelection,
  jumpToLine,
  moveSelectedLines,
  setupFindReplaceBar,
  wrapSelectionWithPair,
} from "./editor-features";
import {
  createFileExplorer,
  type ExplorerFileEntry,
  type FileExplorerController,
} from "./file-explorer";
import {
  createEditorPreviewSync,
  createOutlineQuickJump,
  type EditorPreviewSyncController,
  type OutlineQuickJumpController,
} from "./outline-and-sync";
import {
  createSettingsController,
  handleClipboardImagePaste,
  type SettingsController,
} from "./settings-and-paste";
import { openUserManualModal } from "./user-manual";

// ============================================================================
// Types matching Rust Backend structs
// ============================================================================

interface DroppedPathInfo {
  is_dir: boolean;
  workspace_path: string;
  file_path: string | null;
  file_name: string | null;
}

interface CompileResult {
  html: string;
  slide_count: number;
  course: string;
  title: string;
  description: string;
  author: string;
  date: string;
  theme: string | null;
  elapsed_ms: number;
}

interface ThemeInfo {
  id: string;
  name: string;
  css: string;
  is_builtin: boolean;
  file_path: string | null;
}

interface ExportResult {
  output_path: string;
  bytes_written: number;
  message: string;
}

type RenderMode = "document" | "slide";

// ============================================================================
// Application State
// ============================================================================

const state = {
  workspacePath: "",
  currentFilePath: "",
  currentFileName: "",
  isDirty: false,
  mode: "document" as RenderMode,
  currentSlideIndex: 0,
  totalSlides: 1,
  slideSingleView: true, // true: 1枚ずつ表示, false: 一覧表示
  lastCompileResult: null as CompileResult | null,
  themes: [] as ThemeInfo[],
  currentThemeId: "handout",
  inlineCustomCss: "",
};

// ============================================================================
// DOM Elements
// ============================================================================

const elEditor = document.getElementById("markdown-editor") as HTMLTextAreaElement;
const elEditorHighlight = document.getElementById("editor-highlight") as HTMLPreElement;
const elLineNumbers = document.getElementById("line-numbers") as HTMLDivElement;
const elEditorCursorPos = document.getElementById("editor-cursor-pos") as HTMLSpanElement;
const elEditorStats = document.getElementById("editor-stats") as HTMLSpanElement;
const elPreviewViewport = document.getElementById("preview-viewport") as HTMLDivElement;
const elPreviewContent = document.getElementById("preview-content") as HTMLElement;
const elCompileTime = document.getElementById("compile-time") as HTMLSpanElement;
const elFileTree = document.getElementById("file-tree") as HTMLUListElement;
const elWorkspacePathLabel = document.getElementById("workspace-path-label") as HTMLDivElement;
const elCurrentFileIndicator = document.getElementById("current-file-indicator") as HTMLSpanElement;
const elSaveStatusBadge = document.getElementById("save-status-badge") as HTMLSpanElement;
const elActiveThemeIndicator = document.getElementById("active-theme-indicator") as HTMLSpanElement;
const elPreviewThemeStyle = document.getElementById("preview-theme-style") as HTMLStyleElement;

const elWorkspaceGrid = document.getElementById("workspace-grid") as HTMLElement;
const elPaneSidebar = document.getElementById("pane-sidebar") as HTMLElement;
const elResizerSidebar = document.getElementById("resizer-sidebar") as HTMLDivElement;
const elResizerPreview = document.getElementById("resizer-preview") as HTMLDivElement;
const elPanePreview = document.getElementById("pane-preview") as HTMLElement;

const btnToggleSidebar = document.getElementById("btn-toggle-sidebar") as HTMLButtonElement;
const btnTogglePreview = document.getElementById("btn-toggle-preview") as HTMLButtonElement;
const btnToggleScrollSync = document.getElementById("btn-toggle-scroll-sync") as HTMLButtonElement | null;
const btnCloseSidebar = document.getElementById("btn-close-sidebar") as HTMLButtonElement;

const btnParentDir = document.getElementById("btn-parent-dir") as HTMLButtonElement;
const btnRevealExplorer = document.getElementById("btn-reveal-explorer") as HTMLButtonElement;
const btnRefreshTree = document.getElementById("btn-refresh-tree") as HTMLButtonElement;
const btnModeDoc = document.getElementById("mode-document") as HTMLButtonElement;
const btnModeSlide = document.getElementById("mode-slide") as HTMLButtonElement;
const elSlideNav = document.getElementById("slide-nav") as HTMLDivElement;
const btnPrevSlide = document.getElementById("btn-prev-slide") as HTMLButtonElement;
const btnNextSlide = document.getElementById("btn-next-slide") as HTMLButtonElement;
const elSlideCounter = document.getElementById("slide-counter") as HTMLSpanElement;
const btnSlideViewMode = document.getElementById("btn-slide-view-mode") as HTMLButtonElement;

const selectLectureTheme = document.getElementById("select-lecture-theme") as HTMLSelectElement;

// Dialogs
const modalPrompt = document.getElementById("modal-prompt") as HTMLDialogElement;
const modalPromptTitle = document.getElementById("modal-prompt-title") as HTMLHeadingElement;
const modalPromptDesc = document.getElementById("modal-prompt-desc") as HTMLParagraphElement;
const modalPromptInput = document.getElementById("modal-prompt-input") as HTMLInputElement;

const modalThemeEditor = document.getElementById("modal-theme-editor") as HTMLDialogElement;
const inputThemeId = document.getElementById("theme-id-input") as HTMLInputElement;
const checkboxSyncFrontmatter = document.getElementById("theme-sync-frontmatter") as HTMLInputElement;
const textareaThemeCss = document.getElementById("theme-css-textarea") as HTMLTextAreaElement;

const modalExport = document.getElementById("modal-export") as HTMLDialogElement;
const modalExportTitle = document.getElementById("modal-export-title") as HTMLHeadingElement;
const modalExportMessage = document.getElementById("modal-export-message") as HTMLParagraphElement;
const modalExportPath = document.getElementById("modal-export-path") as HTMLInputElement;
const btnRevealExported = document.getElementById("btn-reveal-exported") as HTMLButtonElement;

const modalHelp = document.getElementById("modal-help") as HTMLDialogElement;
const modalLogs = document.getElementById("modal-logs") as HTMLDialogElement;
const elActivityLogList = document.getElementById("activity-log-list") as HTMLDivElement;
const btnClearLogs = document.getElementById("btn-clear-logs") as HTMLButtonElement;
const modalUnsavedClose = document.getElementById("modal-unsaved-close") as HTMLDialogElement;
const modalUnsavedDesc = document.getElementById("modal-unsaved-desc") as HTMLParagraphElement;

const modalUpdater = document.getElementById("modal-updater") as HTMLDialogElement;
const elUpdaterTitle = document.getElementById("updater-title") as HTMLHeadingElement;
const elUpdaterMessage = document.getElementById("updater-message") as HTMLParagraphElement;
const elUpdaterNotes = document.getElementById("updater-notes") as HTMLPreElement;
const elUpdaterProgressWrap = document.getElementById("updater-progress-wrap") as HTMLDivElement;
const elUpdaterProgressLabel = document.getElementById("updater-progress-label") as HTMLLabelElement;
const elUpdaterProgress = document.getElementById("updater-progress") as HTMLProgressElement;
const btnUpdaterInstall = document.getElementById("btn-updater-install") as HTMLButtonElement;
const btnUpdaterClose = document.getElementById("btn-updater-close") as HTMLButtonElement;

let findReplaceController: FindReplaceController | null = null;
let fileExplorer: FileExplorerController | null = null;
let settingsController: SettingsController | null = null;
let outlineQuickJump: OutlineQuickJumpController | null = null;
let editorPreviewSync: EditorPreviewSyncController | null = null;
let autoSaveTimer: number | null = null;
let pendingUpdate: Update | null = null;

// ============================================================================
// Modern Web Guidance: <dialog closedby="any"> Fallback & Dark Mode Toggle
// ============================================================================

function setupDialogFallbacks(): void {
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e: PointerEvent, dialog: HTMLDialogElement) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) {
          dialog.close();
        }
      });
    }
  }
}

function promptModal(title: string, desc: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    modalPromptTitle.textContent = title;
    modalPromptDesc.textContent = desc;
    modalPromptInput.value = defaultValue;
    modalPrompt.returnValue = "";

    const onClose = () => {
      modalPrompt.removeEventListener("close", onClose);
      const ret = modalPrompt.returnValue;
      modalPrompt.returnValue = "";
      if (ret === "ok" && modalPromptInput.value.trim()) {
        resolve(modalPromptInput.value.trim());
      } else {
        resolve(null);
      }
    };

    modalPrompt.addEventListener("close", onClose);
    modalPrompt.showModal();
    modalPromptInput.focus();
    modalPromptInput.select();
  });
}

function showExportModal(title: string, message: string, outputPath: string): void {
  modalExportTitle.textContent = title;
  modalExportMessage.textContent = message;
  modalExportPath.value = outputPath;
  modalExport.returnValue = "";
  modalExport.showModal();
}

function toggleColorScheme(): void {
  const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
  if (!meta) return;

  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const systemScheme = systemDark ? "dark" : "light";

  let stored: string | null = null;
  try {
    stored = localStorage.getItem("color-scheme");
  } catch (_) {}

  const currentRendered = stored === "dark" || stored === "light" ? stored : systemScheme;
  const targetScheme = currentRendered === "dark" ? "light" : "dark";

  if (targetScheme !== systemScheme) {
    try {
      localStorage.setItem("color-scheme", targetScheme);
    } catch (_) {}
    meta.content = targetScheme;
  } else {
    try {
      localStorage.removeItem("color-scheme");
    } catch (_) {}
    meta.content = "light dark";
  }

  setStatus(`アプリUIを ${targetScheme === "dark" ? "ダーク" : "ライト"} モードに切り替えました`);
}

// ============================================================================
// Lecture CSS Theme Management (Presets + themes/*.css + Frontmatter Sync)
// ============================================================================

async function loadThemes(): Promise<void> {
  try {
    const themes = await invoke<ThemeInfo[]>("list_themes", {
      workspacePath: state.workspacePath,
    });
    state.themes = themes;
    renderThemeSelector();
    applyLectureThemeToPreview(state.currentThemeId);
  } catch (err) {
    console.warn("Failed to load themes:", err);
  }
}

function renderThemeSelector(): void {
  selectLectureTheme.innerHTML = "";
  for (const t of state.themes) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.is_builtin ? `🎨 ${t.name}` : `✨ ${t.name}`;
    if (t.id === state.currentThemeId) {
      opt.selected = true;
    }
    selectLectureTheme.appendChild(opt);
  }
}

function applyLectureThemeToPreview(themeId: string): void {
  const cleanId = themeId.trim().replace(/\.css$/i, "") || "default";
  const found =
    state.themes.find((t) => t.id.toLowerCase() === cleanId.toLowerCase()) ??
    state.themes[0];

  const resolvedId = found ? found.id : "default";
  const baseCss = found ? found.css : "";

  state.currentThemeId = resolvedId;
  if (selectLectureTheme.value !== resolvedId) {
    selectLectureTheme.value = resolvedId;
  }

  const combinedCss = state.inlineCustomCss
    ? `${baseCss}\n/* Inline Custom CSS Override */\n${state.inlineCustomCss}`
    : baseCss;

  elPreviewThemeStyle.textContent = combinedCss;
  elPreviewContent.setAttribute("data-lecture-theme", resolvedId);
  elActiveThemeIndicator.textContent = `Theme: ${resolvedId}`;
}

/**
 * Markdown先頭のフロントマター (`--- ... ---`) 内の `theme: xxx` を更新・追加する
 * (CRLF 改行およびファイル末尾の `---` にも対応)
 */
function updateMarkdownFrontmatterTheme(newThemeId: string, insertIfMissing: boolean): void {
  const raw = elEditor.value;
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const startMatch = /^---\r?\n/.exec(raw);
  if (!startMatch) {
    if (!insertIfMissing) return;
    replaceEditorRangeWithUndo(`---${eol}theme: ${newThemeId}${eol}---${eol}${eol}`, 0, 0);
    return;
  }

  const yamlStart = startMatch[0].length;
  const rest = raw.slice(yamlStart);
  const endMatch = /(?:^|\r?\n)---(?:\r?\n|$)/.exec(rest);
  if (!endMatch) return;

  const yamlEnd = yamlStart + endMatch.index;
  const frontmatterEnd = yamlStart + endMatch.index + endMatch[0].length;
  const yamlPart = raw.slice(yamlStart, yamlEnd);
  const lines = yamlPart.length > 0 ? yamlPart.split(/\r?\n/) : [];

  let foundThemeLine = false;
  const updatedLines = lines.map((line) => {
    if (/^\s*theme\s*:/i.test(line)) {
      foundThemeLine = true;
      return `theme: ${newThemeId}`;
    }
    return line;
  });

  if (!foundThemeLine) {
    if (!insertIfMissing) return;
    updatedLines.push(`theme: ${newThemeId}`);
  }

  const hadTrailingNewline = /\r?\n$/.test(endMatch[0]);
  const nextFrontmatter = `---${eol}${updatedLines.join(eol)}${eol}---${hadTrailingNewline ? eol : ""}`;
  const currentFrontmatter = raw.slice(0, frontmatterEnd);
  if (nextFrontmatter !== currentFrontmatter) {
    replaceEditorRangeWithUndo(nextFrontmatter, 0, frontmatterEnd);
  }
}

function openCustomThemeEditorModal(): void {
  const current =
    state.themes.find((t) => t.id === state.currentThemeId) ?? state.themes[0];
  if (current) {
    inputThemeId.value = current.is_builtin ? `${current.id}-custom` : current.id;
    textareaThemeCss.value = state.inlineCustomCss || current.css;
  }
  modalThemeEditor.returnValue = "";
  modalThemeEditor.showModal();
  textareaThemeCss.focus();
}

async function handleThemeEditorModalClose(): Promise<void> {
  const action = modalThemeEditor.returnValue;
  modalThemeEditor.returnValue = "";
  if (!action || action === "cancel") return;

  const customCssText = textareaThemeCss.value;
  const targetId = inputThemeId.value.trim().replace(/\.css$/i, "") || "custom-theme";

  if (action === "apply-only") {
    state.inlineCustomCss = customCssText;
    applyLectureThemeToPreview(state.currentThemeId);
    setStatus("カスタムCSSを現在のプレビューと出力に一時適用しました");
    return;
  }

  if (action === "save-theme") {
    try {
      const saved = await invoke<ThemeInfo>("save_custom_theme", {
        workspacePath: state.workspacePath,
        themeId: targetId,
        cssContent: customCssText,
      });
      state.inlineCustomCss = "";
      state.currentThemeId = saved.id;
      await loadThemes();

      if (checkboxSyncFrontmatter.checked) {
        updateMarkdownFrontmatterTheme(saved.id, true);
      }
      setStatus(`カスタムテーマ themes/${saved.id}.css を保存し適用しました`);
    } catch (err) {
      setStatus(`カスタムテーマ保存エラー: ${String(err)}`);
    }
  }
}

// ============================================================================
// Mermaid & KaTeX Post-Processing
// ============================================================================

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  securityLevel: "loose",
  flowchart: {
    htmlLabels: true,
    useMaxWidth: true,
    padding: 14,
  },
  themeVariables: {
    background: "#ffffff",
    primaryColor: "#eff6ff",
    primaryTextColor: "#1e293b",
    primaryBorderColor: "#3b82f6",
    lineColor: "#334155",
    secondaryColor: "#f0fdf4",
    secondaryTextColor: "#1e293b",
    secondaryBorderColor: "#10b981",
    tertiaryColor: "#faf5ff",
    tertiaryTextColor: "#1e293b",
    tertiaryBorderColor: "#8b5cf6",
    nodeTextColor: "#1e293b",
    textColor: "#1e293b",
    mainBkg: "#eff6ff",
    nodeBorder: "#3b82f6",
    clusterBkg: "#f8fafc",
    clusterBorder: "#94a3b8",
    edgeLabelBackground: "#ffffff",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
    fontSize: "14px",
  },
});

let mermaidCounter = 0;

function getOrCreateMermaidSandbox(): HTMLDivElement {
  let sb = document.getElementById("mermaid-render-sandbox") as HTMLDivElement | null;
  if (!sb) {
    sb = document.createElement("div");
    sb.id = "mermaid-render-sandbox";
    sb.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:960px;visibility:hidden;pointer-events:none;background:#ffffff;color:#1e293b;font-size:14px;line-height:1.25;letter-spacing:normal;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;";
    document.body.appendChild(sb);
  }
  return sb;
}

async function renderMathAndDiagrams(
  container: HTMLElement,
  isStale?: () => boolean
): Promise<void> {
  // 1. Render Inline Math
  const inlineMaths = container.querySelectorAll<HTMLElement>(".math-inline");
  inlineMaths.forEach((el) => {
    const tex = el.getAttribute("data-math") ?? el.textContent ?? "";
    try {
      katex.render(tex, el, { displayMode: false, throwOnError: false });
    } catch (err) {
      console.warn("KaTeX inline error:", err);
    }
  });

  // 2. Render Display Math
  const displayMaths = container.querySelectorAll<HTMLElement>(".math-display");
  displayMaths.forEach((el) => {
    const tex = el.getAttribute("data-math") ?? el.textContent ?? "";
    try {
      katex.render(tex, el, { displayMode: true, throwOnError: false });
    } catch (err) {
      console.warn("KaTeX display error:", err);
    }
  });

  // 3. Render Mermaid Diagrams in an isolated sandbox container so parent 14pt/serif rules don't distort BBox
  const mermaidBlocks = container.querySelectorAll<HTMLElement>(".mermaid-container");
  if (mermaidBlocks.length > 0) {
    const sandbox = getOrCreateMermaidSandbox();
    for (const block of mermaidBlocks) {
      if (isStale?.()) return;
      const code = block.getAttribute("data-mermaid");
      if (!code) continue;
      try {
        mermaidCounter += 1;
        const id = `mermaid-svg-${Date.now()}-${mermaidCounter}`;
        const { svg } = await mermaid.render(id, code, sandbox);
        if (isStale?.()) return;
        block.innerHTML = svg;
      } catch (err) {
        if (isStale?.()) return;
        block.innerHTML = `<pre style="color:#ef4444;font-size:12px;">Mermaid Syntax Error:\n${escapeHtml(
          String(err)
        )}</pre>`;
      } finally {
        sandbox.innerHTML = "";
      }
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============================================================================
// Editor & Preview Sync
// ============================================================================

function updateCursorPosIndicator(): void {
  const { line, col } = getCursorLineCol(elEditor);
  elEditorCursorPos.textContent = `行 ${line}, 列 ${col}`;
}

function updateLineNumbersAndStats(): void {
  const text = elEditor.value;
  const lines = text.split("\n").length;
  const chars = text.length;

  const nums: string[] = [];
  for (let i = 1; i <= lines; i++) {
    nums.push(String(i));
  }
  elLineNumbers.textContent = nums.join("\n");
  elEditorStats.textContent = `${lines} 行 · ${chars} 文字`;
  elEditorHighlight.innerHTML = highlightLectureMarkdown(text);
  elEditorHighlight.scrollTop = elEditor.scrollTop;
  elEditorHighlight.scrollLeft = elEditor.scrollLeft;
  updateCursorPosIndicator();
  findReplaceController?.refreshMatches();
}

function clearAutoSaveTimer(): void {
  if (autoSaveTimer !== null) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function scheduleAutoSave(): void {
  clearAutoSaveTimer();
  const settings = settingsController?.getSettings();
  if (!settings?.autoSave || !state.currentFilePath || !state.isDirty) {
    return;
  }
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null;
    const latest = settingsController?.getSettings();
    if (latest?.autoSave && state.currentFilePath && state.isDirty) {
      void saveCurrentFile();
    }
  }, settings.autoSaveDelayMs);
}

function markDirty(dirty: boolean): void {
  state.isDirty = dirty;
  if (dirty) {
    elSaveStatusBadge.textContent = "Modified";
    elSaveStatusBadge.className = "status-badge dirty";
    scheduleAutoSave();
  } else {
    elSaveStatusBadge.textContent = "Saved";
    elSaveStatusBadge.className = "status-badge saved";
    clearAutoSaveTimer();
  }
}

interface ActivityLogEntry {
  time: string;
  message: string;
}

const MAX_ACTIVITY_LOGS = 200;
const activityLogs: ActivityLogEntry[] = [];

function formatCurrentTime(): string {
  const now = new Date();
  return now.toLocaleTimeString("ja-JP", { hour12: false });
}

function renderActivityLogs(): void {
  elActivityLogList.innerHTML = "";
  if (activityLogs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "activity-log-empty";
    empty.textContent = "ログはまだありません";
    elActivityLogList.appendChild(empty);
    return;
  }

  for (const entry of activityLogs) {
    const row = document.createElement("div");
    row.className = "activity-log-entry";

    const timeSpan = document.createElement("span");
    timeSpan.className = "activity-log-time";
    timeSpan.textContent = entry.time;

    const msgSpan = document.createElement("span");
    msgSpan.className = "activity-log-msg";
    msgSpan.textContent = entry.message;

    row.appendChild(timeSpan);
    row.appendChild(msgSpan);
    elActivityLogList.appendChild(row);
  }
}

function openActivityLogsModal(): void {
  renderActivityLogs();
  modalLogs.returnValue = "";
  modalLogs.showModal();
}

function setStatus(msg: string): void {
  activityLogs.unshift({ time: formatCurrentTime(), message: msg });
  if (activityLogs.length > MAX_ACTIVITY_LOGS) {
    activityLogs.length = MAX_ACTIVITY_LOGS;
  }
  if (modalLogs.open) {
    renderActivityLogs();
  }
}

let compileTimer: number | null = null;
let compileGeneration = 0;
let activeCompilePromise: Promise<void> | null = null;

function scheduleCompile(): void {
  if (compileTimer !== null) {
    window.clearTimeout(compileTimer);
  }
  compileTimer = window.setTimeout(() => {
    compileTimer = null;
    void compileCurrentMarkdown();
  }, 120);
}

async function flushPendingCompile(): Promise<void> {
  if (compileTimer !== null) {
    window.clearTimeout(compileTimer);
    compileTimer = null;
    await compileCurrentMarkdown(false);
    return;
  }
  if (activeCompilePromise) {
    await activeCompilePromise;
  }
}

function getCurrentBaseDir(): string | null {
  if (state.currentFilePath) {
    const normalized = state.currentFilePath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash > 0) {
      return state.currentFilePath.substring(0, lastSlash);
    }
  }
  return state.workspacePath || null;
}

async function compileCurrentMarkdown(syncThemeFromFrontmatter = true): Promise<void> {
  const gen = ++compileGeneration;
  const markdown = elEditor.value;
  const task = (async () => {
    try {
      const res = await invoke<CompileResult>("compile_markdown", {
        markdown,
        mode: state.mode,
        themeId: syncThemeFromFrontmatter ? null : state.currentThemeId,
        baseDir: getCurrentBaseDir(),
      });
      if (gen !== compileGeneration) return;

      state.lastCompileResult = res;
      state.totalSlides = Math.max(1, res.slide_count);
      if (state.currentSlideIndex >= state.totalSlides) {
        state.currentSlideIndex = state.totalSlides - 1;
      }

      // フロントマターに `theme: xxx` が記述されていれば自動連動
      if (syncThemeFromFrontmatter && res.theme) {
        const cleanFrontTheme = res.theme.trim().replace(/\.css$/i, "");
        const matched = state.themes.find(
          (t) => t.id.toLowerCase() === cleanFrontTheme.toLowerCase()
        );
        if (matched && matched.id !== state.currentThemeId) {
          applyLectureThemeToPreview(matched.id);
        }
      }

      elPreviewContent.innerHTML = res.html;
      elCompileTime.textContent = `レンダリング: ${res.elapsed_ms} ms`;

      await renderMathAndDiagrams(elPreviewContent, () => gen !== compileGeneration);
      if (gen !== compileGeneration) return;

      updateSlideVisibility();
    } catch (err) {
      if (gen !== compileGeneration) return;
      console.error("Compile error:", err);
      setStatus(`変換エラー: ${String(err)}`);
    }
  })();

  activeCompilePromise = task;
  try {
    await task;
  } finally {
    if (activeCompilePromise === task) {
      activeCompilePromise = null;
    }
  }
}

function updateSlideVisibility(): void {
  if (state.mode !== "slide") {
    elSlideNav.hidden = true;
    return;
  }

  elSlideNav.hidden = false;
  elSlideCounter.textContent = `${state.currentSlideIndex + 1} / ${state.totalSlides}`;

  const slides = elPreviewContent.querySelectorAll<HTMLElement>(".lecture-slide");
  slides.forEach((slideEl, idx) => {
    if (state.slideSingleView) {
      if (idx === state.currentSlideIndex) {
        slideEl.classList.remove("hidden-slide");
      } else {
        slideEl.classList.add("hidden-slide");
      }
    } else {
      slideEl.classList.remove("hidden-slide");
    }
  });
}

function setRenderMode(mode: RenderMode): void {
  state.mode = mode;
  if (mode === "document") {
    btnModeDoc.classList.add("active");
    btnModeSlide.classList.remove("active");
    elPreviewViewport.className = "preview-viewport mode-document";
  } else {
    btnModeSlide.classList.add("active");
    btnModeDoc.classList.remove("active");
    elPreviewViewport.className = "preview-viewport mode-slide";
  }
  void compileCurrentMarkdown();
}

// ============================================================================
// Workspace & File Browser Operations (VSCode-style File Explorer)
// ============================================================================

function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function basenameFromPath(p: string): string {
  const norm = normalizePathForCompare(p);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function clearCurrentOpenFile(): void {
  state.currentFilePath = "";
  state.currentFileName = "";
  elEditor.value = "";
  elCurrentFileIndicator.textContent = "未選択";
  markDirty(false);
  updateLineNumbersAndStats();
  elPreviewContent.innerHTML = "";
  state.lastCompileResult = null;
  state.totalSlides = 1;
  state.currentSlideIndex = 0;
  updateSlideVisibility();
}

function setupFileExplorer(): FileExplorerController {
  return createFileExplorer({
    treeEl: elFileTree,
    getWorkspacePath: () => state.workspacePath,
    getActiveFilePath: () => state.currentFilePath,
    listDirectory: (dirPath) =>
      invoke<ExplorerFileEntry[]>("list_workspace_files", {
        workspacePath: dirPath,
      }),
    onOpenFile: async (filePath, fileName) => {
      if (state.isDirty && state.currentFilePath) {
        await saveCurrentFile();
      }
      await openFile(filePath, fileName);
    },
    onOpenWorkspace: async (dirPath) => {
      if (state.isDirty && state.currentFilePath) {
        await saveCurrentFile();
      }
      await loadWorkspace(dirPath);
    },
    onNavigateParent: async () => {
      await navigateToParentDirectory();
    },
    onCreateFile: async (parentDir, fileName) => {
      return await invoke<string | null>("create_markdown_file", {
        workspacePath: parentDir,
        fileName,
        initialContent: null,
      });
    },
    onCreateFolder: async (parentDir, folderName) => {
      return await invoke<string>("create_folder", {
        parentDir,
        name: folderName,
      });
    },
    onRenameEntry: async (oldPath, newName) => {
      return await invoke<string>("rename_workspace_entry", {
        oldPath,
        newName,
      });
    },
    onDeleteEntry: async (targetPath, displayName, isDir) => {
      const kindLabel = isDir ? "フォルダ（中身も含む）" : "ファイル";
      const confirmName = await promptModal(
        `${kindLabel}の削除確認`,
        `「${displayName}」を削除しますか？ 決定を押すと削除されます。`,
        displayName
      );
      if (!confirmName) return false;
      await invoke("delete_workspace_entry", { targetPath });
      return true;
    },
    onRevealInExplorer: async (targetPath) => {
      await revealInExplorer(targetPath);
    },
    onStatus: (msg) => setStatus(msg),
    onEntryRenamed: (oldPath, newPath, isDir) => {
      if (!state.currentFilePath) return;
      const curNorm = normalizePathForCompare(state.currentFilePath);
      const oldNorm = normalizePathForCompare(oldPath);
      if (curNorm === oldNorm) {
        state.currentFilePath = newPath;
        state.currentFileName = basenameFromPath(newPath);
        elCurrentFileIndicator.textContent = state.currentFileName;
      } else if (isDir && curNorm.startsWith(oldNorm + "/")) {
        const suffix = state.currentFilePath.slice(oldPath.length);
        state.currentFilePath = newPath + suffix;
      }
    },
    onEntryDeleted: (deletedPath, isDir) => {
      if (!state.currentFilePath) return;
      const curNorm = normalizePathForCompare(state.currentFilePath);
      const delNorm = normalizePathForCompare(deletedPath);
      if (curNorm === delNorm || (isDir && curNorm.startsWith(delNorm + "/"))) {
        clearCurrentOpenFile();
      }
    },
  });
}

async function loadWorkspace(
  workspacePath: string,
  options?: { silentError?: boolean }
): Promise<boolean> {
  try {
    const isSameWorkspace = state.workspacePath === workspacePath;
    if (!fileExplorer) {
      fileExplorer = setupFileExplorer();
    }

    const entries = await fileExplorer.loadRoot(workspacePath, {
      preserveExpanded: isSameWorkspace,
    });
    state.workspacePath = workspacePath;
    elWorkspacePathLabel.textContent = workspacePath;
    elWorkspacePathLabel.title = `${workspacePath} (クリックでFinder / エクスプローラー表示)`;

    recordRecentWorkspace(workspacePath);

    await loadThemes();

    const openableCount = entries.filter((e) => !e.is_dir && e.can_open).length;
    setStatus(
      `ディレクトリを開きました: ${workspacePath} (${entries.length} 項目 / Markdown ${openableCount} 件)`
    );

    // Auto-open the first openable markdown file if none is open
    const firstMd = entries.find((e) => !e.is_dir && e.can_open);
    if (firstMd && !state.currentFilePath) {
      await openFile(firstMd.path, firstMd.name);
    } else if (state.currentFilePath) {
      await fileExplorer.setActiveFile(state.currentFilePath, { reveal: false });
    }
    return true;
  } catch (err) {
    if (!options?.silentError) {
      setStatus(`フォルダ読み込み失敗: ${String(err)}`);
    }
    return false;
  }
}

async function navigateToParentDirectory(): Promise<void> {
  if (!state.workspacePath) return;
  try {
    const parent = await invoke<string | null>("get_parent_directory", {
      path: state.workspacePath,
    });
    if (parent && parent !== state.workspacePath) {
      await loadWorkspace(parent);
    } else {
      setStatus("これ以上上の階層はありません");
    }
  } catch (err) {
    setStatus(`親フォルダ移動エラー: ${String(err)}`);
  }
}

async function revealInExplorer(targetPath: string): Promise<void> {
  if (!targetPath) return;
  try {
    await invoke("reveal_in_file_explorer", { path: targetPath });
    setStatus(`ファイルエクスプローラーで開きました: ${targetPath}`);
  } catch (err) {
    setStatus(`エクスプローラー起動エラー: ${String(err)}`);
  }
}

async function openFile(filePath: string, displayName: string): Promise<void> {
  try {
    const content = await invoke<string>("read_markdown_file", {
      filePath,
    });
    state.currentFilePath = filePath;
    state.currentFileName = displayName;
    state.currentSlideIndex = 0;

    elEditor.value = content;
    elCurrentFileIndicator.textContent = displayName;
    markDirty(false);
    updateLineNumbersAndStats();

    // Update active state in tree in-place (preserving expanded folders & scroll)
    void fileExplorer?.setActiveFile(filePath, { reveal: true });

    await compileCurrentMarkdown();
    setStatus(`ファイルを開きました: ${displayName}`);
  } catch (err) {
    setStatus(`ファイル読み込みエラー: ${String(err)}`);
  }
}

async function saveCurrentFile(): Promise<void> {
  if (!state.currentFilePath) {
    await createNewFileFlow(elEditor.value);
    return;
  }
  try {
    await invoke("save_markdown_file", {
      filePath: state.currentFilePath,
      content: elEditor.value,
    });
    markDirty(false);
    setStatus(`保存しました: ${state.currentFileName}`);
  } catch (err) {
    setStatus(`保存エラー: ${String(err)}`);
  }
}

async function createNewFileFlow(initialContent: string | null = null): Promise<void> {
  try {
    const createdPath = await invoke<string | null>("create_markdown_file", {
      workspacePath: state.workspacePath,
      fileName: null,
      initialContent,
    });
    if (!createdPath) {
      setStatus(
        initialContent !== null
          ? "名前を付けて保存をキャンセルしました"
          : "新規ファイルの作成をキャンセルしました"
      );
      return;
    }
    const info = await invoke<DroppedPathInfo>("inspect_dropped_path", {
      path: createdPath,
    });
    await loadWorkspace(info.workspace_path);
    const displayName = info.file_name || createdPath;
    await openFile(createdPath, displayName);
    setStatus(
      initialContent !== null
        ? `保存しました: ${displayName}`
        : `新規ファイルを作成しました: ${displayName}`
    );
  } catch (err) {
    setStatus(`作成エラー: ${String(err)}`);
  }
}

// ============================================================================
// Export to Standalone HTML & High-Quality PDF (with OS Native Save Dialogs)
// ============================================================================

function getFullyRenderedPreviewHtml(): string {
  // Temporarily unhide all slides so exported HTML/PDF includes all slides
  const clone = elPreviewContent.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".lecture-slide").forEach((s) => s.classList.remove("hidden-slide"));
  return clone.innerHTML;
}

async function exportHtmlFlow(): Promise<void> {
  if (state.isDirty && state.currentFilePath) {
    await saveCurrentFile();
  }
  await flushPendingCompile();
  setStatus(`HTMLファイルの保存先を選択してください (テーマ: ${state.currentThemeId})...`);
  try {
    const renderedBodyHtml = getFullyRenderedPreviewHtml();
    const res = await invoke<ExportResult | null>("export_lecture_html", {
      sourcePath: state.currentFilePath || null,
      workspacePath: state.workspacePath,
      markdown: elEditor.value,
      renderedBodyHtml,
      mode: state.mode,
      themeId: state.currentThemeId,
      customCss: state.inlineCustomCss || null,
    });
    if (!res) {
      setStatus("HTML出力をキャンセルしました");
      return;
    }
    setStatus(res.message);
    showExportModal("🌐 HTML出力完了", res.message, res.output_path);
  } catch (err) {
    setStatus(`HTML出力エラー: ${String(err)}`);
  }
}

async function getRenderedSlideBodyHtml(): Promise<string> {
  if (state.mode === "slide") {
    return getFullyRenderedPreviewHtml();
  }
  // ドキュメント表示中からスライドショー出力した場合も、スライド形式で KaTeX / Mermaid をレンダリングする
  const res = await invoke<CompileResult>("compile_markdown", {
    markdown: elEditor.value,
    mode: "slide",
    themeId: state.currentThemeId,
    baseDir: getCurrentBaseDir(),
  });
  const offscreen = document.createElement("div");
  offscreen.innerHTML = res.html;
  await renderMathAndDiagrams(offscreen);
  return offscreen.innerHTML;
}

async function exportSlideshowHtmlFlow(): Promise<void> {
  if (state.isDirty && state.currentFilePath) {
    await saveCurrentFile();
  }
  await flushPendingCompile();
  setStatus(`スライドショーHTMLの保存先を選択してください (テーマ: ${state.currentThemeId})...`);
  try {
    const renderedBodyHtml = await getRenderedSlideBodyHtml();
    const res = await invoke<ExportResult | null>("export_lecture_slideshow_html", {
      sourcePath: state.currentFilePath || null,
      workspacePath: state.workspacePath,
      markdown: elEditor.value,
      renderedBodyHtml,
      themeId: state.currentThemeId,
      customCss: state.inlineCustomCss || null,
    });
    if (!res) {
      setStatus("スライドショーHTML出力をキャンセルしました");
      return;
    }
    setStatus(res.message);
    showExportModal("📽️ スライドショーHTML出力完了", res.message, res.output_path);
  } catch (err) {
    setStatus(`スライドショーHTML出力エラー: ${String(err)}`);
  }
}

async function exportPdfFlow(): Promise<void> {
  if (state.isDirty && state.currentFilePath) {
    await saveCurrentFile();
  }
  await flushPendingCompile();
  setStatus(`PDFファイルの保存先を選択してください (テーマ: ${state.currentThemeId})...`);
  try {
    const renderedBodyHtml = getFullyRenderedPreviewHtml();
    const res = await invoke<ExportResult | null>("export_lecture_pdf", {
      sourcePath: state.currentFilePath || null,
      workspacePath: state.workspacePath,
      markdown: elEditor.value,
      renderedBodyHtml,
      mode: state.mode,
      themeId: state.currentThemeId,
      customCss: state.inlineCustomCss || null,
    });
    if (!res) {
      setStatus("PDF出力をキャンセルしました");
      return;
    }
    setStatus(res.message);
    showExportModal("📑 PDF出力完了", res.message, res.output_path);
  } catch (err) {
    setStatus(`PDF出力エラー: ${String(err)} — WebView印刷ダイアログを開きます`);
    window.print();
  }
}

// ============================================================================
// Quick Insert Snippets
// ============================================================================

const SNIPPETS: Record<string, string> = {
  "slide-break": "\n\n---\n\n# 新しいスライドのタイトル\n\n- ポイント1\n- ポイント2\n",
  "math-block":
    "\n$$\n\\mathcal{L}(\\theta) = -\\frac{1}{N} \\sum_{i=1}^{N} \\left[ y_i \\log \\hat{y}_i + (1 - y_i) \\log(1 - \\hat{y}_i) \\right]\n$$\n",
  "math-inline": "$f(x) = \\int_{-\\infty}^{\\infty} \\hat{f}(\\xi) e^{2\\pi i \\xi x} \\, d\\xi$",
  "code-rust":
    '\n```rust\nfn binary_search<T: Ord>(arr: &[T], target: &T) -> Option<usize> {\n    let (mut left, mut right) = (0, arr.len());\n    while left < right {\n        let mid = left + (right - left) / 2;\n        match arr[mid].cmp(target) {\n            std::cmp::Ordering::Equal => return Some(mid),\n            std::cmp::Ordering::Less => left = mid + 1,\n            std::cmp::Ordering::Greater => right = mid,\n        }\n    }\n    None\n}\n```\n',
  mermaid:
    "\n```mermaid\nflowchart LR\n    A[\"入力データ X\"] --> B[\"特徴量抽出 φ(X)\"]\n    B --> C{\"分類器 f(z)\"}\n    C -->|正例| D[\"クラス 1\"]\n    C -->|負例| E[\"クラス 0\"]\n```\n",
  callout:
    "\n> [!IMPORTANT]\n> **演習課題 1**: 上記のアルゴリズムの時間計算量 $O(\\log n)$ を漸化式を用いて証明せよ。\n",
  "two-column":
    '\n<div class="lecture-columns">\n<div>\n\n### 左カラム：理論・定義\n- 線形変換 $T: V \\to W$\n- 核 $\\ker(T)$ と像 $\\mathrm{Im}(T)$\n\n</div>\n<div>\n\n### 右カラム：具体例・応用\n- 次元定理: $\\dim V = \\dim \\ker(T) + \\dim \\mathrm{Im}(T)$\n- 主成分分析 (PCA) への応用\n\n</div>\n</div>\n',
};

/**
 * OS標準の Undo / Redo スタック（Cmd+Z / Cmd+Shift+Z 等）を維持したまま
 * エディタの指定範囲をテキストで置換・挿入する
 */
function replaceEditorRangeWithUndo(
  text: string,
  start: number,
  end: number,
  nextSelStart?: number,
  nextSelEnd?: number
): void {
  elEditor.focus({ preventScroll: true });
  elEditor.setSelectionRange(start, end);

  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch (_) {
    inserted = false;
  }

  if (!inserted) {
    elEditor.setRangeText(text, start, end, "end");
  }

  if (nextSelStart !== undefined && nextSelEnd !== undefined) {
    elEditor.setSelectionRange(nextSelStart, nextSelEnd);
  }

  markDirty(true);
  updateLineNumbersAndStats();
  scheduleCompile();
}

async function gotoLineFlow(): Promise<void> {
  const totalLines = elEditor.value.split("\n").length;
  const { line } = getCursorLineCol(elEditor);
  const input = await promptModal(
    "指定行へ移動",
    `移動先の行番号を入力してください (1 〜 ${totalLines}):`,
    String(line)
  );
  if (!input) return;
  const parsed = parseInt(input, 10);
  if (!Number.isNaN(parsed) && parsed >= 1) {
    jumpToLine(elEditor, parsed);
    updateCursorPosIndicator();
  }
}

function insertSnippetAtCursor(snippetKey: string): void {
  const snippet = SNIPPETS[snippetKey];
  if (!snippet) return;
  replaceEditorRangeWithUndo(snippet, elEditor.selectionStart, elEditor.selectionEnd);
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================

function bindEvents(): void {
  setupDialogFallbacks();

  // Editor typing & scroll sync
  elEditor.addEventListener("input", () => {
    markDirty(true);
    updateLineNumbersAndStats();
    scheduleCompile();
  });

  elEditor.addEventListener("paste", (ev) => {
    void handleClipboardImagePaste(ev, {
      savePastedImage: async (bytes, ext) => {
        const baseDir = getCurrentBaseDir();
        if (!baseDir) {
          throw new Error("保存先のフォルダが開かれていません");
        }
        const relPath = await invoke<string>("save_pasted_image", {
          baseDir,
          imageBytes: Array.from(bytes),
          ext,
        });
        if (fileExplorer) {
          void fileExplorer.refresh();
        }
        return relPath;
      },
      insertText: (text) => {
        replaceEditorRangeWithUndo(text, elEditor.selectionStart, elEditor.selectionEnd);
      },
      onLog: setStatus,
    });
  });

  elEditor.addEventListener("scroll", () => {
    elLineNumbers.scrollTop = elEditor.scrollTop;
    elEditorHighlight.scrollTop = elEditor.scrollTop;
    elEditorHighlight.scrollLeft = elEditor.scrollLeft;
  });

  elEditor.addEventListener("keyup", updateCursorPosIndicator);
  elEditor.addEventListener("click", updateCursorPosIndicator);
  elEditor.addEventListener("select", updateCursorPosIndicator);

  elEditor.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void saveCurrentFile();
        return;
      }
      if (k === "f") {
        e.preventDefault();
        findReplaceController?.openFind(false);
        return;
      }
      if (k === "h") {
        e.preventDefault();
        findReplaceController?.openFind(true);
        return;
      }
      if (k === "g") {
        e.preventDefault();
        void gotoLineFlow();
        return;
      }
    }

    if (mod && e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      findReplaceController?.openFind(true);
      return;
    }

    if (mod && e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "d") {
        e.preventDefault();
        duplicateSelectedLines(elEditor, replaceEditorRangeWithUndo);
        return;
      }
      if (k === "k") {
        e.preventDefault();
        deleteSelectedLines(elEditor, replaceEditorRangeWithUndo);
        return;
      }
    }

    if (e.altKey && !mod && !e.shiftKey) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelectedLines(elEditor, -1, replaceEditorRangeWithUndo);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelectedLines(elEditor, 1, replaceEditorRangeWithUndo);
        return;
      }
    }

    // Tab / Shift+Tab: single-line & multi-line indent/outdent
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      indentOrOutdentSelection(elEditor, e.shiftKey, replaceEditorRangeWithUndo);
      return;
    }

    // Smart Enter (IME-safe: ignore when composing or Safari WebKit keyCode 229)
    if (e.key === "Enter" && !e.shiftKey && !mod && !e.altKey) {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      if (handleSmartEnter(elEditor, replaceEditorRangeWithUndo)) {
        e.preventDefault();
      }
      return;
    }

    // Wrap selected text with paired punctuation/brackets (`*`, `` ` ``, `(`, `[`, `「`, etc.)
    if (!mod && !e.altKey && !e.isComposing && e.keyCode !== 229) {
      if (wrapSelectionWithPair(elEditor, e.key, replaceEditorRangeWithUndo)) {
        e.preventDefault();
      }
    }
  });

  // Mode buttons
  btnModeDoc.addEventListener("click", () => setRenderMode("document"));
  btnModeSlide.addEventListener("click", () => setRenderMode("slide"));

  // Slide navigation
  btnPrevSlide.addEventListener("click", () => {
    if (state.currentSlideIndex > 0) {
      state.currentSlideIndex -= 1;
      updateSlideVisibility();
    }
  });

  btnNextSlide.addEventListener("click", () => {
    if (state.currentSlideIndex + 1 < state.totalSlides) {
      state.currentSlideIndex += 1;
      updateSlideVisibility();
    }
  });

  btnSlideViewMode.addEventListener("click", () => {
    state.slideSingleView = !state.slideSingleView;
    btnSlideViewMode.textContent = state.slideSingleView ? "一覧表示" : "単一表示";
    updateSlideVisibility();
  });

  // Lecture CSS Theme selector & custom CSS editor
  selectLectureTheme.addEventListener("change", () => {
    const selectedId = selectLectureTheme.value;
    state.inlineCustomCss = "";
    applyLectureThemeToPreview(selectedId);
    // フロントマターに既に `theme:` がある場合は自動で書き換え同期する
    updateMarkdownFrontmatterTheme(selectedId, false);
    void compileCurrentMarkdown(false);
    setStatus(`資料テーマを「${selectedId}」に切り替えました`);
  });

  modalThemeEditor.addEventListener("close", () => {
    void handleThemeEditorModalClose();
  });

  btnParentDir.addEventListener("click", () => void navigateToParentDirectory());
  btnRevealExplorer.addEventListener("click", () =>
    void revealInExplorer(state.currentFilePath || state.workspacePath)
  );
  elWorkspacePathLabel.addEventListener("click", () =>
    void revealInExplorer(state.workspacePath)
  );
  btnRefreshTree.addEventListener("click", () => {
    if (fileExplorer) {
      void fileExplorer.refresh();
    } else {
      void loadWorkspace(state.workspacePath);
    }
  });

  // Reveal exported file in Finder / Explorer from export modal
  btnRevealExported.addEventListener("click", () => {
    if (modalExportPath.value) {
      void revealInExplorer(modalExportPath.value);
    }
  });

  btnClearLogs.addEventListener("click", () => {
    activityLogs.length = 0;
    renderActivityLogs();
  });

  // Quick bar chips
  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-insert]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-insert");
      if (key) insertSnippetAtCursor(key);
    });
  });

  const btnInsertImage = document.getElementById("btn-insert-image");
  if (btnInsertImage) {
    btnInsertImage.addEventListener("click", () => void insertImageFlow());
  }

  if (btnToggleScrollSync) {
    btnToggleScrollSync.addEventListener("click", () => {
      const current = settingsController
        ? settingsController.getSettings().syncScroll
        : (editorPreviewSync?.isEnabled() ?? true);
      const next = !current;
      if (settingsController) {
        settingsController.updateSettings({ syncScroll: next });
      } else {
        editorPreviewSync?.setEnabled(next);
        updateScrollSyncToggleUI(next);
      }
      if (next) {
        editorPreviewSync?.syncNow({ smooth: true });
      }
      setStatus(`プレビューのスクロール追従を ${next ? "ON" : "OFF"} にしました`);
    });
  }
}

function updateScrollSyncToggleUI(enabled: boolean): void {
  if (!btnToggleScrollSync) return;
  btnToggleScrollSync.classList.toggle("active", enabled);
  btnToggleScrollSync.setAttribute("aria-pressed", String(enabled));
  btnToggleScrollSync.textContent = enabled ? "🔗 追従同期: ON" : "🔗 追従同期: OFF";
  btnToggleScrollSync.title = enabled
    ? "プレビューのスクロール追従: ON（クリックでOFF）"
    : "プレビューのスクロール追従: OFF（クリックでON）";
}

async function openFolderFlow(): Promise<void> {
  if (state.isDirty && state.currentFilePath) {
    await saveCurrentFile();
  }
  try {
    const selectedPath = await invoke<string | null>("pick_workspace_folder", {
      currentPath: state.workspacePath || null,
    });
    if (selectedPath) {
      state.currentFilePath = "";
      await loadWorkspace(selectedPath);
    }
  } catch (err) {
    // Fallback to text prompt if native dialog fails
    const newPath = await promptModal(
      "講義フォルダ（ワークスペース）の変更",
      "開きたいディレクトリの絶対パスを入力してください:",
      state.workspacePath
    );
    if (newPath) {
      state.currentFilePath = "";
      await loadWorkspace(newPath);
    }
  }
}

async function insertImageFlow(): Promise<void> {
  try {
    const mdImageTag = await invoke<string | null>("pick_image_file", {
      workspacePath: state.workspacePath,
      currentFilePath: state.currentFilePath || null,
    });
    if (mdImageTag) {
      insertRawTextAtCursor(`\n${mdImageTag}\n`);
      setStatus(`画像を挿入しました (Base64自動埋め込み対象)`);
    }
  } catch (err) {
    setStatus(`画像選択エラー: ${String(err)}`);
  }
}

function insertRawTextAtCursor(text: string): void {
  replaceEditorRangeWithUndo(text, elEditor.selectionStart, elEditor.selectionEnd);
}

function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(p);
}

async function setupNativeDragDrop(): Promise<void> {
  try {
    await getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "drop" && event.payload.paths.length > 0) {
        const droppedPath = event.payload.paths[0];
        if (isImagePath(droppedPath)) {
          const normalized = droppedPath.replace(/\\/g, "/");
          const fileName = normalized.split("/").pop() || "image";
          const stem = fileName.replace(/\.[^.]+$/, "");
          const baseDir = getCurrentBaseDir()?.replace(/\\/g, "/");
          const relPath =
            baseDir && normalized.startsWith(baseDir + "/")
              ? normalized.substring(baseDir.length + 1)
              : normalized;
          insertRawTextAtCursor(`\n![${stem}](${relPath})\n`);
          setStatus(`ドロップされた画像を挿入しました: ${fileName}`);
          return;
        }

        try {
          const info = await invoke<DroppedPathInfo>("inspect_dropped_path", {
            path: droppedPath,
          });
          if (state.isDirty && state.currentFilePath) {
            await saveCurrentFile();
          }
          if (info.is_dir) {
            state.currentFilePath = "";
            await loadWorkspace(info.workspace_path);
          } else if (info.file_path && info.file_name) {
            await loadWorkspace(info.workspace_path);
            await openFile(info.file_path, info.file_name);
          }
        } catch (err) {
          setStatus(`ドロップされたパスの読み込みに失敗: ${String(err)}`);
        }
      }
    });
  } catch (_) {
    // Ignore if running outside Tauri webview
  }
}

// ============================================================================
// Resizable Split Panes & Pane Visibility Toggles (with localStorage persistence)
// ============================================================================

const LAYOUT_STORAGE_KEY = "lectern-pane-layout-v1";

interface PaneLayoutState {
  sidebarVisible: boolean;
  previewVisible: boolean;
  sidebarWidthPx: number;
  previewWidthPct: number;
}

const DEFAULT_LAYOUT: PaneLayoutState = {
  sidebarVisible: true,
  previewVisible: true,
  sidebarWidthPx: 240,
  previewWidthPct: 48,
};

const layoutState: PaneLayoutState = loadLayoutState();

function loadLayoutState(): PaneLayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PaneLayoutState>;
      return {
        sidebarVisible: parsed.sidebarVisible ?? DEFAULT_LAYOUT.sidebarVisible,
        previewVisible: parsed.previewVisible ?? DEFAULT_LAYOUT.previewVisible,
        sidebarWidthPx:
          typeof parsed.sidebarWidthPx === "number"
            ? Math.min(520, Math.max(160, parsed.sidebarWidthPx))
            : DEFAULT_LAYOUT.sidebarWidthPx,
        previewWidthPct:
          typeof parsed.previewWidthPct === "number"
            ? Math.min(78, Math.max(20, parsed.previewWidthPct))
            : DEFAULT_LAYOUT.previewWidthPct,
      };
    }
  } catch (_) {}
  return { ...DEFAULT_LAYOUT };
}

function saveLayoutState(): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutState));
  } catch (_) {}
}

function applyLayoutState(): void {
  elPaneSidebar.hidden = !layoutState.sidebarVisible;
  elResizerSidebar.hidden = !layoutState.sidebarVisible;

  elPanePreview.hidden = !layoutState.previewVisible;
  elResizerPreview.hidden = !layoutState.previewVisible;

  elWorkspaceGrid.style.setProperty("--sidebar-width", `${Math.round(layoutState.sidebarWidthPx)}px`);
  elWorkspaceGrid.style.setProperty(
    "--preview-width",
    `${layoutState.previewWidthPct.toFixed(2)}%`
  );

  btnToggleSidebar.classList.toggle("active", layoutState.sidebarVisible);
  btnToggleSidebar.setAttribute("aria-pressed", String(layoutState.sidebarVisible));

  btnTogglePreview.classList.toggle("active", layoutState.previewVisible);
  btnTogglePreview.setAttribute("aria-pressed", String(layoutState.previewVisible));
}

function toggleSidebarVisibility(force?: boolean): void {
  layoutState.sidebarVisible = force ?? !layoutState.sidebarVisible;
  applyLayoutState();
  saveLayoutState();
  setStatus(
    layoutState.sidebarVisible
      ? "ファイルエクスプローラーを表示しました"
      : "ファイルエクスプローラーを非表示にしました"
  );
}

function togglePreviewVisibility(force?: boolean): void {
  const wasHidden = !layoutState.previewVisible;
  layoutState.previewVisible = force ?? !layoutState.previewVisible;
  applyLayoutState();
  saveLayoutState();
  if (wasHidden && layoutState.previewVisible) {
    void compileCurrentMarkdown(false);
  }
  setStatus(
    layoutState.previewVisible
      ? "プレビューウィンドウを表示しました"
      : "プレビューウィンドウを非表示にしました"
  );
}

function setupPaneLayoutAndResizers(): void {
  applyLayoutState();

  // Toggle & Close buttons
  btnToggleSidebar.addEventListener("click", () => toggleSidebarVisibility());
  btnCloseSidebar.addEventListener("click", () => toggleSidebarVisibility(false));

  btnTogglePreview.addEventListener("click", () => togglePreviewVisibility());

  // Global keyboard shortcuts: Cmd/Ctrl + B (Sidebar), Cmd/Ctrl + \ (Preview), Cmd/Ctrl + , (Settings), Cmd/Ctrl + Shift + O (Outline)
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
      if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        outlineQuickJump?.open();
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebarVisibility();
      } else if (e.key === "\\") {
        e.preventDefault();
        togglePreviewVisibility();
      } else if (e.key === ",") {
        e.preventDefault();
        settingsController?.openModal();
      }
    }
  });

  // 1. Left Resizer (Sidebar width in px)
  let draggingSidebar = false;
  elResizerSidebar.addEventListener("pointerdown", (e) => {
    draggingSidebar = true;
    elResizerSidebar.classList.add("dragging");
    document.body.classList.add("is-resizing");
    elResizerSidebar.setPointerCapture(e.pointerId);
  });

  elResizerSidebar.addEventListener("pointermove", (e) => {
    if (!draggingSidebar) return;
    const gridRect = elWorkspaceGrid.getBoundingClientRect();
    const previewActualW = layoutState.previewVisible
      ? elPanePreview.getBoundingClientRect().width
      : 0;
    const maxAllowed = Math.min(520, Math.max(160, gridRect.width - previewActualW - 260));
    const nextWidth = Math.min(maxAllowed, Math.max(160, e.clientX - gridRect.left));
    layoutState.sidebarWidthPx = nextWidth;
    elWorkspaceGrid.style.setProperty("--sidebar-width", `${Math.round(nextWidth)}px`);
  });

  const endSidebarDrag = () => {
    if (!draggingSidebar) return;
    draggingSidebar = false;
    elResizerSidebar.classList.remove("dragging");
    document.body.classList.remove("is-resizing");
    saveLayoutState();
  };
  elResizerSidebar.addEventListener("pointerup", endSidebarDrag);
  elResizerSidebar.addEventListener("pointercancel", endSidebarDrag);

  elResizerSidebar.addEventListener("dblclick", () => {
    layoutState.sidebarWidthPx = DEFAULT_LAYOUT.sidebarWidthPx;
    applyLayoutState();
    saveLayoutState();
    setStatus("ファイル一覧の幅をデフォルトにリセットしました");
  });

  elResizerSidebar.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      layoutState.sidebarWidthPx = Math.max(160, layoutState.sidebarWidthPx - 20);
      applyLayoutState();
      saveLayoutState();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      layoutState.sidebarWidthPx = Math.min(520, layoutState.sidebarWidthPx + 20);
      applyLayoutState();
      saveLayoutState();
    }
  });

  // 2. Right Resizer (Preview width in %)
  let draggingPreview = false;
  elResizerPreview.addEventListener("pointerdown", (e) => {
    draggingPreview = true;
    elResizerPreview.classList.add("dragging");
    document.body.classList.add("is-resizing");
    elResizerPreview.setPointerCapture(e.pointerId);
  });

  elResizerPreview.addEventListener("pointermove", (e) => {
    if (!draggingPreview) return;
    const gridRect = elWorkspaceGrid.getBoundingClientRect();
    if (gridRect.width <= 0) return;

    const sidebarActualW = layoutState.sidebarVisible
      ? elPaneSidebar.getBoundingClientRect().width
      : 0;
    const minPreviewPx = 260;
    const maxPreviewPx = Math.max(minPreviewPx, gridRect.width - sidebarActualW - 260);
    const desiredPx = Math.min(maxPreviewPx, Math.max(minPreviewPx, gridRect.right - e.clientX));
    const pct = (desiredPx / gridRect.width) * 100;

    layoutState.previewWidthPct = Math.min(78, Math.max(20, pct));
    elWorkspaceGrid.style.setProperty(
      "--preview-width",
      `${layoutState.previewWidthPct.toFixed(2)}%`
    );
  });

  const endPreviewDrag = () => {
    if (!draggingPreview) return;
    draggingPreview = false;
    elResizerPreview.classList.remove("dragging");
    document.body.classList.remove("is-resizing");
    saveLayoutState();
  };
  elResizerPreview.addEventListener("pointerup", endPreviewDrag);
  elResizerPreview.addEventListener("pointercancel", endPreviewDrag);

  elResizerPreview.addEventListener("dblclick", () => {
    layoutState.previewWidthPct = DEFAULT_LAYOUT.previewWidthPct;
    applyLayoutState();
    saveLayoutState();
    setStatus("プレビューの幅をデフォルトにリセットしました");
  });

  elResizerPreview.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      layoutState.previewWidthPct = Math.min(78, layoutState.previewWidthPct + 3);
      applyLayoutState();
      saveLayoutState();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      layoutState.previewWidthPct = Math.max(20, layoutState.previewWidthPct - 3);
      applyLayoutState();
      saveLayoutState();
    }
  });
}

// ============================================================================
// Recent Workspaces History (Latest 10) & Auto-Restore on Launch
// ============================================================================

const RECENT_WORKSPACES_STORAGE_KEY = "lectern-recent-workspaces-v1";
const MAX_RECENT_WORKSPACES = 10;

let recentWorkspaces: string[] = loadRecentWorkspaces();

function loadRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, MAX_RECENT_WORKSPACES);
  } catch (_) {
    return [];
  }
}

function saveRecentWorkspaces(): void {
  try {
    localStorage.setItem(
      RECENT_WORKSPACES_STORAGE_KEY,
      JSON.stringify(recentWorkspaces.slice(0, MAX_RECENT_WORKSPACES))
    );
  } catch (_) {}
}

interface MenuActionPayload {
  action: string;
  path: string | null;
}

async function syncRecentWorkspacesToNativeMenu(): Promise<void> {
  try {
    await invoke("update_recent_workspaces_menu", {
      recentPaths: recentWorkspaces.slice(0, MAX_RECENT_WORKSPACES),
    });
  } catch (_) {
    // Ignore when running outside Tauri
  }
}

function recordRecentWorkspace(workspacePath: string): void {
  const normalized = workspacePath.trim();
  if (!normalized) return;
  recentWorkspaces = [
    normalized,
    ...recentWorkspaces.filter((p) => p !== normalized),
  ].slice(0, MAX_RECENT_WORKSPACES);
  saveRecentWorkspaces();
  void syncRecentWorkspacesToNativeMenu();
}

function removeRecentWorkspace(workspacePath: string): void {
  recentWorkspaces = recentWorkspaces.filter((p) => p !== workspacePath);
  saveRecentWorkspaces();
  void syncRecentWorkspacesToNativeMenu();
}

async function openRecentWorkspacePath(dirPath: string): Promise<void> {
  if (state.isDirty && state.currentFilePath) {
    await saveCurrentFile();
  }
  state.currentFilePath = "";
  const ok = await loadWorkspace(dirPath, { silentError: true });
  if (!ok) {
    removeRecentWorkspace(dirPath);
    const defaultWs = await invoke<string>("get_default_workspace");
    await loadWorkspace(defaultWs);
    setStatus(
      `フォルダが見つかりませんでした (${dirPath})。履歴から削除し、サンプルフォルダを開きました`
    );
  }
}

async function setupNativeMenuListener(): Promise<void> {
  try {
    await listen<MenuActionPayload>("menu-action", (event) => {
      const { action, path } = event.payload;
      switch (action) {
        case "file:new":
          void createNewFileFlow();
          break;
        case "file:open-folder":
          void openFolderFlow();
          break;
        case "file:open-recent":
          if (path) {
            void openRecentWorkspacePath(path);
          }
          break;
        case "file:clear-recent":
          recentWorkspaces = state.workspacePath ? [state.workspacePath] : [];
          saveRecentWorkspaces();
          void syncRecentWorkspacesToNativeMenu();
          setStatus("過去のフォルダ履歴をクリアしました");
          break;
        case "file:save":
          void saveCurrentFile();
          break;
        case "file:export-html":
          void exportHtmlFlow();
          break;
        case "file:export-slideshow":
          void exportSlideshowHtmlFlow();
          break;
        case "file:export-pdf":
          void exportPdfFlow();
          break;
        case "file:reveal-explorer":
          void revealInExplorer(state.currentFilePath || state.workspacePath);
          break;
        case "edit:find":
          findReplaceController?.openFind(false);
          break;
        case "edit:replace":
          findReplaceController?.openFind(true);
          break;
        case "edit:goto-line":
          void gotoLineFlow();
          break;
        case "edit:open-outline":
          outlineQuickJump?.open();
          break;
        case "edit:duplicate-line":
          duplicateSelectedLines(elEditor, replaceEditorRangeWithUndo);
          break;
        case "edit:delete-line":
          deleteSelectedLines(elEditor, replaceEditorRangeWithUndo);
          break;
        case "edit:insert-image":
          void insertImageFlow();
          break;
        case "view:mode-document":
          setRenderMode("document");
          break;
        case "view:mode-slide":
          setRenderMode("slide");
          break;
        case "view:toggle-sidebar":
          toggleSidebarVisibility();
          break;
        case "view:toggle-preview":
          togglePreviewVisibility();
          break;
        case "view:edit-theme":
          openCustomThemeEditorModal();
          break;
        case "view:toggle-color-scheme":
          toggleColorScheme();
          break;
        case "view:open-logs":
          openActivityLogsModal();
          break;
        case "help:open-manual":
          openUserManualModal();
          break;
        case "help:open-guide":
          modalHelp.returnValue = "";
          modalHelp.showModal();
          break;
        case "app:open-settings":
          settingsController?.openModal();
          break;
        case "app:check-update":
          void checkForUpdatesFlow(true);
          break;
      }
    });
  } catch (_) {
    // Ignore when running outside Tauri
  }
}

function confirmUnsavedBeforeClose(): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const targetName = state.currentFileName || "無題のドキュメント";
    modalUnsavedDesc.textContent = `「${targetName}」に未保存の変更があります。終了する前に保存しますか？`;
    modalUnsavedClose.returnValue = "";

    const onClose = () => {
      modalUnsavedClose.removeEventListener("close", onClose);
      const ret = modalUnsavedClose.returnValue;
      modalUnsavedClose.returnValue = "";
      if (ret === "save" || ret === "discard") {
        resolve(ret);
      } else {
        resolve("cancel");
      }
    };

    modalUnsavedClose.addEventListener("close", onClose);
    modalUnsavedClose.showModal();
  });
}

async function setupUnsavedCloseGuard(): Promise<void> {
  // Browser fallback
  window.addEventListener("beforeunload", (e) => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Tauri native window close interception
  try {
    const appWindow = getCurrentWindow();
    let handlingClose = false;
    await appWindow.onCloseRequested(async (event) => {
      if (!state.isDirty) {
        return;
      }
      event.preventDefault();
      if (handlingClose) return;
      handlingClose = true;
      try {
        const choice = await confirmUnsavedBeforeClose();
        if (choice === "save") {
          await saveCurrentFile();
          if (!state.isDirty) {
            await appWindow.destroy();
          }
        } else if (choice === "discard") {
          state.isDirty = false;
          await appWindow.destroy();
        }
      } finally {
        handlingClose = false;
      }
    });
  } catch (_) {
    // Ignore when running outside Tauri
  }
}

// ============================================================================
// Self-Updater (GitHub Releases: https://github.com/Nagatani/lectern)
// ============================================================================

async function checkForUpdatesFlow(manual: boolean): Promise<void> {
  if (manual) {
    elUpdaterTitle.textContent = "🔄 アップデートの確認";
    elUpdaterMessage.textContent =
      "GitHub Releases (Nagatani/lectern) の最新バージョンを確認しています...";
    elUpdaterNotes.hidden = true;
    elUpdaterNotes.textContent = "";
    elUpdaterProgressWrap.hidden = true;
    btnUpdaterInstall.hidden = true;
    btnUpdaterInstall.disabled = false;
    btnUpdaterClose.textContent = "閉じる";
    modalUpdater.returnValue = "";
    modalUpdater.showModal();
  }

  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      elUpdaterTitle.textContent = `🎉 新しいバージョン v${update.version} が利用可能です`;
      elUpdaterMessage.textContent = `現在のバージョン v${update.currentVersion} から v${update.version} へアップデートできます。`;
      if (update.body && update.body.trim()) {
        elUpdaterNotes.textContent = update.body.trim();
        elUpdaterNotes.hidden = false;
      } else {
        elUpdaterNotes.hidden = true;
      }
      elUpdaterProgressWrap.hidden = true;
      btnUpdaterInstall.hidden = false;
      btnUpdaterInstall.disabled = false;
      btnUpdaterClose.textContent = "あとで";
      setStatus(`新しいバージョン v${update.version} が見つかりました`);
      if (!modalUpdater.open) {
        modalUpdater.returnValue = "";
        modalUpdater.showModal();
      }
    } else if (manual) {
      elUpdaterTitle.textContent = "✅ 最新バージョンです";
      elUpdaterMessage.textContent = "現在お使いの Lectern は最新バージョンです。";
      btnUpdaterInstall.hidden = true;
      btnUpdaterClose.textContent = "閉じる";
      setStatus("アップデート確認完了: 最新バージョンです");
    }
  } catch (err) {
    const errText = String(err);
    setStatus(`アップデート確認スキップ / エラー: ${errText}`);
    if (manual) {
      elUpdaterTitle.textContent = "⚠️ アップデートを確認できませんでした";
      elUpdaterMessage.textContent =
        `GitHub Releases からの確認に失敗しました。オフライン環境、または署名公開鍵 (pubkey) / latest.json が未設定の可能性があります。\n詳細: ${errText}`;
      btnUpdaterInstall.hidden = true;
      btnUpdaterClose.textContent = "閉じる";
    }
  }
}

async function installPendingUpdate(): Promise<void> {
  if (!pendingUpdate) return;
  btnUpdaterInstall.disabled = true;
  btnUpdaterClose.disabled = true;
  elUpdaterProgressWrap.hidden = false;
  elUpdaterProgress.value = 0;
  elUpdaterProgressLabel.textContent = "アップデートをダウンロード中...";

  try {
    if (state.isDirty && state.currentFilePath) {
      await saveCurrentFile();
    }

    let totalBytes = 0;
    let downloadedBytes = 0;

    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength ?? 0;
        downloadedBytes = 0;
        elUpdaterProgressLabel.textContent =
          totalBytes > 0
            ? `ダウンロード開始 (0% / ${(totalBytes / 1048576).toFixed(1)} MB)`
            : "ダウンロード開始...";
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        if (totalBytes > 0) {
          const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          elUpdaterProgress.value = pct;
          elUpdaterProgressLabel.textContent = `ダウンロード中... ${pct}% (${(
            downloadedBytes / 1048576
          ).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB)`;
        } else {
          elUpdaterProgressLabel.textContent = `ダウンロード中... ${(
            downloadedBytes / 1048576
          ).toFixed(1)} MB`;
        }
      } else if (event.event === "Finished") {
        elUpdaterProgress.value = 100;
        elUpdaterProgressLabel.textContent = "インストール完了。アプリを再起動します...";
      }
    });

    state.isDirty = false;
    await relaunch();
  } catch (err) {
    btnUpdaterInstall.disabled = false;
    btnUpdaterClose.disabled = false;
    elUpdaterMessage.textContent = `アップデートの適用に失敗しました: ${String(err)}`;
    setStatus(`アップデート適用エラー: ${String(err)}`);
  }
}

async function initApp(): Promise<void> {
  settingsController = createSettingsController({
    onChange: (settings) => {
      editorPreviewSync?.setEnabled(settings.syncScroll);
      updateScrollSyncToggleUI(settings.syncScroll);
      if (settings.autoSave && state.isDirty && state.currentFilePath) {
        scheduleAutoSave();
      } else if (!settings.autoSave) {
        clearAutoSaveTimer();
      }
    },
    onLog: setStatus,
  });
  updateScrollSyncToggleUI(settingsController.getSettings().syncScroll);
  outlineQuickJump = createOutlineQuickJump({
    getMarkdown: () => elEditor.value,
    getCurrentLine: () => getCursorLineCol(elEditor).line,
    onSelectHeading: (heading) => {
      jumpToLine(elEditor, heading.line);
      updateCursorPosIndicator();
      editorPreviewSync?.syncNow({ smooth: true });
    },
    onStatus: setStatus,
  });
  editorPreviewSync = createEditorPreviewSync({
    editor: elEditor,
    previewViewport: elPreviewViewport,
    getMode: () => state.mode,
    getCurrentSlideIndex: () => state.currentSlideIndex,
    onSlideChange: (slideIndex) => {
      if (state.mode !== "slide") return;
      const clamped = Math.max(0, Math.min(slideIndex, Math.max(0, state.totalSlides - 1)));
      if (clamped !== state.currentSlideIndex) {
        state.currentSlideIndex = clamped;
        updateSlideVisibility();
      }
    },
    initialEnabled: settingsController.getSettings().syncScroll,
  });
  bindEvents();
  fileExplorer = setupFileExplorer();
  btnUpdaterInstall.addEventListener("click", () => void installPendingUpdate());
  findReplaceController = setupFindReplaceBar(
    elEditor,
    replaceEditorRangeWithUndo,
    setStatus
  );
  setupPaneLayoutAndResizers();
  void setupNativeMenuListener();
  void setupUnsavedCloseGuard();
  void setupNativeDragDrop();
  // 起動後しばらくしてからバックグラウンドで静かにアップデート確認（オフライン時は無視）
  window.setTimeout(() => {
    void checkForUpdatesFlow(false);
  }, 4000);
  try {
    await syncRecentWorkspacesToNativeMenu();

    // 前回最後に開いていたディレクトリがあれば優先して開く
    const lastDir = recentWorkspaces[0];
    if (lastDir) {
      const restored = await loadWorkspace(lastDir, { silentError: true });
      if (restored) {
        return;
      }
      // 見つからない場合は履歴から取り除き、サンプルディレクトリへフォールバック
      removeRecentWorkspace(lastDir);
      const defaultWs = await invoke<string>("get_default_workspace");
      await loadWorkspace(defaultWs);
      setStatus(
        `前回開いていたフォルダ (${lastDir}) が見つからなかったため、サンプルフォルダを開きました`
      );
      return;
    }

    const defaultWs = await invoke<string>("get_default_workspace");
    await loadWorkspace(defaultWs);
  } catch (err) {
    console.warn("Running outside Tauri or init error:", err);
    setStatus("Tauriバックエンドに接続待機中...");
  }
}

void initApp();
