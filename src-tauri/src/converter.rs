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
    pub lang: String,
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
    let preprocessed = preprocess_pagebreaks(&preprocess_callouts(&body_md));

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
            let (clean_slide_md, speaker_note) = extract_speaker_notes(slide_md);
            let slide_inner = render_markdown_chunk(&clean_slide_md, &ss, theme, base_dir);
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

            let note_attr = if speaker_note.is_empty() {
                String::new()
            } else {
                format!(r#" data-speaker-note="{}""#, escape_html(&speaker_note))
            };

            final_html.push_str(&format!(
                r#"<section class="lecture-slide" data-slide-index="{}" aria-roledescription="スライド" aria-label="スライド {} / {}"{}>{}{}<footer class="slide-footer"><span>{}</span><span>{} / {}</span></footer></section>"#,
                idx,
                idx + 1,
                slide_count,
                note_attr,
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
                    "lang" | "language" => {
                        let clean: String = val
                            .chars()
                            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                            .collect();
                        if !clean.is_empty() {
                            meta.lang = clean;
                        }
                    }
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

/// インラインコード外の `<!-- note: ...` または `<!-- notes: ...` (大文字小文字不問) の開始位置を探す。
/// 見つかった場合 `(comment_start_byte, body_start_byte)` を返す。
fn find_note_comment_start(line: &str) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // インラインコード (`...`, ``...``) 内はスキップする
        if bytes[i] == b'`' {
            let mut tick_count = 0;
            while i + tick_count < len && bytes[i + tick_count] == b'`' {
                tick_count += 1;
            }
            let mut j = i + tick_count;
            let mut closed = false;
            while j < len {
                if bytes[j] == b'`' {
                    let mut close_count = 0;
                    while j + close_count < len && bytes[j + close_count] == b'`' {
                        close_count += 1;
                    }
                    if close_count == tick_count {
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
                i += tick_count;
            }
            continue;
        }

        if i + 4 <= len && &bytes[i..i + 4] == b"<!--" {
            let mut pos = i + 4;
            while pos < len && matches!(bytes[pos], b' ' | b'\t') {
                pos += 1;
            }
            // "notes" または "note" を大文字小文字不問でマッチ
            let after_kw = if pos + 5 <= len && bytes[pos..pos + 5].eq_ignore_ascii_case(b"notes") {
                Some(pos + 5)
            } else if pos + 4 <= len && bytes[pos..pos + 4].eq_ignore_ascii_case(b"note") {
                Some(pos + 4)
            } else {
                None
            };

            if let Some(mut colon_pos) = after_kw {
                while colon_pos < len && matches!(bytes[colon_pos], b' ' | b'\t') {
                    colon_pos += 1;
                }
                if colon_pos < len && bytes[colon_pos] == b':' {
                    return Some((i, colon_pos + 1));
                }
            }
            i += 4;
            continue;
        }

        i += 1;
    }

    None
}

/// スライド内のスピーカーノートコメント (`<!-- note: ... -->` / `<!-- notes: ... -->`) を
/// コードフェンス外からのみ抽出し、本文から取り除いた `(clean_markdown, speaker_notes)` を返す。
fn extract_speaker_notes(slide_md: &str) -> (String, String) {
    let mut cleaned_lines: Vec<String> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut fence = FenceTracker::default();
    let mut in_note = false;
    let mut current_note = String::new();

    for line in slide_md.lines() {
        if in_note {
            if let Some(end_idx) = line.find("-->") {
                current_note.push_str(&line[..end_idx]);
                let trimmed_note = current_note.trim();
                if !trimmed_note.is_empty() {
                    notes.push(trimmed_note.to_string());
                }
                current_note.clear();
                in_note = false;

                let after = line[end_idx + 3..].trim();
                if !after.is_empty() {
                    cleaned_lines.push(after.to_string());
                }
            } else {
                current_note.push_str(line);
                current_note.push('\n');
            }
            continue;
        }

        if fence.process_line(line) {
            cleaned_lines.push(line.to_string());
            continue;
        }

        let mut remaining = line;
        let mut kept = String::new();
        let mut matched_any = false;

        while let Some((comment_start, body_start)) = find_note_comment_start(remaining) {
            matched_any = true;
            kept.push_str(&remaining[..comment_start]);
            let body_slice = &remaining[body_start..];
            if let Some(end_rel) = body_slice.find("-->") {
                let note_text = body_slice[..end_rel].trim();
                if !note_text.is_empty() {
                    notes.push(note_text.to_string());
                }
                remaining = &body_slice[end_rel + 3..];
            } else {
                in_note = true;
                let first_part = body_slice.trim_start();
                if !first_part.is_empty() {
                    current_note.push_str(first_part);
                    current_note.push('\n');
                }
                remaining = "";
                break;
            }
        }

        if matched_any {
            kept.push_str(remaining);
            if !kept.trim().is_empty() {
                cleaned_lines.push(kept.trim_end().to_string());
            }
        } else {
            cleaned_lines.push(line.to_string());
        }
    }

    if in_note {
        let trimmed_note = current_note.trim();
        if !trimmed_note.is_empty() {
            notes.push(trimmed_note.to_string());
        }
    }

    let mut cleaned = cleaned_lines.join("\n");
    if slide_md.ends_with('\n') && !cleaned.is_empty() {
        cleaned.push('\n');
    }

    (cleaned, notes.join("\n\n"))
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
                Some(("note", "📘", "NOTE / 補足"))
            } else if tag_line.starts_with("[!TIP]") {
                Some(("tip", "💡", "TIP / ヒント"))
            } else if tag_line.starts_with("[!IMPORTANT]") {
                Some(("important", "🎓", "IMPORTANT / 重要・演習"))
            } else if tag_line.starts_with("[!WARNING]") {
                Some(("warning", "⚠️", "WARNING / 注意"))
            } else {
                None
            };

            if let Some((kind_cls, icon, label)) = callout_kind {
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
                    "\n<aside class=\"callout callout-{}\" aria-label=\"{}\"><div class=\"callout-title\"><span aria-hidden=\"true\">{}</span> {}</div>\n\n{}\n</aside>\n",
                    kind_cls, label, icon, label, inner_md
                ));
                continue;
            }
        }

        out.push_str(line);
        out.push('\n');
    }

    out
}

/// 独立した `<!-- pagebreak -->` または `<!-- page-break -->` (大文字小文字不問) 行かを判定する
fn is_pagebreak_comment(line: &str) -> bool {
    let trimmed = line.trim();
    if let Some(inner) = trimmed
        .strip_prefix("<!--")
        .and_then(|s| s.strip_suffix("-->"))
    {
        let kw = inner.trim();
        kw.eq_ignore_ascii_case("pagebreak") || kw.eq_ignore_ascii_case("page-break")
    } else {
        false
    }
}

