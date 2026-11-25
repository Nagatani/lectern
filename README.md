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
4. **カスタムCSS テーマ切り替え機能 (プレビュー・HTML出力・PDF出力完全対応)**
   - **標準プリセット5種**:
     - `handout` (**Handout — 講義レジュメ・明朝**): 角ゴシック見出し＋明朝体本文・赤字強調の標準講義ハンドアウトテーマ（デフォルト）
     - `default` (**Modern — モダン・サンセリフ**): 視認性の高いブルー系サンセリフテーマ
     - `academic` (**Academic — 論文・モノグラフ**): 明朝体 / セリフフォント、エンジ系アクセントの重厚な学術テーマ
     - `chalkboard` (**Chalkboard — 黒板・チョーク**): 深緑の黒板背景とチョーク風配色
     - `midnight` (**Midnight — ダーク・プロジェクター**): ダークネイビー背景＋シアン/パープル配色
   - **`themes/*.css` 自動読み込み & GUI 上での CSS 編集・保存**:
     - ワークスペース内の `themes/` フォルダにある `.css` ファイル（例: `themes/handout.css`, `themes/sunset-warm.css`）を自動認識してツールバーのドロップダウンに追加します。
     - ツールバーの「**🎨 CSS編集**」ボタンから GUI 上で直接 CSS を編集し、`themes/<テーマ名>.css` として新規保存・即時反映できます。
   - **フロントマター (`theme: xxx`) との双方向連動**:
     - Markdown 先頭のフロントマターに `theme: academic` や `theme: sunset-warm` と記述すると、ファイルを開いた際に自動でそのテーマに切り替わります。
     - ツールバーのドロップダウンからテーマを切り替えると、フロントマターの `theme:` 行も自動で更新されます。
5. **高品質 HTML / PDF エクスポート (GUI & CLI 両対応)**
   - **HTML出力**: 選択中のテーマ CSS・数式・SVG図表を含んだ自己完結型 HTML ファイルを `exports/` フォルダに出力
   - **PDF出力**: システムの Chromium / Google Chrome / Microsoft Edge のヘッドレス印刷エンジンを呼び出し、カスタムCSSテーマが適用されたプレビューの見た目をそのまま高品質な A4 縦 または 16:9 横長スライド PDF として出力

---

## インストールと初回起動（macOS で警告が出る場合）

GitHub Releases から配布している macOS 版（`.dmg` / `.app.zip`）は Apple の公証（Notarization）を行っていないため、初回起動時に以下の警告が表示されることがあります。

> 「Appleは、“Lectern”にMacに損害を与えたり、プライバシーを侵害する可能性のあるマルウェアが含まれていないことを検証できませんでした。」

その場合は、以下のいずれかの手順（初回のみ）で起動を許可してください。

#### 方法 1：システム設定から許可する（GUI）
1. `.dmg` を開き、`Lectern.app` を **アプリケーション（`/Applications`）** フォルダへドラッグ＆ドロップしてコピーします。
2. `Lectern` を一度起動し、警告ダイアログが表示されたら **「完了」** を押して閉じます。
3. **システム設定** → **プライバシーとセキュリティ** を開き、下へスクロールします。
4. セキュリティ欄の「“Lectern”は開発元を確認できないためブロックされました」の横にある **「このまま開く」** をクリックします。
5. 確認ダイアログでもう一度 **「このまま開く」** を選び、パスワードまたは Touch ID で認証すると起動します（次回以降は通常通りダブルクリックで起動できます）。

#### 方法 2：ターミナルから検疫属性を解除する
`Lectern.app` を `/Applications` へコピーした後、ターミナルで以下のコマンドを 1 回実行します。

```bash
xattr -cr /Applications/Lectern.app
```

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

#### 方法 A: GitHub Actions でタグ付けして Releases に自動登録する（Windows 実機不要・おすすめ）
同梱の [.github/workflows/release-build.yml](file:///Users/nagatani/.gemini/antigravity/scratch/lectern/.github/workflows/release-build.yml) により、`v0.1.0` のようなバージョンタグを付けて GitHub に push するだけで、macOS ランナーと Windows ランナーが自動で並列ビルドを行い、**GitHub の Releases ページに以下のビルド済みファイルを自動登録・公開**します：
- **macOS 用**:
  - `Lectern-macos-arm64.app.zip`（解凍してそのまま使える `Lectern.app` 本体）
  - `Lectern_0.1.0_aarch64.dmg`（ディスクイメージインストーラ）
- **Windows 用**:
  - `lectern-windows-x64-portable.exe`（インストール不要で単体起動するポータブル `.exe`）
  - `Lectern_0.1.0_x64-setup.exe`（NSIS セットアップインストーラ）
  - `Lectern_0.1.0_x64_en-US.msi`（MSI インストーラ）

```bash
# リリースタグを作成して GitHub に push すると自動で Release ビルド＆公開が走ります
git tag v0.1.0
git push origin v0.1.0
```

#### 方法 B: Windows PC 上でビルドする
```powershell
npm install
npm run tauri build
```
- **生成先**:
  - ポータブル実行ファイル: `src-tauri\target\release\lectern.exe`
  - NSIS セットアップ `.exe`: `src-tauri\target\release\bundle\nsis\Lectern_0.1.0_x64-setup.exe`
  - MSI インストーラ: `src-tauri\target\release\bundle\msi\Lectern_0.1.0_x64_en-US.msi`
