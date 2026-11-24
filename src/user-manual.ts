/// <reference types="vite/client" />
import userManualMarkdown from "../docs/USER_MANUAL.md?raw";
import "./user-manual.css";

// ============================================================================
// Public API Types
// ============================================================================

export interface UserManualViewer {
  /** Open the User Manual modal dialog, optionally scrolling to a heading ID. */
  open: (sectionId?: string) => void;
  /** Close the User Manual modal dialog. */
  close: () => void;
  /** Return whether the modal dialog is currently open. */
  isOpen: () => boolean;
  /** Underlying native <dialog> element. */
  element: HTMLDialogElement;
}

interface TocHeading {
  id: string;
  level: 2 | 3;
  text: string;
  parentH2Id: string | null;
}

interface ParsedManual {
  html: string;
  headings: TocHeading[];
}

// ============================================================================
// Markdown-to-HTML Renderer (Self-Contained, Safe, CommonMark + GFM + Callouts)
// ============================================================================

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function renderInline(raw: string): string {
  // 1. Protect inline code spans (double or single backticks) before escaping/formatting
  const codeTokens: string[] = [];
  let text = raw.replace(/(``+)(.+?)\1|`([^`\n]+)`/g, (_m, _doubleTicks, doubleBody, singleBody) => {
    const body = typeof doubleBody === "string" ? doubleBody.trim() : singleBody;
    const idx = codeTokens.length;
    codeTokens.push(`<code>${escapeHtml(body)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  // 2. Escape remaining raw HTML
  text = escapeHtml(text);

  // 3. Links: [label](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safeUrl = url.trim();
    if (/^https?:\/\//i.test(safeUrl)) {
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    if (safeUrl.startsWith("#")) {
      return `<a href="${safeUrl}" data-manual-anchor="${safeUrl.slice(1)}">${label}</a>`;
    }
    return label;
  });

  // 4. Bold (**text**) — works cleanly with CJK punctuation/brackets
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");

  // 5. Strikethrough (~~text~~)
  text = text.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");

  // 6. Italic (*text*)
  text = text.replace(/(^|[^\w*])\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*(?!\*)/g, "$1<em>$2</em>");

  // 7. Restore code tokens
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_m, idxStr: string) => codeTokens[Number(idxStr)] ?? "");

  return text;
}

