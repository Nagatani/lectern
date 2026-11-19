/**
 * Lightweight, zero-dependency syntax highlighter for Lectern's Markdown editor.
 * Supports:
 * - Markdown (YAML frontmatter, headings, lists, quotes, callouts, tables, math, links, images, emphasis, inline code)
 * - HTML (both inline HTML in Markdown and ```html fenced blocks: comments, tags, attributes, strings)
 * - Mermaid (```mermaid fenced blocks: comments, diagram keywords, subgraph/end, arrows, labels/strings)
 * - General fenced code blocks (comments, strings, numbers, common keywords)
 *
 * IMPORTANT: Never changes font-weight or font-size in highlight spans, ensuring
 * exact 0px caret alignment with CJK/Japanese characters in the overlaid <textarea>.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrap(cls: string, rawText: string): string {
  return `<span class="${cls}">${escapeHtml(rawText)}</span>`;
}

/**
 * Highlight an HTML tag string such as `<img src="a.png" width="300" />` or `</div>`.
 */
function highlightHtmlTag(rawTag: string): string {
  if (rawTag.startsWith("<!--")) {
    return wrap("hl-comment", rawTag);
  }
  const tagMatch = /^(&lt;|<)(\/?)([A-Za-z][A-Za-z0-9:-]*)([\s\S]*?)(\/?)(&gt;|>)$/.exec(rawTag);
  if (!tagMatch) {
    return wrap("hl-html-tag", rawTag);
  }

  const [, open, slash, tagName, attrsRaw, selfClose, close] = tagMatch;
  let out = wrap("hl-html-punct", open + slash) + wrap("hl-html-tag", tagName);

  // Highlight attributes inside the tag
  const attrRegex = /(\s+)([A-Za-z_:][A-Za-z0-9_.:-]*)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrsRaw)) !== null) {
    if (m.index > lastIndex) {
      out += escapeHtml(attrsRaw.slice(lastIndex, m.index));
    }
    const [, ws, attrName, eq, attrVal] = m;
    out += escapeHtml(ws) + wrap("hl-html-attr", attrName);
    if (eq !== undefined && attrVal !== undefined) {
      out += wrap("hl-html-punct", eq) + wrap("hl-string", attrVal);
    }
    lastIndex = attrRegex.lastIndex;
  }
  if (lastIndex < attrsRaw.length) {
    out += escapeHtml(attrsRaw.slice(lastIndex));
  }

  out += wrap("hl-html-punct", selfClose + close);
  return out;
}

/**
 * Highlight a single line inside an ```html / ```xml / ```svg code block.
 */
function highlightHtmlLine(line: string): string {
  const tokenRegex = /<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?\/?>/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(line)) !== null) {
    if (m.index > last) {
      out += escapeHtml(line.slice(last, m.index));
    }
    out += highlightHtmlTag(m[0]);
    last = tokenRegex.lastIndex;
  }
  if (last < line.length) {
    out += escapeHtml(line.slice(last));
  }
  return out;
}

const MERMAID_KEYWORDS = new Set([
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "gantt",
  "pie",
  "journey",
  "gitGraph",
  "mindmap",
  "timeline",
  "quadrantChart",
  "requirementDiagram",
  "C4Context",
  "subgraph",
  "end",
  "direction",
  "participant",
  "actor",
  "activate",
  "deactivate",
  "Note",
  "note",
  "over",
  "left",
  "right",
  "of",
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "and",
  "critical",
  "option",
  "break",
  "rect",
  "autonumber",
  "style",
  "classDef",
  "class",
  "click",
  "linkStyle",
  "title",
  "section",
  "state",
  "TB",
  "TD",
  "BT",
  "RL",
  "LR",
]);

/**
 * Highlight a single line inside a ```mermaid fenced code block.
 */
function highlightMermaidLine(line: string): string {
  // Comment line (`%% ...`)
  const commentIdx = line.indexOf("%%");
  if (commentIdx !== -1) {
    const before = line.slice(0, commentIdx);
    const comment = line.slice(commentIdx);
    return (before ? highlightMermaidCodeSegment(before) : "") + wrap("hl-comment", comment);
  }
  return highlightMermaidCodeSegment(line);
}

