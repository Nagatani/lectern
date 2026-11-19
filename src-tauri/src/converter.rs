use base64::Engine;
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use syntect::highlighting::ThemeSet;
use syntect::html::highlighted_html_for_string;
use syntect::parsing::SyntaxSet;

/// ビルド時に `.woff2` フォントまで Base64 インライン化された完全自己完結の KaTeX CSS
const INLINED_KATEX_CSS: &str = include_str!(concat!(env!("OUT_DIR"), "/katex_standalone.css"));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileResult {
    pub html: String,
    pub slide_count: usize,
    pub course: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub date: String,
    pub theme: Option<String>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Default, Clone)]
pub struct FrontMatter {
    pub course: String,
    pub title: String,
    pub subtitle: String,
    pub description: String,
    pub author: String,
    pub date: String,
    pub theme: Option<String>,
}

fn build_doc_header_html(meta: &FrontMatter) -> String {
    if meta.course.is_empty()
        && meta.title.is_empty()
        && meta.subtitle.is_empty()
        && meta.description.is_empty()
        && meta.author.is_empty()
        && meta.date.is_empty()
    {
        return String::new();
    }
    let course_html = if !meta.course.is_empty() {
        format!(
            r#"<div class="lecture-doc-course"><span class="course-badge">{}</span></div>"#,
            escape_html(&meta.course)
        )
    } else {
        String::new()
    };
    let title_html = if !meta.title.is_empty() {
        format!(
            r#"<h1 class="lecture-doc-title title">{}</h1>"#,
            escape_html(&meta.title)
        )
    } else {
        String::new()
    };
    let subtitle_html = if !meta.subtitle.is_empty() {
        format!(
            r#"<h1 class="lecture-doc-subtitle subtitle">{}</h1>"#,
            escape_html(&meta.subtitle)
        )
    } else {
        String::new()
    };
    let author_html = if !meta.author.is_empty() {
        format!(
            r#"<span class="lecture-doc-author author">{}</span>"#,
            escape_html(&meta.author)
        )
    } else {
        String::new()
    };
    let date_html = if !meta.date.is_empty() {
        format!(
            r#"<span class="lecture-doc-date date">{}</span>"#,
            escape_html(&meta.date)
        )
    } else {
        String::new()
    };

    let meta_block = if !author_html.is_empty() || !date_html.is_empty() {
        format!(r#"<div class="lecture-doc-meta">{}{}</div>"#, author_html, date_html)
    } else {
        String::new()
    };

    let desc_html = if !meta.description.is_empty() {
        format!(
            r#"<div class="lecture-doc-description"><div class="description-label">資料概要</div><p class="description-text">{}</p></div>"#,
            escape_html(&meta.description)
        )
    } else {
        String::new()
    };

    format!(
        r#"<header class="lecture-doc-header">{}{}{}{}{}</header>"#,
        course_html, title_html, subtitle_html, meta_block, desc_html
    )
}

/// マークダウン文字列を解析し、指定されたモード ("document" | "slide") に応じたHTMLを生成する
pub fn compile_lecture_markdown(markdown: &str, mode: &str) -> CompileResult {
    compile_lecture_markdown_with_options(markdown, mode, None, None)
}

pub fn compile_lecture_markdown_with_theme(
    markdown: &str,
    mode: &str,
    active_theme: Option<&str>,
) -> CompileResult {
    compile_lecture_markdown_with_options(markdown, mode, active_theme, None)
}

pub fn compile_lecture_markdown_with_options(
    markdown: &str,
    mode: &str,
    active_theme: Option<&str>,
    base_dir: Option<&Path>,
) -> CompileResult {
    let start = Instant::now();
    let (meta, body_md) = parse_frontmatter(markdown);
    let preprocessed = preprocess_callouts(&body_md);

    let raw_slides = split_slides(&preprocessed);
    let slide_count = raw_slides.len().max(1);

    let ss = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();
    let effective_theme = active_theme
        .filter(|s| !s.trim().is_empty())
        .or(meta.theme.as_deref())
        .unwrap_or("handout");
    let is_light_code_theme = matches!(
        effective_theme,
        "handout" | "academic" | "sunset-warm"
    );
    let theme = if is_light_code_theme {
        &ts.themes["InspiredGitHub"]
    } else {
        &ts.themes["base16-ocean.dark"]
    };

    let mut final_html = String::new();

    if mode == "slide" {
        for (idx, slide_md) in raw_slides.iter().enumerate() {
            let slide_inner = render_markdown_chunk(slide_md, &ss, theme, base_dir);
            let title_header = if idx == 0 {
                build_doc_header_html(&meta)
            } else {
                String::new()
            };

            let footer_label = match (meta.course.is_empty(), meta.title.is_empty()) {
                (false, false) => format!("{} — {}", meta.course, meta.title),
                (false, true) => meta.course.clone(),
                (true, false) => meta.title.clone(),
                (true, true) => "Lectern".to_string(),
            };

            final_html.push_str(&format!(
                r#"<section class="lecture-slide" data-slide-index="{}">{}{}<footer class="slide-footer"><span>{}</span><span>{} / {}</span></footer></section>"#,
                idx,
                title_header,
                slide_inner,
                escape_html(&footer_label),
                idx + 1,
                slide_count
            ));
        }
    } else {
        // Document (A4 Handout) Mode
        final_html.push_str(&build_doc_header_html(&meta));
        let doc_inner = render_markdown_chunk(&preprocessed, &ss, theme, base_dir);
        final_html.push_str(&doc_inner);
    }

    // HTMLタグ `<img src="...">` で直書きされたローカル画像も Base64 Data URI に変換
    let final_html = embed_local_images_in_html(&final_html, base_dir);
    let elapsed_ms = start.elapsed().as_millis();

    CompileResult {
        html: final_html,
        slide_count,
        course: meta.course,
        title: meta.title,
        description: meta.description,
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
                    "course" | "lecture" | "subject" => meta.course = val,
                    "title" => meta.title = val,
                    "subtitle" => meta.subtitle = val,
                    "description" | "summary" | "abstract" => meta.description = val,
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

/// CommonMark 準拠のコードフェンス追跡ヘルパー（4連バッククォートやチルダによるネストに対応）
#[derive(Default)]
struct FenceTracker {
    active: Option<(char, usize)>,
}

impl FenceTracker {
    fn is_in_fence(&self) -> bool {
        self.active.is_some()
    }

    /// 1行を処理し、その行がコードフェンスの内側（開始・終了行を含む）であれば true を返す
    fn process_line(&mut self, line: &str) -> bool {
        let trimmed = line.trim_start();
        if let Some((f_char, f_len)) = self.active {
            let count = trimmed.chars().take_while(|&c| c == f_char).count();
            if count >= f_len && trimmed[count..].trim().is_empty() {
                self.active = None;
            }
            return true;
        }

        if let Some(first) = trimmed.chars().next() {
            if first == '`' || first == '~' {
                let count = trimmed.chars().take_while(|&c| c == first).count();
                let info = &trimmed[count..];
                // CommonMark: バッククォートフェンスの info 文字列にはバッククォートを含められない
                if count >= 3 && (first == '~' || !info.contains('`')) {
                    self.active = Some((first, count));
                    return true;
                }
            }
        }

        false
    }
}

/// コードフェンス外の独立した `---` 行でスライドを分割する
fn split_slides(markdown: &str) -> Vec<String> {
    let mut slides = Vec::new();
    let mut current = String::new();
    let mut fence = FenceTracker::default();

    for line in markdown.lines() {
        let was_in_fence = fence.is_in_fence();
        let is_fence_line = fence.process_line(line);

        if !was_in_fence && !is_fence_line && line.trim() == "---" {
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
/// コードフェンス内の `> [!NOTE]` は変換せずそのまま保持する
fn preprocess_callouts(markdown: &str) -> String {
    let mut out = String::new();
    let mut lines = markdown.lines().peekable();
    let mut fence = FenceTracker::default();

    while let Some(line) = lines.next() {
        if fence.process_line(line) {
            out.push_str(line);
            out.push('\n');
            continue;
        }

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

/// 画像拡張子から MIME タイプを判定する
fn detect_image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

/// URL パーセントエンコード (`%20` 等) をデコードするヘルパー
fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// 指定された画像パス（相対パス・絶対パス・file://）を解決し、`data:<mime>;base64,...` 文字列に変換する
pub fn resolve_image_to_data_uri(img_src: &str, base_dir: Option<&Path>) -> Option<String> {
    let trimmed = img_src.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("data:")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
    {
        return None;
    }

    let without_scheme = trimmed
        .strip_prefix("file://")
        .unwrap_or(trimmed);
    let decoded = percent_decode_path(without_scheme);
    let candidate = PathBuf::from(&decoded);

    let resolved_path = if candidate.is_absolute() && candidate.exists() {
        candidate
    } else if let Some(base) = base_dir {
        let joined = base.join(&candidate);
        if joined.exists() {
            joined
        } else {
            return None;
        }
    } else if candidate.exists() {
        candidate
    } else {
        return None;
    };

    if !resolved_path.is_file() {
        return None;
    }

    let mime = detect_image_mime(&resolved_path)?;
    let bytes = fs::read(&resolved_path).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime, b64))
}

/// HTML 文字列内の `<img ... src="..." ...>` タグに含まれるローカル画像パスをすべて Base64 Data URI に変換する
pub fn embed_local_images_in_html(html: &str, base_dir: Option<&Path>) -> String {
    let Some(base) = base_dir else {
        return html.to_string();
    };

    let mut result = String::with_capacity(html.len());
    let mut rest = html;

    while let Some(img_idx) = rest.find("<img") {
        result.push_str(&rest[..img_idx]);
        let after_img = &rest[img_idx..];

        let Some(tag_end) = after_img.find('>') else {
            result.push_str(after_img);
            return result;
        };

        let img_tag = &after_img[..=tag_end];
        let replaced_tag = replace_img_tag_src_with_base64(img_tag, Some(base));
        result.push_str(&replaced_tag);
        rest = &after_img[tag_end + 1..];
    }

    result.push_str(rest);
    result
}

fn replace_img_tag_src_with_base64(img_tag: &str, base_dir: Option<&Path>) -> String {
    for pattern in ["src=\"", "src='"] {
        if let Some(src_start) = img_tag.find(pattern) {
            let quote = pattern.chars().last().unwrap();
            let val_start = src_start + pattern.len();
            if let Some(val_end_rel) = img_tag[val_start..].find(quote) {
                let val_end = val_start + val_end_rel;
                let src_val = &img_tag[val_start..val_end];
                if let Some(data_uri) = resolve_image_to_data_uri(src_val, base_dir) {
                    let mut new_tag = String::with_capacity(img_tag.len() + data_uri.len());
                    new_tag.push_str(&img_tag[..val_start]);
                    new_tag.push_str(&data_uri);
                    new_tag.push_str(&img_tag[val_end..]);
                    return new_tag;
                }
            }
        }
    }
    img_tag.to_string()
}

fn is_cjk_or_ascii_punct(c: char) -> bool {
    c.is_ascii_punctuation()
        || matches!(
            c,
            '\u{2000}'..='\u{206F}'
                | '\u{3001}'..='\u{303F}'
                | '\u{FE30}'..='\u{FE6F}'
                | '\u{FF01}'..='\u{FF0F}'
                | '\u{FF1A}'..='\u{FF20}'
                | '\u{FF3B}'..='\u{FF40}'
                | '\u{FF5B}'..='\u{FF65}'
        )
}

/// CommonMark の flanking delimiter 規約により、日本語文中で前後にスペースがない
/// `**...**` / `~~...~~`（例: `これは**「重要」**です`, `**C++**の解説`, `配列の**サイズ(N)**を計算`）
/// が強調変換されない問題を解消する前処理。
/// コードブロック・インラインコード・数式・エスケープ文字には一切干渉しない。
fn preprocess_cjk_emphasis(markdown: &str) -> String {
    let mut out_lines = Vec::new();
    let mut fence = FenceTracker::default();
    let mut in_math_block = false;

    for line in markdown.split('\n') {
        let trimmed = line.trim_start();

        if !in_math_block && fence.process_line(line) {
            out_lines.push(line.to_string());
            continue;
        }

        if trimmed.trim_end() == "$$" {
            in_math_block = !in_math_block;
            out_lines.push(line.to_string());
            continue;
        }

        if in_math_block {
            out_lines.push(line.to_string());
            continue;
        }

        let step1 = fix_cjk_delim_in_line(line, '*', "strong");
        let step2 = fix_cjk_delim_in_line(&step1, '~', "del");
        out_lines.push(step2);
    }

    out_lines.join("\n")
}

fn fix_cjk_delim_in_line(line: &str, delim: char, html_tag: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let len = chars.len();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;

    while i < len {
        // バックスラッシュエスケープをそのまま通す
        if chars[i] == '\\' && i + 1 < len {
            out.push(chars[i]);
            out.push(chars[i + 1]);
            i += 2;
            continue;
        }

        // インラインコード (`...`, ``...``) をそのまま通す
        if chars[i] == '`' {
            let tick_count = chars[i..].iter().take_while(|&&c| c == '`').count();
            let mut j = i + tick_count;
            let mut closed = false;
            while j < len {
                if chars[j] == '`' {
                    let close_count = chars[j..].iter().take_while(|&&c| c == '`').count();
                    if close_count == tick_count {
                        for &c in &chars[i..j + close_count] {
                            out.push(c);
                        }
                        i = j + close_count;
                        closed = true;
                        break;
                    }
                    j += close_count;
                } else {
                    j += 1;
                }
            }
            if !closed {
                for &c in &chars[i..i + tick_count] {
                    out.push(c);
                }
                i += tick_count;
            }
            continue;
        }

        // インライン数式 ($...$) をそのまま通す
        if chars[i] == '$' {
            let dollar_count = chars[i..].iter().take_while(|&&c| c == '$').count();
            let mut j = i + dollar_count;
            let mut closed = false;
            while j < len {
                if chars[j] == '\\' && j + 1 < len {
                    j += 2;
                    continue;
                }
                if chars[j] == '$' {
                    let close_count = chars[j..].iter().take_while(|&&c| c == '$').count();
                    if close_count == dollar_count {
                        for &c in &chars[i..j + close_count] {
                            out.push(c);
                        }
                        i = j + close_count;
                        closed = true;
                        break;
                    }
                    j += close_count;
                } else {
                    j += 1;
                }
            }
            if !closed {
                for &c in &chars[i..i + dollar_count] {
                    out.push(c);
                }
                i += dollar_count;
            }
            continue;
        }

        // ちょうど2連続のデリミタ (`**` または `~~`) を検出
        if i + 1 < len
            && chars[i] == delim
            && chars[i + 1] == delim
            && (i == 0 || chars[i - 1] != delim)
            && (i + 2 >= len || chars[i + 2] != delim)
        {
            // 開き直後が空白なら強調ではない
            if i + 2 < len && !chars[i + 2].is_whitespace() {
                if let Some(close_idx) = find_matching_double_delim(&chars, i + 2, delim) {
                    let before_open = if i > 0 { Some(chars[i - 1]) } else { None };
                    let after_open = chars[i + 2];
                    let before_close = chars[close_idx - 1];
                    let after_close = if close_idx + 2 < len {
                        Some(chars[close_idx + 2])
                    } else {
                        None
                    };

                    let blocked_open = is_cjk_or_ascii_punct(after_open)
                        && before_open
                            .map(|c| !c.is_whitespace() && !is_cjk_or_ascii_punct(c))
                            .unwrap_or(false);
                    let blocked_close = is_cjk_or_ascii_punct(before_close)
                        && after_close
                            .map(|c| !c.is_whitespace() && !is_cjk_or_ascii_punct(c))
                            .unwrap_or(false);

                    if blocked_open || blocked_close {
                        let inner: String = chars[i + 2..close_idx].iter().collect();
                        out.push('<');
                        out.push_str(html_tag);
                        out.push('>');
                        out.push_str(&inner);
                        out.push_str("</");
                        out.push_str(html_tag);
                        out.push('>');
                        i = close_idx + 2;
                        continue;
                    }
                }
            }
        }

        out.push(chars[i]);
        i += 1;
    }

    out
}

fn find_matching_double_delim(chars: &[char], start: usize, delim: char) -> Option<usize> {
    let len = chars.len();
    let mut j = start;
    while j + 1 < len {
        if chars[j] == '\\' && j + 1 < len {
            j += 2;
            continue;
        }
        // インラインコード内のデリミタは無視
        if chars[j] == '`' {
            let tick_count = chars[j..].iter().take_while(|&&c| c == '`').count();
            let mut k = j + tick_count;
            let mut closed = false;
            while k < len {
                if chars[k] == '`' {
                    let cc = chars[k..].iter().take_while(|&&c| c == '`').count();
                    if cc == tick_count {
                        j = k + cc;
                        closed = true;
                        break;
                    }
                    k += cc;
                } else {
                    k += 1;
                }
            }
            if !closed {
                j += tick_count;
            }
            continue;
        }
        // インライン数式内のデリミタは無視
        if chars[j] == '$' {
            let dc = chars[j..].iter().take_while(|&&c| c == '$').count();
            let mut k = j + dc;
            let mut closed = false;
            while k < len {
                if chars[k] == '\\' && k + 1 < len {
                    k += 2;
                    continue;
                }
                if chars[k] == '$' {
                    let cc = chars[k..].iter().take_while(|&&c| c == '$').count();
                    if cc == dc {
                        j = k + cc;
                        closed = true;
                        break;
                    }
                    k += cc;
                } else {
                    k += 1;
                }
            }
            if !closed {
                j += dc;
            }
            continue;
        }

        if chars[j] == delim
            && chars[j + 1] == delim
            && (j == 0 || chars[j - 1] != delim)
            && (j + 2 >= len || chars[j + 2] != delim)
            && !chars[j - 1].is_whitespace()
        {
            return Some(j);
        }
        j += 1;
    }
    None
}

/// `markdown` / `md` コードブロック内で、ネスト表現のためにバックスラッシュで
/// エスケープされたフェンス記号（例: `\`\`\`rust`, `\`\`\``, `\```rust`, `\~~~`）を
/// 通常のフェンス記号（```` ```rust ````, ```` ``` ````, `~~~`）に復元する
fn unescape_nested_markdown_fences(code: &str) -> String {
    let mut out = String::with_capacity(code.len());
    for chunk in code.split_inclusive('\n') {
        let (line_body, newline) = if let Some(stripped) = chunk.strip_suffix('\n') {
            (stripped, "\n")
        } else {
            (chunk, "")
        };
        let indent_len = line_body.len() - line_body.trim_start().len();
        let indent = &line_body[..indent_len];
        let rest = &line_body[indent_len..];

        if let Some(after) = rest.strip_prefix(r"\`\`\`") {
            out.push_str(indent);
            out.push_str("```");
            out.push_str(after);
        } else if let Some(after) = rest.strip_prefix(r"\```") {
            out.push_str(indent);
            out.push_str("```");
            out.push_str(after);
        } else if let Some(after) = rest.strip_prefix(r"\~\~\~") {
            out.push_str(indent);
            out.push_str("~~~");
            out.push_str(after);
        } else if let Some(after) = rest.strip_prefix(r"\~~~") {
            out.push_str(indent);
            out.push_str("~~~");
            out.push_str(after);
        } else {
            out.push_str(line_body);
        }
        out.push_str(newline);
    }
    out
}

/// `pulldown-cmark` + `syntect` で Markdown チャンクを HTML に変換する
fn render_markdown_chunk(
    markdown: &str,
    ss: &SyntaxSet,
    theme: &syntect::highlighting::Theme,
    base_dir: Option<&Path>,
) -> String {
    let preprocessed = preprocess_cjk_emphasis(markdown);

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_MATH);

    let parser = Parser::new_ext(&preprocessed, options);
    let mut events = Vec::new();

    let mut in_code_block = false;
    let mut code_lang = String::new();
    let mut code_buffer = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                // Markdown 画像記法 `![alt](path.jpg)` のローカル画像を Base64 Data URI に変換
                let new_url = resolve_image_to_data_uri(&dest_url, base_dir)
                    .map( Into::into)
                    .unwrap_or(dest_url);
                events.push(Event::Start(Tag::Image {
                    link_type,
                    dest_url: new_url,
                    title,
                    id,
                }));
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                in_code_block = true;
                code_buffer.clear();
                code_lang = match kind {
                    CodeBlockKind::Fenced(lang) => {
                        lang.split_whitespace().next().unwrap_or("").to_string()
                    }
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
                    let effective_code = if code_lang.eq_ignore_ascii_case("markdown")
                        || code_lang.eq_ignore_ascii_case("md")
                    {
                        unescape_nested_markdown_fences(&code_buffer)
                    } else {
                        code_buffer.clone()
                    };
                    let syntax = ss
                        .find_syntax_by_token(&code_lang)
                        .unwrap_or_else(|| ss.find_syntax_plain_text());
                    let highlighted =
                        highlighted_html_for_string(&effective_code, ss, syntax, theme)
                            .unwrap_or_else(|_| {
                                format!("<pre><code>{}</code></pre>", escape_html(&effective_code))
                            });
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
            Event::TaskListMarker(checked) => {
                // HTML上でドキュメントを読みながら直接チェックを入れられるよう disabled を付けない
                let html = if checked {
                    r#"<input type="checkbox" class="task-list-checkbox" checked /> "#
                } else {
                    r#"<input type="checkbox" class="task-list-checkbox" /> "#
                };
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

/// エクスポートおよびPDF印刷用の100%自己完結型スタンドアロンHTML（外部CSS・外部スクリプト一切なし）を生成する
pub fn build_standalone_html(
    markdown: &str,
    rendered_body_html: Option<&str>,
    mode: &str,
    theme_id: Option<&str>,
    theme_css: Option<&str>,
) -> String {
    build_standalone_html_with_base_dir(markdown, rendered_body_html, mode, theme_id, theme_css, None)
}

pub fn build_standalone_html_with_base_dir(
    markdown: &str,
    rendered_body_html: Option<&str>,
    mode: &str,
    theme_id: Option<&str>,
    theme_css: Option<&str>,
    base_dir: Option<&Path>,
) -> String {
    let compiled = compile_lecture_markdown_with_options(markdown, mode, theme_id, base_dir);
    let raw_body = rendered_body_html
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&compiled.html);

    // 渡された HTML 内に残っているローカル画像パスもすべて Base64 Data URI に変換
    let body_content = embed_local_images_in_html(raw_body, base_dir);

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
  <style id="katex-standalone-css">
{katex_inlined_css}
  </style>
  <style id="lectern-base-css">
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
      padding-bottom: 16px;
      margin-bottom: 24px;
    }}
    .lecture-doc-course {{
      margin-bottom: 8px;
    }}
    .course-badge {{
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 3px 10px;
      border-radius: 999px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
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
    .lecture-doc-description {{
      margin-top: 14px;
      padding: 10px 14px;
      background: #f8fafc;
      border-left: 3px solid #64748b;
      border-radius: 0 6px 6px 0;
    }}
    .description-label {{
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
      margin-bottom: 2px;
    }}
    .description-text {{
      margin: 0 !important;
      font-size: 13.5px !important;
      line-height: 1.6 !important;
      color: #334155 !important;
    }}
    h1 {{ font-size: 1.8rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.25em; margin-top: 0.5em; }}
    h2 {{ font-size: 1.4rem; color: #2563eb; margin-top: 0.9em; }}
    h3 {{ font-size: 1.15rem; margin-top: 0.8em; }}
    img {{ max-width: 100% !important; height: auto !important; border-radius: 4px; box-sizing: border-box; }}
    figure {{ max-width: 100%; margin: 1.2rem 0; }}
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
    .lecture-columns > * {{
      min-width: 0;
    }}
    table {{ width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 0.94rem; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }}
    th {{ background: #f1f5f9; font-weight: 700; }}
    .math-display {{ margin: 14px 0; text-align: center; overflow-x: auto; }}
    /* Task List Interactive Checkboxes (Theme-aware custom styling) */
    .lecture-render-root ul:has(> li > input.task-list-checkbox) {{
      padding-left: 0.4rem !important;
    }}
    .lecture-render-root li:has(> input.task-list-checkbox) {{
      list-style: none !important;
      padding-left: 0 !important;
      margin-bottom: 0.55rem;
    }}
    .lecture-render-root input.task-list-checkbox {{
      --cb-size: 1.3em;
      --cb-icon-size: 0.8em;
      --cb-radius: 0.28em;
      --cb-border: #64748b;
      --cb-bg: #ffffff;
      --cb-checked-bg: #2563eb;
      --cb-check-color: #ffffff;
      --cb-icon-check: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'></polyline></svg>");
      appearance: none;
      -webkit-appearance: none;
      display: inline-grid;
      place-content: center;
      inline-size: var(--cb-size);
      block-size: var(--cb-size);
      margin: 0 0.55em 0 0;
      vertical-align: -0.22em;
      border: 2px solid var(--cb-border);
      border-radius: var(--cb-radius);
      background-color: var(--cb-bg);
      cursor: pointer;
      flex-shrink: 0;
      transition: background-color 140ms ease, border-color 140ms ease;
    }}
    .lecture-render-root input.task-list-checkbox::before {{
      content: "";
      inline-size: var(--cb-icon-size);
      block-size: var(--cb-icon-size);
      background-color: var(--cb-check-color);
      -webkit-mask: var(--cb-icon-check) no-repeat center / contain;
      mask: var(--cb-icon-check) no-repeat center / contain;
      transform: scale(0);
    }}
    @media (prefers-reduced-motion: no-preference) {{
      .lecture-render-root input.task-list-checkbox::before {{
        transition: transform 140ms ease;
      }}
    }}
    @media (forced-colors: active) {{
      .lecture-render-root input.task-list-checkbox::before {{
        background-color: CanvasText;
      }}
    }}
    .lecture-render-root input.task-list-checkbox:checked {{
      background-color: var(--cb-checked-bg);
      border-color: var(--cb-checked-bg);
    }}
    .lecture-render-root input.task-list-checkbox:checked::before {{
      transform: scale(1);
    }}
    .lecture-render-root input.task-list-checkbox:focus-visible {{
      outline: 2.5px solid var(--cb-checked-bg);
      outline-offset: 2px;
    }}
    .lecture-render-root li:has(> input.task-list-checkbox:checked) {{
      opacity: 0.72;
    }}
    .mermaid-container {{
      margin: 16px 0;
      display: block;
      text-align: center;
      padding: 16px;
      background: #ffffff;
      color: #1e293b;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      break-inside: avoid;
      font-size: 15px;
      line-height: 1.3;
      letter-spacing: normal;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    }}
    .mermaid-container svg {{
      display: inline-block;
      max-width: 100%;
      height: auto;
    }}
    .mermaid-container p,
    .mermaid-container span,
    .mermaid-container div {{
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1.25 !important;
      letter-spacing: normal !important;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif !important;
      color: #1e293b !important;
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
    // スライドモード時に単体HTMLファイル上でキーボード矢印キー (← / →) でスライド送りできるオフラインスクリプト
    (function () {{
      if (!document.body.classList.contains("mode-slide")) return;
      const slides = Array.from(document.querySelectorAll(".lecture-slide"));
      if (slides.length <= 1) return;
      let current = 0;
      window.addEventListener("keydown", function (e) {{
        if (e.key === "ArrowRight" || e.key === "PageDown") {{
          e.preventDefault();
          current = Math.min(slides.length - 1, current + 1);
          slides[current].scrollIntoView({{ behavior: "smooth", block: "center" }});
        }} else if (e.key === "ArrowLeft" || e.key === "PageUp") {{
          e.preventDefault();
          current = Math.max(0, current - 1);
          slides[current].scrollIntoView({{ behavior: "smooth", block: "center" }});
        }}
      }});
    }})();
  </script>
</body>
</html>"#,
        title = escape_html(title),
        katex_inlined_css = INLINED_KATEX_CSS,
        page_css = page_css,
        custom_theme_style = custom_theme_style,
        mode = escape_html(mode),
        theme_id = escape_html(effective_theme_id),
        body_content = body_content
    )
}
