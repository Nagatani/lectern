import { invoke } from "@tauri-apps/api/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";

// ============================================================================
// Types matching Rust Backend structs
// ============================================================================

interface FileEntry {
  name: string;
  path: string;
  rel_path: string;
  is_dir: boolean;
}

interface CompileResult {
  html: string;
  slide_count: number;
  title: string;
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
const elLineNumbers = document.getElementById("line-numbers") as HTMLDivElement;
const elEditorStats = document.getElementById("editor-stats") as HTMLSpanElement;
const elPreviewViewport = document.getElementById("preview-viewport") as HTMLDivElement;
const elPreviewContent = document.getElementById("preview-content") as HTMLElement;
const elPreviewTitle = document.getElementById("preview-title") as HTMLSpanElement;
const elCompileTime = document.getElementById("compile-time") as HTMLSpanElement;
const elFileTree = document.getElementById("file-tree") as HTMLUListElement;
const elWorkspacePathLabel = document.getElementById("workspace-path-label") as HTMLDivElement;
const elCurrentFileIndicator = document.getElementById("current-file-indicator") as HTMLSpanElement;
const elSaveStatusBadge = document.getElementById("save-status-badge") as HTMLSpanElement;
const elStatusMessage = document.getElementById("status-message") as HTMLDivElement;
const elActiveThemeIndicator = document.getElementById("active-theme-indicator") as HTMLSpanElement;
const elPreviewThemeStyle = document.getElementById("preview-theme-style") as HTMLStyleElement;

const btnOpenFolder = document.getElementById("btn-open-folder") as HTMLButtonElement;
const btnNewFile = document.getElementById("btn-new-file") as HTMLButtonElement;
const btnSaveFile = document.getElementById("btn-save-file") as HTMLButtonElement;
const btnRefreshTree = document.getElementById("btn-refresh-tree") as HTMLButtonElement;
const btnModeDoc = document.getElementById("mode-document") as HTMLButtonElement;
const btnModeSlide = document.getElementById("mode-slide") as HTMLButtonElement;
const elSlideNav = document.getElementById("slide-nav") as HTMLDivElement;
const btnPrevSlide = document.getElementById("btn-prev-slide") as HTMLButtonElement;
const btnNextSlide = document.getElementById("btn-next-slide") as HTMLButtonElement;
const elSlideCounter = document.getElementById("slide-counter") as HTMLSpanElement;
const btnSlideViewMode = document.getElementById("btn-slide-view-mode") as HTMLButtonElement;

const selectLectureTheme = document.getElementById("select-lecture-theme") as HTMLSelectElement;
const btnEditTheme = document.getElementById("btn-edit-theme") as HTMLButtonElement;

const btnExportHtml = document.getElementById("btn-export-html") as HTMLButtonElement;
const btnExportPdf = document.getElementById("btn-export-pdf") as HTMLButtonElement;
const btnThemeToggle = document.getElementById("btn-theme-toggle") as HTMLButtonElement;
const btnHelp = document.getElementById("btn-help") as HTMLButtonElement;

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

const modalHelp = document.getElementById("modal-help") as HTMLDialogElement;

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
 */
function updateMarkdownFrontmatterTheme(newThemeId: string, insertIfMissing: boolean): void {
  const raw = elEditor.value.replace(/\r\n/g, "\n");
  if (!raw.startsWith("---\n")) {
    if (!insertIfMissing) return;
    elEditor.value = `---\ntheme: ${newThemeId}\n---\n\n${raw}`;
    markDirty(true);
    updateLineNumbersAndStats();
    return;
  }

  const endIdx = raw.indexOf("\n---\n", 4);
  if (endIdx === -1) return;

  const yamlPart = raw.substring(4, endIdx);
  const restPart = raw.substring(endIdx + 5);
  const lines = yamlPart.split("\n");

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

  const nextValue = `---\n${updatedLines.join("\n")}\n---\n${restPart}`;
  if (nextValue !== raw) {
    elEditor.value = nextValue;
    markDirty(true);
    updateLineNumbersAndStats();
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

async function renderMathAndDiagrams(container: HTMLElement): Promise<void> {
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
      const code = block.getAttribute("data-mermaid");
      if (!code) continue;
      try {
        mermaidCounter += 1;
        const id = `mermaid-svg-${Date.now()}-${mermaidCounter}`;
        const { svg } = await mermaid.render(id, code, sandbox);
        block.innerHTML = svg;
      } catch (err) {
        block.innerHTML = `<pre style="color:#ef4444;font-size:12px;">Mermaid Syntax Error:\n${escapeHtml(
          String(err)
        )}</pre>`;
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
}

function markDirty(dirty: boolean): void {
  state.isDirty = dirty;
  if (dirty) {
    elSaveStatusBadge.textContent = "Modified";
    elSaveStatusBadge.className = "status-badge dirty";
  } else {
    elSaveStatusBadge.textContent = "Saved";
    elSaveStatusBadge.className = "status-badge saved";
  }
}

function setStatus(msg: string): void {
  elStatusMessage.textContent = msg;
}

let compileTimer: number | null = null;

function scheduleCompile(): void {
  if (compileTimer !== null) {
    window.clearTimeout(compileTimer);
  }
  compileTimer = window.setTimeout(() => {
    void compileCurrentMarkdown();
  }, 120);
}

async function compileCurrentMarkdown(syncThemeFromFrontmatter = true): Promise<void> {
  const markdown = elEditor.value;
  try {
    const res = await invoke<CompileResult>("compile_markdown", {
      markdown,
      mode: state.mode,
      themeId: syncThemeFromFrontmatter ? null : state.currentThemeId,
    });
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
    elCompileTime.textContent = `Rust Engine: ${res.elapsed_ms} ms`;

    await renderMathAndDiagrams(elPreviewContent);
    updateSlideVisibility();
  } catch (err) {
    console.error("Compile error:", err);
    setStatus(`変換エラー: ${String(err)}`);
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
    elPreviewTitle.textContent = "👁️ プレビュー (ドキュメント形式・A4縦)";
  } else {
    btnModeSlide.classList.add("active");
    btnModeDoc.classList.remove("active");
    elPreviewViewport.className = "preview-viewport mode-slide";
    elPreviewTitle.textContent = "👁️ プレビュー (スライド形式・16:9)";
  }
  void compileCurrentMarkdown();
}

// ============================================================================
// Workspace & File Browser Operations
// ============================================================================

async function loadWorkspace(workspacePath: string): Promise<void> {
  try {
    const entries = await invoke<FileEntry[]>("list_workspace_files", {
      workspacePath,
    });
    state.workspacePath = workspacePath;
    elWorkspacePathLabel.textContent = workspacePath;
    elWorkspacePathLabel.title = workspacePath;

    await loadThemes();
    renderFileTree(entries);
    setStatus(`ワークスペースを読み込みました (${entries.length} 項目)`);

    // Auto-open the first markdown file if none is open
    const firstMd = entries.find((e) => !e.is_dir && e.name.endsWith(".md"));
    if (firstMd && !state.currentFilePath) {
      await openFile(firstMd.path, firstMd.rel_path);
    }
  } catch (err) {
    setStatus(`フォルダ読み込み失敗: ${String(err)}`);
  }
}

function renderFileTree(entries: FileEntry[]): void {
  elFileTree.innerHTML = "";
  for (const entry of entries) {
    const li = document.createElement("li");
    if (entry.is_dir) {
      li.className = "file-tree-dir";
      li.textContent = `📁 ${entry.rel_path}`;
      elFileTree.appendChild(li);
      continue;
    }

    li.className = "file-tree-item";
    if (entry.path === state.currentFilePath) {
      li.classList.add("active");
    }

    const spanName = document.createElement("span");
    spanName.className = "file-item-name";
    spanName.textContent = `📝 ${entry.rel_path}`;

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "file-delete-btn";
    btnDel.title = "ファイルを削除";
    btnDel.textContent = "🗑";
    btnDel.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await deleteFile(entry.path, entry.rel_path);
    });

    li.appendChild(spanName);
    li.appendChild(btnDel);

    li.addEventListener("click", async () => {
      if (state.isDirty && state.currentFilePath) {
        await saveCurrentFile();
      }
      await openFile(entry.path, entry.rel_path);
    });

    elFileTree.appendChild(li);
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

    // Update active state in tree
    const entries = await invoke<FileEntry[]>("list_workspace_files", {
      workspacePath: state.workspacePath,
    });
    renderFileTree(entries);

    await compileCurrentMarkdown();
    setStatus(`ファイルを開きました: ${displayName}`);
  } catch (err) {
    setStatus(`ファイル読み込みエラー: ${String(err)}`);
  }
}

async function saveCurrentFile(): Promise<void> {
  if (!state.currentFilePath) {
    await createNewFileFlow();
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

async function createNewFileFlow(): Promise<void> {
  const name = await promptModal(
    "新規講義ファイルの作成",
    "作成するMarkdownファイル名を入力してください（例: lecture03_graph.md）",
    "new_lecture.md"
  );
  if (!name) return;

  try {
    const createdPath = await invoke<string>("create_markdown_file", {
      workspacePath: state.workspacePath,
      fileName: name,
    });
    await loadWorkspace(state.workspacePath);
    const rel = name.endsWith(".md") ? name : `${name}.md`;
    await openFile(createdPath, rel);
    setStatus(`新規ファイルを作成しました: ${rel}`);
  } catch (err) {
    setStatus(`作成エラー: ${String(err)}`);
  }
}

async function deleteFile(filePath: string, relPath: string): Promise<void> {
  const confirmName = await promptModal(
    "ファイルの削除確認",
    `「${relPath}」を削除しますか？ 決定を押すと削除されます。`,
    relPath
  );
  if (!confirmName) return;

  try {
    await invoke("delete_markdown_file", { filePath });
    if (state.currentFilePath === filePath) {
      state.currentFilePath = "";
      state.currentFileName = "";
      elEditor.value = "";
      elCurrentFileIndicator.textContent = "未選択";
    }
    await loadWorkspace(state.workspacePath);
    setStatus(`削除しました: ${relPath}`);
  } catch (err) {
    setStatus(`削除エラー: ${String(err)}`);
  }
}

// ============================================================================
// Export to Standalone HTML & High-Quality PDF
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
  setStatus(`HTMLファイルを生成しています (テーマ: ${state.currentThemeId})...`);
  try {
    const renderedBodyHtml = getFullyRenderedPreviewHtml();
    const res = await invoke<ExportResult>("export_lecture_html", {
      sourcePath: state.currentFilePath || null,
      workspacePath: state.workspacePath,
      markdown: elEditor.value,
      renderedBodyHtml,
      mode: state.mode,
      themeId: state.currentThemeId,
      customCss: state.inlineCustomCss || null,
    });
    setStatus(res.message);
    showExportModal("🌐 HTML出力完了", res.message, res.output_path);
  } catch (err) {
    setStatus(`HTML出力エラー: ${String(err)}`);
  }
}

async function exportPdfFlow(): Promise<void> {
  if (state.isDirty && state.currentFilePath) {
    await saveCurrentFile();
  }
  setStatus(`ブラウザ印刷エンジンでPDFを生成しています (テーマ: ${state.currentThemeId})...`);
  try {
    const renderedBodyHtml = getFullyRenderedPreviewHtml();
    const res = await invoke<ExportResult>("export_lecture_pdf", {
      sourcePath: state.currentFilePath || null,
      workspacePath: state.workspacePath,
      markdown: elEditor.value,
      renderedBodyHtml,
      mode: state.mode,
      themeId: state.currentThemeId,
      customCss: state.inlineCustomCss || null,
    });
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

function insertSnippetAtCursor(snippetKey: string): void {
  const snippet = SNIPPETS[snippetKey];
  if (!snippet) return;

  const start = elEditor.selectionStart;
  const end = elEditor.selectionEnd;
  const value = elEditor.value;

  elEditor.value = value.substring(0, start) + snippet + value.substring(end);
  elEditor.selectionStart = elEditor.selectionEnd = start + snippet.length;
  elEditor.focus();

  markDirty(true);
  updateLineNumbersAndStats();
  scheduleCompile();
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

  elEditor.addEventListener("scroll", () => {
    elLineNumbers.scrollTop = elEditor.scrollTop;
  });

  elEditor.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void saveCurrentFile();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const start = elEditor.selectionStart;
      const end = elEditor.selectionEnd;
      elEditor.value = elEditor.value.substring(0, start) + "  " + elEditor.value.substring(end);
      elEditor.selectionStart = elEditor.selectionEnd = start + 2;
      markDirty(true);
      updateLineNumbersAndStats();
      scheduleCompile();
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

  btnEditTheme.addEventListener("click", () => {
    openCustomThemeEditorModal();
  });

  modalThemeEditor.addEventListener("close", () => {
    void handleThemeEditorModalClose();
  });

  // Workspace controls (OS native directory picker dialog)
  btnOpenFolder.addEventListener("click", async () => {
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
  });

  btnNewFile.addEventListener("click", () => void createNewFileFlow());
  btnSaveFile.addEventListener("click", () => void saveCurrentFile());
  btnRefreshTree.addEventListener("click", () => void loadWorkspace(state.workspacePath));

  // Export buttons
  btnExportHtml.addEventListener("click", () => void exportHtmlFlow());
  btnExportPdf.addEventListener("click", () => void exportPdfFlow());

  // App UI Theme & Help
  btnThemeToggle.addEventListener("click", toggleColorScheme);
  btnHelp.addEventListener("click", () => {
    modalHelp.returnValue = "";
    modalHelp.showModal();
  });

  // Quick bar chips
  document.querySelectorAll<HTMLButtonElement>(".chip-btn[data-insert]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-insert");
      if (key) insertSnippetAtCursor(key);
    });
  });
}

async function initApp(): Promise<void> {
  bindEvents();
  try {
    const defaultWs = await invoke<string>("get_default_workspace");
    await loadWorkspace(defaultWs);
  } catch (err) {
    console.warn("Running outside Tauri or init error:", err);
    setStatus("Tauriバックエンドに接続待機中...");
  }
}

void initApp();
