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

fn validate_entry_name(raw_name: &str) -> Result<String, String> {
    let clean = raw_name.trim();
    if clean.is_empty() {
        return Err("名前が空です".to_string());
    }
    if clean == "." || clean == ".." {
        return Err("「.」や「..」は名前として使用できません".to_string());
    }
    if clean.contains('/') || clean.contains('\\') || clean.contains('\0') {
        return Err("名前にパス区切り文字 (/ や \\) は使用できません".to_string());
    }
    Ok(clean.to_string())
}

/// 指定された親ディレクトリ直下に新しいサブフォルダを安全に作成する
pub fn create_directory(parent_dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !parent_dir.exists() {
        return Err(format!(
            "親ディレクトリが存在しません: {}",
            parent_dir.display()
        ));
    }
    if !parent_dir.is_dir() {
        return Err(format!(
            "親パスはディレクトリではありません: {}",
            parent_dir.display()
        ));
    }

    let clean_name = validate_entry_name(name)?;
    let target_path = parent_dir.join(&clean_name);
    if target_path.exists() {
        return Err(format!(
            "既に同名のファイルまたはフォルダが存在します: {}",
            clean_name
        ));
    }

    fs::create_dir(&target_path).map_err(|e| {
        format!(
            "フォルダの作成に失敗しました ({}): {}",
            target_path.display(),
            e
        )
    })?;
    Ok(target_path)
}

/// ファイルまたはフォルダを同一親ディレクトリ内で安全にリネームする
pub fn rename_entry(old_path: &Path, new_name: &str) -> Result<PathBuf, String> {
    if !old_path.exists() {
        return Err(format!(
            "リネーム対象が見つかりません: {}",
            old_path.display()
        ));
    }

    let clean_name = validate_entry_name(new_name)?;
    let parent = old_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "親ディレクトリを特定できません".to_string())?;

    let new_path = parent.join(&clean_name);
    if old_path == new_path {
        return Ok(new_path);
    }

    let is_case_only_rename = old_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|old_name| old_name.eq_ignore_ascii_case(&clean_name) && old_name != clean_name)
        .unwrap_or(false);

    if new_path.exists() && !is_case_only_rename {
        return Err(format!(
            "既に同名のファイルまたはフォルダが存在します: {}",
            clean_name
        ));
    }

    fs::rename(old_path, &new_path).map_err(|e| {
        format!(
            "名前の変更に失敗しました ({} -> {}): {}",
            old_path.display(),
            new_path.display(),
            e
        )
    })?;
    Ok(new_path)
}