function highlightMermaidCodeSegment(segment: string): string {
  // Match strings, arrows/links, bracketed labels, pipe labels, or identifiers
  const tokenRegex =
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\|[^|]+\||<-->|<->|-->>|->>|-->|==>|-.->|--x|-x|--o|-o|---|===|\.\.\.|\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|\b[A-Za-z_][A-Za-z0-9_-]*\b/g;

  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(segment)) !== null) {
    if (m.index > last) {
      out += escapeHtml(segment.slice(last, m.index));
    }
    const tok = m[0];
    if (tok.startsWith('"') || tok.startsWith("'")) {
      out += wrap("hl-string", tok);
    } else if (tok.startsWith("|") && tok.endsWith("|")) {
      out +=
        wrap("hl-mmd-arrow", "|") +
        wrap("hl-string", tok.slice(1, -1)) +
        wrap("hl-mmd-arrow", "|");
    } else if (
      tok.startsWith("-") ||
      tok.startsWith("=") ||
      tok.startsWith("<") ||
      tok.startsWith(".")
    ) {
      out += wrap("hl-mmd-arrow", tok);
    } else if (
      (tok.startsWith("[") && tok.endsWith("]")) ||
      (tok.startsWith("(") && tok.endsWith(")")) ||
      (tok.startsWith("{") && tok.endsWith("}"))
    ) {
      const open = tok[0];
      const close = tok[tok.length - 1];
      const inner = tok.slice(1, -1);
      out +=
        wrap("hl-mmd-punct", open) +
        wrap("hl-mmd-label", inner) +
        wrap("hl-mmd-punct", close);
    } else if (MERMAID_KEYWORDS.has(tok)) {
      out += wrap("hl-mmd-keyword", tok);
    } else {
      out += wrap("hl-mmd-id", tok);
    }
    last = tokenRegex.lastIndex;
  }
  if (last < segment.length) {
    out += escapeHtml(segment.slice(last));
  }
  return out;
}

const GENERIC_CODE_KEYWORDS = new Set([
  "fn",
  "let",
  "mut",
  "pub",
  "struct",
  "enum",
  "impl",
  "trait",
  "use",
  "mod",
  "match",
  "if",
  "else",
  "for",
  "while",
  "loop",
  "return",
  "const",
  "var",
  "function",
  "async",
  "await",
  "def",
  "class",
  "import",
  "from",
  "export",
  "default",
  "interface",
  "type",
  "try",
  "catch",
  "throw",
  "new",
  "true",
  "false",
  "null",
  "None",
  "Some",
  "Ok",
  "Err",
  "self",
  "this",
  "in",
  "as",
  "where",
]);

/**
 * Lightweight syntax highlight for generic fenced code blocks (Rust, Python, JS/TS, CSS, etc.).
 */
function highlightGenericCodeLine(line: string): string {
  const tokenRegex =
    /\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b/g;

  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(line)) !== null) {
    if (m.index > last) {
      out += escapeHtml(line.slice(last, m.index));
    }
    const tok = m[0];
    if (tok.startsWith("//") || tok.startsWith("#")) {
      out += wrap("hl-comment", tok);
    } else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) {
      out += wrap("hl-string", tok);
    } else if (/^\d/.test(tok)) {
      out += wrap("hl-number", tok);
    } else if (GENERIC_CODE_KEYWORDS.has(tok)) {
      out += wrap("hl-keyword", tok);
    } else {
      out += escapeHtml(tok);
    }
    last = tokenRegex.lastIndex;
  }
  if (last < line.length) {
    out += escapeHtml(line.slice(last));
  }
  return out;
}

/**
 * Highlight inline Markdown constructs + inline HTML tags + inline KaTeX math.
 */
