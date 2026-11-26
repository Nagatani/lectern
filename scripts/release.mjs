#!/usr/bin/env node
/**
 * Lectern Release Helper Script
 *
 * 1つのコマンドで以下を自動実行します:
 *   1. バージョン番号の一括更新:
 *      - package.json / package-lock.json
 *      - src-tauri/tauri.conf.json
 *      - src-tauri/Cargo.toml / src-tauri/Cargo.lock
 *   2. リリースコミット作成 (`chore(release): vX.Y.Z`)
 *   3. Git タグ作成 (`vX.Y.Z`)
 *   4. リモート (origin) へコミットとタグを push → GitHub Actions でビルド & セルフアップデート用 latest.json を自動公開
 *
 * 使い方:
 *   npm run release -- patch          # 0.2.0 -> 0.2.1
 *   npm run release -- minor          # 0.2.0 -> 0.3.0
 *   npm run release -- major          # 0.2.0 -> 1.0.0
 *   npm run release -- 0.2.5          # 明示的にバージョン指定
 *   npm run release -- patch --dry-run  # 変更内容の確認のみ（ファイル変更・pushなし）
 *   npm run release -- patch --no-push  # ローカルの更新・コミット・タグ作成のみ
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const allowDirty = args.includes("--allow-dirty");

let customNotes = "";
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--notes" && i + 1 < args.length) {
    customNotes = args[i + 1];
    i += 1;
  } else if (a.startsWith("--notes=")) {
    customNotes = a.slice("--notes=".length);
  } else if (!a.startsWith("--")) {
    positional.push(a);
  }
}

function usage() {
  console.log(`使い方:
  npm run release -- <patch | minor | major | X.Y.Z> [--notes "変更内容"] [--dry-run] [--no-push] [--allow-dirty]

例:
  npm run release -- patch
  npm run release -- minor --notes "- タブ機能を追加\n- 目次をテーマ連動に改善"
  npm run release -- 0.3.0
  npm run release -- patch --dry-run`);
}

if (positional.length !== 1 || args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(positional.length === 1 ? 0 : 1);
}

function runGit(gitArgs, { capture = false, allowFail = false } = {}) {
  try {
    return execFileSync("git", gitArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function computeNextVersion(current, spec) {
  const cur = parseSemver(current);
  if (!cur) {
    throw new Error(`現在のバージョン形式が不正です: ${current}`);
  }
  if (spec === "patch") return `${cur.major}.${cur.minor}.${cur.patch + 1}`;
  if (spec === "minor") return `${cur.major}.${cur.minor + 1}.0`;
  if (spec === "major") return `${cur.major + 1}.0.0`;

  const explicit = parseSemver(spec);
  if (!explicit) {
    throw new Error(
      `バージョン指定が不正です: "${spec}" (patch / minor / major / X.Y.Z のいずれかを指定してください)`
    );
  }
  return `${explicit.major}.${explicit.minor}.${explicit.patch}`;
}

function updateJsonVersion(filePath, nextVersion, { isLockfile = false } = {}) {
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  json.version = nextVersion;
  if (isLockfile && json.packages && json.packages[""]) {
    json.packages[""].version = nextVersion;
  }
  return JSON.stringify(json, null, 2) + "\n";
}

function updateCargoTomlVersion(filePath, nextVersion) {
  const raw = fs.readFileSync(filePath, "utf8");
  const updated = raw.replace(
    /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m,
    `$1${nextVersion}$3`
  );
  if (updated === raw) {
    throw new Error(`Cargo.toml の [package] version が見つかりませんでした: ${filePath}`);
  }
  return updated;
}

function updateCargoLockVersion(filePath, nextVersion) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw.replace(
    /(\[\[package\]\]\r?\nname\s*=\s*"lectern"\r?\nversion\s*=\s*")([^"]+)(")/,
    `$1${nextVersion}$3`
  );
}

// 1. 現在のバージョンと次バージョンを計算
const pkgPath = path.join(ROOT, "package.json");
const pkgLockPath = path.join(ROOT, "package-lock.json");
const tauriConfPath = path.join(ROOT, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(ROOT, "src-tauri", "Cargo.toml");
const cargoLockPath = path.join(ROOT, "src-tauri", "Cargo.lock");

const currentVersion = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
const nextVersion = computeNextVersion(currentVersion, positional[0]);
const tagName = `v${nextVersion}`;

console.log(`\n🚀 Lectern Release: v${currentVersion} -> ${tagName}${dryRun ? " (DRY RUN)" : ""}`);

// 2. 事前チェック
if (!allowDirty) {
  const status = (runGit(["status", "--porcelain"], { capture: true }) || "").trim();
  if (status) {
    console.error(
      "\n❌ 未コミットの変更があります。先にコミットするか、`--allow-dirty` を付けて実行してください。\n"
    );
    console.error(status);
    process.exit(1);
  }
}

const existingTag = runGit(["rev-parse", "-q", "--verify", `refs/tags/${tagName}`], {
  capture: true,
  allowFail: true,
});
if (existingTag && existingTag.trim()) {
  console.error(`\n❌ タグ ${tagName} はすでに存在します。別のバージョンを指定してください。`);
  process.exit(1);
}

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
if (!tauriConf?.plugins?.updater?.pubkey) {
  console.warn(
    "\n⚠️  注意: src-tauri/tauri.conf.json の plugins.updater.pubkey が未設定です。\n" +
      "   セルフアップデートを有効にするには公開鍵を設定し、GitHub Secrets に TAURI_SIGNING_PRIVATE_KEY を登録してください。"
  );
}

// 3. 更新対象ファイルの準備
const filesToUpdate = [
  { path: pkgPath, content: updateJsonVersion(pkgPath, nextVersion) },
  { path: tauriConfPath, content: updateJsonVersion(tauriConfPath, nextVersion) },
  { path: cargoTomlPath, content: updateCargoTomlVersion(cargoTomlPath, nextVersion) },
];

if (fs.existsSync(pkgLockPath)) {
  filesToUpdate.push({
    path: pkgLockPath,
    content: updateJsonVersion(pkgLockPath, nextVersion, { isLockfile: true }),
  });
}

if (fs.existsSync(cargoLockPath)) {
  filesToUpdate.push({
    path: cargoLockPath,
    content: updateCargoLockVersion(cargoLockPath, nextVersion),
  });
}

function collectReleaseNotes(overrideNotes) {
  if (overrideNotes && overrideNotes.trim()) {
    return overrideNotes.replace(/\\n/g, "\n").trim();
  }
  const prevTag = (
    runGit(["tag", "-l", "v*", "--sort=-v:refname"], { capture: true, allowFail: true }) || ""
  )
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0];

  const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
  const rawLog = (
    runGit(["log", range, "--no-merges", "--pretty=format:- %s"], {
      capture: true,
      allowFail: true,
    }) || ""
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("- chore(release):"));

  if (rawLog.length === 0) {
    return "- 軽微な改善およびメンテナンス更新";
  }
  return rawLog.join("\n");
}

const relPaths = filesToUpdate.map((f) => path.relative(ROOT, f.path));
const releaseNotesBody = collectReleaseNotes(customNotes);
const tagMessage = [
  `Lectern ${tagName}`,
  "",
  "<!-- release-notes:start -->",
  releaseNotesBody,
  "<!-- release-notes:end -->",
].join("\n");

console.log("\n📝 アップデート内容 (タグ注釈 / ダイアログ表示対象):");
console.log(releaseNotesBody);

if (dryRun) {
  console.log("\n[DRY RUN] 更新予定のファイル:");
  for (const rel of relPaths) {
    console.log(`  - ${rel}`);
  }
  console.log(`[DRY RUN] 実行予定のコマンド:`);
  console.log(`  - git add ${relPaths.join(" ")}`);
  console.log(`  - git commit -m "chore(release): ${tagName}"`);
  console.log(`  - git tag -a ${tagName} -m "<リリースノート付きタグ注釈>"`);
  if (!noPush) {
    console.log(`  - git push origin HEAD`);
    console.log(`  - git push origin ${tagName}`);
  }
  console.log("\n✅ DRY RUN 完了（ファイル・Git は変更されていません）\n");
  process.exit(0);
}

// 4. ファイル書き換え
for (const file of filesToUpdate) {
  fs.writeFileSync(file.path, file.content, "utf8");
  console.log(`  ✓ 更新: ${path.relative(ROOT, file.path)}`);
}

// 5. Git コミット & タグ作成（タグ注釈にアップデート内容を記録）
runGit(["add", ...relPaths]);
runGit(["commit", "-m", `chore(release): ${tagName}`]);
runGit(["tag", "-a", tagName, "-m", tagMessage]);
console.log(`\n✓ コミットおよびリリースノート付きタグ ${tagName} を作成しました。`);

// 6. リモートへ push（GitHub Actions のビルド & リリース自動発火）
if (!noPush) {
  console.log("\n📤 リモート (origin) へ push しています...");
  runGit(["push", "origin", "HEAD"]);
  runGit(["push", "origin", tagName]);
  console.log(`\n🎉 リリース ${tagName} の push が完了しました！`);
  console.log(`   GitHub Actions: https://github.com/Nagatani/lectern/actions`);
  console.log(`   GitHub Release: https://github.com/Nagatani/lectern/releases/tag/${tagName}\n`);
} else {
  console.log(`\nℹ️  --no-push が指定されたため push はスキップしました。`);
  console.log(`   公開するには以下を実行してください:`);
  console.log(`   git push origin HEAD && git push origin ${tagName}\n`);
}
