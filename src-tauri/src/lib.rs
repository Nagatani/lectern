pub mod converter;
pub mod fs_ops;
pub mod pdf;
pub mod themes;

use converter::{
    build_slideshow_html_with_base_dir, build_standalone_html_with_base_dir,
    compile_lecture_markdown, compile_lecture_markdown_with_options, CompileResult,
};
use fs_ops::{
    create_directory, create_new_markdown, delete_entry, list_markdown_workspace, read_file_utf8,
    remove_markdown_file, rename_entry, resolve_default_workspace, write_file_utf8, FileEntry,
};
use pdf::render_html_to_pdf;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};
use themes::{list_available_themes, resolve_theme_css, save_custom_theme_file, ThemeInfo};

struct RecentWorkspacesMenuState(Mutex<Vec<String>>);

#[derive(Debug, Clone, Serialize)]
struct MenuActionPayload {
    action: String,
    path: Option<String>,
}

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
    initial_content: Option<String>,
) -> Result<Option<String>, String> {
    // もし file_name が直接渡された場合はその名前で作成、渡されない場合は OS 標準の保存ダイアログを開く
    if let Some(name) = file_name.filter(|s| !s.trim().is_empty()) {
        let created = create_new_markdown(Path::new(&workspace_path), &name)?;
        if let Some(content) = initial_content {
            write_file_utf8(&created, &content)?;
        }
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
    let content_to_write = if let Some(content) = initial_content {
        content
    } else {
        let stem = target_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("新規講義資料");

        format!(
            "---\ncourse: 講義科目名\ntitle: {}\ndescription: この講義資料の概要や学習目標を簡潔に記述します。\nauthor: 担当教員\ndate: YYYY-MM-DD\ntheme: handout\n---\n\n# {}\n\nここに講義の導入や到達目標を記述します。\n\n> [!NOTE]\n> **ポイント**: 数式 $E = mc^2$ やコードブロック、Mermaid図表を記述できます。\n\n---\n\n# 2. 数式とアルゴリズムの例\n\n$$\n\\sum_{{i=1}}^{{n}} i = \\frac{{n(n+1)}}{{2}}\n$$\n\n```rust\nfn main() {{\n    println!(\"Hello, Lectern!\");\n}}\n```\n",
            stem, stem
        )
    };

    write_file_utf8(&target_path, &content_to_write)?;
    Ok(Some(target_path.to_string_lossy().to_string()))
}

#[tauri::command]
fn delete_markdown_file(file_path: String) -> Result<(), String> {
    remove_markdown_file(Path::new(&file_path))
}

#[tauri::command]
fn create_folder(parent_dir: String, name: String) -> Result<String, String> {
    let created = create_directory(Path::new(&parent_dir), &name)?;
    Ok(created.to_string_lossy().to_string())
}

#[tauri::command]
fn rename_workspace_entry(old_path: String, new_name: String) -> Result<String, String> {
    let renamed = rename_entry(Path::new(&old_path), &new_name)?;
    Ok(renamed.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_workspace_entry(target_path: String) -> Result<(), String> {
    delete_entry(Path::new(&target_path))
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
fn save_pasted_image(
    base_dir: String,
    image_bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    fs_ops::save_pasted_image(Path::new(&base_dir), &image_bytes, &ext)
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
    _mode: &str,
    extension: &str,
) -> (PathBuf, String) {
    if let Some(src) = source_path.filter(|s| !s.trim().is_empty()) {
        let p = Path::new(src);
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("lecture");
        let dir = p
            .parent()
            .unwrap_or_else(|| Path::new(workspace_path))
            .to_path_buf();
        (dir, format!("{}.{}", stem, extension))
    } else {
        (
            PathBuf::from(workspace_path),
            format!("lecture.{}", extension),
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
async fn export_lecture_slideshow_html(
    source_path: Option<String>,
    workspace_path: String,
    markdown: String,
    rendered_body_html: Option<String>,
    theme_id: Option<String>,
    custom_css: Option<String>,
) -> Result<Option<ExportResult>, String> {
    let (default_dir, default_filename) =
        default_export_dir_and_filename(source_path.as_deref(), &workspace_path, "slide", "html");

    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("スライドショー HTML ファイルの保存先を選択")
        .add_filter("HTML Slideshow", &["html", "htm"])
        .set_file_name(&default_filename);

    if default_dir.exists() && default_dir.is_dir() {
        dialog = dialog.set_directory(&default_dir);
    }

    let Some(handle) = dialog.save_file().await else {
        return Ok(None);
    };
    let out_path = handle.path().to_path_buf();

    let compiled = compile_lecture_markdown(&markdown, "slide");
    let requested_theme = theme_id.as_deref().or(compiled.theme.as_deref());
    let (resolved_id, resolved_css) = resolve_theme_css(
        Some(Path::new(&workspace_path)),
        requested_theme,
        custom_css.as_deref(),
    );

    let full_html = build_slideshow_html_with_base_dir(
        &markdown,
        rendered_body_html.as_deref(),
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
            "スライドショー HTML を出力しました (全 {} 枚 / Theme: {}, {:.1} KB)",
            compiled.slide_count,
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
    let out_path_for_pdf = out_path.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        render_html_to_pdf(&full_html, &out_path_for_pdf)
    })
    .await
    .map_err(|e| format!("PDF変換タスクの実行に失敗しました: {}", e))??;

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

fn format_recent_menu_label(dir_path: &str) -> String {
    let p = Path::new(dir_path);
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(dir_path);

    let short_path = if let Ok(home) = std::env::var("HOME") {
        if let Some(stripped) = dir_path.strip_prefix(&home) {
            format!("~{}", stripped)
        } else {
            dir_path.to_string()
        }
    } else {
        dir_path.to_string()
    };

    if name == short_path {
        name.to_string()
    } else {
        format!("{}  ({})", name, short_path)
    }
}

fn build_app_menu(app: &AppHandle, recent_paths: &[String]) -> tauri::Result<Menu<tauri::Wry>> {
    // 1. 最近開いたフォルダ サブメニュー
    let mut recent_sub = SubmenuBuilder::new(app, "最近開いたフォルダ");
    if recent_paths.is_empty() {
        let empty_item = MenuItemBuilder::with_id("recent:empty", "(履歴なし)")
            .enabled(false)
            .build(app)?;
        recent_sub = recent_sub.item(&empty_item);
    } else {
        for (idx, path) in recent_paths.iter().take(10).enumerate() {
            let label = format_recent_menu_label(path);
            let item = MenuItemBuilder::with_id(format!("recent:{}", idx), label).build(app)?;
            recent_sub = recent_sub.item(&item);
        }
    }
    let clear_recent = MenuItemBuilder::with_id("file:clear-recent", "履歴をクリア")
        .enabled(!recent_paths.is_empty())
        .build(app)?;
    let recent_submenu = recent_sub.separator().item(&clear_recent).build()?;

    // 2. ファイル メニュー
    let new_file = MenuItemBuilder::with_id("file:new", "新規作成...")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_folder = MenuItemBuilder::with_id("file:open-folder", "フォルダを開く...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save_file = MenuItemBuilder::with_id("file:save", "保存")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let export_html = MenuItemBuilder::with_id("file:export-html", "HTML として出力...")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let export_slideshow =
        MenuItemBuilder::with_id("file:export-slideshow", "スライドショー HTML として出力...")
            .accelerator("CmdOrCtrl+Shift+S")
            .build(app)?;
    let export_pdf = MenuItemBuilder::with_id("file:export-pdf", "PDF として出力...")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;
    let reveal_explorer =
        MenuItemBuilder::with_id("file:reveal-explorer", "Finder / エクスプローラーで表示")
            .accelerator("CmdOrCtrl+Shift+R")
            .build(app)?;

    #[allow(unused_mut)]
    let mut file_sub = SubmenuBuilder::new(app, "ファイル")
        .item(&new_file)
        .item(&open_folder)
        .item(&recent_submenu)
        .separator()
        .item(&save_file)
        .separator()
        .item(&export_html)
        .item(&export_slideshow)
        .item(&export_pdf)
        .separator()
        .item(&reveal_explorer);

    #[cfg(not(target_os = "macos"))]
    {
        file_sub = file_sub
            .separator()
            .item(&PredefinedMenuItem::quit(app, Some("終了"))?);
    }
    let file_submenu = file_sub.build()?;

    // 3. 編集 メニュー（OS標準の Undo/Redo/Cut/Copy/Paste/SelectAll + 検索置換・行操作・画像挿入）
    let find_item = MenuItemBuilder::with_id("edit:find", "検索...")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let replace_item = MenuItemBuilder::with_id("edit:replace", "置換...")
        .accelerator("CmdOrCtrl+H")
        .build(app)?;
    let goto_line = MenuItemBuilder::with_id("edit:goto-line", "指定行へ移動...")
        .accelerator("CmdOrCtrl+G")
        .build(app)?;
    let open_outline = MenuItemBuilder::with_id("edit:open-outline", "見出しアウトラインへ移動...")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let dup_line = MenuItemBuilder::with_id("edit:duplicate-line", "行を複製")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let del_line = MenuItemBuilder::with_id("edit:delete-line", "行を削除")
        .accelerator("CmdOrCtrl+Shift+K")
        .build(app)?;
    let insert_image = MenuItemBuilder::with_id("edit:insert-image", "画像を挿入...")
        .accelerator("CmdOrCtrl+Shift+I")
        .build(app)?;
    let edit_submenu = SubmenuBuilder::new(app, "編集")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find_item)
        .item(&replace_item)
        .item(&goto_line)
        .item(&open_outline)
        .separator()
        .item(&dup_line)
        .item(&del_line)
        .separator()
        .item(&insert_image)
        .build()?;

    // 4. 表示 メニュー
    let mode_doc = MenuItemBuilder::with_id("view:mode-document", "ドキュメント形式 (A4縦)")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let mode_slide = MenuItemBuilder::with_id("view:mode-slide", "スライド形式 (16:9)")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let toggle_sidebar =
        MenuItemBuilder::with_id("view:toggle-sidebar", "ファイル一覧の表示 / 非表示")
            .accelerator("CmdOrCtrl+B")
            .build(app)?;
    let toggle_preview =
        MenuItemBuilder::with_id("view:toggle-preview", "プレビューの表示 / 非表示")
            .accelerator("CmdOrCtrl+\\")
            .build(app)?;
    let edit_theme =
        MenuItemBuilder::with_id("view:edit-theme", "カスタム CSS テーマを編集...").build(app)?;
    let toggle_color_scheme =
        MenuItemBuilder::with_id("view:toggle-color-scheme", "ライト / ダークモード切替")
            .build(app)?;
    let open_logs = MenuItemBuilder::with_id("view:open-logs", "アクティビティログを表示...")
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;
    let open_settings_view = MenuItemBuilder::with_id("app:open-settings", "環境設定...")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let view_submenu = SubmenuBuilder::new(app, "表示")
        .item(&mode_doc)
        .item(&mode_slide)
        .separator()
        .item(&toggle_sidebar)
        .item(&toggle_preview)
        .separator()
        .item(&edit_theme)
        .item(&toggle_color_scheme)
        .separator()
        .item(&open_logs)
        .separator()
        .item(&open_settings_view)
        .build()?;

    // 5. ヘルプ メニュー
    let check_update_help =
        MenuItemBuilder::with_id("app:check-update", "アップデートを確認...").build(app)?;
    let open_manual =
        MenuItemBuilder::with_id("help:open-manual", "ユーザーマニュアル...").build(app)?;
    let open_help = MenuItemBuilder::with_id("help:open-guide", "Markdown 記法ガイド").build(app)?;
    let help_submenu = SubmenuBuilder::new(app, "ヘルプ")
        .item(&open_manual)
        .item(&open_help)
        .separator()
        .item(&check_update_help)
        .build()?;

    #[allow(unused_mut)]
    let mut root = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let check_update_app =
            MenuItemBuilder::with_id("app:check-update", "アップデートを確認...").build(app)?;
        let open_settings_app = MenuItemBuilder::with_id("app:open-settings", "環境設定...")
            .accelerator("CmdOrCtrl+,")
            .build(app)?;
        let app_submenu = SubmenuBuilder::new(app, "Lectern")
            .item(&PredefinedMenuItem::about(app, Some("Lectern について"), None)?)
            .item(&check_update_app)
            .separator()
            .item(&open_settings_app)
            .separator()
            .item(&PredefinedMenuItem::hide(app, Some("Lectern を隠す"))?)
            .item(&PredefinedMenuItem::hide_others(app, Some("ほかを隠す"))?)
            .item(&PredefinedMenuItem::show_all(app, Some("すべてを表示"))?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, Some("Lectern を終了"))?)
            .build()?;
        root = root.item(&app_submenu);
    }

    root.item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&help_submenu)
        .build()
}

#[tauri::command]
fn update_recent_workspaces_menu(
    app: AppHandle,
    state: State<'_, RecentWorkspacesMenuState>,
    recent_paths: Vec<String>,
) -> Result<(), String> {
    let trimmed: Vec<String> = recent_paths
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .take(10)
        .collect();

    if let Ok(mut guard) = state.0.lock() {
        *guard = trimmed.clone();
    }

    let menu = build_app_menu(&app, &trimmed)
        .map_err(|e| format!("メニューの構築に失敗しました: {}", e))?;
    app.set_menu(menu)
        .map_err(|e| format!("メニューの更新に失敗しました: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(RecentWorkspacesMenuState(Mutex::new(Vec::new())))
        .setup(|app| {
            let menu = build_app_menu(app.handle(), &[])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            if let Some(idx_str) = id.strip_prefix("recent:") {
                if let Ok(idx) = idx_str.parse::<usize>() {
                    let target_path = app
                        .state::<RecentWorkspacesMenuState>()
                        .0
                        .lock()
                        .ok()
                        .and_then(|list| list.get(idx).cloned());
                    if let Some(path) = target_path {
                        let _ = app.emit(
                            "menu-action",
                            MenuActionPayload {
                                action: "file:open-recent".to_string(),
                                path: Some(path),
                            },
                        );
                    }
                }
                return;
            }

            let _ = app.emit(
                "menu-action",
                MenuActionPayload {
                    action: id,
                    path: None,
                },
            );
        })
        .invoke_handler(tauri::generate_handler![
            get_default_workspace,
            get_parent_directory,
            inspect_dropped_path,
            reveal_in_file_explorer,
            pick_workspace_folder,
            pick_image_file,
            save_pasted_image,
            list_workspace_files,
            read_markdown_file,
            save_markdown_file,
            create_markdown_file,
            delete_markdown_file,
            create_folder,
            rename_workspace_entry,
            delete_workspace_entry,
            compile_markdown,
            list_themes,
            save_custom_theme,
            export_lecture_html,
            export_lecture_slideshow_html,
            export_lecture_pdf,
            update_recent_workspaces_menu,
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

    #[test]
    fn test_cjk_emphasis_and_inline_code_without_spaces() {
        let md = r#"これは**「重要」**なポイントです。

配列の**サイズ(N)**を計算します。

**C++**や**Rust**を学びます。

これは**「`code`」**です。

これは~~「取り消し」~~です。

これは`println!`です。関数`foo()`と`「バー」`を呼ぶ。

インラインコード内の`**not bold**`は変換しない。

```rust
let ptr = **x;
```
"#;

        let res = compile_lecture_markdown(md, "document");
        assert!(res.html.contains("これは<strong>「重要」</strong>なポイントです。"), "html={}", res.html);
        assert!(res.html.contains("配列の<strong>サイズ(N)</strong>を計算します。"), "html={}", res.html);
        assert!(res.html.contains("<strong>C++</strong>や<strong>Rust</strong>を学びます。"), "html={}", res.html);
        assert!(res.html.contains("これは<strong>「<code>code</code>」</strong>です。"), "html={}", res.html);
        assert!(res.html.contains("これは<del>「取り消し」</del>です。"), "html={}", res.html);
        assert!(res.html.contains("これは<code>println!</code>です。"), "html={}", res.html);
        assert!(res.html.contains("関数<code>foo()</code>と<code>「バー」</code>を呼ぶ。"), "html={}", res.html);
        assert!(res.html.contains("<code>**not bold**</code>"), "html={}", res.html);
        assert!(!res.html.contains("<strong>not bold</strong>"), "html={}", res.html);

        // チェックボックス（タスクリスト）が disabled なしでインタラクティブに出力されること
        let task_md = "- [ ] 未確認項目\n- [x] 確認済み項目\n";
        let task_res = compile_lecture_markdown(task_md, "document");
        assert!(task_res
            .html
            .contains(r#"<input type="checkbox" class="task-list-checkbox" aria-label="タスクの完了状態" />"#));
        assert!(task_res
            .html
            .contains(r#"<input type="checkbox" class="task-list-checkbox" aria-label="タスクの完了状態" checked />"#));
        assert!(!task_res.html.contains("disabled"));
    }

    #[test]
    fn test_nested_markdown_code_blocks_and_escaped_fences() {
        // 1. 4連バッククォートでネストされた Markdown コードブロック（内部に ``` / > [!NOTE] / --- を含む）
        let nested_4 = "````markdown\n# 例\n\n> [!NOTE]\n> サンプル\n\n---\n\n```rust\nfn main() {}\n```\n````\n";
        let res_slide = compile_lecture_markdown(nested_4, "slide");
        assert_eq!(res_slide.slide_count, 1, "コードブロック内の --- でスライド分割されてはならない");
        assert!(
            !res_slide.html.contains(r#"class="callout callout-note""#),
            "コードブロック内の > [!NOTE] がコールアウトHTMLに変換されてはならない: {}",
            res_slide.html
        );
        assert!(
            res_slide.html.contains("```</span>") && res_slide.html.contains("rust"),
            "ネストされた ```rust がそのまま出力されること: {}",
            res_slide.html
        );

        // 2. ```markdown 内でバックスラッシュエスケープされた \`\`\` / \``` が復元されて出力されること
        let escaped_md = "```markdown\n\\`\\`\\`rust\nfn hi() {}\n\\`\\`\\`\n\\```python\nprint(1)\n\\```\n```\n";
        let res_esc = compile_lecture_markdown(escaped_md, "document");
        assert!(res_esc.html.contains("```</span>") && res_esc.html.contains("rust"), "html={}", res_esc.html);
        assert!(res_esc.html.contains("python"), "html={}", res_esc.html);
        assert!(!res_esc.html.contains(r"\`\`\`"), "エスケープ記号が残ってはならない: {}", res_esc.html);
        assert!(!res_esc.html.contains(r"\```"), "エスケープ記号が残ってはならない: {}", res_esc.html);
    }

    #[test]
    fn test_slideshow_standalone_html_generation() {
        let md = "# スライド1\n\n内容A\n\n---\n\n# スライド2\n\n数式 $E=mc^2$\n";
        let (id, css) = resolve_theme_css(None, Some("midnight"), None);
        let html = build_slideshow_html_with_base_dir(md, None, Some(&id), Some(&css), None);
        assert!(html.contains("mode-slideshow"));
        assert!(html.contains("lectern-slideshow-css"));
        assert!(html.contains("slideshow-hud"));
        assert!(html.contains("ss-overview"));
        assert!(html.contains("ss-fullscreen"));
        assert!(html.contains("data:font/woff2;base64,"));
        assert!(!html.contains("https://cdn.jsdelivr.net"));
    }
}
