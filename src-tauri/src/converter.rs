use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use syntect::highlighting::ThemeSet;
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileResult {
    pub html: String,
    pub slide_count: usize,
    pub title: String,
    pub author: String,
    pub date: String,
    pub theme: Option<String>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Default, Clone)]
pub struct FrontMatter {
    pub title: String,
    pub subtitle: String,
    pub author: String,
    pub date: String,
    pub theme: Option<String>,
}

fn build_doc_header_html(meta: &FrontMatter) -> String {
    if meta.title.is_empty() && meta.subtitle.is_empty() && meta.author.is_empty() && meta.date.is_empty() {
        return String::new();
    }
    let title_html = if !meta.title.is_empty() {
        format!(r#"<h1 class="lecture-doc-title title">{}</h1>"#, escape_html(&meta.title))
    } else {
        String::new()
    };
    let subtitle_html = if !meta.subtitle.is_empty() {
        format!(r#"<h1 class="lecture-doc-subtitle subtitle">{}</h1>"#, escape_html(&meta.subtitle))
    } else {
        String::new()
    };
    let author_html = if !meta.author.is_empty() {
        format!(r#"<span class="lecture-doc-author author">{}</span>"#, escape_html(&meta.author))
    } else {
        String::new()
    };
    let date_html = if !meta.date.is_empty() {
        format!(r#"<span class="lecture-doc-date date">{}</span>"#, escape_html(&meta.date))
    } else {
        String::new()
    };

    let meta_block = if !author_html.is_empty() || !date_html.is_empty() {
        format!(r#"<div class="lecture-doc-meta">{}{}</div>"#, author_html, date_html)
    } else {
        String::new()
    };

    format!(r#"<header class="lecture-doc-header">{}{}{}</header>"#, title_html, subtitle_html, meta_block)
}

/// マークダウン文字列を解析し、指定されたモード ("document" | "slide") に応じたHTMLを生成する
pub fn compile_lecture_markdown(markdown: &str, mode: &str) -> CompileResult {
    let start = Instant::now();
    let (meta, body_md) = parse_frontmatter(markdown);
    let preprocessed = preprocess_callouts(&body_md);

    let raw_slides = split_slides(&preprocessed);
    let slide_count = raw_slides.len().max(1);

    let ss = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();
    let is_light_code_theme = matches!(
        meta.theme.as_deref(),
        None | Some("handout") | Some("academic")
    );
    let theme = if is_light_code_theme {
        &ts.themes["InspiredGitHub"]
    } else {
        &ts.themes["base16-ocean.dark"]
    };

    let mut final_html = String::new();

    if mode == "slide" {
        for (idx, slide_md) in raw_slides.iter().enumerate() {
            let slide_inner = render_markdown_chunk(slide_md, &ss, theme);
            let title_header = if idx == 0 {
                build_doc_header_html(&meta)
            } else {
                String::new()
            };

            final_html.push_str(&format!(
                r#"<section class="lecture-slide" data-slide-index="{}">{}{}<footer class="slide-footer"><span>{}</span><span>{} / {}</span></footer></section>"#,
                idx,
                title_header,
                slide_inner,
                escape_html(if meta.title.is_empty() { "Lectern" } else { &meta.title }),
                idx + 1,
                slide_count
            ));
        }
    } else {
        // Document (A4 Handout) Mode
        final_html.push_str(&build_doc_header_html(&meta));
        let doc_inner = render_markdown_chunk(&preprocessed, &ss, theme);
        final_html.push_str(&doc_inner);
    }

    let elapsed_ms = start.elapsed().as_millis();

    CompileResult {
        html: final_html,
        slide_count,
        title: meta.title,
        author: meta.author,
        date: meta.date,
        theme: meta.theme,
        elapsed_ms,
    }
}

/// 先頭の YAML フロントマター (`--- ... ---`) を抽出する
fn parse_frontmatter(input: &str) -> (FrontMatter, String) {
    let mut meta = FrontMatter::default();
    let normalized = input.replace("\r\n", "\n");

    if !normalized.starts_with("---\n") {
        return (meta, normalized);
    }

    if let Some(end_idx) = normalized[4..].find("\n---\n") {
        let yaml_block = &normalized[4..4 + end_idx];
        for line in yaml_block.lines() {
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim().to_lowercase();
                let val = v.trim().trim_matches(['"', '\'']).to_string();
                match key.as_str() {
                    "title" => meta.title = val,
                    "subtitle" => meta.subtitle = val,
                    "author" => meta.author = val,
                    "date" => meta.date = val,
                    "theme" => {
                        if !val.is_empty() {
                            meta.theme = Some(val);
                        }
                    }
                    _ => {}
                }
            }
        }
        let remainder = &normalized[4 + end_idx + 5..];
        return (meta, remainder.to_string());
    }

    (meta, normalized)
}

/// コードフェンス外の独立した `---` 行でスライドを分割する
fn split_slides(markdown: &str) -> Vec<String> {
    let mut slides = Vec::new();
    let mut current = String::new();
    let mut in_code_fence = false;

    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_fence = !in_code_fence;
        }

        if !in_code_fence && trimmed == "---" {
            if !current.trim().is_empty() {
                slides.push(current.clone());
                current.clear();
            }
            continue;
        }

        current.push_str(line);
        current.push('\n');
    }

    if !current.trim().is_empty() || slides.is_empty() {
        slides.push(current);
    }

    slides
}

/// GitHub スタイルのコールアウト (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`) を HTML ブロックに変換する
fn preprocess_callouts(markdown: &str) -> String {
    let mut out = String::new();
    let mut lines = markdown.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim_start();
        if let Some(after_gt) = trimmed.strip_prefix('>') {
            let tag_line = after_gt.trim();
            let callout_kind = if tag_line.starts_with("[!NOTE]") {
                Some(("note", "📘 NOTE / 補足"))
            } else if tag_line.starts_with("[!TIP]") {
                Some(("tip", "💡 TIP / ヒント"))
            } else if tag_line.starts_with("[!IMPORTANT]") {
                Some(("important", "🎓 IMPORTANT / 重要・演習"))
            } else if tag_line.starts_with("[!WARNING]") {
                Some(("warning", "⚠️ WARNING / 注意"))
            } else {
                None
            };

            if let Some((kind_cls, label)) = callout_kind {
                let mut inner_md = String::new();
                while let Some(&next_line) = lines.peek() {
                    let next_trimmed = next_line.trim_start();
                    if let Some(stripped) = next_trimmed.strip_prefix('>') {
                        lines.next();
                        inner_md.push_str(stripped.strip_prefix(' ').unwrap_or(stripped));
                        inner_md.push('\n');
                    } else {
                        break;
                    }
                }
                out.push_str(&format!(
                    "\n<div class=\"callout callout-{}\"><div class=\"callout-title\">{}</div>\n\n{}\n</div>\n",
                    kind_cls, label, inner_md
                ));
                continue;
            }
        }

        out.push_str(line);
        out.push('\n');
    }

    out
}

/// `pulldown-cmark` + `syntect` で Markdown チャンクを HTML に変換する
fn render_markdown_chunk(
    markdown: &str,
    ss: &SyntaxSet,
    theme: &syntect::highlighting::Theme,
) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_MATH);

    let parser = Parser::new_ext(markdown, options);
    let mut events = Vec::new();

    let mut in_code_block = false;
    let mut code_lang = String::new();
    let mut code_buffer = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::CodeBlock(kind)) => {
                in_code_block = true;
                code_buffer.clear();
                code_lang = match kind {
                    CodeBlockKind::Fenced(lang) => lang.split_whitespace().next().unwrap_or("").to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
                if code_lang.eq_ignore_ascii_case("mermaid") {
                    let encoded = escape_html(&code_buffer);
                    let html = format!(
                        r#"<div class="mermaid-container" data-mermaid="{}"><pre class="mermaid">{}</pre></div>"#,
                        encoded, encoded
                    );
                    events.push(Event::Html(html.into()));
                } else {
                    let syntax = ss
                        .find_syntax_by_token(&code_lang)
                        .unwrap_or_else(|| ss.find_syntax_plain_text());
                    let highlighted = highlighted_html_for_string(&code_buffer, ss, syntax, theme)
                        .unwrap_or_else(|_| format!("<pre><code>{}</code></pre>", escape_html(&code_buffer)));
                    let lang_label = if code_lang.is_empty() {
                        "TEXT".to_string()
                    } else {
                        code_lang.to_uppercase()
                    };
                    let wrapped = format!(
                        r#"<div class="code-block-wrapper"><div class="code-block-header">{}</div>{}</div>"#,
                        escape_html(&lang_label),
                        highlighted
                    );
                    events.push(Event::Html(wrapped.into()));
                }
            }
            Event::Text(text) if in_code_block => {
                code_buffer.push_str(&text);
            }
            Event::InlineMath(math_tex) => {
                let escaped = escape_html(&math_tex);
                let html = format!(
                    r#"<span class="math-inline" data-math="{}">${}$</span>"#,
                    escaped, escaped
                );
                events.push(Event::Html(html.into()));
            }
            Event::DisplayMath(math_tex) => {
                let escaped = escape_html(&math_tex);
                let html = format!(
                    r#"<div class="math-display" data-math="{}">$${}$$</div>"#,
                    escaped, escaped
                );
                events.push(Event::Html(html.into()));
            }
            other => events.push(other),
        }
    }

    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, events.into_iter());
    html_output
}

