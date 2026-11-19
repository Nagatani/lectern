use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub css: String,
    pub is_builtin: bool,
    pub file_path: Option<String>,
}

pub const THEME_HANDOUT_CSS: &str = r#"/* Theme: Handout (講義レジュメ・角ゴ見出し＋明朝本文) */

/* ドキュメントモードでは外側の背景・カード枠をなくし、白地ベースでゆったり読めるレイアウトにする */
body.mode-document.theme-handout,
.preview-viewport.mode-document:has(.lecture-render-root[data-lecture-theme="handout"]) {
  background-color: #ffffff !important;
}

.preview-viewport.mode-document:has(.lecture-render-root[data-lecture-theme="handout"]) {
  padding: 0 !important;
}

/* スライドモード時は16:9カードを区別しやすい控えめな背景を維持 */
body.mode-slide.theme-handout,
.preview-viewport.mode-slide:has(.lecture-render-root[data-lecture-theme="handout"]) {
  background-color: #ececec;
}

body.mode-document .lecture-render-root[data-lecture-theme="handout"],
.preview-viewport.mode-document .lecture-render-root[data-lecture-theme="handout"] {
  max-width: 1200px !important;
  margin: 0 auto !important;
  padding: 56px clamp(24px, 5vw, 72px) 84px !important;
  background-color: #ffffff !important;
  color: #222222 !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

.lecture-render-root[data-lecture-theme="handout"],
.lecture-render-root[data-lecture-theme="handout"] .lecture-slide {
  font-size: 1.0625rem;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "ヒラギノ角ゴ ProN W3", "Hiragino Kaku Gothic ProN",
    Arial, "メイリオ", Meiryo, sans-serif;
  color: #222222 !important;
  overflow-wrap: break-word;
}

/* スライドモード時は16:9枠内に綺麗に収まるようサイズと背景を最適化 */
.lecture-render-root[data-lecture-theme="handout"] .lecture-slide {
  font-size: 0.95rem;
  background-color: #ffffff !important;
  border-color: #dcdcdc !important;
}

@media print {
  body.mode-document .lecture-render-root[data-lecture-theme="handout"] {
    max-width: 100% !important;
    padding: 0 !important;
  }
}

.lecture-render-root[data-lecture-theme="handout"] span.smallcaps {
  font-variant: small-caps;
}

.lecture-render-root[data-lecture-theme="handout"] span.underline {
  text-decoration: underline;
}

.lecture-render-root[data-lecture-theme="handout"] div.column {
  display: inline-block;
  vertical-align: top;
  width: 50%;
}

.lecture-render-root[data-lecture-theme="handout"] hr {
  height: 4px;
  padding: 0;
  margin: 3.5rem 0;
  background-color: #e7e7e7;
  border: 0 none;
  background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAYAAACtBE5DAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBNYWNpbnRvc2giIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6OENDRjNBN0E2NTZBMTFFMEI3QjRBODM4NzJDMjlGNDgiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6OENDRjNBN0I2NTZBMTFFMEI3QjRBODM4NzJDMjlGNDgiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo4Q0NGM0E3ODY1NkExMUUwQjdCNEE4Mzg3MkMyOUY0OCIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo4Q0NGM0E3OTY1NkExMUUwQjdCNEE4Mzg3MkMyOUY0OCIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PqqezsUAAAAfSURBVHjaYmRABcYwBiM2QSA4y4hNEKYDQxAEAAIMAHNGAzhkPOlYAAAAAElFTkSuQmCC");
}

/* Mermaid図表内の <p> には干渉しないよう :not(.mermaid-container *) でスコープ化 */
.lecture-render-root[data-lecture-theme="handout"] p:not(.mermaid-container *) {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", "HG明朝E", "ＭＳ Ｐ明朝", "ＭＳ 明朝", serif !important;
  margin-top: 1.05rem;
  margin-bottom: 1.05rem;
  line-height: 2.05;
  letter-spacing: 0.045em;
  text-wrap: pretty;
  color: #222222 !important;
}

.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", "HG明朝E", "ＭＳ Ｐ明朝", "ＭＳ 明朝", serif !important;
  margin-top: 1.6rem;
  margin-bottom: 1.6rem;
  line-height: 1.85;
  letter-spacing: 0.03em;
  color: #222222 !important;
}

