/// <reference types="vite/client" />

// Load component styles only in browser/Vite environments so pure helpers
// remain directly importable in Node's `node:test` runner without CSS loaders.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  void import("./editor-tabs.css").catch(() => {
    // Ignore when running under mocked DOM environments
  });
}

// ============================================================================
// Public Types
// ============================================================================

export interface EditorTabDocument {
  /** Normalized unique identifier (normalized file path). */
  id: string;
  /** Original OS file path. */
  filePath: string;
  /** Display filename (basename). */
  fileName: string;
  /** Current Markdown buffer text (including unsaved edits). */
  content: string;
  /** Whether this tab has unsaved changes. */
  isDirty: boolean;
  /** Saved editor vertical scroll offset. */
  scrollTop: number;
  /** Saved editor horizontal scroll offset. */
  scrollLeft: number;
  /** Saved editor selectionStart offset. */
  selectionStart: number;
  /** Saved editor selectionEnd offset. */
  selectionEnd: number;
  /** Saved active slide index for slide preview mode. */
  slideIndex: number;
  /** Saved preview vertical scroll offset for document preview mode. */
  previewScrollTop: number;
}

export interface EditorTabSnapshot {
  content: string;
  scrollTop: number;
  scrollLeft: number;
  selectionStart: number;
  selectionEnd: number;
  slideIndex: number;
  previewScrollTop: number;
}

export interface EditorTabState {
  tabs: EditorTabDocument[];
  activeTabId: string | null;
}

export interface EditorTabBarDeps {
  /** Container element where the tab bar will be rendered. */
  container: HTMLElement;
  /** Called to capture the live editor & preview snapshot of the outgoing active tab before switching/closing. */
  getActiveSnapshot?: () => EditorTabSnapshot;
  /** Called when the active tab changes (null if all tabs were closed). */
  onActivateTab: (tab: EditorTabDocument | null) => void | Promise<void>;
  /**
   * Called before closing a dirty tab.
   * Return `"save"` (caller should save or let this callback save it and return true/save),
   * `"discard"` to close without saving, or `"cancel"` to abort closing.
   */
  onConfirmCloseDirty?: (tab: EditorTabDocument) => Promise<"save" | "discard" | "cancel">;
  /** Called to persist a specific tab's content to disk (used when closing a dirty tab with "save"). */
  onSaveTab?: (tab: EditorTabDocument) => Promise<boolean>;
  /** Called when the user clicks the `+` new file button on the tab bar. */
  onNewFile?: () => void;
  /** Called when tab list or dirty state changes (e.g. for window title or status). */
  onChange?: (state: EditorTabState) => void;
}

