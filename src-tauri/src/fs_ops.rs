use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub rel_path: String,
    pub is_dir: bool,
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

/// 指定ディレクトリ内の `.md` ファイルおよびサブフォルダを再帰的に走査する（最大深さ3）
pub fn list_markdown_workspace(workspace_path: &Path) -> Result<Vec<FileEntry>, String> {
    if !workspace_path.exists() {
        return Err(format!(
            "指定されたフォルダが存在しません: {}",
            workspace_path.display()
        ));
    }

    let mut entries = Vec::new();
    collect_entries(workspace_path, workspace_path, 0, &mut entries)?;
    Ok(entries)
}

fn collect_entries(
    root: &Path,
    current: &Path,
    depth: usize,
    out: &mut Vec<FileEntry>,
) -> Result<(), String> {
    if depth > 3 {
        return Ok(());
    }

    let read_dir = fs::read_dir(current)
        .map_err(|e| format!("ディレクトリの読み込みに失敗しました ({}): {}", current.display(), e))?;

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
        } else if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
            .unwrap_or(false)
        {
            files.push((file_name, path));
        }
    }

    dirs.sort_by(|a, b| a.0.cmp(&b.0));
    files.sort_by(|a, b| a.0.cmp(&b.0));

    for (name, path) in files {
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        out.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            rel_path: rel,
            is_dir: false,
        });
    }

    for (name, path) in dirs {
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        out.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            rel_path: rel,
            is_dir: true,
        });
        collect_entries(root, &path, depth + 1, out)?;
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
        "---\ntitle: {}\nauthor: 講義資料\ndate: 2026-11-17\n---\n\n# {}\n\nここに講義の導入や到達目標を記述します。\n\n> [!NOTE]\n> **ポイント**: 数式 $E = mc^2$ やコードブロック、Mermaid図表を記述できます。\n\n---\n\n# 2. 数式とアルゴリズムの例\n\n$$\n\\sum_{{i=1}}^{{n}} i = \\frac{{n(n+1)}}{{2}}\n$$\n\n```rust\nfn main() {{\n    println!(\"Hello, Lectern!\");\n}}\n```\n",
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