.lecture-render-root[data-lecture-theme="handout"] strong {
  text-decoration: none;
  color: hsla(0, 75%, 50%, 1) !important;
  font-weight: 700;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-header {
  border-bottom: none !important;
  margin-bottom: 2.6rem;
  padding-bottom: 0;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-course {
  text-align: center;
  margin-bottom: 0.6rem;
}

.lecture-render-root[data-lecture-theme="handout"] .course-badge {
  display: inline-block;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "Hiragino Kaku Gothic ProN", sans-serif !important;
  font-size: 0.88rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.08em;
  color: #3f4756 !important;
  background-color: #f1f3f6 !important;
  border: 1px solid #d5dae2 !important;
  border-radius: 4px !important;
  padding: 3px 14px !important;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-title {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "ヒラギノ角ゴ ProN W3", "Hiragino Kaku Gothic ProN",
    Arial, "メイリオ", Meiryo, sans-serif !important;
  font-weight: normal !important;
  font-size: 2.05rem !important;
  line-height: 1.45;
  color: #222222 !important;
  letter-spacing: 0.06em;
  text-wrap: balance;
  margin: 0.5rem auto 0.8rem !important;
  text-align: center;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-subtitle {
  font-weight: normal;
  font-size: 1.4rem;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: #333333 !important;
  text-align: center;
  margin: 0.4rem auto 1rem;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-meta {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  color: #222222 !important;
  margin-top: 1rem;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-author {
  font-size: 1.15rem;
  font-weight: normal;
  letter-spacing: 0.04em;
  color: #222222 !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.16);
  padding-bottom: 0.3rem;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-date {
  font-size: 1rem;
  font-weight: normal;
  letter-spacing: 0.04em;
  color: #444444 !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.16);
  padding-bottom: 0.3rem;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-description {
  margin-top: 1.5rem;
  padding: 1.05rem 1.4rem;
  background-color: #fafafa !important;
  border: 1px solid #e2e5ea !important;
  border-left: 4px solid #6b7280 !important;
  border-radius: 4px !important;
}

.lecture-render-root[data-lecture-theme="handout"] .description-label {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "Hiragino Kaku Gothic ProN", sans-serif !important;
  font-size: 0.8rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em;
  color: #555555 !important;
  margin-bottom: 0.4rem;
}

.lecture-render-root[data-lecture-theme="handout"] .description-text {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", serif !important;
  font-size: 0.98rem !important;
  line-height: 1.9 !important;
  letter-spacing: 0.04em;
  color: #222222 !important;
  margin: 0 !important;
}

.lecture-render-root[data-lecture-theme="handout"] h1,
.lecture-render-root[data-lecture-theme="handout"] h2,
.lecture-render-root[data-lecture-theme="handout"] h3,
.lecture-render-root[data-lecture-theme="handout"] h4,
.lecture-render-root[data-lecture-theme="handout"] h5,
.lecture-render-root[data-lecture-theme="handout"] h6 {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "ヒラギノ角ゴ ProN W3", "Hiragino Kaku Gothic ProN",
    Arial, "メイリオ", Meiryo, sans-serif !important;
  font-weight: normal !important;
  color: #222222 !important;
  line-height: 1.45;
  letter-spacing: 0.06em;
  text-wrap: balance;
  margin-top: 2.2rem;
}

.lecture-render-root[data-lecture-theme="handout"] h1 {
  font-size: 1.85rem !important;
  margin: 2.6rem auto 1.4rem !important;
  text-align: center;
  border-bottom: none !important;
}

.lecture-render-root[data-lecture-theme="handout"] h2 {
  font-size: 1.5rem !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.22) !important;
  margin: 2.6rem 0 1.15rem !important;
  padding-bottom: 0.35rem;
}

.lecture-render-root[data-lecture-theme="handout"] h3 {
  font-size: 1.28rem !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.16) !important;
  margin: 2rem 0 0.9rem !important;
  padding-bottom: 0.25rem;
}

.lecture-render-root[data-lecture-theme="handout"] h4 {
  font-size: 1.14rem !important;
  margin: 1.6rem 0 0.7rem !important;
}

.lecture-render-root[data-lecture-theme="handout"] h5 {
  font-size: 1.08rem !important;
  margin: 1.3rem 0 0.6rem !important;
}

.lecture-render-root[data-lecture-theme="handout"] h6 {
  font-size: 1rem !important;
  margin: 1.2rem 0 0.55rem !important;
}

.lecture-render-root[data-lecture-theme="handout"] ul,
.lecture-render-root[data-lecture-theme="handout"] ol {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", "HG明朝E", "ＭＳ Ｐ明朝", "ＭＳ 明朝", serif !important;
  line-height: 1.95;
  letter-spacing: 0.04em;
  margin-top: 1rem;
  margin-bottom: 1.2rem;
  padding-left: 2.1rem;
  color: #222222 !important;
}

.lecture-render-root[data-lecture-theme="handout"] ul li,
.lecture-render-root[data-lecture-theme="handout"] ol li {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", "HG明朝E", "ＭＳ Ｐ明朝", "ＭＳ 明朝", serif !important;
  padding-left: 0.45rem;
  margin-bottom: 0.45rem;
  color: #222222 !important;
}

.lecture-render-root[data-lecture-theme="handout"] ul ul,
.lecture-render-root[data-lecture-theme="handout"] ol ul,
.lecture-render-root[data-lecture-theme="handout"] ul ol,
.lecture-render-root[data-lecture-theme="handout"] ol ol {
  margin-top: 0.45rem;
  margin-bottom: 0.45rem;
  padding-left: 1.6rem;
}

.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) {
  border-collapse: collapse;
  border: 1px solid rgba(0, 0, 0, 0.22) !important;
  max-width: 100%;
  width: 100% !important;
  font-size: 0.95rem;
  overflow: auto;
  background-color: #ffffff !important;
  color: #222222 !important;
}

.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) th {
  text-align: center !important;
  font-weight: 600 !important;
  background-color: #f2f3f5 !important;
  color: #171717 !important;
  border: 1px solid rgba(0, 0, 0, 0.22) !important;
  padding: 10px 14px !important;
}

.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) tr,
.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) td {
  border: 1px solid rgba(0, 0, 0, 0.18) !important;
  padding: 10px 14px !important;
  color: #222222 !important;
  background-color: #ffffff !important;
}

.lecture-render-root[data-lecture-theme="handout"] a {
  color: #2b6cb0 !important;
}

/* 引用・コールアウト枠（ダークモード時でも暗い背景にならず、黒文字がくっきり読めるように明示） */
.lecture-render-root[data-lecture-theme="handout"] blockquote {
  border-left: 4px solid #bbbbbb !important;
  background-color: #f7f8fa !important;
  padding: 1rem 1.4rem;
  margin: 1.6rem 0;
  color: #333333 !important;
}

.lecture-render-root[data-lecture-theme="handout"] blockquote * {
  color: #333333 !important;
}

.lecture-render-root[data-lecture-theme="handout"] .callout {
  background-color: #ffffff !important;
  color: #222222 !important;
  border: 1px solid #d8dce3 !important;
  border-left: 5px solid #3b82f6 !important;
  padding: 1.1rem 1.45rem !important;
  margin: 1.7rem 0 !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
}

.lecture-render-root[data-lecture-theme="handout"] .callout-title {
  color: #111827 !important;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "Hiragino Kaku Gothic ProN", sans-serif !important;
  letter-spacing: 0.04em;
  margin-bottom: 0.45rem;
}

.lecture-render-root[data-lecture-theme="handout"] .callout-note {
  background-color: #f0f7ff !important;
  border-left-color: #2563eb !important;
}

.lecture-render-root[data-lecture-theme="handout"] .callout-tip {
  background-color: #f0fdf4 !important;
  border-left-color: #059669 !important;
}

.lecture-render-root[data-lecture-theme="handout"] .callout-important {
  background-color: #faf5ff !important;
  border-left-color: #7c3aed !important;
}

.lecture-render-root[data-lecture-theme="handout"] .callout-warning {
  background-color: #fffbeb !important;
  border-left-color: #d97706 !important;
}

/* インラインコードとコードブロックの可読性保証 */
.lecture-render-root[data-lecture-theme="handout"] pre,
.lecture-render-root[data-lecture-theme="handout"] code,
.lecture-render-root[data-lecture-theme="handout"] var,
.lecture-render-root[data-lecture-theme="handout"] samp,
.lecture-render-root[data-lecture-theme="handout"] kbd,
.lecture-render-root[data-lecture-theme="handout"] .mono {
  font-family: "Ricty Diminished", "JetBrains Mono", "Consolas", "Courier New", Courier, Monaco, monospace !important;
}

.lecture-render-root[data-lecture-theme="handout"] code:not(pre code) {
  display: inline;
  border: 1px solid #d4d7dd !important;
  background-color: #eceef2 !important;
  color: #2c353d !important;
  overflow-wrap: anywhere;
  border-radius: 3px !important;
  padding: 0.08em 0.42em !important;
  margin: 0 2px;
  font-size: 0.87em !important;
  line-height: 1.4 !important;
  letter-spacing: 0.01em !important;
  vertical-align: baseline;
}

.lecture-render-root[data-lecture-theme="handout"] .code-block-wrapper,
.lecture-render-root[data-lecture-theme="handout"] div.sourceCode {
  background-color: #ffffff !important;
  border: 1px solid #d2d6dc !important;
  margin-top: 1.6rem;
  margin-bottom: 1.6rem;
  border-radius: 6px !important;
}

.lecture-render-root[data-lecture-theme="handout"] .code-block-header {
  background-color: #eff1f4 !important;
  color: #333333 !important;
  border-bottom: 1px solid #d2d6dc !important;
  padding: 6px 16px !important;
}

.lecture-render-root[data-lecture-theme="handout"] .code-block-wrapper pre {
  background-color: #ffffff !important;
  color: #24292e !important;
  padding: 16px 20px !important;
  line-height: 1.6 !important;
  letter-spacing: normal !important;
  font-size: 0.88rem !important;
}

/* KaTeX 数式の組版崩れ防止 */
.lecture-render-root[data-lecture-theme="handout"] .katex {
  color: #111111 !important;
  line-height: 1.2 !important;
  letter-spacing: normal !important;
}

.lecture-render-root[data-lecture-theme="handout"] .math-display {
  margin: 1.8rem 0 !important;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-columns {
  gap: 28px !important;
  margin: 1.6rem 0 !important;
}

/* Mermaid 図表のクリッピング・文字消え・背景暗転の完全防止 */
.lecture-render-root[data-lecture-theme="handout"] .mermaid-container {
  display: block !important;
  text-align: center !important;
  background-color: #ffffff !important;
  color: #1e293b !important;
  border: 1px solid #d4d4d8 !important;
  border-radius: 6px !important;
  margin: 1.8rem 0 !important;
  padding: 20px !important;
  font-size: 15px !important;
  line-height: 1.3 !important;
  letter-spacing: normal !important;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif !important;
}

.lecture-render-root[data-lecture-theme="handout"] .mermaid-container svg {
  display: inline-block !important;
  max-width: 100% !important;
  height: auto !important;
}

.lecture-render-root[data-lecture-theme="handout"] .mermaid-container p,
.lecture-render-root[data-lecture-theme="handout"] .mermaid-container span,
.lecture-render-root[data-lecture-theme="handout"] .mermaid-container div {
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif !important;
  margin: 0 !important;
  padding: 0 !important;
  line-height: 1.25 !important;
  letter-spacing: normal !important;
  color: #1e293b !important;
}

.lecture-render-root[data-lecture-theme="handout"] .slide-footer {
  color: #555555 !important;
  border-top-color: #cccccc !important;
}

.lecture-render-root[data-lecture-theme="handout"] input.task-list-checkbox {
  --cb-size: 1.32em;
  --cb-radius: 0.24em;
  --cb-border: #4b5563;
  --cb-bg: #ffffff;
  --cb-checked-bg: #2c4a70;
  --cb-check-color: #ffffff;
}
"#;

pub const THEME_DEFAULT_CSS: &str = r#"/* Theme: Modern (モダン・サンセリフ) */
.lecture-render-root,
.lecture-render-root .lecture-slide {
  background-color: #ffffff !important;
  color: #17202a !important;
  border-color: #d7e0ec !important;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.lecture-render-root .callout {
  background-color: #f8fafc !important;
  color: #17202a !important;
}
.lecture-render-root .callout-note { background-color: #eff6ff !important; border-left-color: #3b82f6 !important; }
.lecture-render-root .callout-tip { background-color: #ecfdf5 !important; border-left-color: #10b981 !important; }
.lecture-render-root .callout-important { background-color: #f5f3ff !important; border-left-color: #8b5cf6 !important; }
.lecture-render-root .callout-warning { background-color: #fffbeb !important; border-left-color: #f59e0b !important; }
.lecture-render-root th { background-color: #f1f5f9 !important; color: #17202a !important; }
.lecture-render-root td { background-color: #ffffff !important; color: #17202a !important; }
.lecture-render-root code:not(pre code) { background-color: #e2e8f0 !important; color: #0f172a !important; }
.lecture-render-root .mermaid-container { background-color: #ffffff !important; color: #0f172a !important; }
.lecture-render-root .course-badge { background-color: #eff6ff !important; color: #1d4ed8 !important; border-color: #bfdbfe !important; }
.lecture-render-root .lecture-doc-description { background-color: #f8fafc !important; border-left-color: #2563eb !important; color: #334155 !important; }
.lecture-render-root input.task-list-checkbox {
  --cb-size: 1.3em;
  --cb-radius: 0.3em;
  --cb-border: #94a3b8;
  --cb-bg: #ffffff;
  --cb-checked-bg: #2563eb;
  --cb-check-color: #ffffff;
}
"#;

pub const THEME_ACADEMIC_CSS: &str = r#"/* Theme: Academic (論文・モノグラフ) */
.lecture-render-root,
.lecture-render-root .lecture-slide {
  background-color: #fcfbf7 !important;
  color: #1c1917 !important;
  font-family: "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Times New Roman", Georgia, serif !important;
  border-color: #d6d3cd !important;
}
.lecture-render-root .lecture-doc-header {
  border-bottom: 3px double #7c2d12 !important;
  text-align: center;
}
.lecture-render-root .course-badge {
  background-color: #f5f2eb !important;
  color: #7c2d12 !important;
  border: 1px solid #d6d3cd !important;
  border-radius: 3px !important;
}
.lecture-render-root .lecture-doc-title {
  color: #431407 !important;
  letter-spacing: 0.03em;
}
.lecture-render-root .lecture-doc-meta {
  justify-content: center;
  color: #57534e !important;
}
.lecture-render-root .lecture-doc-description {
  text-align: left;
  background-color: #f5f2eb !important;
  border-left: 3px solid #7c2d12 !important;
  color: #292524 !important;
}
.lecture-render-root .description-label {
  color: #7c2d12 !important;
}
.lecture-render-root h1 {
  color: #7c2d12 !important;
  border-bottom: 1.5px solid #a8a29e !important;
}
.lecture-render-root h2 {
  color: #9a3412 !important;
}
.lecture-render-root h3 {
  color: #44403c !important;
}
.lecture-render-root th {
  background-color: #f5f2eb !important;
  color: #292524 !important;
  border-color: #a8a29e !important;
}
.lecture-render-root td {
  background-color: #fcfbf7 !important;
  color: #1c1917 !important;
  border-color: #d6d3cd !important;
}
.lecture-render-root code:not(pre code) {
  background-color: #ebe6dc !important;
  color: #7c2d12 !important;
}
.lecture-render-root .callout {
  background-color: #f5f2eb !important;
  border-left-color: #7c2d12 !important;
  color: #1c1917 !important;
}
.lecture-render-root .mermaid-container {
  background-color: #ffffff !important;
  color: #1c1917 !important;
}
.lecture-render-root input.task-list-checkbox {
  --cb-size: 1.3em;
  --cb-radius: 0.2em;
  --cb-border: #8c8277;
  --cb-bg: #fcfbf7;
  --cb-checked-bg: #7c2d12;
  --cb-check-color: #fcfbf7;
}
"#;

pub const THEME_CHALKBOARD_CSS: &str = r#"/* Theme: Chalkboard (黒板・チョーク) */
.lecture-render-root,
.lecture-render-root .lecture-slide {
  background-color: #173528 !important;
  color: #f3f6f4 !important;
  border: 6px solid #7c5332 !important;
  box-shadow: inset 0 0 28px rgba(0, 0, 0, 0.35), 0 10px 25px rgba(0, 0, 0, 0.2) !important;
}
.lecture-render-root .lecture-doc-header {
  border-bottom: 2px dashed rgba(255, 255, 255, 0.35) !important;
}
.lecture-render-root .lecture-doc-title,
.lecture-render-root h1 {
  color: #fef08a !important;
  border-bottom-color: rgba(254, 240, 138, 0.35) !important;
}
.lecture-render-root h2 {
  color: #7dd3fc !important;
}
.lecture-render-root h3 {
  color: #bbf7d0 !important;
}
.lecture-render-root .lecture-doc-meta,
.lecture-render-root .slide-footer {
  color: #cbd5e1 !important;
  border-top-color: rgba(255, 255, 255, 0.25) !important;
}
.lecture-render-root code:not(pre code) {
  background-color: rgba(255, 255, 255, 0.14) !important;
  color: #fde047 !important;
}
.lecture-render-root th {
  background-color: rgba(0, 0, 0, 0.28) !important;
  color: #fef08a !important;
  border-color: rgba(255, 255, 255, 0.3) !important;
}
.lecture-render-root td {
  border-color: rgba(255, 255, 255, 0.25) !important;
  color: #f3f6f4 !important;
}
.lecture-render-root .callout {
  background-color: rgba(0, 0, 0, 0.24) !important;
  border-left-color: #fde047 !important;
  color: #f8fafc !important;
}
.lecture-render-root .mermaid-container {
  background-color: #f8fafc !important;
  color: #0f172a !important;
}
.lecture-render-root .course-badge {
  background-color: rgba(254, 240, 138, 0.16) !important;
  color: #fef08a !important;
  border-color: rgba(254, 240, 138, 0.45) !important;
}
.lecture-render-root .lecture-doc-description {
  background-color: rgba(0, 0, 0, 0.22) !important;
  border-left-color: #7dd3fc !important;
  color: #f3f6f4 !important;
}
.lecture-render-root .description-label {
  color: #7dd3fc !important;
}
.lecture-render-root .description-text {
  color: #f3f6f4 !important;
}
.lecture-render-root input.task-list-checkbox {
  --cb-size: 1.32em;
  --cb-radius: 0.25em;
  --cb-border: #fef08a;
  --cb-bg: rgba(255, 255, 255, 0.08);
  --cb-checked-bg: #fef08a;
  --cb-check-color: #173528;
}
"#;

pub const THEME_MIDNIGHT_CSS: &str = r#"/* Theme: Midnight (ダーク・プロジェクター) */
.lecture-render-root,
.lecture-render-root .lecture-slide {
  background-color: #0f172a !important;
  color: #e2e8f0 !important;
  border-color: #334155 !important;
}
.lecture-render-root .lecture-doc-header {
  border-bottom: 2px solid #38bdf8 !important;
}
.lecture-render-root .course-badge {
  background-color: #1e293b !important;
  color: #38bdf8 !important;
  border-color: #0284c7 !important;
}
.lecture-render-root .lecture-doc-description {
  background-color: #1e293b !important;
  border-left-color: #38bdf8 !important;
  color: #e2e8f0 !important;
}
.lecture-render-root .description-label {
  color: #38bdf8 !important;
}
.lecture-render-root .description-text {
  color: #e2e8f0 !important;
}
.lecture-render-root .lecture-doc-title,
.lecture-render-root h1 {
  color: #f8fafc !important;
  border-bottom-color: #334155 !important;
}
.lecture-render-root h2 {
  color: #38bdf8 !important;
}
.lecture-render-root h3 {
  color: #a78bfa !important;
}
.lecture-render-root .lecture-doc-meta,
.lecture-render-root .slide-footer {
  color: #94a3b8 !important;
  border-top-color: #334155 !important;
}
.lecture-render-root code:not(pre code) {
  background-color: #1e293b !important;
  color: #7dd3fc !important;
}
.lecture-render-root th {
  background-color: #1e293b !important;
  color: #38bdf8 !important;
  border-color: #334155 !important;
}
.lecture-render-root td {
  border-color: #334155 !important;
  color: #e2e8f0 !important;
}
.lecture-render-root .callout {
  background-color: #1e293b !important;
  border-left-color: #38bdf8 !important;
  color: #e2e8f0 !important;
}
.lecture-render-root .mermaid-container {
  background-color: #f8fafc !important;
  color: #0f172a !important;
}
.lecture-render-root input.task-list-checkbox {
  --cb-size: 1.3em;
  --cb-radius: 0.28em;
  --cb-border: #64748b;
  --cb-bg: #1e293b;
  --cb-checked-bg: #38bdf8;
  --cb-check-color: #0f172a;
}
"#;

pub const SAMPLE_CUSTOM_SUNSET_CSS: &str = r#"/* Custom Theme: sunset-warm (自由に編集可能なカスタムCSSテーマ例) */
.lecture-render-root,
.lecture-render-root .lecture-slide {
  background-color: #fffaf5 !important;
  color: #271c19 !important;
  border-color: #fed7aa !important;
}
.lecture-render-root .lecture-doc-header {
  border-bottom: 3px solid #ea580c !important;
}
.lecture-render-root .lecture-doc-title,
.lecture-render-root h1 {
  color: #9a3412 !important;
  border-bottom-color: #fdba74 !important;
}
.lecture-render-root h2 {
  color: #ea580c !important;
}
.lecture-render-root h3 {
  color: #c2410c !important;
}
.lecture-render-root th {
  background-color: #ffedd5 !important;
  color: #7c2d12 !important;
}
.lecture-render-root td {
  background-color: #fffaf5 !important;
  color: #271c19 !important;
}
.lecture-render-root code:not(pre code) {
  background-color: #ffedd5 !important;
  color: #9a3412 !important;
}
.lecture-render-root .callout {
  background-color: #ffedd5 !important;
  border-left-color: #ea580c !important;
  color: #431407 !important;
}
.lecture-render-root .mermaid-container {
  background-color: #ffffff !important;
  color: #1e293b !important;
}
.lecture-render-root input.task-list-checkbox {
  --cb-size: 1.3em;
  --cb-radius: 0.28em;
  --cb-border: #fb923c;
  --cb-bg: #fffaf5;
  --cb-checked-bg: #ea580c;
  --cb-check-color: #ffffff;
}
"#;

pub fn builtin_themes() -> Vec<ThemeInfo> {
    vec![
        ThemeInfo {
            id: "handout".to_string(),
            name: "Handout (講義レジュメ・明朝)".to_string(),
            css: THEME_HANDOUT_CSS.to_string(),
            is_builtin: true,
            file_path: None,
        },
        ThemeInfo {
            id: "default".to_string(),
            name: "Modern (モダン・サンセリフ)".to_string(),
            css: THEME_DEFAULT_CSS.to_string(),
            is_builtin: true,
            file_path: None,
        },
        ThemeInfo {
            id: "academic".to_string(),
            name: "Academic (論文・モノグラフ)".to_string(),
            css: THEME_ACADEMIC_CSS.to_string(),
            is_builtin: true,
            file_path: None,
        },
        ThemeInfo {
            id: "chalkboard".to_string(),
            name: "Chalkboard (黒板・チョーク)".to_string(),
            css: THEME_CHALKBOARD_CSS.to_string(),
            is_builtin: true,
            file_path: None,
        },
        ThemeInfo {
            id: "midnight".to_string(),
            name: "Midnight (ダーク・プロジェクター)".to_string(),
            css: THEME_MIDNIGHT_CSS.to_string(),
            is_builtin: true,
            file_path: None,
        },
    ]
}

/// ワークスペースの `themes/` フォルダ内の `.css` ファイルを含めた全利用可能テーマ一覧を返す
///
/// 内蔵テーマ (`handout` 等) は常にアプリの最新定義をそのまま使用し、
/// フォルダを開くだけで勝手に `themes/` や `handout.css` を自動生成・上書きしない。
pub fn list_available_themes(workspace_path: Option<&Path>) -> Vec<ThemeInfo> {
    let mut themes = builtin_themes();

    if let Some(ws) = workspace_path {
        let themes_dir = ws.join("themes");
        if themes_dir.exists() && themes_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&themes_dir) {
                let mut custom_files = Vec::new();
                for item in entries.flatten() {
                    let path = item.path();
                    if path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("css"))
                        .unwrap_or(false)
                    {
                        custom_files.push(path);
                    }
                }
                custom_files.sort();

                for css_path in custom_files {
                    let stem = css_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("custom")
                        .to_string();
                    if let Ok(css_content) = fs::read_to_string(&css_path) {
                        let collides_with_builtin =
                            themes.iter().any(|t| t.is_builtin && t.id.eq_ignore_ascii_case(&stem));
                        if collides_with_builtin {
                            // 内蔵テーマを上書きせず、別エントリとして選択可能にする
                            themes.push(ThemeInfo {
                                id: format!("local-{}", stem),
                                name: format!("Local: {}.css", stem),
                                css: css_content,
                                is_builtin: false,
                                file_path: Some(css_path.to_string_lossy().to_string()),
                            });
                        } else {
                            themes.push(ThemeInfo {
                                id: stem.clone(),
                                name: format!("Custom: {}.css", stem),
                                css: css_content,
                                is_builtin: false,
                                file_path: Some(css_path.to_string_lossy().to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    themes
}

/// カスタムテーマを `<workspace>/themes/<theme_id>.css` として保存する
pub fn save_custom_theme_file(
    workspace_path: &Path,
    theme_id: &str,
    css_content: &str,
) -> Result<ThemeInfo, String> {
    let clean_id = theme_id
        .trim()
        .trim_end_matches(".css")
        .replace(['/', '\\', ' '], "-");
    if clean_id.is_empty() {
        return Err("テーマ名を入力してください".to_string());
    }

    let themes_dir = workspace_path.join("themes");
    fs::create_dir_all(&themes_dir)
        .map_err(|e| format!("themesフォルダの作成に失敗しました: {}", e))?;

    let css_path = themes_dir.join(format!("{}.css", clean_id));
    fs::write(&css_path, css_content)
        .map_err(|e| format!("カスタムCSSの保存に失敗しました: {}", e))?;

    Ok(ThemeInfo {
        id: clean_id.clone(),
        name: format!("Custom: {}.css", clean_id),
        css: css_content.to_string(),
        is_builtin: false,
        file_path: Some(css_path.to_string_lossy().to_string()),
    })
}

/// 指定されたテーマID（または直接の `.css` パス）と追加インラインCSSから、最終的なテーマCSSを解決する
pub fn resolve_theme_css(
    workspace_path: Option<&Path>,
    theme_id_or_path: Option<&str>,
    extra_custom_css: Option<&str>,
) -> (String, String) {
    let requested = theme_id_or_path
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("handout");

    let mut resolved_css = String::new();
    let mut resolved_id = requested.to_string();

    // 1. 直接存在する .css ファイルパスが指定された場合 (CLI等)
    let direct_path = Path::new(requested);
    if direct_path.exists() && direct_path.is_file() {
        if let Ok(c) = fs::read_to_string(direct_path) {
            resolved_css = c;
            resolved_id = direct_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("custom")
                .to_string();
        }
    }

    // 2. 利用可能なテーマ一覧から検索
    if resolved_css.is_empty() {
        let clean_key = requested.trim_end_matches(".css");
        let available = list_available_themes(workspace_path);
        if let Some(found) = available
            .into_iter()
            .find(|t| t.id.eq_ignore_ascii_case(clean_key))
        {
            resolved_id = found.id;
            resolved_css = found.css;
        } else {
            resolved_id = "handout".to_string();
            resolved_css = THEME_HANDOUT_CSS.to_string();
        }
    }

    if let Some(extra) = extra_custom_css.filter(|s| !s.trim().is_empty()) {
        resolved_css.push_str("\n/* Inline Custom CSS Override */\n");
        resolved_css.push_str(extra);
    }

    (resolved_id, resolved_css)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_handout_is_not_shadowed_by_workspace_file_and_no_auto_create() {
        let tmp = std::env::temp_dir().join(format!(
            "lectern_themes_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // themes/ が無いワークスペースを開いても自動生成しない
        let themes = list_available_themes(Some(&tmp));
        assert!(!tmp.join("themes").exists());
        assert!(themes.iter().any(|t| t.id == "handout" && t.is_builtin));

        // 古い themes/handout.css が存在しても内蔵 handout は上書きされない
        fs::create_dir_all(tmp.join("themes")).unwrap();
        fs::write(tmp.join("themes/handout.css"), "/* stale css */").unwrap();

        let themes_with_stale = list_available_themes(Some(&tmp));
        let builtin = themes_with_stale
            .iter()
            .find(|t| t.id == "handout")
            .unwrap();
        assert!(builtin.is_builtin);
        assert_eq!(builtin.css, THEME_HANDOUT_CSS);

        let local_copy = themes_with_stale
            .iter()
            .find(|t| t.id == "local-handout")
            .unwrap();
        assert!(!local_copy.is_builtin);
        assert_eq!(local_copy.css, "/* stale css */");

        let _ = fs::remove_dir_all(&tmp);
    }
}