export interface EditorTabBarController {
  /** Open a file in a tab (activates existing tab if already open, otherwise creates a new tab). */
  openOrActivateTab: (
    filePath: string,
    fileName: string,
    content: string,
    currentSnapshot?: EditorTabSnapshot
  ) => EditorTabDocument;
  /** Activate a tab by ID (saving the outgoing active tab's snapshot first). */
  activateTab: (tabId: string, currentSnapshot?: EditorTabSnapshot) => EditorTabDocument | null;
  /** Cycle to next (+1) or previous (-1) tab. */
  cycleTab: (delta: 1 | -1, currentSnapshot?: EditorTabSnapshot) => EditorTabDocument | null;
  /** Close a tab by ID (prompts if dirty). Returns true if closed. */
  closeTab: (tabId: string, currentSnapshot?: EditorTabSnapshot) => Promise<boolean>;
  /** Close all tabs except `keepTabId`. */
  closeOtherTabs: (keepTabId: string, currentSnapshot?: EditorTabSnapshot) => Promise<void>;
  /** Close all tabs to the right of `anchorTabId`. */
  closeTabsToRight: (anchorTabId: string, currentSnapshot?: EditorTabSnapshot) => Promise<void>;
  /** Close all open tabs. */
  closeAllTabs: (currentSnapshot?: EditorTabSnapshot) => Promise<boolean>;
  /** Force-reset all tabs without confirmation (e.g. when switching workspace). */
  clearAllTabs: () => void;
  /** Sync live editor snapshot into the currently active tab. */
  updateActiveSnapshot: (snapshot: Partial<EditorTabSnapshot>) => void;
  /** Mark a tab (default: active tab) dirty or clean. */
  setTabDirty: (dirty: boolean, tabId?: string) => void;
  /** Update tab paths when a file or directory is renamed in the explorer. */
  handleEntryRenamed: (oldPath: string, newPath: string, isDir: boolean) => EditorTabDocument | null;
  /** Remove tabs matching a deleted file or directory. */
  handleEntryDeleted: (deletedPath: string, isDir: boolean) => EditorTabDocument | null;
  /** Reorder a tab from `fromId` to `toId` position. */
  reorderTab: (fromId: string, toId: string) => void;
  /** Return the currently active tab (or null). */
  getActiveTab: () => EditorTabDocument | null;
  /** Return a shallow copy of all open tabs. */
  getTabs: () => EditorTabDocument[];
  /** Return a tab by file path (or null). */
  findTabByPath: (filePath: string) => EditorTabDocument | null;
  /** Return all dirty tabs. */
  getDirtyTabs: () => EditorTabDocument[];
  /** Whether any open tab has unsaved changes. */
  hasDirtyTabs: () => boolean;
  /** Re-render the tab bar DOM. */
  render: () => void;
  /** Clean up listeners and context menu. */
  destroy: () => void;
}

// ============================================================================
// Pure Helpers (Unit-Testable without DOM)
// ============================================================================