pub fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// エクスポートおよびPDF印刷用の自己完結型スタンドアロンHTMLを生成する
pub fn build_standalone_html(
    markdown: &str,
    rendered_body_html: Option<&str>,
    mode: &str,
    theme_id: Option<&str>,
    theme_css: Option<&str>,
) -> String {
    let compiled = compile_lecture_markdown(markdown, mode);
    let body_content = rendered_body_html
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&compiled.html);

    let effective_theme_id = theme_id
        .filter(|s| !s.trim().is_empty())
        .or(compiled.theme.as_deref())
        .unwrap_or("handout");

    let custom_theme_style = theme_css.unwrap_or("");

    let title = if compiled.title.is_empty() {
        "Lectern 講義資料"
    } else {
        &compiled.title
    };

    // ローカルの node_modules に katex.min.css があればインライン埋め込みし、オフラインPDF生成でも数式スタイルを保証する
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let katex_css_tag = manifest_dir
        .parent()
        .map(|p| p.join("node_modules/katex/dist/katex.min.css"))
        .and_then(|css_path| std::fs::read_to_string(css_path).ok())
        .map(|css| format!("<style>{}</style>", css))
        .unwrap_or_else(|| {
            r#"<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css" crossorigin="anonymous" />"#.to_string()
        });

    let page_css = if mode == "slide" {
        r#"
        @page {
          size: 16in 9in;
          margin: 0;
        }
        body.mode-slide .lecture-render-root {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 32px 16px;
        }
        .lecture-slide {
          width: 1120px;
          height: 630px;
          background: #ffffff;
          color: #17202a;
          border: 1px solid #d7e0ec;
          border-radius: 12px;
          padding: 44px 56px;
          box-shadow: 0 10px 28px rgba(0,0,0,0.08);
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          box-sizing: border-box;
          page-break-after: always;
          break-after: page;
        }
        @media print {
          body.mode-slide {
            background: #ffffff;
            margin: 0;
            padding: 0;
          }
          body.mode-slide .lecture-render-root {
            padding: 0;
            gap: 0;
          }
          .lecture-slide {
            width: 100vw;
            height: 100vh;
            border: none;
            border-radius: 0;
            box-shadow: none;
            page-break-after: always;
            break-after: page;
          }
        }
        "#
    } else {
        r#"
        @page {
          size: A4 portrait;
          margin: 16mm 18mm;
        }
        body.mode-document .lecture-render-root {
          max-width: 840px;
          margin: 32px auto;
          background: #ffffff;
          color: #17202a;
          padding: 44px 52px;
          border-radius: 10px;
          box-shadow: 0 6px 22px rgba(0,0,0,0.06);
        }
        @media print {
          body.mode-document {
            background: #ffffff;
          }
          body.mode-document .lecture-render-root {
            max-width: 100%;
            margin: 0;
            padding: 0;
            box-shadow: none;
            border: none;
          }
        }
        "#
    };

    format!(
        r#"<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  {katex_css_tag}
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Segoe UI", sans-serif;
      background: #f1f5f9;
      color: #17202a;
      line-height: 1.7;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }}
    .lecture-doc-header {{
      border-bottom: 2px solid #2563eb;
      padding-bottom: 14px;
      margin-bottom: 24px;
    }}
    .lecture-doc-title {{
      font-size: 28px;
      font-weight: 800;
      margin: 0 0 6px 0;
      color: #0f172a;
    }}
    .lecture-doc-meta {{
      display: flex;
      gap: 16px;
      font-size: 13px;
      color: #64748b;
    }}
    h1 {{ font-size: 1.8rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.25em; margin-top: 0.5em; }}
    h2 {{ font-size: 1.4rem; color: #2563eb; margin-top: 0.9em; }}
    h3 {{ font-size: 1.15rem; margin-top: 0.8em; }}
    code:not(pre code) {{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #eef2f9;
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
    }}
    .code-block-wrapper {{
      margin: 14px 0;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #cbd5e1;
      break-inside: avoid;
    }}
    .code-block-header {{
      background: #1e293b;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 12px;
      text-transform: uppercase;
    }}
    .code-block-wrapper pre {{
      margin: 0 !important;
      padding: 12px 16px !important;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.5;
    }}
    .callout {{
      border-left: 4px solid #2563eb;
      background: #f8fafc;
      padding: 12px 16px;
      border-radius: 0 8px 8px 0;
      margin: 14px 0;
      break-inside: avoid;
    }}
    .callout-title {{ font-weight: 700; margin-bottom: 4px; }}
    .callout-note {{ border-left-color: #3b82f6; background: #eff6ff; }}
    .callout-tip {{ border-left-color: #10b981; background: #ecfdf5; }}
    .callout-important {{ border-left-color: #8b5cf6; background: #f5f3ff; }}
    .callout-warning {{ border-left-color: #f59e0b; background: #fffbeb; }}
    .lecture-columns {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      align-items: start;
      margin: 14px 0;
    }}
    table {{ width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 0.94rem; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }}
    th {{ background: #f1f5f9; font-weight: 700; }}
    .math-display {{ margin: 14px 0; text-align: center; overflow-x: auto; }}
    .mermaid-container {{
      margin: 16px 0;
      display: flex;
      justify-content: center;
      padding: 12px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      break-inside: avoid;
    }}
    .slide-footer {{
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #64748b;
    }}
    {page_css}
  </style>
  <style id="lectern-theme-css">
{custom_theme_style}
  </style>
</head>
<body class="mode-{mode} theme-{theme_id}" data-lecture-theme="{theme_id}">
  <article class="lecture-render-root" data-lecture-theme="{theme_id}">
    {body_content}
  </article>
  <script>
    // CLI出力時などで未レンダリングの数式やMermaid図表が残っている場合のみCDNで補完
    window.addEventListener("DOMContentLoaded", () => {{
      const unrendered = document.querySelectorAll(".math-inline:not(:has(.katex)), .math-display:not(:has(.katex))");
      if (unrendered.length > 0) {{
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.js";
        s.onload = () => {{
          unrendered.forEach((el) => {{
            const tex = el.getAttribute("data-math") || "";
            const isDisplay = el.classList.contains("math-display");
            if (window.katex) window.katex.render(tex, el, {{ displayMode: isDisplay, throwOnError: false }});
          }});
        }};
        document.head.appendChild(s);
      }}
      const unrenderedMermaid = document.querySelectorAll(".mermaid-container:not(:has(svg)) .mermaid");
      if (unrenderedMermaid.length > 0) {{
        const m = document.createElement("script");
        m.src = "https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.min.js";
        m.onload = () => {{
          if (window.mermaid) {{
            window.mermaid.initialize({{ startOnLoad: false, theme: "default" }});
            window.mermaid.run({{ querySelector: ".mermaid" }});
          }}
        }};
        document.head.appendChild(m);
      }}
    }});
  </script>
</body>
</html>"#,
        title = escape_html(title),
        katex_css_tag = katex_css_tag,
        page_css = page_css,
        custom_theme_style = custom_theme_style,
        mode = escape_html(mode),
        theme_id = escape_html(effective_theme_id),
        body_content = body_content
    )
}
