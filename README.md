# Lectern — Rust + Tauri 講義資料エディタ & HTML/PDF 変換ツール

**Lectern**（演台・書見台）は、Rust (`pulldown-cmark` + `syntect`) と Tauri v2 (Vanilla TypeScript フロントエンド) で構築された、マークダウン講義資料の作成・リアルタイムプレビュー・HTML/PDF変換デスクトップアプリケーションです。

## 主な機能

1. **ドキュメント形式 (A4縦) & スライド形式 (16:9 横長) のワンクリック切り替え**
   - 同じ Markdown ファイルから、配布資料・教科書風の **ドキュメント表示** と、プレゼンテーション用の **16:9 スライド表示** (`---` でページ分割) を即座に切り替えられます。
2. **講義資料に必須の拡張記法をサポート**
   - **数式表示 (KaTeX)**: インライン数式 `$E = mc^2$` およびディスプレイ数式 `$$ ... $$`
   - **コードのシンタックスハイライト (`syntect`)**: Rust バックエンド側で高速に色付け
   - **図表描画 (Mermaid.js)**: フローチャート、シーケンス図、状態遷移図などをリアルタイム描画
   - **コールアウト枠**: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` による定理・補足・演習問題枠
   - **2段組レイアウト**: `<div class="lecture-columns">...</div>` スニペットをワンクリック挿入
3. **3ペイン GUI エディタ & ファイルブラウザ**
   - 左ペイン: ワークスペースフォルダ内の `.md` ファイル・サブフォルダ一覧ツリー、新規作成・削除・フォルダ切り替え
   - 中央ペイン: 行番号付き Markdown エディタ、クイック挿入バー、`Cmd+S` / `Ctrl+S` ショートカット保存
   - 右ペイン: リアルタイムプレビュー、スライド送りナビゲーション（単一表示 / 一覧表示切り替え）
4. **高品質 HTML / PDF エクスポート (GUI & CLI 両対応)**
   - **HTML出力**: スタイル・数式・SVG図表を含んだ自己完結型 HTML ファイルを `exports/` フォルダに出力
   - **PDF出力**: システムの Chromium / Google Chrome / Microsoft Edge のヘッドレス印刷エンジンを呼び出し、プレビューの見た目をそのまま高品質な A4 縦 または 16:9 横長スライド PDF として出力

---

## 起動・ビルド方法

### 1. GUI アプリとして開発起動
```bash
npm install
npm run tauri dev
```

### 2. CLI (コマンドライン) から直接 HTML / PDF 変換
```bash
cd src-tauri

# ドキュメント形式 (A4縦) で HTML と PDF を生成
cargo run -- --cli ../sample-lectures/01_algorithms_and_complexity.md --mode document --output ../sample-lectures/exports/01_doc.html
cargo run -- --cli ../sample-lectures/01_algorithms_and_complexity.md --mode document --output ../sample-lectures/exports/01_doc.pdf

# スライド形式 (16:9) で HTML と PDF を生成
cargo run -- --cli ../sample-lectures/01_algorithms_and_complexity.md --mode slide --output ../sample-lectures/exports/01_slide.html
cargo run -- --cli ../sample-lectures/01_algorithms_and_complexity.md --mode slide --output ../sample-lectures/exports/01_slide.pdf
```

---

## パッケージング（macOS の `.app` 化 / Windows の `.exe` 化）

### 1. macOS で `.app` / `.dmg` を作成する
```bash
# .app バンドルのみを高速生成する場合
npm run tauri build -- --bundles app

# .app とインストーラ (.dmg) の両方を生成する場合
npm run tauri build
```
- **生成先**:
  - アプリ本体: `src-tauri/target/release/bundle/macos/Lectern.app`
  - 単体バイナリ: `src-tauri/target/release/lectern`

### 2. Windows で `.exe` / `.msi` を作成する

#### 方法 A: GitHub Actions を使って自動生成する（Windows 実機不要）
同梱の `.github/workflows/release-build.yml` により、GitHub リポジトリに push して Actions を実行するだけで、Windows 用 `lectern.exe` / セットアップ `.exe` / `.msi` と macOS 用 `Lectern.app` / `.dmg` が自動ビルドされます。

#### 方法 B: Windows PC 上でビルドする
```powershell
npm install
npm run tauri build
```
- **生成先**:
  - ポータブル実行ファイル: `src-tauri\target\release\lectern.exe`
  - NSIS セットアップ `.exe`: `src-tauri\target\release\bundle\nsis\Lectern_0.1.0_x64-setup.exe`
  - MSI インストーラ: `src-tauri\target\release\bundle\msi\Lectern_0.1.0_x64_en-US.msi`
