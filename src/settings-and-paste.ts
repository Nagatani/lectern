import "./settings-and-paste.css";

// ============================================================================
// Editor Settings Types & Persistence (localStorage: lectern-settings-v1)
// ============================================================================

export const SETTINGS_STORAGE_KEY = "lectern-settings-v1";

export interface EditorSettings {
  /** Editor font size in pixels (11–22, default 13.5) */
  fontSizePx: number;
  /** Editor line height multiplier (1.3–2.2, default 1.6) */
  lineHeight: number;
  /** Tab width in spaces (2 or 4, default 2) */
  tabSize: 2 | 4;
  /** Wrap long lines inside the editor viewport (default true) */
  wordWrap: boolean;
  /** Automatically save dirty files after idle delay (default false) */
  autoSave: boolean;
  /** Auto-save debounce delay in milliseconds (500–10000, default 1500) */
  autoSaveDelayMs: number;
  /** Synchronize editor & preview scrolling (default true) */
  syncScroll: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: Readonly<EditorSettings> = Object.freeze({
  fontSizePx: 13.5,
  lineHeight: 1.6,
  tabSize: 2,
  wordWrap: true,
  autoSave: false,
  autoSaveDelayMs: 1500,
  syncScroll: true,
});

function clampNumber(value: unknown, min: number, max: number, fallback: number, step?: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  const clamped = Math.min(max, Math.max(min, num));
  if (!step || step <= 0) return clamped;
  const rounded = Math.round(clamped / step) * step;
  return Number(rounded.toFixed(4));
}

export function sanitizeEditorSettings(raw: unknown): EditorSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawTab = Number(obj.tabSize);
  const tabSize: 2 | 4 = rawTab === 4 ? 4 : 2;

  return {
    fontSizePx: clampNumber(obj.fontSizePx, 11, 22, DEFAULT_EDITOR_SETTINGS.fontSizePx, 0.5),
    lineHeight: clampNumber(obj.lineHeight, 1.3, 2.2, DEFAULT_EDITOR_SETTINGS.lineHeight, 0.05),
    tabSize,
    wordWrap: typeof obj.wordWrap === "boolean" ? obj.wordWrap : DEFAULT_EDITOR_SETTINGS.wordWrap,
    autoSave: typeof obj.autoSave === "boolean" ? obj.autoSave : DEFAULT_EDITOR_SETTINGS.autoSave,
    autoSaveDelayMs: clampNumber(
      obj.autoSaveDelayMs,
      500,
      10000,
      DEFAULT_EDITOR_SETTINGS.autoSaveDelayMs,
      100
    ),
    syncScroll:
      typeof obj.syncScroll === "boolean" ? obj.syncScroll : DEFAULT_EDITOR_SETTINGS.syncScroll,
  };
}

export function loadEditorSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EDITOR_SETTINGS };
    return sanitizeEditorSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
}

export function saveEditorSettings(settings: EditorSettings): void {
  const clean = sanitizeEditorSettings(settings);
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

// ============================================================================
// Settings Controller & Accessible Preferences Modal (<dialog id="modal-settings">)
// ============================================================================

export interface SettingsControllerDeps {
  /** Optional `.editor-stage` container (defaults to `document.querySelector(".editor-stage")`) */
  editorStage?: HTMLElement | null;
  /** Optional root element for CSS custom properties (defaults to `document.documentElement`) */
  rootElement?: HTMLElement;
  /** Invoked whenever settings are updated or reset */
  onChange?: (settings: EditorSettings) => void;
  /** Optional status / activity logger */
  onLog?: (message: string) => void;
}

export interface SettingsController {
  /** Return a shallow copy of the current settings */
  getSettings: () => EditorSettings;
  /** Merge partial settings, persist, apply live to DOM, and notify `onChange` */
  updateSettings: (patch: Partial<EditorSettings>) => EditorSettings;
  /** Reset all settings to defaults, persist, apply live, and notify `onChange` */
  resetSettings: () => EditorSettings;
  /** Re-apply current (or given) settings to CSS custom properties and `.editor-stage` */
  applySettings: (settings?: EditorSettings) => void;
  /** Open the accessible 環境設定 modal dialog */
  openModal: () => void;
  /** Close the 環境設定 modal dialog */
  closeModal: () => void;
  /** Return whether the modal dialog is currently open */
  isModalOpen: () => boolean;
  /** Underlying `<dialog id="modal-settings">` element */
  element: HTMLDialogElement;
  /** Remove dynamically created dialog and listeners */
  destroy: () => void;
}

function attachClosedByAnyFallback(dialog: HTMLDialogElement): void {
  if ("closedBy" in HTMLDialogElement.prototype) return;

  const isOutside = (e: PointerEvent): boolean => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (e) => {
    pressedOutside = isOutside(e);
  });
  dialog.addEventListener("pointerup", (e) => {
    if (pressedOutside && isOutside(e)) {
      dialog.close();
    }
    pressedOutside = false;
  });
}