function highlightMarkdownInline(text: string): string {
  const tokenRegex =
    /(`[^`\n]+`)|(\$\$[^$\n]+\$\$|\$(?!\s)[^$\n]+?(?<!\s)\$)|(<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*)?\/?>)|(!?\[[^\]\n]*\]\([^)\n]*\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(~~[^~\n]+~~)|(\*(?!\s)[^*\n]+?(?<!\s)\*)/g;

  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(text)) !== null) {
    if (m.index > last) {
      out += escapeHtml(text.slice(last, m.index));
    }
    const [full, inlineCode, math, htmlTag, linkOrImg, strong, strike, em] = m;
    if (inlineCode) {
      out += wrap("hl-inline-code", inlineCode);
    } else if (math) {
      out += wrap("hl-math", math);
    } else if (htmlTag) {
      out += highlightHtmlTag(htmlTag);
    } else if (linkOrImg) {
      const linkMatch = /^(!?\[)([^\]\n]*)(\]\()([^)\n]*)(\))$/.exec(linkOrImg);
      if (linkMatch) {
        out +=
          wrap("hl-punct", linkMatch[1]) +
          wrap("hl-link-text", linkMatch[2]) +
          wrap("hl-punct", linkMatch[3]) +
          wrap("hl-link-url", linkMatch[4]) +
          wrap("hl-punct", linkMatch[5]);
      } else {
        out += wrap("hl-link-text", linkOrImg);
      }
    } else if (strong) {
      out += wrap("hl-strong", strong);
    } else if (strike) {
      out += wrap("hl-del", strike);
    } else if (em) {
      out += wrap("hl-em", em);
    } else {
      out += escapeHtml(full);
    }
    last = tokenRegex.lastIndex;
  }
  if (last < text.length) {
    out += escapeHtml(text.slice(last));
  }
  return out;
}

/**
 * Highlight a full Markdown document (with YAML frontmatter, HTML, Mermaid, KaTeX, and fenced code blocks).
 */
export function highlightLectureMarkdown(source: string): string {
  const lines = source.split("\n");
  const rendered: string[] = new Array(lines.length);

  let inFrontmatter = false;
  let inCodeFence = false;
  let codeFenceLang = "";
  let codeFenceMarker = "";
  let codeFenceLen = 0;
  let inMathBlock = false;

  // Detect YAML frontmatter starting on line 0
  let frontmatterEndLine = -1;
  if (lines.length > 1 && lines[0].trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        frontmatterEndLine = i;
        break;
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. YAML Frontmatter
    if (frontmatterEndLine !== -1 && i <= frontmatterEndLine) {
      if (i === 0 || i === frontmatterEndLine) {
        inFrontmatter = i === 0;
        rendered[i] = wrap("hl-meta", line);
      } else if (inFrontmatter) {
        const kv = /^(\s*[A-Za-z0-9_-]+)(\s*:\s*)(.*)$/.exec(line);
        if (kv) {
          rendered[i] =
            wrap("hl-yaml-key", kv[1]) +
            wrap("hl-punct", kv[2]) +
            wrap("hl-yaml-val", kv[3]);
        } else {
          rendered[i] = wrap("hl-yaml-val", line);
        }
      }
      continue;
    }

    // 2. Fenced Code Blocks (``` or ~~~)
    if (!inMathBlock) {
      const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
      if (fenceMatch) {
        const [, indent, marker, info] = fenceMatch;
        if (!inCodeFence && (marker[0] === "~" || !info.includes("`"))) {
          inCodeFence = true;
          codeFenceMarker = marker[0];
          codeFenceLen = marker.length;
          codeFenceLang = info.trim().split(/\s+/)[0].toLowerCase();
          rendered[i] =
            escapeHtml(indent) +
            wrap("hl-code-fence", marker) +
            (info ? wrap("hl-code-lang", info) : "");
          continue;
        } else if (
          inCodeFence &&
          marker[0] === codeFenceMarker &&
          marker.length >= codeFenceLen &&
          info.trim() === ""
        ) {
          inCodeFence = false;
          codeFenceLang = "";
          codeFenceMarker = "";
          codeFenceLen = 0;
          rendered[i] = escapeHtml(indent) + wrap("hl-code-fence", marker);
          continue;
        }
      }
    }

    if (inCodeFence) {
      if (codeFenceLang === "mermaid") {
        rendered[i] = `<span class="hl-code-line">${highlightMermaidLine(line)}</span>`;
      } else if (
        codeFenceLang === "html" ||
        codeFenceLang === "htm" ||
        codeFenceLang === "xml" ||
        codeFenceLang === "svg"
      ) {
        rendered[i] = `<span class="hl-code-line">${highlightHtmlLine(line)}</span>`;
      } else {
        rendered[i] = `<span class="hl-code-line">${highlightGenericCodeLine(line)}</span>`;
      }
      continue;
    }

    // 3. Display Math Block ($$ ... $$)
    if (line.trim() === "$$") {
      inMathBlock = !inMathBlock;
      rendered[i] = wrap("hl-math-delim", line);
      continue;
    }
    if (inMathBlock) {
      rendered[i] = wrap("hl-math", line);
      continue;
    }

    // 4. Headings (# ... ######)
    const headingMatch = /^(\s*#{1,6})(\s+)(.*)$/.exec(line);
    if (headingMatch) {
      rendered[i] =
        wrap("hl-heading-marker", headingMatch[1]) +
        escapeHtml(headingMatch[2]) +
        `<span class="hl-heading">${highlightMarkdownInline(headingMatch[3])}</span>`;
      continue;
    }

    // 5. Horizontal Rule / Slide Break (---, ***, ___)
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      rendered[i] = wrap("hl-hr", line);
      continue;
    }

    // 6. Callout / Blockquote (> [!NOTE], > ...)
    const calloutMatch = /^(\s*>+\s*)(\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])(.*)$/i.exec(line);
    if (calloutMatch) {
      rendered[i] =
        wrap("hl-quote-marker", calloutMatch[1]) +
        wrap("hl-callout", calloutMatch[2]) +
        highlightMarkdownInline(calloutMatch[3]);
      continue;
    }
    const quoteMatch = /^(\s*>+\s?)(.*)$/.exec(line);
    if (quoteMatch) {
      rendered[i] =
        wrap("hl-quote-marker", quoteMatch[1]) +
        `<span class="hl-quote">${highlightMarkdownInline(quoteMatch[2])}</span>`;
      continue;
    }

    // 7. Lists (-, *, +, 1., task list)
    const listMatch = /^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)(.*)$/.exec(line);
    if (listMatch) {
      rendered[i] =
        wrap("hl-list-marker", listMatch[1]) + highlightMarkdownInline(listMatch[2]);
      continue;
    }

    // 8. Markdown Table Separator or Row
    if (/^\s*\|/.test(line) && line.includes("|")) {
      rendered[i] = line
        .split("|")
        .map((cell) => highlightMarkdownInline(cell))
        .join(wrap("hl-table-pipe", "|"));
      continue;
    }

    // 9. Standard paragraph / inline Markdown + HTML
    rendered[i] = highlightMarkdownInline(line);
  }

  // Trailing space prevents the last empty line from collapsing inside <pre>
  let result = rendered.join("\n");
  if (source.endsWith("\n")) {
    result += " ";
  }
  return result;
}