function parseTableCells(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !trimmed.includes("-")) return false;
  const cells = parseTableCells(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function parseTableAlignments(sepLine: string): Array<"left" | "center" | "right"> {
  return parseTableCells(sepLine).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function renderManualMarkdown(markdown: string): ParsedManual {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const headings: TocHeading[] = [];
  let headingCounter = 0;
  let currentH2Id: string | null = null;

  let i = 0;
  const len = lines.length;

  const isBlockStart = (idx: number): boolean => {
    if (idx >= len) return true;
    const line = lines[idx];
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^(`{3,}|~{3,})/.test(trimmed)) return true;
    if (/^#{1,6}\s+/.test(trimmed)) return true;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return true;
    if (/^>\s?/.test(trimmed)) return true;
    if (/^\s*[-*+]\s+/.test(line)) return true;
    if (/^\s*\d+\.\s+/.test(line)) return true;
    if (
      trimmed.includes("|") &&
      idx + 1 < len &&
      isTableSeparatorLine(lines[idx + 1])
    ) {
      return true;
    }
    return false;
  };

  while (i < len) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block (supports 3+ backticks or tildes, including nested 4-backtick fences)
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fenceMatch) {
      const fenceSeq = fenceMatch[1];
      const fenceChar = fenceSeq[0];
      const fenceLen = fenceSeq.length;
      const lang = fenceMatch[2].trim().split(/\s+/)[0] ?? "";
      const codeLines: string[] = [];
      i += 1;
      while (i < len) {
        const closeTrim = lines[i].trim();
        const closeRegex = new RegExp(`^\\${fenceChar}{${fenceLen},}\\s*$`);
        if (closeRegex.test(closeTrim)) {
          i += 1;
          break;
        }
        codeLines.push(lines[i]);
        i += 1;
      }
      const label = lang ? lang.toUpperCase() : "TEXT";
      out.push(
        `<div class="manual-code-block"><div class="manual-code-header">${escapeHtml(
          label
        )}</div><pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`
      );
      continue;
    }

    // 2. Headings (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawText = headingMatch[2];
      const plainText = stripInlineMarkdown(rawText);
      headingCounter += 1;
      const id = `manual-sec-${headingCounter}`;

      if (level === 2) {
        currentH2Id = id;
        headings.push({ id, level: 2, text: plainText, parentH2Id: null });
      } else if (level === 3) {
        headings.push({ id, level: 3, text: plainText, parentH2Id: currentH2Id });
      }

      out.push(`<h${level} id="${id}">${renderInline(rawText)}</h${level}>`);
      i += 1;
      continue;
    }

    // 3. Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    // 4. Callout or Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < len && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }

      const firstLine = (quoteLines[0] ?? "").trim();
      let calloutKind: { cls: string; title: string } | null = null;
      if (firstLine.startsWith("[!NOTE]")) {
        calloutKind = { cls: "note", title: "📘 NOTE / 補足" };
      } else if (firstLine.startsWith("[!TIP]")) {
        calloutKind = { cls: "tip", title: "💡 TIP / ヒント" };
      } else if (firstLine.startsWith("[!IMPORTANT]")) {
        calloutKind = { cls: "important", title: "🎓 IMPORTANT / 重要・演習" };
      } else if (firstLine.startsWith("[!WARNING]")) {
        calloutKind = { cls: "warning", title: "⚠️ WARNING / 注意" };
      }

      if (calloutKind) {
        const bodyParagraphs = quoteLines
          .slice(1)
          .join("\n")
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => `<p>${renderInline(p.replace(/\n/g, " "))}</p>`)
          .join("");
        out.push(
          `<div class="manual-callout manual-callout-${calloutKind.cls}"><div class="manual-callout-title">${calloutKind.title}</div>${bodyParagraphs}</div>`
        );
      } else {
        const body = quoteLines
          .join("\n")
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => `<p>${renderInline(p.replace(/\n/g, " "))}</p>`)
          .join("");
        out.push(`<blockquote>${body}</blockquote>`);
      }
      continue;
    }

    // 5. GFM Table
    if (trimmed.includes("|") && i + 1 < len && isTableSeparatorLine(lines[i + 1])) {
      const headers = parseTableCells(lines[i]);
      const aligns = parseTableAlignments(lines[i + 1]);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < len && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        bodyRows.push(parseTableCells(lines[i]));
        i += 1;
      }

      const thHtml = headers
        .map((h, idx) => {
          const align = aligns[idx] ?? "left";
          return `<th style="text-align:${align}">${renderInline(h)}</th>`;
        })
        .join("");

      const trHtml = bodyRows
        .map((cells) => {
          const tds = headers
            .map((_h, idx) => {
              const align = aligns[idx] ?? "left";
              return `<td style="text-align:${align}">${renderInline(cells[idx] ?? "")}</td>`;
            })
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");

      out.push(
        `<div class="manual-table-wrap"><table><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table></div>`
      );
      continue;
    }

    // 6. Unordered or Ordered List (with 1-level nested sub-list support)
    const ulStart = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    const olStart = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (ulStart || olStart) {
      const isOrdered = Boolean(olStart);
      const baseIndent = (ulStart ? ulStart[1] : olStart![1]).length;
      const tag = isOrdered ? "ol" : "ul";
      const itemsHtml: string[] = [];

      while (i < len) {
        const curLine = lines[i];
        const m = isOrdered
          ? /^(\s*)\d+\.\s+(.+)$/.exec(curLine)
          : /^(\s*)[-*+]\s+(.+)$/.exec(curLine);
        if (!m || m[1].length !== baseIndent) break;

        let itemContent = renderInline(m[2]);
        i += 1;

        // Collect nested sub-list items indented deeper than baseIndent
        const subItems: string[] = [];
        let subOrdered = false;
        while (i < len) {
          const subUl = /^(\s+)[-*+]\s+(.+)$/.exec(lines[i]);
          const subOl = /^(\s+)\d+\.\s+(.+)$/.exec(lines[i]);
          const subMatch = subUl || subOl;
          if (!subMatch || subMatch[1].length <= baseIndent) break;
          if (subItems.length === 0) subOrdered = Boolean(subOl);
          subItems.push(`<li>${renderInline(subMatch[2])}</li>`);
          i += 1;
        }

        if (subItems.length > 0) {
          const subTag = subOrdered ? "ol" : "ul";
          itemContent += `<${subTag}>${subItems.join("")}</${subTag}>`;
        }
        itemsHtml.push(`<li>${itemContent}</li>`);
      }

      out.push(`<${tag}>${itemsHtml.join("")}</${tag}>`);
      continue;
    }

    // 7. Paragraph
    const paraLines: string[] = [];
    while (i < len && !isBlockStart(i)) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length > 0) {
      const joined = paraLines
        .map((l, idx) => {
          if (idx < paraLines.length - 1 && l.endsWith("  ")) {
            return `${renderInline(l.trimEnd())}<br />`;
          }
          return renderInline(l.trim());
        })
        .join(" ");
      out.push(`<p>${joined}</p>`);
    } else {
      i += 1;
    }
  }

  return { html: out.join("\n"), headings };
}

// ============================================================================
// Dialog Fallback Helper (for WebViews without native `closedBy` support)
// ============================================================================

function attachClosedByAnyFallback(dialog: HTMLDialogElement): void {
  if ("closedBy" in HTMLDialogElement.prototype) return;
  const isOutside = (e: PointerEvent) => {
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

// ============================================================================
// Singleton Viewer Factory & Convenience Opener
// ============================================================================

let cachedViewer: UserManualViewer | null = null;

/**
 * Create (or return the existing) accessible in-app User Manual modal viewer.
 * Renders `docs/USER_MANUAL.md` with an auto-generated H2/H3 Table of Contents
 * sidebar and instant search/filter highlighting.
 */
export function createUserManualViewer(): UserManualViewer {
  if (cachedViewer && document.body.contains(cachedViewer.element)) {
    return cachedViewer;
  }

  const parsed = renderManualMarkdown(userManualMarkdown);

  // Build native <dialog class="modal-dialog modal-manual" closedby="any">
  const dialog = document.createElement("dialog");
  dialog.id = "modal-user-manual";
  dialog.className = "modal-dialog modal-manual";
  dialog.setAttribute("closedby", "any");
  dialog.setAttribute("aria-labelledby", "modal-manual-title");

  dialog.innerHTML = `
    <div class="manual-shell">
      <header class="manual-header">
        <div class="manual-header-left">
          <h2 id="modal-manual-title" class="manual-title">📘 Lectern ユーザーマニュアル</h2>
        </div>
        <search class="manual-search-box" aria-label="マニュアル内検索">
          <label for="manual-search-input" class="visually-hidden">マニュアル内を検索</label>
          <div class="manual-search-input-wrap">
            <input
              type="search"
              id="manual-search-input"
              class="manual-search-input"
              placeholder="キーワード・ショートカットを検索..."
              autocomplete="off"
            />
            <button
              type="button"
              id="manual-search-clear"
              class="manual-search-clear"
              aria-label="検索をクリア"
              title="検索をクリア"
              hidden
            >✕</button>
          </div>
          <span id="manual-search-count" class="manual-search-count" aria-live="polite"></span>
          <div id="manual-search-nav" class="manual-search-nav" hidden>
            <button type="button" id="manual-hit-prev" class="btn btn-icon btn-sm" aria-label="前の一致" title="前の一致 (Shift+Enter)">▲</button>
            <button type="button" id="manual-hit-next" class="btn btn-icon btn-sm" aria-label="次の一致" title="次の一致 (Enter)">▼</button>
          </div>
        </search>
        <div class="manual-header-actions">
          <button type="button" id="manual-close-btn" class="btn btn-secondary btn-sm" aria-label="ユーザーマニュアルを閉じる" title="閉じる (Esc)">
            ✕ 閉じる
          </button>
        </div>
      </header>
      <div class="manual-body">
        <nav class="manual-toc" aria-label="マニュアル目次">
          <div class="manual-toc-label">目次</div>
          <ul id="manual-toc-list" class="manual-toc-list"></ul>
          <div id="manual-toc-empty" class="manual-toc-empty" hidden>一致するセクションがありません</div>
        </nav>
        <div id="manual-content" class="manual-content" tabindex="0">
          <article id="manual-article" class="manual-article"></article>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
  attachClosedByAnyFallback(dialog);

  const elSearchInput = dialog.querySelector("#manual-search-input") as HTMLInputElement;
  const btnSearchClear = dialog.querySelector("#manual-search-clear") as HTMLButtonElement;
  const elSearchCount = dialog.querySelector("#manual-search-count") as HTMLSpanElement;
  const elSearchNav = dialog.querySelector("#manual-search-nav") as HTMLDivElement;
  const btnHitPrev = dialog.querySelector("#manual-hit-prev") as HTMLButtonElement;
  const btnHitNext = dialog.querySelector("#manual-hit-next") as HTMLButtonElement;
  const btnClose = dialog.querySelector("#manual-close-btn") as HTMLButtonElement;
  const elTocList = dialog.querySelector("#manual-toc-list") as HTMLUListElement;
  const elTocEmpty = dialog.querySelector("#manual-toc-empty") as HTMLDivElement;
  const elContent = dialog.querySelector("#manual-content") as HTMLDivElement;
  const elArticle = dialog.querySelector("#manual-article") as HTMLElement;

  // Render initial article HTML
  elArticle.innerHTML = parsed.html;

  // Build Table of Contents sidebar from H2/H3 headings
  const tocItemMap = new Map<
    string,
    { li: HTMLLIElement; btn: HTMLButtonElement; badge: HTMLSpanElement; heading: TocHeading }
  >();

  for (const h of parsed.headings) {
    const li = document.createElement("li");
    li.className = "manual-toc-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `manual-toc-link level-${h.level}`;
    btn.dataset.targetId = h.id;

    const textSpan = document.createElement("span");
    textSpan.textContent = h.text;

    const badge = document.createElement("span");
    badge.className = "manual-toc-badge";
    badge.hidden = true;

    btn.appendChild(textSpan);
    btn.appendChild(badge);
    btn.addEventListener("click", () => {
      scrollToHeading(h.id);
    });

    li.appendChild(btn);
    elTocList.appendChild(li);
    tocItemMap.set(h.id, { li, btn, badge, heading: h });
  }

  let currentActiveHeadingId: string | null = parsed.headings[0]?.id ?? null;
  let searchHits: HTMLElement[] = [];
  let currentHitIdx = -1;

  function setActiveTocHeading(id: string | null): void {
    currentActiveHeadingId = id;
    for (const [hId, entry] of tocItemMap) {
      const active = hId === id;
      entry.btn.classList.toggle("is-active", active);
      if (active) {
        entry.btn.setAttribute("aria-current", "location");
      } else {
        entry.btn.removeAttribute("aria-current");
      }
    }
  }

  function scrollToHeading(id: string, behavior: ScrollBehavior = "smooth"): void {
    const target = elArticle.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    target.scrollIntoView({ behavior, block: "start" });
    setActiveTocHeading(id);
  }

  // Update active ToC item while scrolling through the manual
  function updateActiveHeadingFromScroll(): void {
    const containerTop = elContent.getBoundingClientRect().top;
    let activeId: string | null = null;
    for (const h of parsed.headings) {
      const el = elArticle.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`);
      if (!el) continue;
      const top = el.getBoundingClientRect().top - containerTop;
      if (top <= 48) {
        activeId = h.id;
      } else {
        break;
      }
    }
    if (!activeId && parsed.headings.length > 0) {
      activeId = parsed.headings[0].id;
    }
    if (activeId && activeId !== currentActiveHeadingId) {
      setActiveTocHeading(activeId);
    }
  }

  elContent.addEventListener("scroll", updateActiveHeadingFromScroll, { passive: true });

  // Handle internal #anchor links inside the manual
  elArticle.addEventListener("click", (e) => {
    const anchor = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
      "a[data-manual-anchor]"
    );
    if (!anchor) return;
    e.preventDefault();
    const targetId = anchor.getAttribute("data-manual-anchor");
    if (targetId) scrollToHeading(targetId);
  });

  // Search / Filter logic
  function clearSearchHighlights(): void {
    const marks = elArticle.querySelectorAll<HTMLElement>("mark.manual-hit");
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    });
    searchHits = [];
    currentHitIdx = -1;
  }

  function focusHit(idx: number): void {
    if (searchHits.length === 0) return;
    searchHits.forEach((m) => m.classList.remove("is-current"));
    currentHitIdx = ((idx % searchHits.length) + searchHits.length) % searchHits.length;
    const hit = searchHits[currentHitIdx];
    hit.classList.add("is-current");
    hit.scrollIntoView({ behavior: "smooth", block: "center" });
    elSearchCount.textContent = `${currentHitIdx + 1} / ${searchHits.length}`;
  }

  function applySearch(rawQuery: string): void {
    clearSearchHighlights();
    const query = rawQuery.trim();
    btnSearchClear.hidden = query.length === 0;

    if (!query) {
      elSearchCount.textContent = "";
      elSearchNav.hidden = true;
      elTocEmpty.hidden = true;
      for (const entry of tocItemMap.values()) {
        entry.li.hidden = false;
        entry.badge.hidden = true;
        entry.badge.textContent = "";
      }
      return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");

    // Walk text nodes inside article and wrap matches with <mark class="manual-hit">
    const walker = document.createTreeWalker(elArticle, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      if (currentNode.nodeValue && regex.test(currentNode.nodeValue)) {
        regex.lastIndex = 0;
        textNodes.push(currentNode as Text);
      }
    }

    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      regex.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(value)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
        }
        const mark = document.createElement("mark");
        mark.className = "manual-hit";
        mark.textContent = match[0];
        frag.appendChild(mark);
        searchHits.push(mark);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < value.length) {
        frag.appendChild(document.createTextNode(value.slice(lastIndex)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    // Count hits per H2/H3 section so the ToC filters cleanly
    const sectionHitCount = new Map<string, number>();
    let activeSectionId: string | null = null;
    for (const child of Array.from(elArticle.children)) {
      if (child.tagName === "H2" || child.tagName === "H3") {
        activeSectionId = child.id || activeSectionId;
      }
      const hitsInChild = child.querySelectorAll("mark.manual-hit").length;
      if (hitsInChild > 0 && activeSectionId) {
        sectionHitCount.set(
          activeSectionId,
          (sectionHitCount.get(activeSectionId) ?? 0) + hitsInChild
        );
      }
    }

    // Propagate H3 match counts up to their parent H2 so matching sub-sections keep parent visible
    const h2HasVisibleChild = new Set<string>();
    for (const h of parsed.headings) {
      if (h.level === 3 && h.parentH2Id && (sectionHitCount.get(h.id) ?? 0) > 0) {
        h2HasVisibleChild.add(h.parentH2Id);
      }
    }

    let visibleCount = 0;
    for (const h of parsed.headings) {
      const entry = tocItemMap.get(h.id);
      if (!entry) continue;
      const ownHits = sectionHitCount.get(h.id) ?? 0;
      const show = ownHits > 0 || (h.level === 2 && h2HasVisibleChild.has(h.id));
      entry.li.hidden = !show;
      if (show) visibleCount += 1;
      if (ownHits > 0) {
        entry.badge.hidden = false;
        entry.badge.textContent = String(ownHits);
      } else {
        entry.badge.hidden = true;
        entry.badge.textContent = "";
      }
    }

    elTocEmpty.hidden = visibleCount > 0;

    if (searchHits.length > 0) {
      elSearchNav.hidden = false;
      focusHit(0);
    } else {
      elSearchNav.hidden = true;
      elSearchCount.textContent = "該当なし";
    }
  }

  elSearchInput.addEventListener("input", () => {
    applySearch(elSearchInput.value);
  });

  elSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (elSearchInput.value.trim().length > 0) {
        e.preventDefault();
        e.stopPropagation();
        elSearchInput.value = "";
        applySearch("");
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) return;
      if (searchHits.length > 0) {
        focusHit(e.shiftKey ? currentHitIdx - 1 : currentHitIdx + 1);
      }
    }
  });

  btnSearchClear.addEventListener("click", () => {
    elSearchInput.value = "";
    applySearch("");
    elSearchInput.focus();
  });

  btnHitPrev.addEventListener("click", () => focusHit(currentHitIdx - 1));
  btnHitNext.addEventListener("click", () => focusHit(currentHitIdx + 1));
  btnClose.addEventListener("click", () => dialog.close());

  setActiveTocHeading(currentActiveHeadingId);

  const viewer: UserManualViewer = {
    open(sectionId?: string) {
      if (!dialog.open) {
        dialog.returnValue = "";
        dialog.showModal();
      }
      if (sectionId) {
        scrollToHeading(sectionId, "auto");
      } else {
        updateActiveHeadingFromScroll();
      }
      elSearchInput.focus({ preventScroll: true });
    },
    close() {
      if (dialog.open) {
        dialog.close();
      }
    },
    isOpen() {
      return dialog.open;
    },
    element: dialog,
  };

  cachedViewer = viewer;
  return viewer;
}

/**
 * Convenience helper to open the User Manual modal dialog directly.
 */
export function openUserManualModal(sectionId?: string): void {
  createUserManualViewer().open(sectionId);
}
