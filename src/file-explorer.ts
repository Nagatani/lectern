import "./file-explorer.css";

// ============================================================================
// Public Types
// ============================================================================

export interface ExplorerFileEntry {
  name: string;
  path: string;
  rel_path: string;
  is_dir: boolean;
  can_open: boolean;
  extension: string | null;
}

export interface FileExplorerDeps {
  /** The `<ul id="file-tree">` element that hosts the file tree */
  treeEl: HTMLUListElement;
  /** Optional external filter `<input>`. If omitted, a VSCode-style filter & action bar is auto-injected above `treeEl`. */
  filterInputEl?: HTMLInputElement | null;
  /** Return current workspace root directory path */
  getWorkspacePath: () => string;
  /** Return currently active (open) file path, or empty string */
  getActiveFilePath: () => string;

  /** List direct children of a directory */
  listDirectory: (dirPath: string) => Promise<ExplorerFileEntry[]>;
  /** Open a Markdown file in the editor */
  onOpenFile: (filePath: string, fileName: string) => Promise<void> | void;
  /** Switch workspace root to a subdirectory */
  onOpenWorkspace: (dirPath: string) => Promise<void> | void;
  /** Switch workspace root to its parent directory ("..") */
  onNavigateParent: () => Promise<void> | void;

  /** Create a new file inside `parentDir`; return created absolute path or null if cancelled */
  onCreateFile: (parentDir: string, fileName: string) => Promise<string | null>;
  /** Create a new folder inside `parentDir`; return created absolute path or null if cancelled */
  onCreateFolder: (parentDir: string, folderName: string) => Promise<string | null>;
  /** Rename a file or folder; return new absolute path */
  onRenameEntry: (oldPath: string, newName: string) => Promise<string>;
  /** Delete a file or folder (caller may confirm first); return true if deleted */
  onDeleteEntry: (targetPath: string, displayName: string, isDir: boolean) => Promise<boolean>;
  /** Reveal path in macOS Finder / Windows Explorer / Linux file manager */
  onRevealInExplorer: (targetPath: string) => Promise<void> | void;

  /** Optional status/activity log callback */
  onStatus?: (message: string) => void;
  /** Optional callback after an entry is renamed */
  onEntryRenamed?: (oldPath: string, newPath: string, isDir: boolean) => void;
  /** Optional callback after an entry is deleted */
  onEntryDeleted?: (deletedPath: string, isDir: boolean) => void;
  /** Optional clipboard writer override */
  copyToClipboard?: (text: string) => Promise<void>;
}

export interface FileExplorerController {
  /** Load a workspace root directory and render the tree */
  loadRoot(
    workspacePath: string,
    options?: { preserveExpanded?: boolean }
  ): Promise<ExplorerFileEntry[]>;
  /** Reload the current workspace root and all currently expanded folders */
  refresh(): Promise<void>;
  /** Update the active file highlight and optionally auto-expand & scroll to reveal it */
  setActiveFile(filePath: string, options?: { reveal?: boolean }): Promise<void>;
  /** Collapse all expanded folders */
  collapseAll(): void;
  /** Start inline New File input in `parentDir` (defaults to selected folder or workspace root) */
  startNewFile(parentDir?: string): Promise<void>;
  /** Start inline New Folder input in `parentDir` (defaults to selected folder or workspace root) */
  startNewFolder(parentDir?: string): Promise<void>;
  /** Start inline Rename on `targetPath` (defaults to currently selected item) */
  startRename(targetPath?: string): void;
  /** Delete `targetPath` (defaults to currently selected item) */
  deleteSelected(targetPath?: string): Promise<void>;
  /** Set filter query programmatically */
  setFilter(query: string): void;
  /** Focus the filter input */
  focusFilter(): void;
  /** Return currently selected entry path, or null */
  getSelectedPath(): string | null;
  /** Tear down event listeners and injected DOM */
  destroy(): void;
}

// ============================================================================
// Path & Formatting Helpers
// ============================================================================

function normalizeSlash(p: string): string {
  const replaced = p.replace(/\\/g, "/");
  if (replaced.length > 1 && replaced.endsWith("/")) {
    return replaced.slice(0, -1);
  }
  return replaced;
}