/// コードフェンス外の独立した `<!-- pagebreak -->` / `<!-- page-break -->` 行を
/// 印刷時改ページ用 `<div class="lecture-page-break" aria-hidden="true"></div>` に変換する
fn preprocess_pagebreaks(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len());
    let mut fence = FenceTracker::default();

    for line in markdown.lines() {
        if fence.process_line(line) {
            out.push_str(line);
            out.push('\n');
            continue;
        }

        if is_pagebreak_comment(line) {
            out.push_str("\n<div class=\"lecture-page-break\" aria-hidden=\"true\"></div>\n\n");
            continue;
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

/// Mermaid コード内のアクセシビリティ用タイトル (`accTitle: ...` または `%% title: ...`) を抽出する
fn extract_mermaid_accessible_label(mermaid_src: &str) -> String {
    for line in mermaid_src.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("accTitle:") {
            let title = rest.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
        if let Some(rest) = trimmed.strip_prefix("%%") {
            let inner = rest.trim();
            if let Some(title) = inner
                .strip_prefix("title:")
                .or_else(|| inner.strip_prefix("Title:"))
                .or_else(|| inner.strip_prefix("alt:"))
                .or_else(|| inner.strip_prefix("Alt:"))
            {
                let clean = title.trim();
                if !clean.is_empty() {
                    return clean.to_string();
                }
            }
        }
    }
    "Mermaid図表".to_string()
}

/// `<thead>` 内の `<th>` に `scope="col"` を自動付与して、スクリーンリーダーの表読み上げを改善する
fn add_scope_to_table_headers(html: &str) -> String {
    if !html.contains("<thead>") {
        return html.to_string();
    }
    let mut out = String::with_capacity(html.len() + 64);
    let mut rest = html;
    while let Some(head_start) = rest.find("<thead>") {
        out.push_str(&rest[..head_start]);
        let after_start = &rest[head_start..];
        if let Some(head_end_rel) = after_start.find("</thead>") {
            let thead_block = &after_start[..head_end_rel + "</thead>".len()];
            let enhanced = thead_block
                .replace("<th ", r#"<th scope="col" "#)
                .replace("<th>", r#"<th scope="col">"#);
            out.push_str(&enhanced);
            rest = &after_start[head_end_rel + "</thead>".len()..];
        } else {
            out.push_str(after_start);
            rest = "";
            break;
        }
    }
    out.push_str(rest);
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
                    let aria_label = escape_html(&extract_mermaid_accessible_label(&code_buffer));
                    let html = format!(
                        r#"<figure class="mermaid-container" role="figure" aria-label="{}" data-mermaid="{}"><pre class="mermaid">{}</pre></figure>"#,
                        aria_label, encoded, encoded
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
                    let escaped_lang = escape_html(&lang_label);
                    let wrapped = format!(
                        r#"<figure class="code-block-wrapper" role="figure" aria-label="コードブロック ({})"><figcaption class="code-block-header">{}</figcaption>{}</figure>"#,
                        escaped_lang, escaped_lang, highlighted
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
                    r#"<input type="checkbox" class="task-list-checkbox" aria-label="タスクの完了状態" checked /> "#
                } else {
                    r#"<input type="checkbox" class="task-list-checkbox" aria-label="タスクの完了状態" /> "#
                };
                events.push(Event::Html(html.into()));
            }
            other => events.push(other),
        }
    }

    let mut html_output = String::new();
    pulldown_cmark::html::push_html(&mut html_output, events.into_iter());
    add_scope_to_table_headers(&html_output)
}

pub fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// エクスポートおよびPDF印刷用の100%自己完結型スタンドアロンHTML（外部CSS・外部スクリプト一切なし）を生成する
/// HTML 出力用の埋め込み favicon（`data:image/svg+xml;base64,...`）を生成する。
/// ドキュメント出力とスライド／スライドショー出力で異なるアイコンを返す。
fn build_embedded_favicon_data_uri(mode: &str) -> String {
    let svg = if mode == "slide" {
        // スライド／プレゼン用: 紫グラデーション背景＋16:9スクリーン＋再生アイコン
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#4338ca"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><rect x="10" y="14" width="44" height="30" rx="4" fill="#ffffff"/><polygon points="28,22 28,36 40,29" fill="#6d28d9"/><path d="M32 44v8M22 52h20" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/></svg>"##
    } else {
        // ドキュメント（講義資料）用: 青グラデーション背景＋折り目付き文書シート＋本文ライン
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2563eb"/><stop offset="100%" stop-color="#1d4ed8"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M18 12h20l10 10v30a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3z" fill="#ffffff"/><path d="M38 12v10h10z" fill="#bfdbfe"/><rect x="22" y="28" width="20" height="3.5" rx="1.75" fill="#2563eb"/><rect x="22" y="36" width="18" height="3.5" rx="1.75" fill="#60a5fa"/><rect x="22" y="44" width="13" height="3.5" rx="1.75" fill="#93c5fd"/></svg>"##
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
    format!("data:image/svg+xml;base64,{}", encoded)
}

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
          padding: 34px 48px 26px;
          box-shadow: 0 10px 28px rgba(0,0,0,0.08);
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          box-sizing: border-box;
          overflow-y: auto;
          line-height: 1.55;
          page-break-after: always;
          break-after: page;
        }
        .lecture-slide > :first-child {
          margin-top: 0;
        }
        .lecture-slide .lecture-doc-header {
          margin-bottom: 14px;
          padding-bottom: 12px;
        }
        .lecture-slide .lecture-doc-title {
          font-size: 26px;
          margin: 0 0 4px 0;
          line-height: 1.3;
        }
        .lecture-slide .lecture-doc-description {
          margin-top: 10px;
          padding: 8px 12px;
        }
        .lecture-slide h1 {
          font-size: 1.65rem;
          line-height: 1.3;
          margin: 0 0 0.55rem;
          padding-bottom: 0.2em;
        }
        .lecture-slide h2 {
          font-size: 1.32rem;
          line-height: 1.35;
          margin: 0.45rem 0 0.45rem;
        }
        .lecture-slide h3 {
          font-size: 1.1rem;
          line-height: 1.35;
          margin: 0.4rem 0 0.35rem;
        }
        .lecture-slide p {
          margin: 0.45rem 0;
          line-height: 1.6;
        }
        .lecture-slide ul,
        .lecture-slide ol {
          margin: 0.45rem 0 0.55rem;
          line-height: 1.55;
        }
        .lecture-slide li {
          margin-bottom: 0.26rem;
        }
        .lecture-slide .code-block-wrapper {
          margin: 10px 0;
          flex-shrink: 0;
        }
        .lecture-slide .code-block-wrapper pre {
          padding: 10px 14px !important;
          font-size: 12px;
          line-height: 1.45;
          max-height: 310px;
          overflow: auto;
        }
        .lecture-slide .mermaid-container {
          margin: 10px 0;
          padding: 10px 14px;
          max-height: 330px;
          overflow: auto;
        }
        .lecture-slide .mermaid-container svg {
          max-height: 300px !important;
          width: auto !important;
          max-width: 100% !important;
        }
        .lecture-slide table {
          margin: 10px 0;
          font-size: 0.86rem;
          line-height: 1.45;
        }
        .lecture-slide th,
        .lecture-slide td {
          padding: 6px 10px;
        }
        .lecture-slide img {
          max-height: 340px !important;
          width: auto !important;
          max-width: 100% !important;
          object-fit: contain;
          display: block;
          margin: 0.45rem auto;
        }
        .lecture-slide .callout {
          margin: 10px 0;
          padding: 10px 14px;
          font-size: 0.92rem;
        }
        .lecture-slide blockquote {
          margin: 10px 0;
          padding: 8px 14px;
        }
        .lecture-slide .math-display {
          margin: 10px 0;
        }
        .lecture-slide .lecture-columns {
          gap: 20px;
          margin: 10px 0;
        }
        .lecture-slide .slide-footer {
          margin-top: auto;
          padding-top: 8px;
          flex-shrink: 0;
          font-size: 11.5px;
        }
        @media print {
          body.mode-slide {
            background: #ffffff;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
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
            overflow: hidden !important;
            page-break-after: always;
            break-after: page;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .lecture-slide:last-child {
            page-break-after: auto;
            break-after: auto;
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

    let doc_toc_css = if mode == "document" {
        r#"
        /* Document Auto-ToC (Collapsible Table of Contents) */
        .doc-toc-toggle {
          position: fixed;
          top: 18px;
          right: 20px;
          z-index: 9990;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.88);
          color: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.22);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: background-color 0.15s ease, transform 0.15s ease;
        }
        .doc-toc-toggle[hidden] {
          display: none !important;
        }
        .doc-toc-toggle:hover {
          background: rgba(30, 41, 59, 0.96);
          transform: translateY(-1px);
        }
        .doc-toc-toggle.is-open {
          background: #1d4ed8;
          border-color: #60a5fa;
        }
        .doc-toc-drawer {
          position: fixed;
          top: 62px;
          right: 20px;
          z-index: 9991;
          width: min(310px, calc(100vw - 40px));
          max-height: calc(100vh - 86px);
          display: flex;
          flex-direction: column;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.94);
          color: #f1f5f9;
          border: 1px solid rgba(148, 163, 184, 0.28);
          box-shadow: 0 18px 42px rgba(15, 23, 42, 0.36);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
          overflow: hidden;
        }
        .doc-toc-drawer[hidden] {
          display: none !important;
        }
        .doc-toc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: rgba(30, 41, 59, 0.8);
          border-bottom: 1px solid rgba(148, 163, 184, 0.2);
          font-size: 13px;
          font-weight: 700;
          color: #e2e8f0;
        }
        .doc-toc-close {
          border: none;
          background: transparent;
          color: #cbd5e1;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 7px;
          border-radius: 6px;
        }
        .doc-toc-close:hover {
          background: rgba(255, 255, 255, 0.14);
          color: #ffffff;
        }
        .doc-toc-list {
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .doc-toc-item {
          display: block;
          text-decoration: none;
          color: #e2e8f0;
          font-size: 13px;
          line-height: 1.45;
          padding: 6px 10px;
          border-radius: 7px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          transition: background-color 0.12s ease, color 0.12s ease;
        }
        .doc-toc-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }
        .doc-toc-item.doc-toc-h1 {
          font-weight: 700;
          color: #f8fafc;
        }
        .doc-toc-item.doc-toc-h2 {
          padding-left: 20px;
          color: #cbd5e1;
        }
        .doc-toc-item.doc-toc-h3 {
          padding-left: 32px;
          font-size: 12.2px;
          color: #94a3b8;
        }
        @media print {
          .doc-toc-toggle,
          .doc-toc-drawer {
            display: none !important;
          }
        }
        "#
    } else {
        ""
    };

    let doc_toc_markup_and_script = if mode == "document" {
        r##"
  <button type="button" id="doc-toc-toggle" class="doc-toc-toggle" hidden aria-expanded="false" aria-controls="doc-toc-drawer" title="目次を開閉 (M)">☰ 目次</button>
  <aside id="doc-toc-drawer" class="doc-toc-drawer" hidden aria-label="目次">
    <div class="doc-toc-header">
      <span>📑 目次</span>
      <button type="button" id="doc-toc-close" class="doc-toc-close" aria-label="目次を閉じる">✕</button>
    </div>
    <nav id="doc-toc-list" class="doc-toc-list" aria-label="目次リンク"></nav>
  </aside>
  <script>
    // ドキュメントモード用オフライン自動目次 (H1–H3, M キー / ボタン開閉, Esc で閉じる)
    (function () {
      const root = document.querySelector(".lecture-render-root");
      const toggleBtn = document.getElementById("doc-toc-toggle");
      const drawer = document.getElementById("doc-toc-drawer");
      const closeBtn = document.getElementById("doc-toc-close");
      const list = document.getElementById("doc-toc-list");
      if (!root || !toggleBtn || !drawer || !list) return;

      const headings = Array.from(root.querySelectorAll("h1, h2, h3")).filter(function (el) {
        return (el.textContent || "").trim().length > 0;
      });
      if (headings.length < 2) return;

      let isOpen = false;
      function setOpen(open) {
        isOpen = open;
        drawer.hidden = !open;
        toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
        toggleBtn.classList.toggle("is-open", open);
      }

      headings.forEach(function (heading, idx) {
        if (!heading.id) {
          heading.id = "doc-heading-" + (idx + 1);
        }
        const level = heading.tagName.toLowerCase();
        const link = document.createElement("a");
        link.className = "doc-toc-item doc-toc-" + level;
        link.href = "#" + heading.id;
        link.textContent = (heading.textContent || "").trim();
        link.addEventListener("click", function (e) {
          e.preventDefault();
          const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
          try {
            history.replaceState(null, "", "#" + heading.id);
          } catch (_) {}
          if (window.innerWidth < 1100) {
            setOpen(false);
          }
        });
        list.appendChild(link);
      });

      toggleBtn.hidden = false;
      toggleBtn.addEventListener("click", function () {
        setOpen(!isOpen);
      });
      if (closeBtn) {
        closeBtn.addEventListener("click", function () {
          setOpen(false);
        });
      }
      document.addEventListener("click", function (e) {
        if (isOpen && !drawer.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
          setOpen(false);
        }
      });
      window.addEventListener("keydown", function (e) {
        const target = e.target;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
        ) {
          return;
        }
        if (e.key === "Escape" && isOpen) {
          e.preventDefault();
          setOpen(false);
        } else if (
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          e.key.toLowerCase() === "m"
        ) {
          e.preventDefault();
          setOpen(!isOpen);
        }
      });
    })();
  </script>"##
    } else {
        ""
    };

    let favicon_data_uri = build_embedded_favicon_data_uri(mode);
    let parsed_lang = parse_frontmatter(markdown).0.lang;
    let doc_lang = if parsed_lang.is_empty() {
        "ja"
    } else {
        parsed_lang.as_str()
    };
    let slide_live_region = if mode == "slide" {
        r#"
  <div id="slide-live-region" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>"#
    } else {
        ""
    };

    format!(
        r##"<!doctype html>
<html lang="{doc_lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <link rel="icon" type="image/svg+xml" href="{favicon_data_uri}" />
  <style id="katex-standalone-css">
{katex_inlined_css}
  </style>
  <style id="lectern-base-css">
    * {{ box-sizing: border-box; }}
    .visually-hidden:where(:not(:focus-within, :active)) {{
      position: absolute !important;
      clip-path: inset(50%) !important;
      overflow: hidden !important;
      width: 1px !important;
      height: 1px !important;
      margin: -1px !important;
      padding: 0 !important;
      border: 0 !important;
      white-space: nowrap !important;
    }}
    .skip-link:focus-visible {{
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 9999;
      padding: 8px 14px;
      border-radius: 8px;
      background: #0f172a;
      color: #ffffff;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }}
    :where(a:any-link, button, summary, [tabindex="-1"]):focus-visible {{
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }}
    @media (prefers-reduced-motion: reduce) {{
      html {{ scroll-behavior: auto !important; }}
      *, *::before, *::after {{
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }}
    }}
    @media print {{
      .skip-link {{ display: none !important; }}
    }}
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
    .lecture-page-break {{
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 24px 0;
      height: 1px;
      border: 0;
      border-top: 1.5px dashed #cbd5e1;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      user-select: none;
    }}
    .lecture-page-break::after {{
      content: "ページ区切り";
      background: #ffffff;
      padding: 0 10px;
      border-radius: 999px;
    }}
    @media print {{
      .lecture-page-break {{
        page-break-after: always;
        break-after: page;
        height: 0;
        margin: 0;
        padding: 0;
        border: 0;
        overflow: hidden;
      }}
      .lecture-page-break::after {{
        display: none;
        content: none;
      }}
    }}
    {page_css}
    {doc_toc_css}
  </style>
  <style id="lectern-theme-css">
{custom_theme_style}
  </style>
</head>
<body class="mode-{mode} theme-{theme_id}" data-lecture-theme="{theme_id}">
  <a href="#main-content" class="skip-link visually-hidden">本文へスキップ</a>
  <main id="main-content" tabindex="-1">
    <article class="lecture-render-root" data-lecture-theme="{theme_id}">
      {body_content}
    </article>
  </main>{slide_live_region}{doc_toc_markup_and_script}
  <script>
    // スライドモード時に単体HTMLファイル上でキーボード矢印キー (← / →) でスライド送りできるオフラインスクリプト
    (function () {{
      if (!document.body.classList.contains("mode-slide")) return;
      const slides = Array.from(document.querySelectorAll(".lecture-slide"));
      const liveRegion = document.getElementById("slide-live-region");
      if (slides.length <= 1) return;
      let current = 0;
      function announceSlide(idx) {{
        if (!liveRegion || !slides[idx]) return;
        const h = slides[idx].querySelector("h1, h2, h3");
        const headingText = h ? (h.textContent || "").trim() : "";
        liveRegion.textContent = "スライド " + (idx + 1) + " / " + slides.length + (headingText ? ": " + headingText : "");
      }}
      window.addEventListener("keydown", function (e) {{
        const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const behavior = reduceMotion ? "auto" : "smooth";
        if (e.key === "ArrowRight" || e.key === "PageDown") {{
          e.preventDefault();
          current = Math.min(slides.length - 1, current + 1);
          slides[current].scrollIntoView({{ behavior: behavior, block: "center" }});
          announceSlide(current);
        }} else if (e.key === "ArrowLeft" || e.key === "PageUp") {{
          e.preventDefault();
          current = Math.max(0, current - 1);
          slides[current].scrollIntoView({{ behavior: behavior, block: "center" }});
          announceSlide(current);
        }}
      }});
    }})();
  </script>
</body>
</html>"##,
        doc_lang = escape_html(doc_lang),
        title = escape_html(title),
        katex_inlined_css = INLINED_KATEX_CSS,
        page_css = page_css,
        doc_toc_css = doc_toc_css,
        custom_theme_style = custom_theme_style,
        mode = escape_html(mode),
        theme_id = escape_html(effective_theme_id),
        body_content = body_content,
        doc_toc_markup_and_script = doc_toc_markup_and_script
    )
}

/// Web ブラウザ上で全画面・16:9 スケール対応のスライドショーとしてプレゼン再生できる
/// 100% 自己完結型スタンドアロン HTML を生成する
pub fn build_slideshow_html_with_base_dir(
    markdown: &str,
    rendered_body_html: Option<&str>,
    theme_id: Option<&str>,
    theme_css: Option<&str>,
    base_dir: Option<&Path>,
) -> String {
    let base_html = build_standalone_html_with_base_dir(
        markdown,
        rendered_body_html,
        "slide",
        theme_id,
        theme_css,
        base_dir,
    );

    let slideshow_css = r#"
  <style id="lectern-slideshow-css">
    html, body.mode-slideshow {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #0b0f19 !important;
    }
    body.mode-slideshow .lecture-render-root {
      position: fixed;
      inset: 0;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      margin: 0 !important;
      gap: 0 !important;
      background: transparent !important;
      max-width: none !important;
      border: none !important;
      box-shadow: none !important;
    }
    body.mode-slideshow .lecture-slide {
      display: none !important;
      width: 1120px !important;
      height: 630px !important;
      margin: 0 !important;
      flex-shrink: 0;
      overflow-y: auto;
      transform-origin: center center;
      transform: scale(var(--slide-scale, 1));
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55) !important;
      border-radius: 10px !important;
    }
    body.mode-slideshow .lecture-slide.is-active {
      display: flex !important;
    }

    @keyframes lecternSlideEnter {
      from {
        opacity: 0;
        transform: scale(var(--slide-scale, 1)) translateY(6px);
      }
      to {
        opacity: 1;
        transform: scale(var(--slide-scale, 1)) translateY(0);
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      body.mode-slideshow .lecture-slide.is-active {
        animation: lecternSlideEnter 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      body.mode-slideshow .lecture-slide.is-active,
      .slideshow-hud,
      .slideshow-progress-fill,
      .slideshow-notes-drawer,
      .slideshow-edge-nav,
      .slideshow-edge-nav span,
      .slide-thumb-wrap {
        animation: none !important;
        transition: none !important;
      }
    }

    /* Clean Edge Hover Navigation Zones (never interfere with slide text selection, links, or checkboxes) */
    .slideshow-edge-nav {
      position: fixed;
      top: 56px;
      bottom: 74px;
      width: 52px;
      z-index: 9990;
      border: none;
      background: transparent;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #f8fafc;
      opacity: 0;
      transition: opacity 0.18s ease;
    }
    .slideshow-edge-nav.edge-prev { left: 0; }
    .slideshow-edge-nav.edge-next { right: 0; }
    .slideshow-edge-nav span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 54px;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.16);
      font-size: 22px;
      line-height: 1;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
      transition: background-color 0.15s ease, transform 0.15s ease;
    }
    .slideshow-edge-nav:hover,
    .slideshow-edge-nav:focus-visible {
      opacity: 1;
      outline: none;
    }
    .slideshow-edge-nav:hover span {
      background: rgba(30, 41, 59, 0.92);
      transform: scale(1.04);
    }
    .slideshow-edge-nav:focus-visible span {
      outline: 2px solid #38bdf8;
      outline-offset: 2px;
    }
    .slideshow-edge-nav:disabled,
    body.mode-slideshow.is-overview .slideshow-edge-nav {
      display: none !important;
    }

    /* Overview Grid Mode (O / G key) with Slide Title Preview */
    body.mode-slideshow.is-overview {
      overflow-y: auto;
    }
    body.mode-slideshow.is-overview .lecture-render-root {
      position: static;
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(344px, 1fr));
      gap: 24px;
      padding: 32px 32px 104px !important;
      align-items: start !important;
      justify-items: center !important;
    }
    body.mode-slideshow.is-overview .slide-thumb-wrap {
      position: relative;
      width: 336px;
      display: flex;
      flex-direction: column;
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      background: #111827;
      outline: 2px solid rgba(255, 255, 255, 0.14);
      outline-offset: 2px;
      transition: outline-color 0.15s ease, transform 0.15s ease;
    }
    body.mode-slideshow.is-overview .slide-thumb-wrap:hover {
      outline-color: #60a5fa;
      transform: translateY(-2px);
    }
    body.mode-slideshow.is-overview .slide-thumb-wrap.is-current {
      outline: 3px solid #38bdf8;
    }
    body.mode-slideshow.is-overview .slide-thumb-stage {
      position: relative;
      width: 336px;
      height: 189px;
      overflow: hidden;
      background: #0f172a;
    }
    body.mode-slideshow.is-overview .slide-thumb-stage .lecture-slide {
      display: flex !important;
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: top left;
      transform: scale(0.3) !important;
      pointer-events: none;
      border-radius: 0 !important;
      box-shadow: none !important;
      animation: none !important;
    }
    body.mode-slideshow.is-overview .slide-thumb-caption {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      background: rgba(15, 23, 42, 0.94);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
      font-size: 12px;
    }
    body.mode-slideshow.is-overview .slide-thumb-badge {
      flex-shrink: 0;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      background: rgba(56, 189, 248, 0.2);
      color: #7dd3fc;
    }
    body.mode-slideshow.is-overview .slide-thumb-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
      color: #f1f5f9;
    }
    body.mode-slideshow.is-overview .slide-thumb-note-dot {
      flex-shrink: 0;
      font-size: 11px;
      opacity: 0.88;
    }

    /* Presenter Floating HUD */
    .slideshow-hud {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      z-index: 9999;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.82);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
      font-size: 12.5px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
      transition: opacity 0.25s ease;
    }
    body.mode-slideshow.hud-hidden .slideshow-hud {
      opacity: 0;
      pointer-events: none;
    }
    .slideshow-hud:hover,
    .slideshow-hud:focus-within {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .slideshow-hud button {
      position: relative;
      border: none;
      background: transparent;
      color: #f8fafc;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 999px;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 0.15s ease;
    }
    .slideshow-hud button:hover {
      background: rgba(255, 255, 255, 0.16);
    }
    .slideshow-hud button.is-active-btn {
      background: rgba(56, 189, 248, 0.25);
      color: #7dd3fc;
    }
    .slideshow-hud button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .slideshow-hud .hud-counter {
      min-width: 62px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      color: #e2e8f0;
    }
    .slideshow-hud .hud-sep {
      width: 1px;
      height: 16px;
      background: rgba(255, 255, 255, 0.2);
      margin: 0 2px;
    }
    .hud-note-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #38bdf8;
      margin-left: 5px;
      vertical-align: middle;
    }

    /* Speaker Notes Drawer (N key) */
    .slideshow-notes-drawer {
      position: fixed;
      left: 50%;
      bottom: 68px;
      transform: translateX(-50%);
      z-index: 9996;
      width: min(760px, calc(100vw - 32px));
      max-height: 30vh;
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(148, 163, 184, 0.28);
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.48);
      overflow: hidden;
    }
    .slideshow-notes-drawer[hidden] {
      display: none !important;
    }
    .slideshow-notes-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 14px;
      background: rgba(30, 41, 59, 0.75);
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      font-size: 12px;
      font-weight: 700;
      color: #7dd3fc;
    }
    .slideshow-notes-slide-label {
      color: #94a3b8;
      font-weight: 500;
      margin-left: 8px;
    }
    .slideshow-notes-close,
    .slideshow-modal-close {
      border: none;
      background: transparent;
      color: #cbd5e1;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 7px;
      border-radius: 6px;
    }
    .slideshow-notes-close:hover,
    .slideshow-modal-close:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #ffffff;
    }
    .slideshow-notes-body {
      padding: 12px 16px;
      overflow-y: auto;
      font-size: 13.5px;
      line-height: 1.65;
      white-space: pre-wrap;
      color: #f1f5f9;
    }
    .slideshow-notes-body.is-empty {
      color: #94a3b8;
      font-style: italic;
    }

    /* Slide Jump / TOC Popover (T key or click counter) */
    .slideshow-toc-menu {
      position: fixed;
      left: 50%;
      bottom: 68px;
      transform: translateX(-50%);
      z-index: 9997;
      width: min(440px, calc(100vw - 32px));
      max-height: 56vh;
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(148, 163, 184, 0.28);
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.52);
      overflow: hidden;
    }
    .slideshow-toc-menu[hidden] {
      display: none !important;
    }
    .slideshow-toc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 14px;
      background: rgba(30, 41, 59, 0.78);
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      font-size: 12.5px;
      font-weight: 700;
      color: #e2e8f0;
    }
    .slideshow-toc-list {
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .ss-toc-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      border: none;
      background: transparent;
      color: #e2e8f0;
      text-align: left;
      font-family: inherit;
      font-size: 13px;
      padding: 7px 10px;
      border-radius: 7px;
      cursor: pointer;
    }
    .ss-toc-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .ss-toc-item.is-current {
      background: rgba(56, 189, 248, 0.22);
      color: #ffffff;
      font-weight: 600;
    }
    .ss-toc-num {
      flex-shrink: 0;
      min-width: 24px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      color: #7dd3fc;
    }
    .ss-toc-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ss-toc-note {
      flex-shrink: 0;
      font-size: 11px;
      opacity: 0.85;
    }

    /* Keyboard Shortcut Help Overlay (? key) */
    .slideshow-help-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(2, 6, 23, 0.72);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .slideshow-help-overlay[hidden] {
      display: none !important;
    }
    .slideshow-help-card {
      width: min(500px, 100%);
      border-radius: 14px;
      background: #0f172a;
      border: 1px solid rgba(148, 163, 184, 0.28);
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }
    .slideshow-help-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: rgba(30, 41, 59, 0.8);
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      font-size: 14px;
      font-weight: 700;
    }
    .slideshow-help-list {
      margin: 0;
      padding: 12px 16px 16px;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 9px;
      font-size: 13px;
    }
    .slideshow-help-list li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      line-height: 1.4;
    }
    .slideshow-help-keys {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      flex-shrink: 0;
    }
    .slideshow-help-keys kbd {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 5px;
      font-size: 11.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #1e293b;
      color: #7dd3fc;
      border: 1px solid rgba(148, 163, 184, 0.35);
      box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.35);
    }

    /* Bottom Progress Bar */
    .slideshow-progress {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: rgba(255, 255, 255, 0.1);
      z-index: 9998;
    }
    .slideshow-progress-fill {
      height: 100%;
      width: 0%;
      background: #38bdf8;
      transition: width 0.2s ease;
    }

    /* 2-Window Synchronized Presenter Dashboard (?presenter=1) */
    body.mode-slideshow.is-presenter-mode {
      overflow: hidden;
      background: #090d16 !important;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    }
    body.mode-slideshow.is-presenter-mode > .lecture-render-root,
    body.mode-slideshow.is-presenter-mode .slideshow-hud,
    body.mode-slideshow.is-presenter-mode .slideshow-edge-nav,
    body.mode-slideshow.is-presenter-mode .slideshow-notes-drawer,
    body.mode-slideshow.is-presenter-mode .slideshow-toc-menu,
    body.mode-slideshow.is-presenter-mode .slideshow-progress {
      display: none !important;
    }
    .presenter-dashboard {
      position: fixed;
      inset: 0;
      z-index: 9995;
      display: flex;
      flex-direction: column;
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    }
    .presenter-dashboard[hidden] {
      display: none !important;
    }
    .presenter-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 18px;
      background: #0f172a;
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .presenter-topbar-left,
    .presenter-topbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .presenter-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.18);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #7dd3fc;
      font-size: 12px;
      font-weight: 700;
    }
    .presenter-counter {
      font-variant-numeric: tabular-nums;
      font-size: 14px;
      font-weight: 700;
      color: #e2e8f0;
      min-width: 64px;
      text-align: center;
    }
    .presenter-btn {
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: #1e293b;
      color: #f8fafc;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.14s ease, border-color 0.14s ease;
    }
    .presenter-btn:hover:not(:disabled) {
      background: #334155;
      border-color: #60a5fa;
    }
    .presenter-btn:disabled {
      opacity: 0.38;
      cursor: default;
    }
    .presenter-btn.is-running {
      background: rgba(16, 185, 129, 0.2);
      border-color: rgba(52, 211, 153, 0.55);
      color: #6ee7b7;
    }
    .presenter-timer-group {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 10px;
      background: #111827;
      border: 1px solid rgba(148, 163, 184, 0.22);
    }
    .presenter-timer-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 18px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: #38bdf8;
      letter-spacing: 0.03em;
    }
    .presenter-clock {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #cbd5e1;
      padding: 5px 10px;
      border-radius: 8px;
      background: #111827;
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .presenter-main {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1.38fr) minmax(0, 1fr);
      gap: 16px;
      padding: 16px;
      box-sizing: border-box;
    }
    .presenter-right-col {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-height: 0;
    }
    .presenter-panel {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-radius: 12px;
      background: #0f172a;
      border: 1px solid rgba(148, 163, 184, 0.22);
      overflow: hidden;
    }
    .presenter-panel-next {
      flex: 0 0 46%;
    }
    .presenter-panel-notes {
      flex: 1;
    }
    .presenter-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      background: rgba(30, 41, 59, 0.8);
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      font-size: 12px;
      font-weight: 700;
      color: #94a3b8;
      letter-spacing: 0.03em;
      flex-shrink: 0;
    }
    .presenter-panel-subtitle {
      color: #e2e8f0;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 70%;
    }
    .presenter-stage {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #020617;
      padding: 12px;
      overflow: hidden;
    }
    .presenter-stage-frame {
      position: relative;
      width: 1120px;
      height: 630px;
      overflow: hidden;
      border-radius: 8px;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.5);
      transform-origin: center center;
      flex-shrink: 0;
    }
    .presenter-stage-root {
      position: static !important;
      width: 1120px !important;
      height: 630px !important;
      padding: 0 !important;
      margin: 0 !important;
      display: block !important;
      background: transparent !important;
    }
    .presenter-stage-root .lecture-slide {
      display: flex !important;
      transform: none !important;
      animation: none !important;
      width: 1120px !important;
      height: 630px !important;
      margin: 0 !important;
      border-radius: 8px !important;
      box-shadow: none !important;
      pointer-events: none;
    }
    .presenter-last-slide-msg {
      color: #94a3b8;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .presenter-notes-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 16px 18px;
      font-size: 18px;
      line-height: 1.75;
      color: #f8fafc;
      white-space: pre-wrap;
    }
    .presenter-notes-body.is-empty {
      color: #94a3b8;
      font-style: italic;
      font-size: 15px;
    }
    @media (max-width: 900px) {
      .presenter-main {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr 1fr;
      }
      .presenter-panel-next {
        flex: 0 0 42%;
      }
    }

    @media print {
      html, body.mode-slideshow {
        width: auto;
        height: auto;
        overflow: visible !important;
        background: #ffffff !important;
      }
      body.mode-slideshow .lecture-render-root {
        position: static !important;
        display: block !important;
      }
      body.mode-slideshow .lecture-slide {
        display: flex !important;
        transform: none !important;
        animation: none !important;
        width: 100vw !important;
        height: 100vh !important;
        overflow: hidden !important;
        box-shadow: none !important;
        border: none !important;
        border-radius: 0 !important;
        page-break-after: always;
        break-after: page;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body.mode-slideshow .lecture-slide:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .slideshow-hud,
      .slideshow-progress,
      .slideshow-edge-nav,
      .slideshow-notes-drawer,
      .slideshow-toc-menu,
      .slideshow-help-overlay,
      .presenter-dashboard {
        display: none !important;
      }
    }
  </style>
</head>"#;

    let slideshow_hud_and_script = r##"
  <button type="button" id="ss-edge-prev" class="slideshow-edge-nav edge-prev" aria-label="前のスライド" title="前のスライド (←)"><span>‹</span></button>
  <button type="button" id="ss-edge-next" class="slideshow-edge-nav edge-next" aria-label="次のスライド" title="次のスライド (→)"><span>›</span></button>

  <aside id="ss-notes-drawer" class="slideshow-notes-drawer" hidden aria-label="スピーカーノート">
    <div class="slideshow-notes-header">
      <div>🗒 スピーカーノート<span id="ss-notes-slide-label" class="slideshow-notes-slide-label"></span></div>
      <button type="button" id="ss-notes-close" class="slideshow-notes-close" aria-label="ノートを閉じる">✕</button>
    </div>
    <div id="ss-notes-body" class="slideshow-notes-body"></div>
  </aside>

  <div id="ss-toc-menu" class="slideshow-toc-menu" hidden role="dialog" aria-label="スライド目次">
    <div class="slideshow-toc-header">
      <span>📑 目次・スライドジャンプ</span>
      <button type="button" id="ss-toc-close" class="slideshow-modal-close" aria-label="目次を閉じる">✕</button>
    </div>
    <div id="ss-toc-list" class="slideshow-toc-list" role="listbox"></div>
  </div>

  <div id="ss-help-overlay" class="slideshow-help-overlay" hidden role="dialog" aria-modal="true" aria-label="キーボードショートカット一覧">
    <div class="slideshow-help-card">
      <div class="slideshow-help-header">
        <span>⌨️ キーボードショートカット</span>
        <button type="button" id="ss-help-close" class="slideshow-modal-close" aria-label="ヘルプを閉じる">✕</button>
      </div>
      <ul class="slideshow-help-list">
        <li><span>次のスライド</span><span class="slideshow-help-keys"><kbd>→</kbd><kbd>↓</kbd><kbd>Space</kbd><kbd>PgDn</kbd><kbd>Enter</kbd></span></li>
        <li><span>前のスライド</span><span class="slideshow-help-keys"><kbd>←</kbd><kbd>↑</kbd><kbd>PgUp</kbd><kbd>Backspace</kbd></span></li>
        <li><span>最初 / 最後のスライド</span><span class="slideshow-help-keys"><kbd>Home</kbd><kbd>End</kbd></span></li>
        <li><span>スライド一覧（オーバービュー）</span><span class="slideshow-help-keys"><kbd>O</kbd><kbd>G</kbd></span></li>
        <li><span>目次・スライドジャンプ</span><span class="slideshow-help-keys"><kbd>T</kbd></span></li>
        <li><span>スピーカーノート表示切替</span><span class="slideshow-help-keys"><kbd>N</kbd></span></li>
        <li><span>発表者ビューを開く</span><span class="slideshow-help-keys"><kbd>P</kbd></span></li>
        <li><span>全画面表示切替</span><span class="slideshow-help-keys"><kbd>F</kbd></span></li>
        <li><span>ショートカットヘルプ</span><span class="slideshow-help-keys"><kbd>?</kbd></span></li>
        <li><span>オーバーレイ・一覧を閉じる</span><span class="slideshow-help-keys"><kbd>Esc</kbd></span></li>
      </ul>
    </div>
  </div>

  <section id="ss-presenter-dashboard" class="presenter-dashboard" hidden aria-label="発表者ビュー">
    <header class="presenter-topbar">
      <div class="presenter-topbar-left">
        <span class="presenter-badge">🎙 発表者ビュー</span>
        <button type="button" id="presenter-prev" class="presenter-btn" title="前のスライド (←)">◀ 前へ</button>
        <span id="presenter-counter" class="presenter-counter">1 / 1</span>
        <button type="button" id="presenter-next" class="presenter-btn" title="次のスライド (→)">次へ ▶</button>
      </div>
      <div class="presenter-topbar-right">
        <div class="presenter-timer-group" aria-label="経過タイマー">
          <span id="presenter-timer" class="presenter-timer-value">00:00:00</span>
          <button type="button" id="presenter-timer-toggle" class="presenter-btn">▶ 開始</button>
          <button type="button" id="presenter-timer-reset" class="presenter-btn">↺ リセット</button>
        </div>
        <span id="presenter-clock" class="presenter-clock" aria-label="現在時刻">--:--:--</span>
      </div>
    </header>
    <div class="presenter-main">
      <section class="presenter-panel presenter-panel-current" aria-label="現在のスライド">
        <div class="presenter-panel-header">
          <span>現在のスライド</span>
          <span id="presenter-current-title" class="presenter-panel-subtitle"></span>
        </div>
        <div id="presenter-current-stage" class="presenter-stage"></div>
      </section>
      <div class="presenter-right-col">
        <section class="presenter-panel presenter-panel-next" aria-label="次のスライド">
          <div class="presenter-panel-header">
            <span>次のスライド</span>
            <span id="presenter-next-title" class="presenter-panel-subtitle"></span>
          </div>
          <div id="presenter-next-stage" class="presenter-stage"></div>
        </section>
        <section class="presenter-panel presenter-panel-notes" aria-label="スピーカーノート">
          <div class="presenter-panel-header">
            <span>🗒 スピーカーノート</span>
          </div>
          <div id="presenter-notes-body" class="presenter-notes-body"></div>
        </section>
      </div>
    </div>
  </section>

  <div class="slideshow-hud" role="toolbar" aria-label="スライドショー操作">
    <button type="button" id="ss-prev" title="前のスライド (← / PageUp)">◀</button>
    <button type="button" id="ss-counter" class="hud-counter" title="目次・スライドジャンプ (T)" aria-haspopup="dialog" aria-expanded="false">1 / 1</button>
    <button type="button" id="ss-next" title="次のスライド (→ / Space / PageDown)">▶</button>
    <span class="hud-sep" aria-hidden="true"></span>
    <button type="button" id="ss-overview" title="スライド一覧グリッド (O / G)">⊞ 一覧</button>
    <button type="button" id="ss-notes-toggle" title="スピーカーノート (N)">🗒 ノート<span id="ss-notes-dot" class="hud-note-dot" hidden></span></button>
    <button type="button" id="ss-presenter-toggle" title="発表者ビューを開く (P)">🎙 発表者</button>
    <button type="button" id="ss-fullscreen" title="全画面表示切替 (F)">⛶ 全画面</button>
    <button type="button" id="ss-help-toggle" title="ショートカット一覧 (?)">?</button>
  </div>
  <div class="slideshow-progress" aria-hidden="true">
    <div id="ss-progress-fill" class="slideshow-progress-fill"></div>
  </div>
  <script>
    (function () {
      const root = document.querySelector(".lecture-render-root");
      const slides = Array.from(document.querySelectorAll(".lecture-slide"));
      if (!root || slides.length === 0) return;

      const btnPrev = document.getElementById("ss-prev");
      const btnNext = document.getElementById("ss-next");
      const btnEdgePrev = document.getElementById("ss-edge-prev");
      const btnEdgeNext = document.getElementById("ss-edge-next");
      const btnOverview = document.getElementById("ss-overview");
      const btnNotes = document.getElementById("ss-notes-toggle");
      const elNotesDot = document.getElementById("ss-notes-dot");
      const btnPresenter = document.getElementById("ss-presenter-toggle");
      const btnFullscreen = document.getElementById("ss-fullscreen");
      const btnHelp = document.getElementById("ss-help-toggle");
      const elCounter = document.getElementById("ss-counter");
      const elProgress = document.getElementById("ss-progress-fill");

      const presenterDashboard = document.getElementById("ss-presenter-dashboard");
      const btnPresenterPrev = document.getElementById("presenter-prev");
      const btnPresenterNext = document.getElementById("presenter-next");
      const elPresenterCounter = document.getElementById("presenter-counter");
      const elPresenterCurrentTitle = document.getElementById("presenter-current-title");
      const elPresenterNextTitle = document.getElementById("presenter-next-title");
      const elPresenterCurrentStage = document.getElementById("presenter-current-stage");
      const elPresenterNextStage = document.getElementById("presenter-next-stage");
      const elPresenterNotesBody = document.getElementById("presenter-notes-body");
      const elPresenterTimer = document.getElementById("presenter-timer");
      const btnPresenterTimerToggle = document.getElementById("presenter-timer-toggle");
      const btnPresenterTimerReset = document.getElementById("presenter-timer-reset");
      const elPresenterClock = document.getElementById("presenter-clock");

      const notesDrawer = document.getElementById("ss-notes-drawer");
      const notesBody = document.getElementById("ss-notes-body");
      const notesSlideLabel = document.getElementById("ss-notes-slide-label");
      const btnNotesClose = document.getElementById("ss-notes-close");

      const tocMenu = document.getElementById("ss-toc-menu");
      const tocList = document.getElementById("ss-toc-list");
      const btnTocClose = document.getElementById("ss-toc-close");

      const helpOverlay = document.getElementById("ss-help-overlay");
      const btnHelpClose = document.getElementById("ss-help-close");

      const isPresenterMode = new URLSearchParams(window.location.search).get("presenter") === "1";
      const SYNC_CHANNEL_NAME = "lectern-slideshow-sync";
      const SYNC_STORAGE_KEY = "lectern-slideshow-sync-state";
      const senderId = Math.random().toString(36).slice(2) + "-" + Date.now();
      let syncChannel = null;
      try {
        if (typeof BroadcastChannel !== "undefined") {
          syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
        }
      } catch (_) {}
      let presenterWindow = null;

      let current = 0;
      let inOverview = false;
      let notesOpen = false;
      let tocOpen = false;
      let helpOpen = false;
      let hudTimer = null;

      function getSlideTitle(slideEl, idx) {
        const heading = slideEl.querySelector(".lecture-doc-title, h1, h2, h3");
        const raw = heading ? (heading.textContent || "").trim() : "";
        return raw || ("スライド " + (idx + 1));
      }

      function getSlideNote(slideEl) {
        return (slideEl.getAttribute("data-speaker-note") || "").trim();
      }

      const slideMeta = slides.map((s, idx) => ({
        title: getSlideTitle(s, idx),
        hasNote: getSlideNote(s).length > 0
      }));

      function parseHashIndex() {
        const m = /^#(\d+)$/.exec(window.location.hash);
        if (!m) return 0;
        const n = parseInt(m[1], 10) - 1;
        return Math.max(0, Math.min(slides.length - 1, n));
      }

      function updateScale() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scale = Math.min((vw - 24) / 1120, (vh - 24) / 630);
        document.documentElement.style.setProperty("--slide-scale", String(Math.max(0.2, scale)));
      }

      function renderNotes() {
        const note = getSlideNote(slides[current]);
        const hasNote = note.length > 0;
        if (elNotesDot) elNotesDot.hidden = !hasNote;
        if (notesSlideLabel) {
          notesSlideLabel.textContent = "— " + (current + 1) + " / " + slides.length + " " + slideMeta[current].title;
        }
        if (notesBody) {
          notesBody.textContent = hasNote ? note : "このスライドにはスピーカーノートがありません。";
          notesBody.classList.toggle("is-empty", !hasNote);
        }
      }

      function renderToc() {
        if (!tocList) return;
        tocList.innerHTML = "";
        slides.forEach((_, idx) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "ss-toc-item" + (idx === current ? " is-current" : "");
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", idx === current ? "true" : "false");

          const num = document.createElement("span");
          num.className = "ss-toc-num";
          num.textContent = String(idx + 1);

          const title = document.createElement("span");
          title.className = "ss-toc-title";
          title.textContent = slideMeta[idx].title;

          item.appendChild(num);
          item.appendChild(title);

          if (slideMeta[idx].hasNote) {
            const noteIcon = document.createElement("span");
            noteIcon.className = "ss-toc-note";
            noteIcon.textContent = "🗒";
            noteIcon.title = "スピーカーノートあり";
            item.appendChild(noteIcon);
          }

          item.addEventListener("click", () => {
            setToc(false);
            goTo(idx);
          });
          tocList.appendChild(item);
        });
      }

      function setNotes(open) {
        notesOpen = open;
        if (notesDrawer) notesDrawer.hidden = !open;
        if (btnNotes) btnNotes.classList.toggle("is-active-btn", open);
        if (open) {
          setToc(false);
          renderNotes();
          document.body.classList.remove("hud-hidden");
        } else {
          wakeHud();
        }
      }

      function setToc(open) {
        tocOpen = open;
        if (tocMenu) tocMenu.hidden = !open;
        if (elCounter) {
          elCounter.setAttribute("aria-expanded", open ? "true" : "false");
          elCounter.classList.toggle("is-active-btn", open);
        }
        if (open) {
          setNotes(false);
          setHelp(false);
          renderToc();
          document.body.classList.remove("hud-hidden");
          const activeItem = tocList?.querySelector(".ss-toc-item.is-current");
          activeItem?.scrollIntoView({ block: "nearest" });
        } else {
          wakeHud();
        }
      }

      function setHelp(open) {
        helpOpen = open;
        if (helpOverlay) helpOverlay.hidden = !open;
        if (btnHelp) btnHelp.classList.toggle("is-active-btn", open);
        if (open) {
          setToc(false);
          document.body.classList.remove("hud-hidden");
        } else {
          wakeHud();
        }
      }

      function broadcastSync(payload) {
        if (syncChannel) {
          try { syncChannel.postMessage(payload); } catch (_) {}
        }
        try {
          localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(payload));
        } catch (_) {}
        try {
          if (presenterWindow && !presenterWindow.closed) {
            presenterWindow.postMessage(payload, "*");
          }
        } catch (_) {}
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, "*");
          }
        } catch (_) {}
      }

      function broadcastSlide(index) {
        broadcastSync({
          type: "slide-change",
          index: index,
          total: slides.length,
          sender: senderId,
          ts: Date.now()
        });
      }

      function openPresenterWindow() {
        if (isPresenterMode) return;
        let targetUrl = "";
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("presenter", "1");
          url.hash = "#" + (current + 1);
          targetUrl = url.toString();
        } catch (_) {
          const base = window.location.href.split("#")[0].split("?")[0];
          targetUrl = base + "?presenter=1#" + (current + 1);
        }
        presenterWindow = window.open(
          targetUrl,
          "lectern-presenter-view",
          "width=1280,height=800,resizable=yes,scrollbars=yes"
        );
        if (presenterWindow) {
          try { presenterWindow.focus(); } catch (_) {}
        }
      }

      function scalePresenterStage(stageEl) {
        if (!stageEl) return;
        const frame = stageEl.querySelector(".presenter-stage-frame");
        if (!frame) return;
        const w = Math.max(120, stageEl.clientWidth - 24);
        const h = Math.max(80, stageEl.clientHeight - 24);
        const scale = Math.max(0.12, Math.min(w / 1120, h / 630));
        frame.style.transform = "scale(" + scale.toFixed(4) + ")";
      }

      function scalePresenterStages() {
        scalePresenterStage(elPresenterCurrentStage);
        scalePresenterStage(elPresenterNextStage);
      }

      function renderPresenterStage(stageEl, slideIdx) {
        if (!stageEl) return;
        stageEl.innerHTML = "";
        if (slideIdx < 0 || slideIdx >= slides.length) {
          const msg = document.createElement("div");
          msg.className = "presenter-last-slide-msg";
          msg.textContent = "最終スライド";
          stageEl.appendChild(msg);
          return;
        }
        const frame = document.createElement("div");
        frame.className = "presenter-stage-frame";
        const stageRoot = document.createElement("div");
        stageRoot.className = "lecture-render-root presenter-stage-root";
        const themeAttr = root.getAttribute("data-lecture-theme");
        if (themeAttr) stageRoot.setAttribute("data-lecture-theme", themeAttr);
        const clone = slides[slideIdx].cloneNode(true);
        clone.classList.add("is-active");
        stageRoot.appendChild(clone);
        frame.appendChild(stageRoot);
        stageEl.appendChild(frame);
        scalePresenterStage(stageEl);
      }

      function renderPresenterView() {
        if (elPresenterCounter) {
          elPresenterCounter.textContent = (current + 1) + " / " + slides.length;
        }
        const atFirst = current <= 0;
        const atLast = current >= slides.length - 1;
        if (btnPresenterPrev) btnPresenterPrev.disabled = atFirst;
        if (btnPresenterNext) btnPresenterNext.disabled = atLast;
        if (elPresenterCurrentTitle) {
          elPresenterCurrentTitle.textContent = (current + 1) + ". " + slideMeta[current].title;
        }
        if (elPresenterNextTitle) {
          elPresenterNextTitle.textContent = atLast
            ? "最終スライド"
            : (current + 2) + ". " + slideMeta[current + 1].title;
        }
        renderPresenterStage(elPresenterCurrentStage, current);
        renderPresenterStage(elPresenterNextStage, atLast ? -1 : current + 1);
        if (elPresenterNotesBody) {
          const note = getSlideNote(slides[current]);
          const hasNote = note.length > 0;
          elPresenterNotesBody.textContent = hasNote
            ? note
            : "このスライドにはスピーカーノートがありません。";
          elPresenterNotesBody.classList.toggle("is-empty", !hasNote);
        }
        const targetHash = "#" + (current + 1);
        if (window.location.hash !== targetHash) {
          try { history.replaceState(null, "", targetHash); } catch (_) {}
        }
      }

      function renderCurrent() {
        if (isPresenterMode) {
          renderPresenterView();
          return;
        }
        slides.forEach((s, idx) => {
          s.classList.toggle("is-active", idx === current);
        });
        if (elCounter) elCounter.textContent = (current + 1) + " / " + slides.length;
        const atFirst = current <= 0;
        const atLast = current >= slides.length - 1;
        if (btnPrev) btnPrev.disabled = atFirst;
        if (btnNext) btnNext.disabled = atLast;
        if (btnEdgePrev) btnEdgePrev.disabled = atFirst;
        if (btnEdgeNext) btnEdgeNext.disabled = atLast;
        if (elProgress) {
          const pct = slides.length <= 1 ? 100 : ((current + 1) / slides.length) * 100;
          elProgress.style.width = pct.toFixed(1) + "%";
        }
        renderNotes();
        const targetHash = "#" + (current + 1);
        if (window.location.hash !== targetHash) {
          try { history.replaceState(null, "", targetHash); } catch (_) {}
        }
      }

      function goTo(index, shouldBroadcast) {
        const nextIndex = Math.max(0, Math.min(slides.length - 1, index));
        const changed = nextIndex !== current;
        current = nextIndex;
        if (!isPresenterMode && inOverview) setOverview(false);
        renderCurrent();
        const liveRegion = document.getElementById("slide-live-region");
        if (liveRegion && slideMeta[current]) {
          liveRegion.textContent = "スライド " + (current + 1) + " / " + slides.length + ": " + slideMeta[current].title;
        }
        if (shouldBroadcast !== false && changed) {
          broadcastSlide(current);
        }
      }

      function handleSyncMessage(data) {
        if (!data || typeof data !== "object" || data.sender === senderId) return;
        if (data.type === "slide-change" && typeof data.index === "number") {
          goTo(data.index, false);
        } else if (data.type === "sync-request" && !isPresenterMode) {
          broadcastSlide(current);
        }
      }

      if (syncChannel) {
        syncChannel.onmessage = (event) => handleSyncMessage(event.data);
      }
      window.addEventListener("storage", (event) => {
        if (event.key !== SYNC_STORAGE_KEY || !event.newValue) return;
        try {
          handleSyncMessage(JSON.parse(event.newValue));
        } catch (_) {}
      });
      window.addEventListener("message", (event) => {
        handleSyncMessage(event.data);
      });

      function setOverview(enable) {
        if (inOverview === enable) return;
        inOverview = enable;
        document.body.classList.toggle("is-overview", enable);
        if (btnOverview) {
          btnOverview.textContent = enable ? "✕ 戻る" : "⊞ 一覧";
          btnOverview.classList.toggle("is-active-btn", enable);
        }

        if (enable) {
          setToc(false);
          document.body.classList.remove("hud-hidden");
          root.innerHTML = "";
          slides.forEach((slideEl, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "slide-thumb-wrap" + (idx === current ? " is-current" : "");
            wrap.title = (idx + 1) + ". " + slideMeta[idx].title;

            const stage = document.createElement("div");
            stage.className = "slide-thumb-stage";
            stage.appendChild(slideEl);

            const caption = document.createElement("div");
            caption.className = "slide-thumb-caption";

            const badge = document.createElement("span");
            badge.className = "slide-thumb-badge";
            badge.textContent = String(idx + 1);

            const title = document.createElement("span");
            title.className = "slide-thumb-title";
            title.textContent = slideMeta[idx].title;

            caption.appendChild(badge);
            caption.appendChild(title);

            if (slideMeta[idx].hasNote) {
              const noteDot = document.createElement("span");
              noteDot.className = "slide-thumb-note-dot";
              noteDot.textContent = "🗒";
              noteDot.title = "スピーカーノートあり";
              caption.appendChild(noteDot);
            }

            wrap.appendChild(stage);
            wrap.appendChild(caption);
            wrap.addEventListener("click", () => goTo(idx));
            root.appendChild(wrap);
          });
        } else {
          root.innerHTML = "";
          slides.forEach((slideEl) => root.appendChild(slideEl));
          updateScale();
          renderCurrent();
        }
      }

      function toggleFullscreen() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      }

      function wakeHud() {
        document.body.classList.remove("hud-hidden");
        if (hudTimer) clearTimeout(hudTimer);
        if (!inOverview && !notesOpen && !tocOpen && !helpOpen) {
          hudTimer = setTimeout(() => {
            document.body.classList.add("hud-hidden");
          }, 2600);
        }
      }

      btnPrev?.addEventListener("click", () => goTo(current - 1));
      btnNext?.addEventListener("click", () => goTo(current + 1));
      btnEdgePrev?.addEventListener("click", () => goTo(current - 1));
      btnEdgeNext?.addEventListener("click", () => goTo(current + 1));
      btnOverview?.addEventListener("click", () => setOverview(!inOverview));
      btnNotes?.addEventListener("click", () => setNotes(!notesOpen));
      btnNotesClose?.addEventListener("click", () => setNotes(false));
      btnPresenter?.addEventListener("click", openPresenterWindow);
      elCounter?.addEventListener("click", () => setToc(!tocOpen));
      btnTocClose?.addEventListener("click", () => setToc(false));
      btnFullscreen?.addEventListener("click", toggleFullscreen);
      btnHelp?.addEventListener("click", () => setHelp(!helpOpen));
      btnHelpClose?.addEventListener("click", () => setHelp(false));

      btnPresenterPrev?.addEventListener("click", () => goTo(current - 1));
      btnPresenterNext?.addEventListener("click", () => goTo(current + 1));

      // Lecture Elapsed Timer & Current Clock (Presenter Mode)
      let timerRunning = false;
      let timerElapsedMs = 0;
      let timerStartedAt = 0;
      let timerInterval = null;

      function formatElapsed(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const hrs = String(Math.floor(totalSec / 3600)).padStart(2, "0");
        const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
        const secs = String(totalSec % 60).padStart(2, "0");
        return hrs + ":" + mins + ":" + secs;
      }

      function updateTimerDisplay() {
        if (!elPresenterTimer) return;
        const elapsed = timerRunning
          ? timerElapsedMs + (Date.now() - timerStartedAt)
          : timerElapsedMs;
        elPresenterTimer.textContent = formatElapsed(elapsed);
      }

      function toggleTimer() {
        if (timerRunning) {
          timerElapsedMs += Date.now() - timerStartedAt;
          timerRunning = false;
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
          if (btnPresenterTimerToggle) {
            btnPresenterTimerToggle.textContent = "▶ 開始";
            btnPresenterTimerToggle.classList.remove("is-running");
          }
        } else {
          timerStartedAt = Date.now();
          timerRunning = true;
          timerInterval = setInterval(updateTimerDisplay, 250);
          if (btnPresenterTimerToggle) {
            btnPresenterTimerToggle.textContent = "⏸ 一時停止";
            btnPresenterTimerToggle.classList.add("is-running");
          }
        }
        updateTimerDisplay();
      }

      function resetTimer() {
        timerRunning = false;
        timerElapsedMs = 0;
        timerStartedAt = 0;
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        if (btnPresenterTimerToggle) {
          btnPresenterTimerToggle.textContent = "▶ 開始";
          btnPresenterTimerToggle.classList.remove("is-running");
        }
        updateTimerDisplay();
      }

      function updateClockDisplay() {
        if (!elPresenterClock) return;
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        elPresenterClock.textContent = hh + ":" + mm + ":" + ss;
      }

      btnPresenterTimerToggle?.addEventListener("click", toggleTimer);
      btnPresenterTimerReset?.addEventListener("click", resetTimer);

      helpOverlay?.addEventListener("click", (e) => {
        if (e.target === helpOverlay) setHelp(false);
      });

      document.addEventListener("click", (e) => {
        if (tocOpen && tocMenu && !tocMenu.contains(e.target) && e.target !== elCounter) {
          setToc(false);
        }
      });

      window.addEventListener("keydown", (e) => {
        const target = e.target;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
        ) {
          return;
        }
        const isInteractiveFocus =
          target &&
          (target.tagName === "A" || target.tagName === "BUTTON" || target.tagName === "SUMMARY");

        if (!isPresenterMode) wakeHud();

        if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
          e.preventDefault();
          setHelp(!helpOpen);
          return;
        }
        if (e.key === "Escape") {
          if (helpOpen) {
            e.preventDefault();
            setHelp(false);
          } else if (tocOpen) {
            e.preventDefault();
            setToc(false);
          } else if (inOverview) {
            e.preventDefault();
            setOverview(false);
          } else if (notesOpen) {
            e.preventDefault();
            setNotes(false);
          }
          return;
        }
        if (helpOpen) return;

        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") {
          if (inOverview || tocOpen) return;
          e.preventDefault();
          goTo(current + 1);
        } else if ((e.key === " " || e.key === "Enter") && !isInteractiveFocus) {
          if (inOverview || tocOpen) return;
          e.preventDefault();
          goTo(current + 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Backspace") {
          if (inOverview || tocOpen) return;
          e.preventDefault();
          goTo(current - 1);
        } else if (e.key === "Home") {
          e.preventDefault();
          goTo(0);
        } else if (e.key === "End") {
          e.preventDefault();
          goTo(slides.length - 1);
        } else if (!isPresenterMode && (e.key.toLowerCase() === "o" || e.key.toLowerCase() === "g")) {
          e.preventDefault();
          setOverview(!inOverview);
        } else if (!isPresenterMode && e.key.toLowerCase() === "t") {
          e.preventDefault();
          setToc(!tocOpen);
        } else if (!isPresenterMode && e.key.toLowerCase() === "n") {
          e.preventDefault();
          setNotes(!notesOpen);
        } else if (!isPresenterMode && e.key.toLowerCase() === "p" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          openPresenterWindow();
        } else if (!isPresenterMode && e.key.toLowerCase() === "f") {
          e.preventDefault();
          toggleFullscreen();
        }
      });

      // Touch swipe navigation
      let touchStartX = null;
      window.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
      }, { passive: true });
      window.addEventListener("touchend", (e) => {
        if (touchStartX === null || inOverview || tocOpen || helpOpen || isPresenterMode) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(dx) > 48) {
          goTo(dx < 0 ? current + 1 : current - 1);
        }
      }, { passive: true });

      window.addEventListener("mousemove", () => {
        if (!isPresenterMode) wakeHud();
      }, { passive: true });
      window.addEventListener("resize", () => {
        if (isPresenterMode) {
          scalePresenterStages();
        } else {
          updateScale();
        }
      });
      document.addEventListener("fullscreenchange", updateScale);
      window.addEventListener("hashchange", () => {
        current = parseHashIndex();
        if (!inOverview) renderCurrent();
      });

      current = parseHashIndex();
      if (isPresenterMode) {
        document.body.classList.add("is-presenter-mode");
        if (presenterDashboard) presenterDashboard.hidden = false;
        document.title = "[発表者ビュー] " + document.title;
        updateTimerDisplay();
        updateClockDisplay();
        setInterval(updateClockDisplay, 1000);
        renderCurrent();
        requestAnimationFrame(scalePresenterStages);
        broadcastSync({ type: "sync-request", sender: senderId, ts: Date.now() });
      } else {
        updateScale();
        renderCurrent();
        wakeHud();
      }
    })();
  </script>
