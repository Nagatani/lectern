use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub can_open: bool,
    pub extension: Option<String>,
}

/// プロジェクト同梱の `sample-lectures` またはユーザーの Documents/LectureMD-Studio をデフォルトワークスペースとして返す
pub fn resolve_default_workspace() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest_dir.parent() {
        let sample_dir = parent.join("sample-lectures");
        if sample_dir.exists() {
            return sample_dir;
        }
    }

    // パッケージ化された .app / .exe 単体起動時のフォールバック: ~/Documents/Lectern
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let user_ws = home.join("Documents").join("Lectern");
    if !user_ws.exists() {
        let _ = fs::create_dir_all(&user_ws);
        let _ = create_new_markdown(&user_ws, "01_welcome_lecture.md");
    }
    user_ws
}

/// 指定ディレクトリ直下のサブフォルダおよびすべての通常ファイルを走査して返す
/// Markdown (`.md` / `.markdown`) のみ `can_open = true` とする
pub fn list_markdown_workspace(workspace_path: &Path) -> Result<Vec<FileEntry>, String> {
    if !workspace_path.exists() {
        return Err(format!(
            "指定されたフォルダが存在しません: {}",
            workspace_path.display()
        ));
    }

    let mut entries = Vec::new();
    collect_entries(workspace_path, &mut entries)?;
    Ok(entries)
}

fn is_openable_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

fn collect_entries(current: &Path, out: &mut Vec<FileEntry>) -> Result<(), String> {
    let read_dir = fs::read_dir(current).map_err(|e| {
        format!(
            "ディレクトリの読み込みに失敗しました ({}): {}",
            current.display(),
            e
        )
    })?;

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for item in read_dir.flatten() {
        let path = item.path();
        let file_name = item.file_name().to_string_lossy().to_string();

        // 隠しファイルや node_modules / target / dist は除外
        if file_name.starts_with('.')
            || file_name == "node_modules"
            || file_name == "target"
            || file_name == "dist"
        {
            continue;
        }

        if path.is_dir() {
            dirs.push((file_name, path));
        } else if path.is_file() {
            let can_open = is_openable_markdown(&path);
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_lowercase());
            files.push((file_name, path, can_open, extension));
        }
    }

    dirs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    files.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    // ディレクトリを先頭に配置
    for (name, path) in dirs {
        out.push(FileEntry {
            name: name.clone(),
            path: path.to_string_lossy().to_string(),
            rel_path: name,
            is_dir: true,
            can_open: false,
            extension: None,
        });
    }

    // すべてのファイル（開ける Markdown と開けないファイルの両方）を続けて配置
    for (name, path, can_open, extension) in files {
        out.push(FileEntry {
            name: name.clone(),
            path: path.to_string_lossy().to_string(),
            rel_path: name,
            is_dir: false,
            can_open,
            extension,
        });
    }

    Ok(())
}

pub fn read_file_utf8(file_path: &Path) -> Result<String, String> {
    fs::read_to_string(file_path)
        .map_err(|e| format!("ファイルの読み込みに失敗しました ({}): {}", file_path.display(), e))
}

pub fn write_file_utf8(file_path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("親ディレクトリの作成に失敗しました: {}", e))?;
    }
    fs::write(file_path, content)
        .map_err(|e| format!("ファイルの保存に失敗しました ({}): {}", file_path.display(), e))
}

pub fn create_new_markdown(workspace_path: &Path, file_name: &str) -> Result<PathBuf, String> {
    let clean_name = file_name.trim().trim_start_matches(['/', '\\']);
    if clean_name.is_empty() {
        return Err("ファイル名が空です".to_string());
    }

    let final_name = if clean_name.ends_with(".md") || clean_name.ends_with(".markdown") {
        clean_name.to_string()
    } else {
        format!("{}.md", clean_name)
    };

    let target_path = workspace_path.join(&final_name);
    if target_path.exists() {
        return Err(format!("既に同名のファイルが存在します: {}", final_name));
    }

    let stem = target_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("新規講義資料");

    let initial_template = format!(
        "---\ncourse: 講義科目名\ntitle: {}\ndescription: この講義資料の概要や学習目標を簡潔に記述します。\nauthor: 担当教員\ndate: 2026-11-19\ntheme: handout\n---\n\n# {}\n\nここに講義の導入や到達目標を記述します。\n\n> [!NOTE]\n> **ポイント**: 数式 $E = mc^2$ やコードブロック、Mermaid図表を記述できます。\n\n---\n\n# 2. 数式とアルゴリズムの例\n\n$$\n\\sum_{{i=1}}^{{n}} i = \\frac{{n(n+1)}}{{2}}\n$$\n\n```rust\nfn main() {{\n    println!(\"Hello, Lectern!\");\n}}\n```\n",
        stem, stem
    );

    write_file_utf8(&target_path, &initial_template)?;
    Ok(target_path)
}

pub fn remove_markdown_file(file_path: &Path) -> Result<(), String> {
    if !file_path.exists() {
        return Err("削除対象のファイルが見つかりません".to_string());
    }
    fs::remove_file(file_path)
        .map_err(|e| format!("ファイルの削除に失敗しました: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_openable_and_non_openable_files_and_dirs() {
        let tmp = std::env::temp_dir().join(format!(
            "lectern_fs_ops_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("sub_folder")).unwrap();
        fs::write(tmp.join("01_intro.md"), "# Intro").unwrap();
        fs::write(tmp.join("02_notes.MARKDOWN"), "# Notes").unwrap();
        fs::write(tmp.join("diagram.png"), b"png").unwrap();
        fs::write(tmp.join("handout.pdf"), b"pdf").unwrap();
        fs::write(tmp.join(".hidden.md"), "hidden").unwrap();

        let entries = list_markdown_workspace(&tmp).unwrap();
        let _ = fs::remove_dir_all(&tmp);

        assert_eq!(entries.len(), 5);
        assert!(entries[0].is_dir && entries[0].name == "sub_folder" && !entries[0].can_open);

        let intro = entries.iter().find(|e| e.name == "01_intro.md").unwrap();
        assert!(intro.can_open);
        assert_eq!(intro.extension.as_deref(), Some("md"));

        let notes = entries.iter().find(|e| e.name == "02_notes.MARKDOWN").unwrap();
        assert!(notes.can_open);
        assert_eq!(notes.extension.as_deref(), Some("markdown"));

        let png = entries.iter().find(|e| e.name == "diagram.png").unwrap();
        assert!(!png.can_open);
        assert_eq!(png.extension.as_deref(), Some("png"));

        let pdf = entries.iter().find(|e| e.name == "handout.pdf").unwrap();
        assert!(!pdf.can_open);
        assert_eq!(pdf.extension.as_deref(), Some("pdf"));
    }
}
