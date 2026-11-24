import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { highlightLectureMarkdown } from "../src/editor-highlight.ts";

/**
 * Strip all HTML tags from highlighted output and unescape HTML entities
 * to verify exact character-for-character alignment with the raw textarea text.
 */
function stripHighlightHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("highlightLectureMarkdown", () => {
  it("preserves exact plain-text characters for 0px caret alignment", () => {
    const samples = [
      "# 見出し1\n\nこれは**強調**と`コード`と$E=mc^2$です。",
      "---\ntitle: 講義資料\ntheme: academic\n---\n\n- [ ] タスク\n- [x] 完了",
      "```mermaid\nflowchart LR\n  A[\"開始\"] -->|矢印| B[終了]\n```",
      "<div class=\"lecture-columns\">\n  <img src=\"a.png\" width=\"300\" />\n</div>",
    ];

    for (const src of samples) {
      const html = highlightLectureMarkdown(src);
      assert.equal(stripHighlightHtml(html), src);
    }
  });

  it("appends a single trailing space when source ends with a newline", () => {
    const src = "# Heading\n";
    const html = highlightLectureMarkdown(src);
    assert.ok(html.endsWith("\n "));
    assert.equal(stripHighlightHtml(html), src + " ");
  });

  it("highlights YAML frontmatter delimiters, keys, punctuation, and values", () => {
    const src = [
      "---",
      "course: 情報工学特論",
      "title: アルゴリズム入門",
      "theme: handout",
      "---",
      "",
      "# 本文",
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    assert.match(html, /<span class="hl-meta">---<\/span>/);
    assert.match(
      html,
      /<span class="hl-yaml-key">course<\/span><span class="hl-punct">: <\/span><span class="hl-yaml-val">情報工学特論<\/span>/
    );
    assert.match(
      html,
      /<span class="hl-yaml-key">theme<\/span><span class="hl-punct">: <\/span><span class="hl-yaml-val">handout<\/span>/
    );
    assert.match(
      html,
      /<span class="hl-heading-marker">#<\/span> <span class="hl-heading">本文<\/span>/
    );
  });

  it("highlights Markdown headings, horizontal rules, callouts, blockquotes, lists, and tables", () => {
    const src = [
      "## セクション *斜体*",
      "---",
      "> [!IMPORTANT]",
      "> 重要な **補足** です",
      "- [ ] 未完了タスク",
      "1. 番号付きリスト ~~取消~~",
      "| 列A | 列B |",
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    assert.match(html, /<span class="hl-heading-marker">##<\/span>/);
    assert.match(html, /<span class="hl-em">\*斜体\*<\/span>/);
    assert.match(html, /<span class="hl-hr">---<\/span>/);
    assert.match(html, /<span class="hl-callout">\[!IMPORTANT\]<\/span>/);
    assert.match(html, /<span class="hl-quote">重要な <span class="hl-strong">\*\*補足\*\*<\/span> です<\/span>/);
    assert.match(html, /<span class="hl-list-marker">- \[ \] <\/span>/);
    assert.match(html, /<span class="hl-list-marker">1\. <\/span>/);
    assert.match(html, /<span class="hl-del">~~取消~~<\/span>/);
    assert.match(html, /<span class="hl-table-pipe">\|<\/span>/);
  });

  it("highlights inline links, images, inline code, and inline/block math", () => {
    const src = [
      "参照: [Lectern](https://example.com) と ![図1](img/fig1.png)",
      "コード `let x = 1;` と数式 $a^2 + b^2 = c^2$",
      "$$",
      "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
      "$$",
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    assert.match(html, /<span class="hl-link-text">Lectern<\/span>/);
    assert.match(html, /<span class="hl-link-url">https:\/\/example\.com<\/span>/);
    assert.match(html, /<span class="hl-punct">!\[<\/span><span class="hl-link-text">図1<\/span>/);
    assert.match(html, /<span class="hl-inline-code">`let x = 1;`<\/span>/);
    assert.match(html, /<span class="hl-math">\$a\^2 \+ b\^2 = c\^2\$<\/span>/);
    assert.match(html, /<span class="hl-math-delim">\$\$<\/span>/);
    assert.match(html, /<span class="hl-math">\\sum_\{i=1\}\^\{n\} i = \\frac\{n\(n\+1\)\}\{2\}<\/span>/);
  });

  it("highlights inline HTML tags, attributes, values, and HTML comments", () => {
    const src = [
      "<!-- スピーカーノート -->",
      '<img src="images/pic.png" width="300" data-flag />',
      '<div class="lecture-columns">内容</div>',
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    assert.match(html, /<span class="hl-comment">&lt;!-- スピーカーノート --&gt;<\/span>/);
    assert.match(html, /<span class="hl-html-tag">img<\/span>/);
    assert.match(html, /<span class="hl-html-attr">src<\/span>/);
    assert.match(html, /<span class="hl-string">"images\/pic\.png"<\/span>/);
    assert.match(html, /<span class="hl-html-attr">data-flag<\/span>/);
    assert.match(html, /<span class="hl-html-tag">div<\/span>/);
    assert.match(html, /<span class="hl-html-punct">&lt;\/<\/span><span class="hl-html-tag">div<\/span>/);
  });

  it("highlights ```html fenced code blocks", () => {
    const src = [
      "```html",
      "<!-- header -->",
      '<section id="s1">Hello</section>',
      "```",
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    assert.match(html, /<span class="hl-code-fence">```<\/span><span class="hl-code-lang">html<\/span>/);
    assert.match(html, /<span class="hl-comment">&lt;!-- header --&gt;<\/span>/);
    assert.match(html, /<span class="hl-html-tag">section<\/span>/);
    assert.match(html, /<span class="hl-html-attr">id<\/span>/);
    assert.match(html, /<span class="hl-string">"s1"<\/span>/);
  });

  it("highlights ```mermaid fenced code blocks (keywords, arrows, labels, comments)", () => {
    const src = [
      "```mermaid",
      "%% フローチャート例",
      "flowchart LR",
      '  A["入力"] -->|検証| B(処理)',
      "  subgraph sub1",
      "    B ==> C{分岐}",
      "  end",
      "```",
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    assert.match(html, /<span class="hl-comment">%% フローチャート例<\/span>/);
    assert.match(html, /<span class="hl-mmd-keyword">flowchart<\/span>/);
    assert.match(html, /<span class="hl-mmd-keyword">LR<\/span>/);
    assert.match(html, /<span class="hl-mmd-arrow">--&gt;<\/span>/);
    assert.match(html, /<span class="hl-mmd-arrow">\|<\/span><span class="hl-string">検証<\/span><span class="hl-mmd-arrow">\|<\/span>/);
    assert.match(html, /<span class="hl-mmd-punct">\(<\/span><span class="hl-mmd-label">処理<\/span><span class="hl-mmd-punct">\)<\/span>/);
    assert.match(html, /<span class="hl-mmd-keyword">subgraph<\/span>/);
    assert.match(html, /<span class="hl-mmd-keyword">end<\/span>/);
  });

  it("supports 4-backtick nested fences without closing early on inner 3-backtick fences", () => {
    const src = [
      "````markdown",
      "# Nested Heading",
      "```rust",
      "fn main() {}",
      "```",
      "````",
      "# Outside Heading",
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    const lines = html.split("\n");
    assert.equal(lines.length, 7);

    // Opening 4-backtick fence
    assert.match(lines[0], /hl-code-fence">````<\/span><span class="hl-code-lang">markdown/);
    // Inner lines must stay inside hl-code-line (not parsed as Markdown heading or closing fence)
    assert.match(lines[1], /^<span class="hl-code-line">/);
    assert.match(lines[2], /^<span class="hl-code-line">/);
    assert.match(lines[3], /^<span class="hl-code-line">/);
    assert.match(lines[4], /^<span class="hl-code-line">/);
    // Closing 4-backtick fence
    assert.match(lines[5], /hl-code-fence">````<\/span>/);
    // Line after closing fence is parsed as normal Markdown heading
    assert.match(lines[6], /hl-heading-marker">#<\/span>/);
  });

  it("supports tilde (~~~) fenced code blocks and generic code highlighting", () => {
    const src = [
      "~~~rust",
      "pub fn add(a: i32) -> i32 {",
      "  // comment",
      '  let s = "hello";',
      "  return 42;",
      "}",
      "~~~",
    ].join("\n");

    const html = highlightLectureMarkdown(src);
    assert.match(html, /<span class="hl-code-fence">~~~<\/span><span class="hl-code-lang">rust<\/span>/);
    assert.match(html, /<span class="hl-keyword">pub<\/span>/);
    assert.match(html, /<span class="hl-keyword">fn<\/span>/);
    assert.match(html, /<span class="hl-comment">\/\/ comment<\/span>/);
    assert.match(html, /<span class="hl-string">"hello"<\/span>/);
    assert.match(html, /<span class="hl-number">42<\/span>/);
  });

  it("escapes all XSS payloads safely across Markdown, YAML, HTML, Mermaid, and code blocks", () => {
    const payloads = [
      '<script>alert("xss")</script>',
      '<img src="x" onerror="alert(1)">',
      '"><svg onload=alert(1)>',
      "---\ntitle: <script>evil()</script>\n---\nBody",
      "```js\nconst x = '<script>alert(1)</script>';\n```",
      "```mermaid\nflowchart LR\n  A[<script>alert(1)</script>] --> B\n```",
      "```html\n<script>alert(1)</script>\n```",
      "[click](javascript:alert(1)) & `<b>tag</b>`",
    ];

    for (const payload of payloads) {
      const html = highlightLectureMarkdown(payload);
      // No raw <script>, <img>, <svg>, or <b> tags may ever appear in output;
      // only `<span class="...">` and `</span>` are allowed.
      const tags = html.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
      for (const tag of tags) {
        assert.match(
          tag,
          /^(?:<span class="hl-[a-z-]+">|<\/span>)$/,
          `Unexpected unescaped tag in output: ${tag}`
        );
      }
      assert.equal(stripHighlightHtml(html), payload);
    }
  });
});
