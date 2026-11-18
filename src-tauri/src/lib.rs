pub mod converter;
pub mod fs_ops;
pub mod pdf;
pub mod themes;

use converter::{
    build_standalone_html_with_base_dir, compile_lecture_markdown,
    compile_lecture_markdown_with_options, CompileResult,
};
use fs_ops::{
    create_new_markdown, list_markdown_workspace, read_file_utf8, remove_markdown_file,
    resolve_default_workspace, write_file_utf8, FileEntry,
};
use pdf::render_html_to_pdf;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use themes::{list_available_themes, resolve_theme_css, save_custom_theme_file, ThemeInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub output_path: String,
    pub bytes_written: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DroppedPathInfo {
    pub is_dir: bool,
    pub workspace_path: String,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
}

#[tauri::command]
fn get_default_workspace() -> String {
    resolve_default_workspace().to_string_lossy().to_string()
}

#[tauri::command]
fn get_parent_directory(path: String) -> Option<String> {
    let p = Path::new(&path);
    p.parent()
        .filter(|parent| !parent.as_os_str().is_empty() && *parent != p)
        .map(|parent| parent.to_string_lossy().to_string())
}

#[tauri::command]
fn inspect_dropped_path(path: String) -> Result<DroppedPathInfo, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("パスが存在しません: {}", path));
    }
    if p.is_dir() {
        Ok(DroppedPathInfo {
            is_dir: true,
            workspace_path: p.to_string_lossy().to_string(),
            file_path: None,
            file_name: None,
        })
    } else {
        let parent = p
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_string_lossy()
            .to_string();
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        Ok(DroppedPathInfo {
            is_dir: false,
            workspace_path: parent,
            file_path: Some(p.to_string_lossy().to_string()),
            file_name: Some(name),
        })
    }
}

