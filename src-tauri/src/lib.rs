pub mod converter;
pub mod fs_ops;
pub mod pdf;

use converter::{build_standalone_html, compile_lecture_markdown, CompileResult};
use fs_ops::{
    create_new_markdown, list_markdown_workspace, read_file_utf8, remove_markdown_file,
    resolve_default_workspace, write_file_utf8, FileEntry,
};
use pdf::render_html_to_pdf;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub output_path: String,
    pub bytes_written: u64,
    pub message: String,
}

#[tauri::command]
fn get_default_workspace() -> String {
    resolve_default_workspace().to_string_lossy().to_string()
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
fn create_markdown_file(workspace_path: String, file_name: String) -> Result<String, String> {
    let created = create_new_markdown(Path::new(&workspace_path), &file_name)?;
    Ok(created.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_markdown_file(file_path: String) -> Result<(), String> {
    remove_markdown_file(Path::new(&file_path))
}

#[tauri::command]
fn compile_markdown(markdown: String, mode: String) -> CompileResult {
    compile_lecture_markdown(&markdown, &mode)
}

fn determine_export_path(
    source_path: Option<&str>,
    workspace_path: &str,
    mode: &str,
    extension: &str,
) -> PathBuf {
    let suffix = if mode == "slide" { "_slide" } else { "_doc" };
    if let Some(src) = source_path.filter(|s| !s.trim().is_empty()) {
        let p = Path::new(src);
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("lecture");
        let parent = p.parent().unwrap_or_else(|| Path::new(workspace_path));
        parent.join("exports").join(format!("{}{}.{}", stem, suffix, extension))
    } else {
        Path::new(workspace_path)
            .join("exports")
            .join(format!("lecture{}.{}", suffix, extension))
    }
}

#[tauri::command]
fn export_lecture_html(
    source_path: Option<String>,
    workspace_path: String,
    markdown: String,
    rendered_body_html: Option<String>,
    mode: String,
) -> Result<ExportResult, String> {
    let out_path = determine_export_path(source_path.as_deref(), &workspace_path, &mode, "html");
    let full_html = build_standalone_html(&markdown, rendered_body_html.as_deref(), &mode);
    write_file_utf8(&out_path, &full_html)?;
    let bytes = full_html.len() as u64;

    Ok(ExportResult {
        output_path: out_path.to_string_lossy().to_string(),
        bytes_written: bytes,
        message: format!(
            "HTMLファイルを出力しました ({} Mode, {:.1} KB)",
            if mode == "slide" { "スライド" } else { "ドキュメント" },
            bytes as f64 / 1024.0
        ),
    })
}

#[tauri::command]
fn export_lecture_pdf(
    source_path: Option<String>,
    workspace_path: String,
    markdown: String,
    rendered_body_html: Option<String>,
    mode: String,
) -> Result<ExportResult, String> {
    let out_path = determine_export_path(source_path.as_deref(), &workspace_path, &mode, "pdf");
    let full_html = build_standalone_html(&markdown, rendered_body_html.as_deref(), &mode);
    let bytes = render_html_to_pdf(&full_html, &out_path)?;

    Ok(ExportResult {
        output_path: out_path.to_string_lossy().to_string(),
        bytes_written: bytes,
        message: format!(
            "PDFファイルを出力しました ({} Mode, {:.1} KB)",
            if mode == "slide" { "スライド" } else { "ドキュメント" },
            bytes as f64 / 1024.0
        ),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_default_workspace,
            list_workspace_files,
            read_markdown_file,
            save_markdown_file,
            create_markdown_file,
            delete_markdown_file,
            compile_markdown,
            export_lecture_html,
            export_lecture_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LectureMD Studio Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_markdown_document_and_slide_modes() {
        let md = r#"---
title: テスト講義
author: 担当教員
date: 2026-11-17
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
        assert_eq!(doc_res.title, "テスト講義");
        assert_eq!(doc_res.slide_count, 2);
        assert!(doc_res.html.contains("math-inline"));
        assert!(doc_res.html.contains("math-display"));
        assert!(doc_res.html.contains("callout-important"));
        assert!(doc_res.html.contains("code-block-wrapper"));
        assert!(doc_res.html.contains("mermaid-container"));

        let slide_res = compile_lecture_markdown(md, "slide");
        assert_eq!(slide_res.slide_count, 2);
        assert!(slide_res.html.contains("data-slide-index=\"0\""));
        assert!(slide_res.html.contains("data-slide-index=\"1\""));
    }
}