function basenamePath(p: string): string {
  const norm = normalizeSlash(p);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function dirnamePath(p: string): string {
  const hasBackslash = p.includes("\\") && !p.includes("/");
  const norm = normalizeSlash(p);
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) {
    return idx === 0 ? "/" : p;
  }
  const dir = norm.slice(0, idx);
  return hasBackslash ? dir.replace(/\//g, "\\") : dir;
}

function getRelativePath(rootPath: string, targetPath: string): string {
  const normRoot = normalizeSlash(rootPath);
  const normTarget = normalizeSlash(targetPath);
  if (normTarget === normRoot) {
    return ".";
  }
  const prefix = normRoot === "/" ? "/" : `${normRoot}/`;
  if (normTarget.startsWith(prefix)) {
    return normTarget.slice(prefix.length);
  }
  return targetPath;
}

function isMarkdownPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function validateInlineName(raw: string): string | null {
  const clean = raw.trim();
  if (!clean) return "名前を入力してください";
  if (clean === "." || clean === "..") return "「.」や「..」は使用できません";
  if (clean.includes("/") || clean.includes("\\") || clean.includes("\0")) {
    return "名前にパス区切り文字 (/ や \\) は使用できません";
  }
  return null;
}

function getFileBadgeText(entry: ExplorerFileEntry): string {
  if (entry.can_open) return "MD";
  if (entry.extension) {
    return entry.extension.toUpperCase().slice(0, 6);
  }
  return "FILE";
}

// ============================================================================
// Inline SVG Icons (Crisp VSCode-style 16x16 icons)
// ============================================================================

const SVG_CHEVRON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`;
const SVG_FOLDER_CLOSED = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.75 3A1.75 1.75 0 0 0 0 4.75v6.5C0 12.216.784 13 1.75 13h12.5A1.75 1.75 0 0 0 16 11.25v-5.5A1.75 1.75 0 0 0 14.25 4H7.536a.75.75 0 0 1-.53-.22L5.97 2.743A1.75 1.75 0 0 0 4.732 2.25H1.75Z"/></svg>`;
const SVG_FOLDER_OPEN = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.75 2.5A1.75 1.75 0 0 0 0 4.25v7.5C0 12.716.784 13.5 1.75 13.5h11.6a1.75 1.75 0 0 0 1.675-1.242l1.2-3.95A1.25 1.25 0 0 0 15.03 6.7H3.6a1.25 1.25 0 0 0-1.196.888L1.25 11.35V4.25c0-.276.224-.5.5-.5h2.982c.133 0 .26.053.354.146l1.036 1.037c.281.281.662.439 1.06.439h6.318V5.5a1.5 1.5 0 0 0-1.5-1.5H7.536a.75.75 0 0 1-.53-.22L5.97 2.743A1.75 1.75 0 0 0 4.732 2.25H1.75Z"/></svg>`;
const SVG_FILE_MD = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2h6l3 3v9h-9V2Z"/><path d="M9.5 2v3h3"/><path d="M5.5 10.5v-3l1.5 1.7 1.5-1.7v3"/></svg>`;
const SVG_FILE_GENERIC = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2h6l3 3v9h-9V2Z"/><path d="M9.5 2v3h3"/></svg>`;
const SVG_FILE_IMAGE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="5.8" cy="6.2" r="1.1"/><path d="M14 10.8l-3.2-3.2-4.8 4.8"/></svg>`;
const SVG_NEW_FILE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2h5.5l3 3v9h-8.5V2Z"/><path d="M9 2v3h3"/><path d="M7.75 7.5v4M5.75 9.5h4"/></svg>`;
const SVG_NEW_FOLDER = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.75 3.5h4l1.4 1.5h7.1v7.5h-12.5v-9Z"/><path d="M8 7.2v3.6M6.2 9h3.6"/></svg>`;
const SVG_COLLAPSE_ALL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 8h5"/></svg>`;
const SVG_SEARCH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>`;
const SVG_REVEAL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7v7"/><path d="M13 3L6.5 9.5"/><path d="M11 10v3H3V5h3"/></svg>`;
const SVG_TRASH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11"/><path d="M5.5 4.5V3h5v1.5"/><path d="M4 4.5l.7 8.5h6.6l.7-8.5"/></svg>`;
const SVG_FOCUS_DIR = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3.5h7.5V11"/><path d="M12.5 3.5L4 12"/></svg>`;

function getFileIconSpec(entry: ExplorerFileEntry): { svg: string; cls: string } {
  if (entry.can_open) {
    return { svg: SVG_FILE_MD, cls: "icon-markdown" };
  }
  const ext = (entry.extension || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) {
    return { svg: SVG_FILE_IMAGE, cls: "icon-image" };
  }
  if (ext === "pdf") {
    return { svg: SVG_FILE_GENERIC, cls: "icon-pdf" };
  }
  if (["html", "htm", "css", "scss", "js", "ts", "json", "yaml", "yml", "toml", "xml"].includes(ext)) {
    return { svg: SVG_FILE_GENERIC, cls: "icon-code" };
  }
  return { svg: SVG_FILE_GENERIC, cls: "" };
}

function appendHighlightedText(container: HTMLElement, text: string, query: string): void {
  container.textContent = "";
  if (!query) {
    container.textContent = text;
    return;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) {
    container.textContent = text;
    return;
  }

  if (idx > 0) {
    container.appendChild(document.createTextNode(text.slice(0, idx)));
  }
  const mark = document.createElement("mark");
  mark.className = "fe-match";
  mark.textContent = text.slice(idx, idx + query.length);
  container.appendChild(mark);
  if (idx + query.length < text.length) {
    container.appendChild(document.createTextNode(text.slice(idx + query.length)));
  }
}

// ============================================================================
// Context Menu Types
// ============================================================================

interface MenuItemSpec {
  type: "item";
  label: string;
  shortcut?: string;
  danger?: boolean;
  action: () => void | Promise<void>;
}

interface MenuSeparatorSpec {
  type: "separator";
}

type MenuSpec = MenuItemSpec | MenuSeparatorSpec;

// ============================================================================
// Main Factory: createFileExplorer
// ============================================================================

export function createFileExplorer(deps: FileExplorerDeps): FileExplorerController {
  const { treeEl } = deps;
  treeEl.classList.add("fe-tree");
  if (!treeEl.hasAttribute("tabindex")) {
    treeEl.tabIndex = 0;
  }

  // Internal state
  let currentRootPath = deps.getWorkspacePath();
  let activeFilePath = deps.getActiveFilePath();
  let selectedPath: string | null = activeFilePath || null;
  let filterQuery = "";

  const expandedDirs = new Set<string>();
  const dirChildrenCache = new Map<string, ExplorerFileEntry[]>();
  const entryByPath = new Map<string, ExplorerFileEntry>();

  let inlineCreate: { parentDir: string; kind: "file" | "folder" } | null = null;
  let inlineRenamePath: string | null = null;

  // Injected toolbar elements (when filterInputEl is not supplied externally)
  let injectedToolbarEl: HTMLDivElement | null = null;
  let filterInputEl: HTMLInputElement | null = deps.filterInputEl ?? null;
  let filterClearBtn: HTMLButtonElement | null = null;

  // Context menu element (appended to document.body)
  const contextMenuEl = document.createElement("div");
  contextMenuEl.className = "fe-context-menu";
  contextMenuEl.setAttribute("role", "menu");
  contextMenuEl.hidden = true;
  document.body.appendChild(contextMenuEl);

  const reportStatus = (msg: string) => {
    deps.onStatus?.(msg);
  };

  async function writeClipboard(text: string): Promise<void> {
    if (deps.copyToClipboard) {
      await deps.copyToClipboard(text);
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  // --------------------------------------------------------------------------
  // Filter & Action Toolbar Setup
  // --------------------------------------------------------------------------

  const onFilterInput = () => {
    if (!filterInputEl) return;
    filterQuery = filterInputEl.value;
    if (filterClearBtn) {
      filterClearBtn.hidden = filterQuery.length === 0;
    }
    renderTree();
  };

  const onFilterKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      if (filterQuery) {
        ev.preventDefault();
        setFilter("");
      } else {
        treeEl.focus();
      }
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      treeEl.focus();
      moveSelectionBy(1);
    }
  };

  if (!filterInputEl && treeEl.parentElement) {
    injectedToolbarEl = document.createElement("div");
    injectedToolbarEl.className = "fe-toolbar";

    const row = document.createElement("div");
    row.className = "fe-toolbar-row";

    const filterWrap = document.createElement("div");
    filterWrap.className = "fe-filter-wrap";

    const searchIcon = document.createElement("span");
    searchIcon.className = "fe-filter-icon";
    searchIcon.innerHTML = SVG_SEARCH;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "fe-filter-input";
    input.placeholder = "ファイルを絞り込み...";
    input.setAttribute("aria-label", "ファイルツリーを絞り込み");
    input.autocomplete = "off";
    input.spellcheck = false;

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "fe-filter-clear";
    clearBtn.title = "絞り込みをクリア (Esc)";
    clearBtn.setAttribute("aria-label", "絞り込みをクリア");
    clearBtn.textContent = "×";
    clearBtn.hidden = true;
    clearBtn.addEventListener("click", () => {
      setFilter("");
      input.focus();
    });

    filterWrap.appendChild(searchIcon);
    filterWrap.appendChild(input);
    filterWrap.appendChild(clearBtn);

    const actions = document.createElement("div");
    actions.className = "fe-action-group";

    const btnNewFile = document.createElement("button");
    btnNewFile.type = "button";
    btnNewFile.className = "fe-icon-btn";
    btnNewFile.title = "新規ファイル (選択フォルダ内)";
    btnNewFile.setAttribute("aria-label", "新規ファイル");
    btnNewFile.innerHTML = SVG_NEW_FILE;
    btnNewFile.addEventListener("click", () => {
      void startNewFile();
    });

    const btnNewFolder = document.createElement("button");
    btnNewFolder.type = "button";
    btnNewFolder.className = "fe-icon-btn";
    btnNewFolder.title = "新規フォルダ (選択フォルダ内)";
    btnNewFolder.setAttribute("aria-label", "新規フォルダ");
    btnNewFolder.innerHTML = SVG_NEW_FOLDER;
    btnNewFolder.addEventListener("click", () => {
      void startNewFolder();
    });

    const btnCollapse = document.createElement("button");
    btnCollapse.type = "button";
    btnCollapse.className = "fe-icon-btn";
    btnCollapse.title = "すべてのフォルダを折りたたむ";
    btnCollapse.setAttribute("aria-label", "すべてのフォルダを折りたたむ");
    btnCollapse.innerHTML = SVG_COLLAPSE_ALL;
    btnCollapse.addEventListener("click", () => {
      collapseAll();
    });

    actions.appendChild(btnNewFile);
    actions.appendChild(btnNewFolder);
    actions.appendChild(btnCollapse);

    row.appendChild(filterWrap);
    row.appendChild(actions);
    injectedToolbarEl.appendChild(row);

    treeEl.parentElement.insertBefore(injectedToolbarEl, treeEl);
    filterInputEl = input;
    filterClearBtn = clearBtn;
  }

  if (filterInputEl) {
    filterInputEl.addEventListener("input", onFilterInput);
    filterInputEl.addEventListener("keydown", onFilterKeyDown);
  }

  // --------------------------------------------------------------------------
  // Directory Fetching & Cache Management
  // --------------------------------------------------------------------------

  async function fetchDir(dirPath: string, forceReload = false): Promise<ExplorerFileEntry[]> {
    if (!forceReload && dirChildrenCache.has(dirPath)) {
      return dirChildrenCache.get(dirPath)!;
    }
    const entries = await deps.listDirectory(dirPath);
    dirChildrenCache.set(dirPath, entries);
    for (const entry of entries) {
      entryByPath.set(entry.path, entry);
    }
    return entries;
  }

  function rebuildEntryIndex(): void {
    entryByPath.clear();
    for (const entries of dirChildrenCache.values()) {
      for (const entry of entries) {
        entryByPath.set(entry.path, entry);
      }
    }
  }

  function resolveTargetDir(explicitParentDir?: string): string {
    if (explicitParentDir) return explicitParentDir;
    const root = currentRootPath || deps.getWorkspacePath();
    if (!selectedPath) return root;
    const selectedEntry = entryByPath.get(selectedPath);
    if (selectedEntry?.is_dir) {
      return selectedEntry.path;
    }
    const parent = dirnamePath(selectedPath);
    const normRoot = normalizeSlash(root);
    const normParent = normalizeSlash(parent);
    if (normParent === normRoot || normParent.startsWith(`${normRoot}/`)) {
      return parent;
    }
    return root;
  }

  async function ensureDirExpanded(dirPath: string): Promise<void> {
    const root = currentRootPath || deps.getWorkspacePath();
    const normRoot = normalizeSlash(root);
    const normTarget = normalizeSlash(dirPath);
    if (normTarget === normRoot) return;

    const rel = getRelativePath(root, dirPath);
    if (rel === dirPath || rel === ".") return;

    const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
    const baseClean = root.endsWith(sep) ? root.slice(0, -1) : root;
    const segments = rel.split("/").filter(Boolean);
    let cursor = baseClean;

    for (const seg of segments) {
      cursor = `${cursor}${sep}${seg}`;
      expandedDirs.add(cursor);
      if (!dirChildrenCache.has(cursor)) {
        try {
          await fetchDir(cursor, false);
        } catch {
          break;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Filtering Helpers
  // --------------------------------------------------------------------------

  function entryMatchesFilter(entry: ExplorerFileEntry, queryLower: string): boolean {
    if (entry.name.toLowerCase().includes(queryLower)) {
      return true;
    }
    const rel = getRelativePath(currentRootPath, entry.path).toLowerCase();
    return rel.includes(queryLower);
  }

  function hasMatchingDescendant(dirPath: string, queryLower: string): boolean {
    const children = dirChildrenCache.get(dirPath);
    if (!children) return false;
    for (const child of children) {
      if (entryMatchesFilter(child, queryLower)) return true;
      if (child.is_dir && hasMatchingDescendant(child.path, queryLower)) return true;
    }
    return false;
  }

  function filterEntriesForDisplay(
    entries: ExplorerFileEntry[],
    queryTrimmed: string
  ): ExplorerFileEntry[] {
    if (!queryTrimmed) return entries;
    const q = queryTrimmed.toLowerCase();
    return entries.filter((entry) => {
      if (entryMatchesFilter(entry, q)) return true;
      if (entry.is_dir && hasMatchingDescendant(entry.path, q)) return true;
      return false;
    });
  }

  // --------------------------------------------------------------------------
  // Context Menu
  // --------------------------------------------------------------------------

  function closeContextMenu(): void {
    if (contextMenuEl.hidden) return;
    contextMenuEl.hidden = true;
    contextMenuEl.innerHTML = "";
  }

  function openContextMenu(clientX: number, clientY: number, items: MenuSpec[]): void {
    contextMenuEl.innerHTML = "";

    for (const spec of items) {
      if (spec.type === "separator") {
        const sep = document.createElement("div");
        sep.className = "fe-menu-sep";
        sep.setAttribute("role", "separator");
        contextMenuEl.appendChild(sep);
        continue;
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = spec.danger ? "fe-menu-item is-danger" : "fe-menu-item";
      btn.setAttribute("role", "menuitem");

      const labelSpan = document.createElement("span");
      labelSpan.textContent = spec.label;
      btn.appendChild(labelSpan);

      if (spec.shortcut) {
        const sc = document.createElement("span");
        sc.className = "fe-menu-shortcut";
        sc.textContent = spec.shortcut;
        btn.appendChild(sc);
      }

      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeContextMenu();
        void spec.action();
      });

      contextMenuEl.appendChild(btn);
    }

    contextMenuEl.hidden = false;
    contextMenuEl.style.left = "0px";
    contextMenuEl.style.top = "0px";

    const rect = contextMenuEl.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(clientX, Math.max(pad, window.innerWidth - rect.width - pad));
    const y = Math.min(clientY, Math.max(pad, window.innerHeight - rect.height - pad));
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;

    const firstItem = contextMenuEl.querySelector<HTMLButtonElement>(".fe-menu-item");
    firstItem?.focus();
  }

  function buildContextMenuForEntry(entry: ExplorerFileEntry): MenuSpec[] {
    const targetParentDir = entry.is_dir ? entry.path : dirnamePath(entry.path);
    const items: MenuSpec[] = [];

    if (entry.is_dir) {
      items.push({
        type: "item",
        label: "このフォルダをルートとして開く",
        action: () => deps.onOpenWorkspace(entry.path),
      });
      items.push({ type: "separator" });
    } else if (entry.can_open) {
      items.push({
        type: "item",
        label: "開く",
        shortcut: "Enter",
        action: () => deps.onOpenFile(entry.path, entry.name),
      });
      items.push({ type: "separator" });
    }

    items.push(
      {
        type: "item",
        label: "新規ファイル...",
        action: () => startNewFile(targetParentDir),
      },
      {
        type: "item",
        label: "新規フォルダ...",
        action: () => startNewFolder(targetParentDir),
      },
      { type: "separator" },
      {
        type: "item",
        label: "名前の変更",
        shortcut: "F2",
        action: () => startRename(entry.path),
      },
      {
        type: "item",
        label: "削除",
        danger: true,
        action: () => deleteSelected(entry.path),
      },
      { type: "separator" },
      {
        type: "item",
        label: "パスをコピー",
        action: async () => {
          try {
            await writeClipboard(entry.path);
            reportStatus(`パスをコピーしました: ${entry.path}`);
          } catch (err) {
            reportStatus(`コピー失敗: ${String(err)}`);
          }
        },
      },
      {
        type: "item",
        label: "相対パスをコピー",
        action: async () => {
          const rel = getRelativePath(currentRootPath, entry.path);
          try {
            await writeClipboard(rel);
            reportStatus(`相対パスをコピーしました: ${rel}`);
          } catch (err) {
            reportStatus(`コピー失敗: ${String(err)}`);
          }
        },
      },
      {
        type: "item",
        label: "Finder / エクスプローラーで表示",
        action: () => deps.onRevealInExplorer(entry.path),
      }
    );

    return items;
  }

  function buildContextMenuForRoot(): MenuSpec[] {
    const root = currentRootPath || deps.getWorkspacePath();
    return [
      {
        type: "item",
        label: "新規ファイル...",
        action: () => startNewFile(root),
      },
      {
        type: "item",
        label: "新規フォルダ...",
        action: () => startNewFolder(root),
      },
      {
        type: "item",
        label: "すべて折りたたむ",
        action: () => collapseAll(),
      },
      { type: "separator" },
      {
        type: "item",
        label: "パスをコピー",
        action: async () => {
          try {
            await writeClipboard(root);
            reportStatus(`パスをコピーしました: ${root}`);
          } catch (err) {
            reportStatus(`コピー失敗: ${String(err)}`);
          }
        },
      },
      {
        type: "item",
        label: "Finder / エクスプローラーで表示",
        action: () => deps.onRevealInExplorer(root),
      },
    ];
  }

  const onContextMenuKeyDown = (ev: KeyboardEvent) => {
    if (contextMenuEl.hidden) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeContextMenu();
      treeEl.focus();
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const buttons = Array.from(
        contextMenuEl.querySelectorAll<HTMLButtonElement>(".fe-menu-item")
      );
      if (buttons.length === 0) return;
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        ev.key === "ArrowDown"
          ? (idx + 1) % buttons.length
          : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
  contextMenuEl.addEventListener("keydown", onContextMenuKeyDown);

  const onGlobalPointerDown = (ev: PointerEvent) => {
    if (!contextMenuEl.hidden && !contextMenuEl.contains(ev.target as Node)) {
      closeContextMenu();
    }
  };

  const onGlobalKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && !contextMenuEl.hidden) {
      ev.preventDefault();
      closeContextMenu();
      treeEl.focus();
    }
  };

  const onWindowDismiss = () => closeContextMenu();

  document.addEventListener("pointerdown", onGlobalPointerDown, true);
  document.addEventListener("keydown", onGlobalKeyDown);
  window.addEventListener("blur", onWindowDismiss);
  window.addEventListener("resize", onWindowDismiss);
  treeEl.addEventListener("scroll", onWindowDismiss);

  // --------------------------------------------------------------------------
  // Inline Create & Inline Rename DOM Builders
  // --------------------------------------------------------------------------

  function buildInlineCreateRow(parentDir: string, kind: "file" | "folder", depth: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "fe-inline-row";
    li.style.setProperty("--tree-depth", String(depth));

    const line = document.createElement("div");
    line.className = "fe-inline-line";

    const spacer = document.createElement("span");
    spacer.className = "fe-chevron-spacer";
    line.appendChild(spacer);

    const icon = document.createElement("span");
    icon.className = kind === "folder" ? "fe-icon icon-folder" : "fe-icon icon-markdown";
    icon.innerHTML = kind === "folder" ? SVG_FOLDER_CLOSED : SVG_FILE_MD;
    line.appendChild(icon);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "fe-inline-input";
    input.placeholder = kind === "folder" ? "新しいフォルダ名" : "新しいファイル名 (例: lecture.md)";
    input.setAttribute("aria-label", kind === "folder" ? "新しいフォルダ名" : "新しいファイル名");
    input.autocomplete = "off";
    input.spellcheck = false;
    line.appendChild(input);

    const errorEl = document.createElement("div");
    errorEl.className = "fe-inline-error";
    errorEl.hidden = true;

    li.appendChild(line);
    li.appendChild(errorEl);

    let finished = false;
    let submitting = false;

    const showError = (msg: string) => {
      input.classList.add("has-error");
      errorEl.textContent = msg;
      errorEl.hidden = false;
    };

    const cancel = () => {
      if (finished) return;
      finished = true;
      inlineCreate = null;
      renderTree();
      treeEl.focus();
    };

    const commit = async () => {
      if (finished || submitting) return;
      const raw = input.value.trim();
      if (!raw) {
        cancel();
        return;
      }
      const validationErr = validateInlineName(raw);
      if (validationErr) {
        showError(validationErr);
        input.focus();
        return;
      }

      submitting = true;
      input.disabled = true;
      try {
        const createdPath =
          kind === "folder"
            ? await deps.onCreateFolder(parentDir, raw)
            : await deps.onCreateFile(parentDir, raw);

        finished = true;
        inlineCreate = null;

        if (createdPath) {
          dirChildrenCache.delete(parentDir);
          await fetchDir(parentDir, true);
          selectedPath = createdPath;
          renderTree();
          scrollPathIntoView(createdPath);

          if (kind === "file" && isMarkdownPath(createdPath)) {
            await deps.onOpenFile(createdPath, basenamePath(createdPath));
          }
        } else {
          renderTree();
        }
      } catch (err) {
        submitting = false;
        input.disabled = false;
        showError(String(err));
        input.focus();
        input.select();
      }
    };

    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        void commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });

    input.addEventListener("input", () => {
      input.classList.remove("has-error");
      errorEl.hidden = true;
    });

    input.addEventListener("blur", () => {
      if (finished || submitting) return;
      if (input.value.trim()) {
        void commit();
      } else {
        cancel();
      }
    });

    requestAnimationFrame(() => {
      input.focus();
      input.scrollIntoView({ block: "nearest" });
    });

    return li;
  }

  function buildInlineRenameControls(entry: ExplorerFileEntry, rowEl: HTMLElement): void {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.flex = "1";
    wrapper.style.minWidth = "0";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "fe-inline-input";
    input.value = entry.name;
    input.setAttribute("aria-label", `${entry.name} の新しい名前`);
    input.autocomplete = "off";
    input.spellcheck = false;

    const errorEl = document.createElement("div");
    errorEl.className = "fe-inline-error";
    errorEl.style.marginLeft = "0";
    errorEl.hidden = true;

    wrapper.appendChild(input);
    wrapper.appendChild(errorEl);
    rowEl.appendChild(wrapper);

    let finished = false;
    let submitting = false;

    const showError = (msg: string) => {
      input.classList.add("has-error");
      errorEl.textContent = msg;
      errorEl.hidden = false;
    };

    const cancel = () => {
      if (finished) return;
      finished = true;
      inlineRenamePath = null;
      renderTree();
      treeEl.focus();
    };

    const commit = async () => {
      if (finished || submitting) return;
      const nextName = input.value.trim();
      if (!nextName || nextName === entry.name) {
        cancel();
        return;
      }
      const validationErr = validateInlineName(nextName);
      if (validationErr) {
        showError(validationErr);
        input.focus();
        return;
      }

      submitting = true;
      input.disabled = true;
      try {
        const newPath = await deps.onRenameEntry(entry.path, nextName);
        finished = true;
        inlineRenamePath = null;

        // Update expanded & cached paths when renaming a folder
        if (entry.is_dir) {
          const oldNorm = normalizeSlash(entry.path);
          const newNorm = normalizeSlash(newPath);
          const nextExpanded = new Set<string>();
          for (const dir of expandedDirs) {
            const dNorm = normalizeSlash(dir);
            if (dNorm === oldNorm) {
              nextExpanded.add(newPath);
            } else if (dNorm.startsWith(`${oldNorm}/`)) {
              nextExpanded.add(newPath + dir.slice(entry.path.length));
            } else {
              nextExpanded.add(dir);
            }
          }
          expandedDirs.clear();
          for (const d of nextExpanded) expandedDirs.add(d);

          // Invalidate cached descendants under oldPath
          for (const key of Array.from(dirChildrenCache.keys())) {
            const kNorm = normalizeSlash(key);
            if (kNorm === oldNorm || kNorm.startsWith(`${oldNorm}/`)) {
              dirChildrenCache.delete(key);
            }
          }
        }

        if (selectedPath === entry.path) {
          selectedPath = newPath;
        }
        if (activeFilePath === entry.path) {
          activeFilePath = newPath;
        }

        deps.onEntryRenamed?.(entry.path, newPath, entry.is_dir);

        const parentDir = dirnamePath(entry.path);
        dirChildrenCache.delete(parentDir);
        await fetchDir(parentDir, true);
        if (entry.is_dir && expandedDirs.has(newPath)) {
          await fetchDir(newPath, true);
        }
        rebuildEntryIndex();
        renderTree();
        scrollPathIntoView(newPath);
      } catch (err) {
        submitting = false;
        input.disabled = false;
        showError(String(err));
        input.focus();
      }
    };

    input.addEventListener("click", (ev) => ev.stopPropagation());
    input.addEventListener("dblclick", (ev) => ev.stopPropagation());
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        void commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });

    input.addEventListener("input", () => {
      input.classList.remove("has-error");
      errorEl.hidden = true;
    });

    input.addEventListener("blur", () => {
      if (finished || submitting) return;
      const trimmed = input.value.trim();
      if (trimmed && trimmed !== entry.name) {
        void commit();
      } else {
        cancel();
      }
    });

    requestAnimationFrame(() => {
      input.focus();
      if (!entry.is_dir) {
        const dotIdx = entry.name.lastIndexOf(".");
        if (dotIdx > 0) {
          input.setSelectionRange(0, dotIdx);
          return;
        }
      }
      input.select();
    });
  }

  // --------------------------------------------------------------------------
  // Tree Rendering
  // --------------------------------------------------------------------------

  function updateSelectionAndActiveClasses(): void {
    const rows = treeEl.querySelectorAll<HTMLElement>(".fe-row[data-path]");
    rows.forEach((row) => {
      const p = row.dataset.path ?? "";
      const isSelected = selectedPath === p;
      const isActive = activeFilePath === p && row.classList.contains("is-openable");
      row.classList.toggle("is-selected", isSelected);
      row.classList.toggle("is-active", isActive);
      if (isActive) {
        row.setAttribute("aria-current", "true");
      } else {
        row.removeAttribute("aria-current");
      }
    });
  }

  function scrollPathIntoView(targetPath: string): void {
    const rows = treeEl.querySelectorAll<HTMLElement>(".fe-row[data-path]");
    for (const row of rows) {
      if (row.dataset.path === targetPath) {
        row.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }

  async function toggleDirectory(dirPath: string): Promise<void> {
    if (expandedDirs.has(dirPath)) {
      expandedDirs.delete(dirPath);
      renderTree();
      return;
    }
    expandedDirs.add(dirPath);
    renderTree();
    if (!dirChildrenCache.has(dirPath)) {
      try {
        await fetchDir(dirPath, false);
        renderTree();
      } catch (err) {
        expandedDirs.delete(dirPath);
        reportStatus(`サブフォルダ読み込みエラー: ${String(err)}`);
        renderTree();
      }
    }
  }

  function renderEntries(
    container: HTMLUListElement,
    parentDir: string,
    entries: ExplorerFileEntry[],
    depth: number
  ): void {
    const queryTrimmed = filterQuery.trim();
    const visibleEntries = filterEntriesForDisplay(entries, queryTrimmed);

    // Inline create row at top of target parent directory
    if (inlineCreate && inlineCreate.parentDir === parentDir) {
      container.appendChild(buildInlineCreateRow(parentDir, inlineCreate.kind, depth));
    }

    if (visibleEntries.length === 0 && !(inlineCreate && inlineCreate.parentDir === parentDir)) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "fe-empty";
      emptyLi.style.setProperty("--tree-depth", String(depth));
      emptyLi.textContent = queryTrimmed ? "一致するファイルがありません" : "(空のフォルダ)";
      container.appendChild(emptyLi);
      return;
    }

    for (const entry of visibleEntries) {
      if (entry.is_dir) {
        const isFilterExpanded =
          queryTrimmed.length > 0 && hasMatchingDescendant(entry.path, queryTrimmed.toLowerCase());
        const isOpen = expandedDirs.has(entry.path) || isFilterExpanded;

        const li = document.createElement("li");
        li.className = `fe-node fe-dir-node${isOpen ? " is-open" : ""}`;
        li.setAttribute("role", "treeitem");
        li.setAttribute("aria-expanded", String(isOpen));
        li.style.setProperty("--tree-depth", String(depth));

        const row = document.createElement("div");
        row.className = "fe-row is-folder";
        row.dataset.path = entry.path;
        row.dataset.isDir = "true";
        if (selectedPath === entry.path) row.classList.add("is-selected");
        row.title = `${entry.name} (クリックで展開/折りたたみ · ダブルクリックでルート表示 · 右クリックでメニュー)`;

        const chevron = document.createElement("span");
        chevron.className = "fe-chevron";
        chevron.innerHTML = SVG_CHEVRON;
        row.appendChild(chevron);

        const icon = document.createElement("span");
        icon.className = "fe-icon icon-folder";
        icon.innerHTML = isOpen ? SVG_FOLDER_OPEN : SVG_FOLDER_CLOSED;
        row.appendChild(icon);

        if (inlineRenamePath === entry.path) {
          buildInlineRenameControls(entry, row);
        } else {
          const nameSpan = document.createElement("span");
          nameSpan.className = "fe-name";
          appendHighlightedText(nameSpan, entry.name, queryTrimmed);
          row.appendChild(nameSpan);

          const actions = document.createElement("div");
          actions.className = "fe-row-actions";

          const btnFocus = document.createElement("button");
          btnFocus.type = "button";
          btnFocus.className = "fe-row-btn";
          btnFocus.title = `「${entry.name}」をルートフォルダとして開く`;
          btnFocus.setAttribute("aria-label", `${entry.name} をルートフォルダとして開く`);
          btnFocus.innerHTML = SVG_FOCUS_DIR;
          btnFocus.addEventListener("click", (ev) => {
            ev.stopPropagation();
            void deps.onOpenWorkspace(entry.path);
          });
          actions.appendChild(btnFocus);
          row.appendChild(actions);

          row.addEventListener("click", () => {
            selectedPath = entry.path;
            void toggleDirectory(entry.path);
          });

          row.addEventListener("dblclick", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void deps.onOpenWorkspace(entry.path);
          });

          row.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            selectedPath = entry.path;
            updateSelectionAndActiveClasses();
            openContextMenu(ev.clientX, ev.clientY, buildContextMenuForEntry(entry));
          });
        }

        li.appendChild(row);

        if (isOpen) {
          const childrenUl = document.createElement("ul");
          childrenUl.className = "fe-children";
          childrenUl.setAttribute("role", "group");
          childrenUl.style.setProperty("--tree-depth", String(depth));

          const cached = dirChildrenCache.get(entry.path);
          if (!cached) {
            const loadingLi = document.createElement("li");
            loadingLi.className = "fe-empty";
            loadingLi.style.setProperty("--tree-depth", String(depth + 1));
            loadingLi.textContent = "読み込み中...";
            childrenUl.appendChild(loadingLi);
          } else {
            renderEntries(childrenUl, entry.path, cached, depth + 1);
          }
          li.appendChild(childrenUl);
        }

        container.appendChild(li);
        continue;
      }

      // File row
      const li = document.createElement("li");
      li.className = "fe-node fe-file-node";
      li.setAttribute("role", "treeitem");
      li.style.setProperty("--tree-depth", String(depth));

      const isActive = entry.can_open && entry.path === activeFilePath;
      const isSelected = selectedPath === entry.path;

      const row = document.createElement("div");
      row.className = `fe-row ${entry.can_open ? "is-openable" : "is-unopenable"}${
        isActive ? " is-active" : ""
      }${isSelected ? " is-selected" : ""}`;
      row.dataset.path = entry.path;
      row.dataset.isDir = "false";
      if (isActive) {
        row.setAttribute("aria-current", "true");
      }
      if (!entry.can_open) {
        row.setAttribute("aria-disabled", "true");
      }

      const extLabel = entry.extension ? `.${entry.extension}` : "拡張子なし";
      row.title = entry.can_open
        ? `${entry.name} をエディタで開く (F2で名前変更 · 右クリックでメニュー)`
        : `${entry.name} (${extLabel} はエディタで開けません · 右クリックまたは ↗ でFinder/エクスプローラー表示)`;

      const spacer = document.createElement("span");
      spacer.className = "fe-chevron-spacer";
      row.appendChild(spacer);

      const iconSpec = getFileIconSpec(entry);
      const icon = document.createElement("span");
      icon.className = `fe-icon ${iconSpec.cls}`;
      icon.innerHTML = iconSpec.svg;
      row.appendChild(icon);

      if (inlineRenamePath === entry.path) {
        buildInlineRenameControls(entry, row);
      } else {
        const nameSpan = document.createElement("span");
        nameSpan.className = "fe-name";
        appendHighlightedText(nameSpan, entry.name, queryTrimmed);
        row.appendChild(nameSpan);

        const badge = document.createElement("span");
        badge.className = `fe-badge ${entry.can_open ? "badge-openable" : "badge-unopenable"}`;
        badge.textContent = getFileBadgeText(entry);
        row.appendChild(badge);

        const actions = document.createElement("div");
        actions.className = "fe-row-actions";

        if (entry.can_open) {
          const btnDel = document.createElement("button");
          btnDel.type = "button";
          btnDel.className = "fe-row-btn btn-danger-hover";
          btnDel.title = "削除";
          btnDel.setAttribute("aria-label", `${entry.name} を削除`);
          btnDel.innerHTML = SVG_TRASH;
          btnDel.addEventListener("click", (ev) => {
            ev.stopPropagation();
            void deleteSelected(entry.path);
          });
          actions.appendChild(btnDel);
        } else {
          const btnReveal = document.createElement("button");
          btnReveal.type = "button";
          btnReveal.className = "fe-row-btn";
          btnReveal.title = "Finder / エクスプローラーで表示";
          btnReveal.setAttribute("aria-label", `${entry.name} をFinder/エクスプローラーで表示`);
          btnReveal.innerHTML = SVG_REVEAL;
          btnReveal.addEventListener("click", (ev) => {
            ev.stopPropagation();
            void deps.onRevealInExplorer(entry.path);
          });
          actions.appendChild(btnReveal);
        }

        row.appendChild(actions);

        row.addEventListener("click", () => {
          selectedPath = entry.path;
          updateSelectionAndActiveClasses();
          if (entry.can_open) {
            void deps.onOpenFile(entry.path, entry.name);
          } else {
            reportStatus(
              `「${entry.name}」(${extLabel}) はMarkdownエディタでは開けません（↗ または右クリックでFinder / エクスプローラー表示できます）`
            );
          }
        });

        row.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          selectedPath = entry.path;
          updateSelectionAndActiveClasses();
          openContextMenu(ev.clientX, ev.clientY, buildContextMenuForEntry(entry));
        });
      }

      li.appendChild(row);
      container.appendChild(li);
    }
  }

  function renderTree(): void {
    const scrollTop = treeEl.scrollTop;
    treeEl.innerHTML = "";

    // ".." Parent Directory row
    const parentLi = document.createElement("li");
    parentLi.className = "fe-parent-item";
    parentLi.setAttribute("role", "treeitem");

    const parentBtn = document.createElement("button");
    parentBtn.type = "button";
    parentBtn.className = "fe-parent-btn";
    parentBtn.title = "親フォルダへ移動";
    parentBtn.textContent = "↑ .. (上の階層へ)";
    parentBtn.addEventListener("click", () => {
      void deps.onNavigateParent();
    });
    parentLi.appendChild(parentBtn);
    treeEl.appendChild(parentLi);

    const rootEntries = dirChildrenCache.get(currentRootPath) ?? [];
    renderEntries(treeEl, currentRootPath, rootEntries, 0);

    treeEl.scrollTop = scrollTop;
  }

  // --------------------------------------------------------------------------
  // Keyboard Navigation & Tree Container Events
  // --------------------------------------------------------------------------

  function getVisibleRows(): HTMLElement[] {
    return Array.from(treeEl.querySelectorAll<HTMLElement>(".fe-row[data-path]"));
  }

  function moveSelectionBy(delta: number): void {
    const rows = getVisibleRows();
    if (rows.length === 0) return;
    const currentIdx = rows.findIndex((r) => r.dataset.path === selectedPath);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = delta > 0 ? 0 : rows.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(rows.length - 1, currentIdx + delta));
    }
    const nextRow = rows[nextIdx];
    if (nextRow?.dataset.path) {
      selectedPath = nextRow.dataset.path;
      updateSelectionAndActiveClasses();
      nextRow.scrollIntoView({ block: "nearest" });
    }
  }

  const onTreeKeyDown = (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }

    if (ev.key === "F2") {
      if (selectedPath && entryByPath.has(selectedPath)) {
        ev.preventDefault();
        startRename(selectedPath);
      }
      return;
    }

    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveSelectionBy(1);
      return;
    }

    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveSelectionBy(-1);
      return;
    }

    if (ev.key === "Enter" && selectedPath) {
      const entry = entryByPath.get(selectedPath);
      if (!entry) return;
      ev.preventDefault();
      if (entry.is_dir) {
        void toggleDirectory(entry.path);
      } else if (entry.can_open) {
        void deps.onOpenFile(entry.path, entry.name);
      }
      return;
    }

    if (ev.key === "ArrowRight" && selectedPath) {
      const entry = entryByPath.get(selectedPath);
      if (entry?.is_dir) {
        ev.preventDefault();
        if (!expandedDirs.has(entry.path)) {
          void toggleDirectory(entry.path);
        } else {
          moveSelectionBy(1);
        }
      }
      return;
    }

    if (ev.key === "ArrowLeft" && selectedPath) {
      const entry = entryByPath.get(selectedPath);
      if (entry?.is_dir && expandedDirs.has(entry.path)) {
        ev.preventDefault();
        void toggleDirectory(entry.path);
        return;
      }
      const parent = dirnamePath(selectedPath);
      if (parent && parent !== currentRootPath && entryByPath.has(parent)) {
        ev.preventDefault();
        selectedPath = parent;
        updateSelectionAndActiveClasses();
        scrollPathIntoView(parent);
      }
    }
  };

  const onTreeContextMenu = (ev: MouseEvent) => {
    if (ev.defaultPrevented) return;
    ev.preventDefault();
    openContextMenu(ev.clientX, ev.clientY, buildContextMenuForRoot());
  };

  treeEl.addEventListener("keydown", onTreeKeyDown);
  treeEl.addEventListener("contextmenu", onTreeContextMenu);

  // --------------------------------------------------------------------------
  // Controller Methods
  // --------------------------------------------------------------------------

  async function loadRoot(
    workspacePath: string,
    options?: { preserveExpanded?: boolean }
  ): Promise<ExplorerFileEntry[]> {
    const isSame = currentRootPath === workspacePath;
    currentRootPath = workspacePath;
    activeFilePath = deps.getActiveFilePath();
    inlineCreate = null;
    inlineRenamePath = null;
    closeContextMenu();

    dirChildrenCache.clear();
    if (!isSame && !options?.preserveExpanded) {
      expandedDirs.clear();
      selectedPath = activeFilePath || null;
    }

    const rootEntries = await fetchDir(workspacePath, true);

    // Reload any preserved expanded folders
    const dirsToReload = Array.from(expandedDirs);
    for (const dir of dirsToReload) {
      try {
        await fetchDir(dir, true);
      } catch {
        expandedDirs.delete(dir);
      }
    }

    rebuildEntryIndex();
    renderTree();
    return rootEntries;
  }

  async function refresh(): Promise<void> {
    const root = currentRootPath || deps.getWorkspacePath();
    if (!root) return;
    await loadRoot(root, { preserveExpanded: true });
  }

  async function setActiveFile(
    filePath: string,
    options?: { reveal?: boolean }
  ): Promise<void> {
    activeFilePath = filePath;
    if (filePath) {
      selectedPath = filePath;
    }

    const shouldReveal = options?.reveal !== false;
    if (shouldReveal && filePath && currentRootPath) {
      const parentDir = dirnamePath(filePath);
      const normRoot = normalizeSlash(currentRootPath);
      const normParent = normalizeSlash(parentDir);
      if (normParent !== normRoot && normParent.startsWith(`${normRoot}/`)) {
        await ensureDirExpanded(parentDir);
        rebuildEntryIndex();
        renderTree();
      } else {
        updateSelectionAndActiveClasses();
      }
      scrollPathIntoView(filePath);
    } else {
      updateSelectionAndActiveClasses();
    }
  }

  function collapseAll(): void {
    expandedDirs.clear();
    inlineCreate = null;
    inlineRenamePath = null;
    closeContextMenu();
    renderTree();
    reportStatus("すべてのフォルダを折りたたみました");
  }

  async function startNewFile(parentDir?: string): Promise<void> {
    const targetDir = resolveTargetDir(parentDir);
    if (!targetDir) return;
    inlineRenamePath = null;
    closeContextMenu();

    if (normalizeSlash(targetDir) !== normalizeSlash(currentRootPath)) {
      await ensureDirExpanded(targetDir);
    }
    inlineCreate = { parentDir: targetDir, kind: "file" };
    renderTree();
  }

  async function startNewFolder(parentDir?: string): Promise<void> {
    const targetDir = resolveTargetDir(parentDir);
    if (!targetDir) return;
    inlineRenamePath = null;
    closeContextMenu();

    if (normalizeSlash(targetDir) !== normalizeSlash(currentRootPath)) {
      await ensureDirExpanded(targetDir);
    }
    inlineCreate = { parentDir: targetDir, kind: "folder" };
    renderTree();
  }

  function startRename(targetPath?: string): void {
    const path = targetPath ?? selectedPath;
    if (!path || !entryByPath.has(path)) return;
    inlineCreate = null;
    closeContextMenu();
    inlineRenamePath = path;
    selectedPath = path;
    renderTree();
  }

  async function deleteSelected(targetPath?: string): Promise<void> {
    const path = targetPath ?? selectedPath;
    if (!path) return;
    const entry = entryByPath.get(path);
    if (!entry) return;

    closeContextMenu();
    const relLabel = getRelativePath(currentRootPath, entry.path);
    const deleted = await deps.onDeleteEntry(entry.path, relLabel, entry.is_dir);
    if (!deleted) return;

    if (entry.is_dir) {
      const targetNorm = normalizeSlash(entry.path);
      for (const dir of Array.from(expandedDirs)) {
        const dNorm = normalizeSlash(dir);
        if (dNorm === targetNorm || dNorm.startsWith(`${targetNorm}/`)) {
          expandedDirs.delete(dir);
        }
      }
      for (const key of Array.from(dirChildrenCache.keys())) {
        const kNorm = normalizeSlash(key);
        if (kNorm === targetNorm || kNorm.startsWith(`${targetNorm}/`)) {
          dirChildrenCache.delete(key);
        }
      }
    }

    if (selectedPath === entry.path) {
      selectedPath = null;
    }

    deps.onEntryDeleted?.(entry.path, entry.is_dir);

    const parentDir = dirnamePath(entry.path);
    dirChildrenCache.delete(parentDir);
    try {
      await fetchDir(parentDir, true);
    } catch {
      await refresh();
      return;
    }
    rebuildEntryIndex();
    renderTree();
  }

  function setFilter(query: string): void {
    filterQuery = query;
    if (filterInputEl && filterInputEl.value !== query) {
      filterInputEl.value = query;
    }
    if (filterClearBtn) {
      filterClearBtn.hidden = query.length === 0;
    }
    renderTree();
  }

  function focusFilter(): void {
    filterInputEl?.focus();
    filterInputEl?.select();
  }

  function getSelectedPath(): string | null {
    return selectedPath;
  }

  function destroy(): void {
    closeContextMenu();
    contextMenuEl.remove();
    document.removeEventListener("pointerdown", onGlobalPointerDown, true);
    document.removeEventListener("keydown", onGlobalKeyDown);
    window.removeEventListener("blur", onWindowDismiss);
    window.removeEventListener("resize", onWindowDismiss);
    treeEl.removeEventListener("scroll", onWindowDismiss);
    treeEl.removeEventListener("keydown", onTreeKeyDown);
    treeEl.removeEventListener("contextmenu", onTreeContextMenu);
    if (filterInputEl) {
      filterInputEl.removeEventListener("input", onFilterInput);
      filterInputEl.removeEventListener("keydown", onFilterKeyDown);
    }
    injectedToolbarEl?.remove();
  }

  return {
    loadRoot,
    refresh,
    setActiveFile,
    collapseAll,
    startNewFile,
    startNewFolder,
    startRename,
    deleteSelected,
    setFilter,
    focusFilter,
    getSelectedPath,
    destroy,
  };
}