/// ファイルまたはフォルダ（空・非空どちらも）を安全に削除する
pub fn delete_entry(target_path: &Path) -> Result<(), String> {
    if target_path.as_os_str().is_empty() || target_path.parent().is_none() {
        return Err("ルートディレクトリは削除できません".to_string());
    }

    let meta = fs::symlink_metadata(target_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("削除対象が見つかりません: {}", target_path.display())
        } else {
            format!(
                "削除対象の情報を取得できませんでした ({}): {}",
                target_path.display(),
                e
            )
        }
    })?;

    if meta.is_dir() {
        fs::remove_dir_all(target_path).map_err(|e| {
            format!(
                "フォルダの削除に失敗しました ({}): {}",
                target_path.display(),
                e
            )
        })
    } else {
        fs::remove_file(target_path).map_err(|e| {
            format!(
                "ファイルの削除に失敗しました ({}): {}",
                target_path.display(),
                e
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn make_temp_dir(label: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "lectern_fs_ops_{}_{}_{}",
            label,
            std::process::id(),
            id
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_openable_and_non_openable_files_and_dirs() {
        let tmp = make_temp_dir("list");
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

    #[test]
    fn list_markdown_workspace_errors_on_missing_directory() {
        let missing = std::env::temp_dir().join(format!(
            "lectern_fs_ops_nonexistent_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&missing);
        let err = list_markdown_workspace(&missing).unwrap_err();
        assert!(err.contains("存在しません"));
    }

    #[test]
    fn create_directory_creates_and_validates() {
        let tmp = make_temp_dir("mkdir");

        let created = create_directory(&tmp, "week01").unwrap();
        assert!(created.exists() && created.is_dir());
        assert_eq!(created.file_name().and_then(|n| n.to_str()), Some("week01"));

        // Duplicate name rejected
        let dup_err = create_directory(&tmp, "week01").unwrap_err();
        assert!(dup_err.contains("既に同名"));

        // Invalid names rejected
        assert!(create_directory(&tmp, "   ").is_err());
        assert!(create_directory(&tmp, "..").is_err());
        assert!(create_directory(&tmp, ".").is_err());
        assert!(create_directory(&tmp, "a/b").is_err());
        assert!(create_directory(&tmp, "a\\b").is_err());

        // Non-existent parent rejected
        assert!(create_directory(&tmp.join("missing_parent"), "child").is_err());

        // File as parent rejected
        let file_path = tmp.join("note.md");
        fs::write(&file_path, "# hi").unwrap();
        assert!(create_directory(&file_path, "child").is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn rename_entry_renames_files_and_dirs_safely() {
        let tmp = make_temp_dir("rename");
        let file_a = tmp.join("draft.md");
        let file_b = tmp.join("existing.md");
        fs::write(&file_a, "# Draft").unwrap();
        fs::write(&file_b, "# Existing").unwrap();

        // Rename file
        let renamed = rename_entry(&file_a, "final.md").unwrap();
        assert!(!file_a.exists());
        assert!(renamed.exists());
        assert_eq!(fs::read_to_string(&renamed).unwrap(), "# Draft");

        // Same-name rename is a no-op
        let same = rename_entry(&renamed, "final.md").unwrap();
        assert_eq!(same, renamed);

        // Collision rejected
        let col_err = rename_entry(&renamed, "existing.md").unwrap_err();
        assert!(col_err.contains("既に同名"));

        // Invalid names rejected
        assert!(rename_entry(&renamed, "").is_err());
        assert!(rename_entry(&renamed, "../escape.md").is_err());
        assert!(rename_entry(&renamed, "sub/file.md").is_err());

        // Rename directory
        let dir_old = tmp.join("old_dir");
        fs::create_dir_all(&dir_old).unwrap();
        fs::write(dir_old.join("inside.md"), "ok").unwrap();
        let dir_new = rename_entry(&dir_old, "new_dir").unwrap();
        assert!(!dir_old.exists());
        assert!(dir_new.join("inside.md").exists());

        // Missing source rejected
        assert!(rename_entry(&tmp.join("nope.md"), "other.md").is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn delete_entry_deletes_files_empty_dirs_and_non_empty_dirs() {
        let tmp = make_temp_dir("delete");

        // Delete regular file
        let f = tmp.join("remove_me.md");
        fs::write(&f, "bye").unwrap();
        delete_entry(&f).unwrap();
        assert!(!f.exists());

        // Delete empty directory
        let empty_dir = tmp.join("empty_dir");
        fs::create_dir(&empty_dir).unwrap();
        delete_entry(&empty_dir).unwrap();
        assert!(!empty_dir.exists());

        // Delete non-empty directory recursively
        let nested_dir = tmp.join("nested_dir");
        fs::create_dir_all(nested_dir.join("sub")).unwrap();
        fs::write(nested_dir.join("sub").join("lecture.md"), "# Lecture").unwrap();
        delete_entry(&nested_dir).unwrap();
        assert!(!nested_dir.exists());

        // Missing path rejected
        let missing_err = delete_entry(&tmp.join("ghost.md")).unwrap_err();
        assert!(missing_err.contains("見つかりません"));

        // Root path rejected
        assert!(delete_entry(Path::new("/")).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
