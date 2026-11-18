use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// システムにインストールされている Chromium 系ブラウザ (macOS / Windows / Linux) の実行ファイルパスを検索する
pub fn detect_chromium_binary() -> Option<PathBuf> {
    let candidates = [
        // macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        // Windows (Standard Program Files & Edge pre-installed on Windows 10/11)
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        // Linux
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
    ];

    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }

    // Windows ユーザーローカルの AppData 配下にインストールされた Chrome / Edge もチェック
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let local_candidates = [
            PathBuf::from(&local_app_data).join(r"Google\Chrome\Application\chrome.exe"),
            PathBuf::from(&local_app_data).join(r"Microsoft\Edge\Application\msedge.exe"),
        ];
        for p in local_candidates {
            if p.exists() {
                return Some(p);
            }
        }
    }

    None
}

/// スタンドアロンHTML文字列を一時ファイルに書き出し、ブラウザのHeadless印刷エンジンで高品質PDFに変換する
pub fn render_html_to_pdf(html_content: &str, output_pdf_path: &Path) -> Result<u64, String> {
    let browser_bin = detect_chromium_binary().ok_or_else(|| {
        "PDF変換用のブラウザエンジン (Google Chrome / Microsoft Edge / Chromium) が見つかりませんでした。"
            .to_string()
    })?;

    if let Some(parent) = output_pdf_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("出力先ディレクトリの作成に失敗しました: {}", e))?;
    }

    // 一時HTMLファイルを生成
    let temp_dir = std::env::temp_dir();
    let temp_html_path = temp_dir.join(format!("lectern_export_{}.html", std::process::id()));
    fs::write(&temp_html_path, html_content)
        .map_err(|e| format!("一時HTMLファイルの書き込みに失敗しました: {}", e))?;

    let file_url = if cfg!(target_os = "windows") {
        format!(
            "file:///{}",
            temp_html_path.to_string_lossy().replace('\\', "/")
        )
    } else {
        format!("file://{}", temp_html_path.to_string_lossy())
    };

    let mut cmd = Command::new(&browser_bin);
    cmd.arg("--headless")
        .arg("--disable-gpu")
        .arg("--no-pdf-header-footer")
        .arg("--print-to-pdf-no-header")
        .arg(format!("--print-to-pdf={}", output_pdf_path.to_string_lossy()))
        .arg(&file_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Windows でサブプロセス起動時に黒いコンソール画面 (cmd.exe) が一瞬出るのを防止
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let status = cmd
        .status()
        .map_err(|e| format!("ブラウザ印刷エンジンの起動に失敗しました: {}", e))?;

    let _ = fs::remove_file(&temp_html_path);

    if !status.success() {
        return Err(format!(
            "PDF生成プロセスがエラーコードで終了しました: {:?}",
            status.code()
        ));
    }

    let meta = fs::metadata(output_pdf_path)
        .map_err(|e| format!("生成されたPDFファイルの情報取得に失敗しました: {}", e))?;

    Ok(meta.len())
}