#[tauri::command]
fn reveal_in_file_explorer(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("指定されたパスが存在しません: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if target.is_file() {
            cmd.arg("-R").arg(target);
        } else {
            cmd.arg(target);
        }
        cmd.spawn()
            .map_err(|e| format!("Finder の起動に失敗しました: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer.exe");
        if target.is_file() {
            cmd.arg(format!("/select,{}", target.to_string_lossy()));
        } else {
            cmd.arg(target);
        }
        cmd.spawn()
            .map_err(|e| format!("エクスプローラーの起動に失敗しました: {}", e))?;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let dir = if target.is_file() {
            target.parent().unwrap_or(target)
        } else {
            target
        };
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("ファイルマネージャーの起動に失敗しました: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn pick_workspace_folder(current_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title("講義フォルダ（ワークスペース）を選択");
    if let Some(p) = current_path.filter(|s| !s.trim().is_empty()) {
        let dir = Path::new(&p);
        if dir.exists() && dir.is_dir() {
            dialog = dialog.set_directory(dir);
        }
    }
    dialog
        .pick_folder()
        .await
        .map(|handle| handle.path().to_string_lossy().to_string())
}

#[tauri::command]
fn list_workspace_files(workspace_path: String) -> Result<Vec<FileEntry>, String> {
    list_markdown_workspace(Path::new(&workspace_path))
}

#[tauri::command]
fn read_markdown_file(file_path: String) -> Result<String, String> {
    read_file_utf8(Path::new(&file_path))
}

#[tauri::command]
fn save_markdown_file(file_path: String, content: String) -> Result<(), String> {
    write_file_utf8(Path::new(&file_path), &content)
}

#[tauri::command]
async fn create_markdown_file(
    workspace_path: String,
    file_name: Option<String>,
) -> Result<Option<String>, String> {
    // もし file_name が直接渡された場合はその名前で作成、渡されない場合は OS 標準の保存ダイアログを開く
    if let Some(name) = file_name.filter(|s| !s.trim().is_empty()) {
        let created = create_new_markdown(Path::new(&workspace_path), &name)?;
        return Ok(Some(created.to_string_lossy().to_string()));
    }

    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("新規講義 Markdown ファイルを作成")
        .add_filter("Markdown Document", &["md", "markdown"])
        .set_file_name("new_lecture.md");

    let ws_dir = Path::new(&workspace_path);
    if ws_dir.exists() && ws_dir.is_dir() {
        dialog = dialog.set_directory(ws_dir);
    }

    let Some(handle) = dialog.save_file().await else {
        return Ok(None);
    };

    let target_path = handle.path().to_path_buf();
    let stem = target_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("新規講義資料");

    let initial_template = format!(
        "---\ncourse: 講義科目名\ntitle: {}\ndescription: この講義資料の概要や学習目標を簡潔に記述します。\nauthor: 担当教員\ndate: 2026-11-19\ntheme: handout\n---\n\n# {}\n\nここに講義の導入や到達目標を記述します。\n\n> [!NOTE]\n> **ポイント**: 数式 $E = mc^2$ やコードブロック、Mermaid図表を記述できます。\n\n---\n\n# 2. 数式とアルゴリズムの例\n\n$$\n\\sum_{{i=1}}^{{n}} i = \\frac{{n(n+1)}}{{2}}\n$$\n\n```rust\nfn main() {{\n    println!(\"Hello, Lectern!\");\n}}\n```\n",
        stem, stem
    );

    write_file_utf8(&target_path, &initial_template)?;
    Ok(Some(target_path.to_string_lossy().to_string()))
}

#[tauri::command]
fn delete_markdown_file(file_path: String) -> Result<(), String> {
    remove_markdown_file(Path::new(&file_path))
}

#[tauri::command]
fn compile_markdown(
    markdown: String,
    mode: String,
    theme_id: Option<String>,
    base_dir: Option<String>,
) -> CompileResult {
    let base_path = base_dir
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(Path::new);
    compile_lecture_markdown_with_options(&markdown, &mode, theme_id.as_deref(), base_path)
}

#[tauri::command]
async fn pick_image_file(
    workspace_path: String,
    current_file_path: Option<String>,
) -> Option<String> {
    let base_dir = current_file_path
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .and_then(|p| Path::new(p).parent())
        .unwrap_or_else(|| Path::new(&workspace_path));

    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("埋め込む画像ファイルを選択 (JPEG / PNG / GIF / WebP / SVG)")
        .add_filter(
            "Image Files",
            &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
        );

    if base_dir.exists() && base_dir.is_dir() {
        dialog = dialog.set_directory(base_dir);
    }

    let handle = dialog.pick_file().await?;
    let picked = handle.path();

    // 基準ディレクトリの配下にある場合は相対パスに変換し、それ以外は絶対パスを返す
    let rel_or_abs = if let Ok(rel) = picked.strip_prefix(base_dir) {
        rel.to_string_lossy().replace('\\', "/")
    } else {
        picked.to_string_lossy().replace('\\', "/")
    };

    let stem = picked
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("画像");

    Some(format!("![{}]({})", stem, rel_or_abs))
}

#[tauri::command]
fn list_themes(workspace_path: String) -> Vec<ThemeInfo> {
    let ws = if workspace_path.trim().is_empty() {
        None
    } else {
        Some(Path::new(&workspace_path))
    };
    list_available_themes(ws)
}

#[tauri::command]
fn save_custom_theme(
    workspace_path: String,
    theme_id: String,
    css_content: String,
) -> Result<ThemeInfo, String> {
    save_custom_theme_file(Path::new(&workspace_path), &theme_id, &css_content)
}

fn default_export_dir_and_filename(
    source_path: Option<&str>,
    workspace_path: &str,
    mode: &str,
    extension: &str,
) -> (PathBuf, String) {
    let suffix = if mode == "slide" { "_slide" } else { "_doc" };
    if let Some(src) = source_path.filter(|s| !s.trim().is_empty()) {
        let p = Path::new(src);
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("lecture");
        let dir = p
            .parent()
            .unwrap_or_else(|| Path::new(workspace_path))
            .to_path_buf();
        (dir, format!("{}{}.{}", stem, suffix, extension))
    } else {
        (
            PathBuf::from(workspace_path),
            format!("lecture{}.{}", suffix, extension),
        )
    }
}

#[tauri::command]
async fn export_lecture_html(
    source_path: Option<String>,
    workspace_path: String,
    markdown: String,
    rendered_body_html: Option<String>,
    mode: String,
    theme_id: Option<String>,
    custom_css: Option<String>,
) -> Result<Option<ExportResult>, String> {
    let (default_dir, default_filename) =
        default_export_dir_and_filename(source_path.as_deref(), &workspace_path, &mode, "html");

    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("HTMLファイルの保存先を選択")
        .add_filter("HTML Document", &["html", "htm"])
        .set_file_name(&default_filename);

    if default_dir.exists() && default_dir.is_dir() {
        dialog = dialog.set_directory(&default_dir);
    }

    let Some(handle) = dialog.save_file().await else {
        return Ok(None);
    };
    let out_path = handle.path().to_path_buf();

    let compiled = compile_lecture_markdown(&markdown, &mode);
    let requested_theme = theme_id.as_deref().or(compiled.theme.as_deref());
    let (resolved_id, resolved_css) = resolve_theme_css(
        Some(Path::new(&workspace_path)),
        requested_theme,
        custom_css.as_deref(),
    );

    let full_html = build_standalone_html_with_base_dir(
        &markdown,
        rendered_body_html.as_deref(),
        &mode,
        Some(&resolved_id),
        Some(&resolved_css),
        Some(&default_dir),
    );
    write_file_utf8(&out_path, &full_html)?;
    let bytes = full_html.len() as u64;

    Ok(Some(ExportResult {
        output_path: out_path.to_string_lossy().to_string(),
        bytes_written: bytes,
        message: format!(
            "HTMLファイルを出力しました ({} Mode / Theme: {}, {:.1} KB)",
            if mode == "slide" { "スライド" } else { "ドキュメント" },
            resolved_id,
            bytes as f64 / 1024.0
        ),
    }))
}

#[tauri::command]
async fn export_lecture_pdf(
    source_path: Option<String>,
    workspace_path: String,
    markdown: String,
    rendered_body_html: Option<String>,
    mode: String,
    theme_id: Option<String>,
    custom_css: Option<String>,
) -> Result<Option<ExportResult>, String> {
    let (default_dir, default_filename) =
        default_export_dir_and_filename(source_path.as_deref(), &workspace_path, &mode, "pdf");

    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("PDFファイルの保存先を選択")
        .add_filter("PDF Document", &["pdf"])
        .set_file_name(&default_filename);

    if default_dir.exists() && default_dir.is_dir() {
        dialog = dialog.set_directory(&default_dir);
    }

    let Some(handle) = dialog.save_file().await else {
        return Ok(None);
    };
    let out_path = handle.path().to_path_buf();

    let compiled = compile_lecture_markdown(&markdown, &mode);
    let requested_theme = theme_id.as_deref().or(compiled.theme.as_deref());
    let (resolved_id, resolved_css) = resolve_theme_css(
        Some(Path::new(&workspace_path)),
        requested_theme,
        custom_css.as_deref(),
    );

    let full_html = build_standalone_html_with_base_dir(
        &markdown,
        rendered_body_html.as_deref(),
        &mode,
        Some(&resolved_id),
        Some(&resolved_css),
        Some(&default_dir),
    );
    let bytes = render_html_to_pdf(&full_html, &out_path)?;

    Ok(Some(ExportResult {
        output_path: out_path.to_string_lossy().to_string(),
        bytes_written: bytes,
        message: format!(
            "PDFファイルを出力しました ({} Mode / Theme: {}, {:.1} KB)",
            if mode == "slide" { "スライド" } else { "ドキュメント" },
            resolved_id,
            bytes as f64 / 1024.0
        ),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_default_workspace,
            get_parent_directory,
            inspect_dropped_path,
            reveal_in_file_explorer,
            pick_workspace_folder,
            pick_image_file,
            list_workspace_files,
            read_markdown_file,
            save_markdown_file,
            create_markdown_file,
            delete_markdown_file,
            compile_markdown,
            list_themes,
            save_custom_theme,
            export_lecture_html,
            export_lecture_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lectern Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_markdown_document_and_slide_modes_and_themes() {
        let md = r#"---
course: 情報工学特論
title: テスト講義
description: 本資料ではアルゴリズムの基礎を解説します。
author: 担当教員
date: 2026-11-17
theme: academic
---

# スライド1

インライン数式 $E = mc^2$ とディスプレイ数式:

$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

> [!IMPORTANT]
> 重要な定理の補足です。

---

# スライド2

```rust
fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

```mermaid
flowchart LR
    A --> B
```
"#;

        let doc_res = compile_lecture_markdown(md, "document");
        assert_eq!(doc_res.course, "情報工学特論");
        assert_eq!(doc_res.title, "テスト講義");
        assert_eq!(doc_res.description, "本資料ではアルゴリズムの基礎を解説します。");
        assert!(doc_res.html.contains("course-badge"));
        assert!(doc_res.html.contains("lecture-doc-description"));
        assert_eq!(doc_res.theme.as_deref(), Some("academic"));
        assert_eq!(doc_res.slide_count, 2);
        assert!(doc_res.html.contains("math-inline"));
        assert!(doc_res.html.contains("math-display"));
        assert!(doc_res.html.contains("callout-important"));
        assert!(doc_res.html.contains("code-block-wrapper"));
        assert!(doc_res.html.contains("mermaid-container"));

        let (resolved_id, resolved_css) =
            resolve_theme_css(None, doc_res.theme.as_deref(), Some(".custom-rule { color: red; }"));
        assert_eq!(resolved_id, "academic");
        assert!(resolved_css.contains("Hiragino Mincho ProN"));
        assert!(resolved_css.contains(".custom-rule"));

        let sample_dir = resolve_default_workspace();
        let md_with_img = format!(
            "{}\n\n![分割統治法](images/divide_and_conquer.png)\n\n<img src=\"images/divide_and_conquer.png\" width=\"300\" />",
            md
        );
        let standalone = build_standalone_html_with_base_dir(
            &md_with_img,
            None,
            "slide",
            Some(&resolved_id),
            Some(&resolved_css),
            Some(&sample_dir),
        );
        assert!(standalone.contains("data-lecture-theme=\"academic\""));
        assert!(standalone.contains(".custom-rule"));
        // 画像が Base64 Data URI として埋め込まれていること
        assert!(standalone.contains("data:image/png;base64,"));
        // KaTeX フォントも Base64 Data URI としてインライン埋め込みされ、外部 CDN スクリプト・CSS が一切ないこと
        assert!(standalone.contains("data:font/woff2;base64,"));
        assert!(!standalone.contains("https://cdn.jsdelivr.net"));
    }
}