</body>"##;

    let with_body_cls = base_html.replacen(
        "<body class=\"mode-slide ",
        "<body class=\"mode-slide mode-slideshow ",
        1,
    );
    let with_css = with_body_cls.replacen("</head>", slideshow_css, 1);

    if let Some(script_idx) = with_css.rfind("  <script>") {
        format!("{}{}\n</html>", &with_css[..script_idx], slideshow_hud_and_script)
    } else {
        with_css.replacen("</body>", slideshow_hud_and_script, 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_speaker_notes_single_multiline_and_fences() {
        let slide = r#"# アルゴリズム入門

本文のテキストです。インラインコード `<!-- note: ignore inline -->` はそのまま残します。

<!-- note: ここで受講者に質問を投げかける -->

```markdown
<!-- note: コードブロック内のノートは抽出しない -->
```

<!-- NOTES:
1. 30秒考える時間を取る
2. 回答例を2つ紹介する
-->

<!-- 通常のHTMLコメントは無視する -->
"#;

        let (cleaned, notes) = extract_speaker_notes(slide);

        assert!(cleaned.contains("# アルゴリズム入門"));
        assert!(cleaned.contains("`<!-- note: ignore inline -->`"));
        assert!(cleaned.contains("<!-- note: コードブロック内のノートは抽出しない -->"));
        assert!(cleaned.contains("<!-- 通常のHTMLコメントは無視する -->"));
        assert!(!cleaned.contains("ここで受講者に質問を投げかける"));
        assert!(!cleaned.contains("30秒考える時間を取る"));

        assert_eq!(
            notes,
            "ここで受講者に質問を投げかける\n\n1. 30秒考える時間を取る\n2. 回答例を2つ紹介する"
        );
    }

    #[test]
    fn test_slide_mode_attaches_escaped_speaker_notes_without_rendering_on_slide() {
        let md = r#"---
title: スピーカーノートテスト
---

# スライド1

スライド本文です。

<!-- note: 重要ポイント: "A < B & C" を口頭補足 -->

---

# スライド2

ノートなしのスライド。
"#;

        let compiled = compile_lecture_markdown(md, "slide");
        assert_eq!(compiled.slide_count, 2);
        assert!(
            compiled.html.contains(
                r#"data-slide-index="0" aria-roledescription="スライド" aria-label="スライド 1 / 2" data-speaker-note="重要ポイント: &quot;A &lt; B &amp; C&quot; を口頭補足""#
            ),
            "html={}",
            compiled.html
        );
        // ノート本文がスライドの可視要素として出力されていないこと
        assert!(!compiled.html.contains("<p>重要ポイント:"));
        // 2枚目はノートなしのため data-speaker-note 属性を付けない
        assert!(compiled
            .html
            .contains(r#"data-slide-index="1" aria-roledescription="スライド" aria-label="スライド 2 / 2">"#));
    }

    #[test]
    fn test_split_slides_respects_code_fences() {
        let md = r#"# Slide 1

```yaml
---
key: value
---
```

````markdown
---
nested: true
---
````

~~~
---
~~~

---

# Slide 2

Body 2

---

# Slide 3
"#;

        let slides = split_slides(md);
        assert_eq!(slides.len(), 3);
        assert!(slides[0].contains("# Slide 1"));
        assert!(slides[0].contains("key: value"));
        assert!(slides[0].contains("nested: true"));
        assert!(slides[1].contains("# Slide 2"));
        assert!(slides[2].contains("# Slide 3"));
    }

    #[test]
    fn test_slideshow_html_contains_notes_toc_help_overview_transitions_and_is_offline() {
        let md = r#"---
course: ソフトウェア工学
title: プレゼン最適化テスト
theme: midnight
---

# はじめに

- [ ] タスク1
- [x] タスク2

<!-- notes: 導入は2分以内で話す -->

---

# アーキテクチャ

```mermaid
flowchart LR
  A --> B
```
"#;

        let html = build_slideshow_html_with_base_dir(md, None, Some("midnight"), None, None);

        // スライドショー基本構造 & テーマ
        assert!(html.contains("mode-slideshow"));
        assert!(html.contains("data-lecture-theme=\"midnight\""));

        // スピーカーノート抽出 & ドロワー
        assert!(html.contains(r#"data-speaker-note="導入は2分以内で話す""#));
        assert!(html.contains(r#"id="ss-notes-drawer""#));
        assert!(html.contains(r#"id="ss-notes-toggle""#));

        // オーバービュー（タイトルプレビュー付き）& 目次/スライドジャンプ
        assert!(html.contains(r#"id="ss-overview""#));
        assert!(html.contains("slide-thumb-caption"));
        assert!(html.contains("slide-thumb-title"));
        assert!(html.contains(r#"id="ss-toc-menu""#));
        assert!(html.contains(r#"id="ss-toc-list""#));

        // キーボードショートカットヘルプオーバーレイ (?)
        assert!(html.contains(r#"id="ss-help-overlay""#));
        assert!(html.contains(r#"id="ss-help-toggle""#));

        // エッジホバーナビゲーション & prefers-reduced-motion 対応トランジション
        assert!(html.contains(r#"id="ss-edge-prev""#));
        assert!(html.contains(r#"id="ss-edge-next""#));
        assert!(html.contains("prefers-reduced-motion: no-preference"));
        assert!(html.contains("prefers-reduced-motion: reduce"));

        // 100% スタンドアロンオフライン（外部CDNなし・Base64 KaTeXフォント内包）
        assert!(html.contains("data:font/woff2;base64,"));
        assert!(!html.contains("https://cdn."));
        assert!(!html.contains("http://cdn."));
        assert!(!html.contains("<script src="));
        assert!(!html.contains(r#"<link rel="stylesheet""#));
    }

    #[test]
    fn test_pagebreak_conversion_and_code_fence_preservation() {
        let md = r#"# 第1章

最初のページの内容です。

<!-- pagebreak -->

# 第2章

<!-- PAGE-BREAK -->

```markdown
<!-- pagebreak -->
<!-- page-break -->
```

~~~html
<!-- PAGEBREAK -->
~~~

最後の段落です。
"#;

        let compiled = compile_lecture_markdown(md, "document");
        let break_div = r#"<div class="lecture-page-break" aria-hidden="true"></div>"#;
        // コードフェンス外の2か所のみ変換される
        assert_eq!(compiled.html.matches(break_div).count(), 2);
        // コードフェンス内はそのまま保持される（HTMLエスケープされた形でコードブロック内に存在）
        assert!(compiled.html.contains("pagebreak"));
        assert!(compiled.html.contains("PAGEBREAK"));

        // スタンドアロン HTML にスクリーン用ラベルと印刷用改ページ CSS が含まれる
        let standalone = build_standalone_html(md, None, "document", None, None);
        assert!(standalone.contains(".lecture-page-break"));
        assert!(standalone.contains("ページ区切り"));
        assert!(standalone.contains("page-break-after: always;"));
        assert!(standalone.contains("break-after: page;"));
    }

    #[test]
    fn test_document_auto_toc_markup_script_and_slide_mode_exclusion() {
        let md = r#"---
title: データベース設計
---

# 第1章 概要

## 1.1 正規化

### 1.1.1 第1正規形

# 第2章 インデックス
"#;

        let doc_html = build_standalone_html(md, None, "document", None, None);
        assert!(doc_html.contains(r#"id="doc-toc-toggle""#));
        assert!(doc_html.contains("☰ 目次"));
        assert!(doc_html.contains(r#"id="doc-toc-drawer""#));
        assert!(doc_html.contains(r#"id="doc-toc-list""#));
        assert!(doc_html.contains(r#"querySelectorAll("h1, h2, h3")"#));
        assert!(doc_html.contains("headings.length < 2"));
        assert!(doc_html.contains(r#"e.key === "Escape""#));
        assert!(doc_html.contains(r#"e.key.toLowerCase() === "m""#));
        assert!(doc_html.contains("scrollIntoView"));
        assert!(doc_html.contains(".doc-toc-toggle,\n          .doc-toc-drawer"));
        assert!(!doc_html.contains("<script src="));
        assert!(!doc_html.contains("https://cdn."));

        // slide モードではドキュメント用自動目次を注入しない
        let slide_html = build_standalone_html(md, None, "slide", None, None);
        assert!(!slide_html.contains(r#"id="doc-toc-toggle""#));
        assert!(!slide_html.contains(r#"id="doc-toc-drawer""#));
    }

    #[test]
    fn test_standalone_html_embeds_distinct_base64_favicons_for_document_and_slide() {
        let md = "# Favicon Test\n\nContent\n\n---\n\n# Slide 2";
        let doc_html = build_standalone_html(md, None, "document", None, None);
        let slide_html = build_standalone_html(md, None, "slide", None, None);
        let slideshow_html = build_slideshow_html_with_base_dir(md, None, None, None, None);

        let doc_uri = build_embedded_favicon_data_uri("document");
        let slide_uri = build_embedded_favicon_data_uri("slide");

        assert!(doc_uri.starts_with("data:image/svg+xml;base64,"));
        assert!(slide_uri.starts_with("data:image/svg+xml;base64,"));
        assert_ne!(doc_uri, slide_uri);

        // Decode Base64 payloads to verify valid SVG markup
        let doc_b64 = doc_uri.strip_prefix("data:image/svg+xml;base64,").unwrap();
        let slide_b64 = slide_uri.strip_prefix("data:image/svg+xml;base64,").unwrap();
        let doc_svg = String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(doc_b64).unwrap(),
        )
        .unwrap();
        let slide_svg = String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(slide_b64).unwrap(),
        )
        .unwrap();
        assert!(doc_svg.starts_with("<svg ") && doc_svg.ends_with("</svg>"));
        assert!(slide_svg.starts_with("<svg ") && slide_svg.ends_with("</svg>"));

        let expected_doc_tag = format!(
            r#"<link rel="icon" type="image/svg+xml" href="{}" />"#,
            doc_uri
        );
        let expected_slide_tag = format!(
            r#"<link rel="icon" type="image/svg+xml" href="{}" />"#,
            slide_uri
        );

        assert!(doc_html.contains(&expected_doc_tag));
        assert!(slide_html.contains(&expected_slide_tag));
        assert!(slideshow_html.contains(&expected_slide_tag));
    }

    #[test]
    fn test_standalone_html_semantic_accessibility_features() {
        let md = r#"---
title: アクセシビリティ講義
lang: en
---

# 第1章 概要

> [!NOTE]
> スクリーンリーダー向けの補足です。

| 項目 | 値 |
| --- | --- |
| A | 1 |

- [x] 完了タスク

```rust
fn main() {}
```

```mermaid
graph LR
  accTitle: 処理フロー図
  A[入力] --> B[出力]
```

---

# 第2章 詳細
"#;

        let doc_html = build_standalone_html(md, None, "document", None, None);
        assert!(doc_html.contains(r#"<html lang="en">"#));
        assert!(doc_html.contains(r##"<a href="#main-content" class="skip-link visually-hidden">本文へスキップ</a>"##));
        assert!(doc_html.contains(r#"<main id="main-content" tabindex="-1">"#));
        assert!(doc_html.contains(r#"<aside class="callout callout-note" aria-label="NOTE / 補足">"#));
        assert!(doc_html.contains(r#"<span aria-hidden="true">📘</span> NOTE / 補足"#));
        assert!(doc_html.contains(r#"<th scope="col">項目</th>"#));
        assert!(doc_html.contains(r#"<th scope="col">値</th>"#));
        assert!(doc_html.contains(r#"aria-label="タスクの完了状態""#));
        assert!(doc_html.contains(r#"<figure class="code-block-wrapper" role="figure" aria-label="コードブロック (RUST)">"#));
        assert!(doc_html.contains(r#"<figcaption class="code-block-header">RUST</figcaption>"#));
        assert!(doc_html.contains(r#"<figure class="mermaid-container" role="figure" aria-label="処理フロー図""#));
        assert!(doc_html.contains(r#"aria-label="目次リンク""#));
        assert!(doc_html.contains("prefers-reduced-motion: reduce"));

        let slide_html = build_standalone_html(md, None, "slide", None, None);
        assert!(slide_html.contains(r#"aria-roledescription="スライド""#));
        assert!(slide_html.contains(r#"aria-label="スライド 1 / 2""#));
        assert!(slide_html.contains(r#"id="slide-live-region""#));
        assert!(slide_html.contains(r#"aria-live="polite""#));
    }

    #[test]
    fn test_slideshow_presenter_view_sync_timer_and_offline() {
        let md = r#"---
title: 発表者ビューテスト
---

# スライド1

内容1

<!-- note: ここではタイマーを確認しながら3分で話す -->

---

# スライド2

内容2
"#;

        let html = build_slideshow_html_with_base_dir(md, None, Some("handout"), None, None);

        // HUD ボタン & ショートカットヘルプ
        assert!(html.contains(r#"id="ss-presenter-toggle""#));
        assert!(html.contains("🎙 発表者"));
        assert!(html.contains("<kbd>P</kbd>"));

        // ?presenter=1 モード & 2ウィンドウ同期 (BroadcastChannel + localStorage フォールバック)
        assert!(html.contains("?presenter=1"));
        assert!(html.contains("BroadcastChannel"));
        assert!(html.contains("lectern-slideshow-sync"));
        assert!(html.contains("localStorage"));
        assert!(html.contains(r#"addEventListener("storage""#));

        // 発表者ダッシュボード要素（現在スライド・次スライド・ノート・タイマー・時計・前後操作）
        assert!(html.contains(r#"id="ss-presenter-dashboard""#));
        assert!(html.contains(r#"id="presenter-current-stage""#));
        assert!(html.contains(r#"id="presenter-next-stage""#));
        assert!(html.contains("最終スライド"));
        assert!(html.contains(r#"id="presenter-notes-body""#));
        assert!(html.contains(r#"id="presenter-timer""#));
        assert!(html.contains("00:00:00"));
        assert!(html.contains(r#"id="presenter-timer-toggle""#));
        assert!(html.contains(r#"id="presenter-timer-reset""#));
        assert!(html.contains(r#"id="presenter-clock""#));
        assert!(html.contains(r#"id="presenter-prev""#));
        assert!(html.contains(r#"id="presenter-next""#));

        // 100% オフライン
        assert!(!html.contains("https://cdn."));
        assert!(!html.contains("<script src="));
        assert!(!html.contains(r#"<link rel="stylesheet""#));
    }
}