export function normalizeTabPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function basenameOfPath(path: string): string {
  const norm = normalizeTabPath(path);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/**
 * Computes a short parent-folder disambiguation label for tabs that share the same filename
 * (matching VSCode's tab disambiguation behavior).
 */
export function computeTabDisambiguations(tabs: readonly EditorTabDocument[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    const key = tab.fileName.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const hints = new Map<string, string>();
  for (const tab of tabs) {
    if ((counts.get(tab.fileName.toLowerCase()) ?? 0) <= 1) continue;
    const parts = normalizeTabPath(tab.filePath).split("/").filter(Boolean);
    if (parts.length >= 2) {
      hints.set(tab.id, parts[parts.length - 2]);
    }
  }
  return hints;
}

/**
 * Pure state transition: opens a new tab or activates an existing one.
 */
export function openTabInState(
  state: EditorTabState,
  filePath: string,
  fileName: string,
  content: string,
  currentSnapshot?: EditorTabSnapshot
): { nextState: EditorTabState; tab: EditorTabDocument; existed: boolean } {
  const id = normalizeTabPath(filePath);
  const tabs = state.tabs.map((t) =>
    t.id === state.activeTabId && currentSnapshot ? { ...t, ...currentSnapshot } : { ...t }
  );

  const existing = tabs.find((t) => t.id === id);
  if (existing) {
    return {
      nextState: { tabs, activeTabId: existing.id },
      tab: existing,
      existed: true,
    };
  }

  const newTab: EditorTabDocument = {
    id,
    filePath,
    fileName,
    content,
    isDirty: false,
    scrollTop: 0,
    scrollLeft: 0,
    selectionStart: 0,
    selectionEnd: 0,
    slideIndex: 0,
    previewScrollTop: 0,
  };

  tabs.push(newTab);
  return {
    nextState: { tabs, activeTabId: newTab.id },
    tab: newTab,
    existed: false,
  };
}

/**
 * Pure state transition: closes a tab and selects the adjacent tab if it was active
 * (right neighbor first, then left neighbor, matching VSCode).
 */
export function closeTabInState(
  state: EditorTabState,
  tabId: string
): { nextState: EditorTabState; activeChanged: boolean; nextActive: EditorTabDocument | null } {
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) {
    const current = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
    return { nextState: state, activeChanged: false, nextActive: current };
  }

  const nextTabs = state.tabs.filter((t) => t.id !== tabId);
  if (state.activeTabId !== tabId) {
    const current = nextTabs.find((t) => t.id === state.activeTabId) ?? null;
    return {
      nextState: { tabs: nextTabs, activeTabId: state.activeTabId },
      activeChanged: false,
      nextActive: current,
    };
  }

  if (nextTabs.length === 0) {
    return {
      nextState: { tabs: [], activeTabId: null },
      activeChanged: true,
      nextActive: null,
    };
  }

  const nextIdx = idx < nextTabs.length ? idx : nextTabs.length - 1;
  const nextActive = nextTabs[nextIdx];
  return {
    nextState: { tabs: nextTabs, activeTabId: nextActive.id },
    activeChanged: true,
    nextActive,
  };
}

/**
 * Pure state transition: reorders a tab from `fromId` to the position of `toId`.
 */
export function reorderTabsInState(
  state: EditorTabState,
  fromId: string,
  toId: string
): EditorTabState {
  if (fromId === toId) return state;
  const fromIdx = state.tabs.findIndex((t) => t.id === fromId);
  const toIdx = state.tabs.findIndex((t) => t.id === toId);
  if (fromIdx < 0 || toIdx < 0) return state;

  const nextTabs = [...state.tabs];
  const [moved] = nextTabs.splice(fromIdx, 1);
  nextTabs.splice(toIdx, 0, moved);
  return { ...state, tabs: nextTabs };
}

/**
 * Pure state transition: updates tab paths when a file or folder is renamed.
 */
export function renameEntryInTabState(
  state: EditorTabState,
  oldPath: string,
  newPath: string,
  isDir: boolean
): EditorTabState {
  const oldNorm = normalizeTabPath(oldPath);
  let nextActiveId = state.activeTabId;

  const nextTabs = state.tabs.map((tab) => {
    if (tab.id === oldNorm) {
      const nextId = normalizeTabPath(newPath);
      if (nextActiveId === tab.id) nextActiveId = nextId;
      return {
        ...tab,
        id: nextId,
        filePath: newPath,
        fileName: basenameOfPath(newPath),
      };
    }
    if (isDir && tab.id.startsWith(oldNorm + "/")) {
      const suffix = tab.filePath.slice(oldPath.length);
      const updatedPath = newPath + suffix;
      const nextId = normalizeTabPath(updatedPath);
      if (nextActiveId === tab.id) nextActiveId = nextId;
      return {
        ...tab,
        id: nextId,
        filePath: updatedPath,
        fileName: basenameOfPath(updatedPath),
      };
    }
    return tab;
  });

  return { tabs: nextTabs, activeTabId: nextActiveId };
}

/**
 * Pure state transition: removes tabs matching a deleted file or folder.
 */
export function deleteEntryInTabState(
  state: EditorTabState,
  deletedPath: string,
  isDir: boolean
): { nextState: EditorTabState; activeChanged: boolean; nextActive: EditorTabDocument | null } {
  const delNorm = normalizeTabPath(deletedPath);
  let currentState = state;
  let activeChanged = false;

  const toRemove = state.tabs
    .filter((tab) => tab.id === delNorm || (isDir && tab.id.startsWith(delNorm + "/")))
    .map((tab) => tab.id);

  for (const id of toRemove) {
    const res = closeTabInState(currentState, id);
    currentState = res.nextState;
    if (res.activeChanged) activeChanged = true;
  }

  const nextActive =
    currentState.tabs.find((t) => t.id === currentState.activeTabId) ?? null;
  return { nextState: currentState, activeChanged, nextActive };
}

// ============================================================================
// VSCode-Style Tab Bar UI Controller
// ============================================================================

export function createEditorTabBar(deps: EditorTabBarDeps): EditorTabBarController {
  let state: EditorTabState = { tabs: [], activeTabId: null };
  let draggedTabId: string | null = null;
  let contextMenuEl: HTMLDivElement | null = null;

  // Build shell inside container:
  // [tablist (scrollable single row)] [actions (+ new file)]
  deps.container.innerHTML = "";
  deps.container.classList.add("editor-tabs-bar");

  const tablistEl = document.createElement("div");
  tablistEl.className = "editor-tablist";
  tablistEl.setAttribute("role", "tablist");
  tablistEl.setAttribute("aria-label", "開いているドキュメント");

  const actionsEl = document.createElement("div");
  actionsEl.className = "editor-tabs-actions";

  const btnNewTab = document.createElement("button");
  btnNewTab.type = "button";
  btnNewTab.className = "editor-tab-action-btn";
  btnNewTab.setAttribute("aria-label", "新規ドキュメントを作成");
  btnNewTab.title = "新規Markdownファイルを作成 (Cmd+N / Ctrl+N)";
  btnNewTab.textContent = "＋";
  btnNewTab.addEventListener("click", () => {
    deps.onNewFile?.();
  });

  actionsEl.appendChild(btnNewTab);
  deps.container.appendChild(tablistEl);
  deps.container.appendChild(actionsEl);

  const closeContextMenu = (): void => {
    if (contextMenuEl) {
      contextMenuEl.remove();
      contextMenuEl = null;
    }
  };

  const handleGlobalPointerDown = (e: PointerEvent): void => {
    if (contextMenuEl && !contextMenuEl.contains(e.target as Node)) {
      closeContextMenu();
    }
  };

  const handleGlobalKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && contextMenuEl) {
      closeContextMenu();
    }
  };

  window.addEventListener("pointerdown", handleGlobalPointerDown);
  window.addEventListener("keydown", handleGlobalKeyDown);

  // Horizontal mouse-wheel scrolling on the tablist (VSCode feel)
  const handleWheel = (e: WheelEvent): void => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tablistEl.scrollWidth > tablistEl.clientWidth) {
      e.preventDefault();
      tablistEl.scrollLeft += e.deltaY;
    }
  };
  tablistEl.addEventListener("wheel", handleWheel, { passive: false });

  // Roving tabindex keyboard navigation inside tablist (ArrowLeft / ArrowRight / Home / End)
  const handleTablistKeyDown = (e: KeyboardEvent): void => {
    const tabButtons = Array.from(
      tablistEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    );
    if (tabButtons.length === 0) return;

    const currentIdx = tabButtons.findIndex((el) => el === document.activeElement);
    if (currentIdx < 0) return;

    let nextIdx = -1;
    if (e.key === "ArrowRight") {
      nextIdx = (currentIdx + 1) % tabButtons.length;
    } else if (e.key === "ArrowLeft") {
      nextIdx = (currentIdx - 1 + tabButtons.length) % tabButtons.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = tabButtons.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    tabButtons[nextIdx].focus();
    tabButtons[nextIdx].scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  tablistEl.addEventListener("keydown", handleTablistKeyDown);

  const notifyChange = (): void => {
    deps.onChange?.({
      tabs: state.tabs.map((t) => ({ ...t })),
      activeTabId: state.activeTabId,
    });
  };

  const scrollActiveTabIntoView = (): void => {
    if (!state.activeTabId) return;
    const activeEl = tablistEl.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const openContextMenu = (tab: EditorTabDocument, x: number, y: number): void => {
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "editor-tab-context-menu";
    menu.setAttribute("role", "menu");

    const idx = state.tabs.findIndex((t) => t.id === tab.id);
    const hasOthers = state.tabs.length > 1;
    const hasRight = idx >= 0 && idx < state.tabs.length - 1;

    const items: Array<{ label: string; disabled?: boolean; action: () => void }> = [
      {
        label: "閉じる",
        action: () => {
          void controller.closeTab(tab.id);
        },
      },
      {
        label: "他のタブをすべて閉じる",
        disabled: !hasOthers,
        action: () => {
          void controller.closeOtherTabs(tab.id);
        },
      },
      {
        label: "右側のタブをすべて閉じる",
        disabled: !hasRight,
        action: () => {
          void controller.closeTabsToRight(tab.id);
        },
      },
      {
        label: "すべて閉じる",
        action: () => {
          void controller.closeAllTabs();
        },
      },
    ];

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "editor-tab-context-item";
      btn.setAttribute("role", "menuitem");
      btn.textContent = item.label;
      if (item.disabled) {
        btn.disabled = true;
      } else {
        btn.addEventListener("click", () => {
          closeContextMenu();
          item.action();
        });
      }
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, clampedX)}px`;
    menu.style.top = `${Math.max(8, clampedY)}px`;
    contextMenuEl = menu;
  };

  const render = (): void => {
    tablistEl.innerHTML = "";
    const hints = computeTabDisambiguations(state.tabs);

    if (state.tabs.length === 0) {
      const emptyHint = document.createElement("span");
      emptyHint.className = "editor-tabs-empty";
      emptyHint.textContent = "開いているファイルはありません";
      tablistEl.appendChild(emptyHint);
      return;
    }

    for (const tab of state.tabs) {
      const isActive = tab.id === state.activeTabId;

      const tabItem = document.createElement("div");
      tabItem.className = "editor-tab-item";
      if (isActive) tabItem.classList.add("is-active");
      if (tab.isDirty) tabItem.classList.add("is-dirty");
      tabItem.dataset.tabId = tab.id;
      tabItem.draggable = true;

      // Primary interactive tab button (role="tab")
      const tabBtn = document.createElement("button");
      tabBtn.type = "button";
      tabBtn.className = "editor-tab-btn";
      tabBtn.setAttribute("role", "tab");
      tabBtn.setAttribute("aria-selected", String(isActive));
      tabBtn.tabIndex = isActive ? 0 : -1;
      tabBtn.title = tab.isDirty ? `${tab.filePath} (未保存の変更あり)` : tab.filePath;

      const iconSpan = document.createElement("span");
      iconSpan.className = "editor-tab-icon";
      iconSpan.setAttribute("aria-hidden", "true");
      iconSpan.textContent = "📄";

      const labelSpan = document.createElement("span");
      labelSpan.className = "editor-tab-label";
      labelSpan.textContent = tab.fileName;

      tabBtn.appendChild(iconSpan);
      tabBtn.appendChild(labelSpan);

      const hint = hints.get(tab.id);
      if (hint) {
        const hintSpan = document.createElement("span");
        hintSpan.className = "editor-tab-hint";
        hintSpan.textContent = hint;
        tabBtn.appendChild(hintSpan);
      }

      tabBtn.addEventListener("click", () => {
        if (state.activeTabId !== tab.id) {
          controller.activateTab(tab.id);
        }
      });

      // Middle-click to close tab (standard VSCode behavior)
      tabItem.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void controller.closeTab(tab.id);
        }
      });

      // Right-click context menu
      tabItem.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu(tab, e.clientX, e.clientY);
      });

      // Drag & Drop reordering
      tabItem.addEventListener("dragstart", (e) => {
        draggedTabId = tab.id;
        tabItem.classList.add("is-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tab.id);
        }
      });

      tabItem.addEventListener("dragover", (e) => {
        if (!draggedTabId || draggedTabId === tab.id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        tabItem.classList.add("is-drag-over");
      });

      tabItem.addEventListener("dragleave", () => {
        tabItem.classList.remove("is-drag-over");
      });

      tabItem.addEventListener("drop", (e) => {
        e.preventDefault();
        tabItem.classList.remove("is-drag-over");
        if (draggedTabId && draggedTabId !== tab.id) {
          controller.reorderTab(draggedTabId, tab.id);
        }
        draggedTabId = null;
      });

      tabItem.addEventListener("dragend", () => {
        draggedTabId = null;
        tabItem.classList.remove("is-dragging");
        tablistEl.querySelectorAll(".is-drag-over").forEach((el) => {
          el.classList.remove("is-drag-over");
        });
      });

      // Close button (shows ● dot when dirty, × on hover/focus — exact VSCode UX)
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "editor-tab-close";
      closeBtn.setAttribute("aria-label", `${tab.fileName} を閉じる`);
      closeBtn.title = tab.isDirty ? "閉じる（未保存の変更あり）" : "閉じる (Cmd+W / Ctrl+W)";
      closeBtn.tabIndex = -1;

      const dirtyDot = document.createElement("span");
      dirtyDot.className = "editor-tab-dirty-dot";
      dirtyDot.setAttribute("aria-hidden", "true");
      dirtyDot.textContent = "●";

      const closeIcon = document.createElement("span");
      closeIcon.className = "editor-tab-close-icon";
      closeIcon.setAttribute("aria-hidden", "true");
      closeIcon.textContent = "✕";

      closeBtn.appendChild(dirtyDot);
      closeBtn.appendChild(closeIcon);

      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void controller.closeTab(tab.id);
      });

      tabItem.appendChild(tabBtn);
      tabItem.appendChild(closeBtn);
      tablistEl.appendChild(tabItem);
    }

    scrollActiveTabIntoView();
  };

  const saveSnapshotIntoActive = (snapshot?: EditorTabSnapshot): void => {
    const resolved = snapshot ?? deps.getActiveSnapshot?.();
    if (!resolved || !state.activeTabId) return;
    const active = state.tabs.find((t) => t.id === state.activeTabId);
    if (active) {
      active.content = resolved.content;
      active.scrollTop = resolved.scrollTop;
      active.scrollLeft = resolved.scrollLeft;
      active.selectionStart = resolved.selectionStart;
      active.selectionEnd = resolved.selectionEnd;
      active.slideIndex = resolved.slideIndex;
      active.previewScrollTop = resolved.previewScrollTop;
    }
  };

  const controller: EditorTabBarController = {
    openOrActivateTab(filePath, fileName, content, currentSnapshot) {
      const { nextState, tab } = openTabInState(
        state,
        filePath,
        fileName,
        content,
        currentSnapshot ?? deps.getActiveSnapshot?.()
      );
      state = nextState;
      render();
      notifyChange();
      void deps.onActivateTab(tab);
      return tab;
    },

    activateTab(tabId, currentSnapshot) {
      saveSnapshotIntoActive(currentSnapshot);
      const target = state.tabs.find((t) => t.id === tabId);
      if (!target) return null;
      state = { ...state, activeTabId: target.id };
      render();
      notifyChange();
      void deps.onActivateTab(target);
      return target;
    },

    cycleTab(delta, currentSnapshot) {
      if (state.tabs.length <= 1) return controller.getActiveTab();
      const curIdx = state.tabs.findIndex((t) => t.id === state.activeTabId);
      const startIdx = curIdx >= 0 ? curIdx : 0;
      const nextIdx = (startIdx + delta + state.tabs.length) % state.tabs.length;
      return controller.activateTab(state.tabs[nextIdx].id, currentSnapshot);
    },

    async closeTab(tabId, currentSnapshot) {
      saveSnapshotIntoActive(currentSnapshot);
      const target = state.tabs.find((t) => t.id === tabId);
      if (!target) return false;

      if (target.isDirty && deps.onConfirmCloseDirty) {
        const choice = await deps.onConfirmCloseDirty(target);
        if (choice === "cancel") return false;
        if (choice === "save") {
          if (deps.onSaveTab) {
            const saved = await deps.onSaveTab(target);
            if (!saved) return false;
          }
          target.isDirty = false;
        }
      }

      const { nextState, activeChanged, nextActive } = closeTabInState(state, tabId);
      state = nextState;
      render();
      notifyChange();
      if (activeChanged) {
        await deps.onActivateTab(nextActive);
      }
      return true;
    },

    async closeOtherTabs(keepTabId, currentSnapshot) {
      saveSnapshotIntoActive(currentSnapshot);
      const toClose = state.tabs.filter((t) => t.id !== keepTabId).map((t) => t.id);
      for (const id of toClose) {
        const closed = await controller.closeTab(id);
        if (!closed) break;
      }
    },

    async closeTabsToRight(anchorTabId, currentSnapshot) {
      saveSnapshotIntoActive(currentSnapshot);
      const idx = state.tabs.findIndex((t) => t.id === anchorTabId);
      if (idx < 0) return;
      const toClose = state.tabs.slice(idx + 1).map((t) => t.id);
      for (const id of toClose) {
        const closed = await controller.closeTab(id);
        if (!closed) break;
      }
    },

    async closeAllTabs(currentSnapshot) {
      saveSnapshotIntoActive(currentSnapshot);
      const toClose = state.tabs.map((t) => t.id);
      for (const id of toClose) {
        const closed = await controller.closeTab(id);
        if (!closed) return false;
      }
      return true;
    },

    clearAllTabs() {
      closeContextMenu();
      state = { tabs: [], activeTabId: null };
      render();
      notifyChange();
    },

    updateActiveSnapshot(snapshot) {
      if (!state.activeTabId) return;
      const active = state.tabs.find((t) => t.id === state.activeTabId);
      if (!active) return;
      if (snapshot.content !== undefined) active.content = snapshot.content;
      if (snapshot.scrollTop !== undefined) active.scrollTop = snapshot.scrollTop;
      if (snapshot.scrollLeft !== undefined) active.scrollLeft = snapshot.scrollLeft;
      if (snapshot.selectionStart !== undefined) active.selectionStart = snapshot.selectionStart;
      if (snapshot.selectionEnd !== undefined) active.selectionEnd = snapshot.selectionEnd;
      if (snapshot.slideIndex !== undefined) active.slideIndex = snapshot.slideIndex;
      if (snapshot.previewScrollTop !== undefined) active.previewScrollTop = snapshot.previewScrollTop;
    },

    setTabDirty(dirty, tabId) {
      const targetId = tabId ?? state.activeTabId;
      if (!targetId) return;
      const target = state.tabs.find((t) => t.id === targetId);
      if (!target || target.isDirty === dirty) return;
      target.isDirty = dirty;
      render();
      notifyChange();
    },

    handleEntryRenamed(oldPath, newPath, isDir) {
      state = renameEntryInTabState(state, oldPath, newPath, isDir);
      render();
      notifyChange();
      return controller.getActiveTab();
    },

    handleEntryDeleted(deletedPath, isDir) {
      const { nextState, activeChanged, nextActive } = deleteEntryInTabState(
        state,
        deletedPath,
        isDir
      );
      state = nextState;
      render();
      notifyChange();
      if (activeChanged) {
        void deps.onActivateTab(nextActive);
      }
      return nextActive;
    },

    reorderTab(fromId, toId) {
      const next = reorderTabsInState(state, fromId, toId);
      if (next === state) return;
      state = next;
      render();
      notifyChange();
    },

    getActiveTab() {
      if (!state.activeTabId) return null;
      return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
    },

    getTabs() {
      return state.tabs.map((t) => ({ ...t }));
    },

    findTabByPath(filePath) {
      const id = normalizeTabPath(filePath);
      return state.tabs.find((t) => t.id === id) ?? null;
    },

    getDirtyTabs() {
      return state.tabs.filter((t) => t.isDirty);
    },

    hasDirtyTabs() {
      return state.tabs.some((t) => t.isDirty);
    },

    render,

    destroy() {
      closeContextMenu();
      window.removeEventListener("pointerdown", handleGlobalPointerDown);
      window.removeEventListener("keydown", handleGlobalKeyDown);
      tablistEl.removeEventListener("wheel", handleWheel);
      tablistEl.removeEventListener("keydown", handleTablistKeyDown);
      deps.container.innerHTML = "";
    },
  };

  render();
  return controller;
}