function formatDelayLabel(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}秒` : `${(ms / 1000).toFixed(1)}秒`;
}

function buildSettingsDialogElement(): HTMLDialogElement {
  const existing = document.getElementById("modal-settings");
  if (existing instanceof HTMLDialogElement) {
    existing.remove();
  }

  const dialog = document.createElement("dialog");
  dialog.id = "modal-settings";
  dialog.className = "modal-dialog";
  dialog.setAttribute("closedby", "any");
  dialog.setAttribute("aria-labelledby", "modal-settings-title");

  dialog.innerHTML = `
    <div class="settings-modal-shell">
      <header class="settings-modal-header">
        <div class="settings-modal-title-group">
          <h2 id="modal-settings-title" class="settings-modal-title">⚙️ 環境設定</h2>
          <p class="settings-modal-subtitle">変更はリアルタイムでエディタへ反映・自動保存されます</p>
        </div>
        <button type="button" class="btn btn-icon" data-settings-close aria-label="環境設定を閉じる" title="閉じる (Esc)">✕</button>
      </header>

      <div class="settings-modal-body">
        <section class="settings-section" aria-label="エディタ表示">
          <h3 class="settings-section-title">エディタ表示</h3>

          <div class="settings-row-stack">
            <div class="settings-range-header">
              <label for="setting-font-size" class="settings-label">フォントサイズ</label>
              <output id="setting-font-size-val" class="settings-value-badge" for="setting-font-size">13.5px</output>
            </div>
            <input
              id="setting-font-size"
              class="settings-range"
              type="range"
              min="11"
              max="22"
              step="0.5"
              value="13.5"
            />
          </div>

          <div class="settings-row-stack">
            <div class="settings-range-header">
              <label for="setting-line-height" class="settings-label">行間 (Line Height)</label>
              <output id="setting-line-height-val" class="settings-value-badge" for="setting-line-height">1.60</output>
            </div>
            <input
              id="setting-line-height"
              class="settings-range"
              type="range"
              min="1.3"
              max="2.2"
              step="0.05"
              value="1.6"
            />
          </div>

          <div class="settings-row">
            <div class="settings-label-group">
              <span id="setting-tab-size-label" class="settings-label">タブ幅</span>
              <span class="settings-hint">インデントおよび Tab キーの幅</span>
            </div>
            <div class="settings-segmented" role="group" aria-labelledby="setting-tab-size-label">
              <button type="button" class="settings-seg-btn" data-tab-size="2" aria-pressed="true">2 スペース</button>
              <button type="button" class="settings-seg-btn" data-tab-size="4" aria-pressed="false">4 スペース</button>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-label-group">
              <label for="setting-word-wrap" class="settings-label">右端で折り返す (Word Wrap)</label>
              <span class="settings-hint">オフにすると長い行を横スクロールで表示します</span>
            </div>
            <label class="settings-switch">
              <input id="setting-word-wrap" type="checkbox" checked />
            </label>
          </div>
        </section>

        <section class="settings-section" aria-label="保存・プレビュー連動">
          <h3 class="settings-section-title">保存・プレビュー連動</h3>

          <div class="settings-row">
            <div class="settings-label-group">
              <label for="setting-auto-save" class="settings-label">自動保存 (Auto Save)</label>
              <span class="settings-hint">入力停止後に開いているファイルを自動で保存します</span>
            </div>
            <label class="settings-switch">
              <input id="setting-auto-save" type="checkbox" />
            </label>
          </div>

          <div id="setting-autosave-delay-row" class="settings-row settings-sub-row is-disabled">
            <div class="settings-label-group">
              <label for="setting-autosave-delay" class="settings-label">自動保存の待機時間</label>
              <span class="settings-hint">最後の入力から保存までの間隔</span>
            </div>
            <select id="setting-autosave-delay" class="settings-select" disabled>
              <option value="500">0.5秒</option>
              <option value="1000">1秒</option>
              <option value="1500" selected>1.5秒</option>
              <option value="2000">2秒</option>
              <option value="3000">3秒</option>
              <option value="5000">5秒</option>
            </select>
          </div>

          <div class="settings-row">
            <div class="settings-label-group">
              <label for="setting-sync-scroll" class="settings-label">プレビューとスクロール同期</label>
              <span class="settings-hint">エディタのスクロール位置に合わせてプレビューを追従します</span>
            </div>
            <label class="settings-switch">
              <input id="setting-sync-scroll" type="checkbox" checked />
            </label>
          </div>
        </section>
      </div>

      <footer class="settings-modal-footer">
        <button type="button" id="btn-settings-reset" class="btn">初期値にリセット</button>
        <button type="button" class="btn btn-primary" data-settings-close>閉じる</button>
      </footer>
    </div>
  `;

  document.body.appendChild(dialog);
  attachClosedByAnyFallback(dialog);
  return dialog;
}

export function createSettingsController(deps: SettingsControllerDeps = {}): SettingsController {
  let current: EditorSettings = loadEditorSettings();
  const rootEl = deps.rootElement ?? document.documentElement;
  const dialog = buildSettingsDialogElement();

  // Control references
  const inputFontSize = dialog.querySelector<HTMLInputElement>("#setting-font-size")!;
  const outFontSize = dialog.querySelector<HTMLOutputElement>("#setting-font-size-val")!;
  const inputLineHeight = dialog.querySelector<HTMLInputElement>("#setting-line-height")!;
  const outLineHeight = dialog.querySelector<HTMLOutputElement>("#setting-line-height-val")!;
  const tabButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[data-tab-size]"));
  const inputWordWrap = dialog.querySelector<HTMLInputElement>("#setting-word-wrap")!;
  const inputAutoSave = dialog.querySelector<HTMLInputElement>("#setting-auto-save")!;
  const rowAutoSaveDelay = dialog.querySelector<HTMLDivElement>("#setting-autosave-delay-row")!;
  const selectAutoSaveDelay = dialog.querySelector<HTMLSelectElement>("#setting-autosave-delay")!;
  const inputSyncScroll = dialog.querySelector<HTMLInputElement>("#setting-sync-scroll")!;
  const btnReset = dialog.querySelector<HTMLButtonElement>("#btn-settings-reset")!;
  const closeButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[data-settings-close]"));

  function resolveEditorStage(): HTMLElement | null {
    return deps.editorStage ?? document.querySelector<HTMLElement>(".editor-stage");
  }

  function applySettings(settings: EditorSettings = current): void {
    const clean = sanitizeEditorSettings(settings);
    rootEl.style.setProperty("--editor-font-size", `${clean.fontSizePx}px`);
    rootEl.style.setProperty("--editor-line-height", String(clean.lineHeight));
    rootEl.style.setProperty("--editor-tab-size", String(clean.tabSize));

    const stage = resolveEditorStage();
    if (stage) {
      // Toggle `.editor-nowrap` on `.editor-stage` so BOTH `.editor-highlight-layer`
      // and `.markdown-editor` update identically and preserve 0px CJK caret alignment.
      stage.classList.toggle("editor-nowrap", !clean.wordWrap);

      const editorEl = stage.querySelector<HTMLTextAreaElement>(".markdown-editor");
      const highlightEl = stage.querySelector<HTMLElement>(".editor-highlight-layer");
      if (editorEl && highlightEl) {
        if (clean.wordWrap) {
          editorEl.scrollLeft = 0;
        }
        highlightEl.scrollTop = editorEl.scrollTop;
        highlightEl.scrollLeft = editorEl.scrollLeft;
      }
    }
  }

  function syncControlsFromState(): void {
    inputFontSize.value = String(current.fontSizePx);
    outFontSize.textContent = `${current.fontSizePx}px`;

    inputLineHeight.value = String(current.lineHeight);
    outLineHeight.textContent = current.lineHeight.toFixed(2);

    for (const btn of tabButtons) {
      const val = Number(btn.dataset.tabSize);
      btn.setAttribute("aria-pressed", String(val === current.tabSize));
    }

    inputWordWrap.checked = current.wordWrap;
    inputAutoSave.checked = current.autoSave;

    // Ensure custom saved delay values remain selectable in <select>
    const delayStr = String(current.autoSaveDelayMs);
    if (!Array.from(selectAutoSaveDelay.options).some((opt) => opt.value === delayStr)) {
      const opt = document.createElement("option");
      opt.value = delayStr;
      opt.textContent = formatDelayLabel(current.autoSaveDelayMs);
      selectAutoSaveDelay.appendChild(opt);
    }
    selectAutoSaveDelay.value = delayStr;
    selectAutoSaveDelay.disabled = !current.autoSave;
    rowAutoSaveDelay.classList.toggle("is-disabled", !current.autoSave);

    inputSyncScroll.checked = current.syncScroll;
  }

  function commit(next: EditorSettings, notify = true): EditorSettings {
    current = sanitizeEditorSettings(next);
    saveEditorSettings(current);
    applySettings(current);
    syncControlsFromState();
    if (notify) {
      deps.onChange?.({ ...current });
    }
    return { ...current };
  }

  // Wire live-preview event listeners
  inputFontSize.addEventListener("input", () => {
    commit({ ...current, fontSizePx: Number(inputFontSize.value) });
  });

  inputLineHeight.addEventListener("input", () => {
    commit({ ...current, lineHeight: Number(inputLineHeight.value) });
  });

  for (const btn of tabButtons) {
    btn.addEventListener("click", () => {
      const nextTab: 2 | 4 = Number(btn.dataset.tabSize) === 4 ? 4 : 2;
      if (nextTab !== current.tabSize) {
        commit({ ...current, tabSize: nextTab });
      }
    });
  }

  inputWordWrap.addEventListener("change", () => {
    commit({ ...current, wordWrap: inputWordWrap.checked });
  });

  inputAutoSave.addEventListener("change", () => {
    commit({ ...current, autoSave: inputAutoSave.checked });
  });

  selectAutoSaveDelay.addEventListener("change", () => {
    commit({ ...current, autoSaveDelayMs: Number(selectAutoSaveDelay.value) });
  });

  inputSyncScroll.addEventListener("change", () => {
    commit({ ...current, syncScroll: inputSyncScroll.checked });
  });

  btnReset.addEventListener("click", () => {
    commit({ ...DEFAULT_EDITOR_SETTINGS });
    deps.onLog?.("環境設定を初期値にリセットしました");
  });

  for (const btn of closeButtons) {
    btn.addEventListener("click", () => {
      dialog.close();
    });
  }

  // Initial DOM sync (without firing redundant onChange on construction)
  applySettings(current);
  syncControlsFromState();

  return {
    getSettings: () => ({ ...current }),
    updateSettings: (patch: Partial<EditorSettings>) => commit({ ...current, ...patch }),
    resetSettings: () => {
      const reset = commit({ ...DEFAULT_EDITOR_SETTINGS });
      deps.onLog?.("環境設定を初期値にリセットしました");
      return reset;
    },
    applySettings,
    openModal: () => {
      syncControlsFromState();
      if (!dialog.open) {
        dialog.showModal();
      }
    },
    closeModal: () => {
      if (dialog.open) {
        dialog.close();
      }
    },
    isModalOpen: () => dialog.open,
    element: dialog,
    destroy: () => {
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
    },
  };
}

// ============================================================================
// Clipboard Image Paste Handler
// ============================================================================

const CLIPBOARD_IMAGE_MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface ClipboardImagePasteDeps {
  /**
   * Persist pasted image bytes (e.g. via Tauri `save_pasted_image` command)
   * and return the Markdown-ready relative path (e.g. `"images/paste_...png"`).
   */
  savePastedImage: (bytes: Uint8Array, ext: string) => Promise<string>;
  /**
   * Insert Markdown text at the current editor cursor in an Undo-safe manner
   * (e.g. via `execCommand("insertText")` / `replaceTextareaRange`).
   */
  insertText: (text: string) => void;
  /** Optional status / activity log callback */
  onLog?: (message: string) => void;
  /** Optional error callback */
  onError?: (error: unknown) => void;
}

/**
 * Inspects a `paste` event for clipboard image items (`image/png`, `image/jpeg`,
 * `image/webp`, `image/gif`). When found, prevents default paste, reads raw bytes
 * via `File.arrayBuffer()`, saves them via `deps.savePastedImage(bytes, ext)`, and
 * inserts `\n![画像](${relPath})\n` via `deps.insertText(...)` (Undo-safe).
 *
 * Returns `true` if an image was handled, or `false` to allow normal text paste.
 */
export async function handleClipboardImagePaste(
  ev: ClipboardEvent,
  deps: ClipboardImagePasteDeps
): Promise<boolean> {
  const items = ev.clipboardData?.items;
  if (!items || items.length === 0) {
    return false;
  }

  let matchedItem: DataTransferItem | null = null;
  let ext = "png";

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const mime = item.type.toLowerCase();
    const mappedExt = CLIPBOARD_IMAGE_MIME_TO_EXT[mime];
    if (mappedExt) {
      matchedItem = item;
      ext = mappedExt;
      break;
    }
  }

  if (!matchedItem) {
    return false;
  }

  // Must prevent default synchronously before awaiting File.arrayBuffer()
  ev.preventDefault();

  const file = matchedItem.getAsFile();
  if (!file) {
    return false;
  }

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new Error("クリップボードの画像データが空です");
    }

    const relPath = await deps.savePastedImage(bytes, ext);
    deps.insertText(`\n![画像](${relPath})\n`);
    deps.onLog?.(`クリップボード画像を保存して挿入しました: ${relPath}`);
    return true;
  } catch (err) {
    deps.onError?.(err);
    deps.onLog?.(`クリップボード画像の貼り付けに失敗しました: ${String(err)}`);
    return false;
  }
}
