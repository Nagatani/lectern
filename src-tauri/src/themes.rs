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
body.theme-handout,
.preview-viewport:has(.lecture-render-root[data-lecture-theme="handout"]) {
  background-color: #ececec;
}

.lecture-render-root[data-lecture-theme="handout"],
.lecture-render-root[data-lecture-theme="handout"] .lecture-slide {
  font-size: 13.5pt;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "ヒラギノ角ゴ ProN W3", "Hiragino Kaku Gothic ProN",
    Arial, "メイリオ", Meiryo, sans-serif;
  max-width: 1024px;
  background-color: #f8f8f8 !important;
  color: #232323 !important;
  border-color: #dcdcdc !important;
}

/* スライドモード時は16:9枠内に綺麗に収まるようサイズと余白を最適化 */
.lecture-render-root[data-lecture-theme="handout"] .lecture-slide {
  font-size: 12pt;
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
  margin: 3rem 0;
  background-color: #e7e7e7;
  border: 0 none;
  background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAYAAACtBE5DAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBNYWNpbnRvc2giIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6OENDRjNBN0E2NTZBMTFFMEI3QjRBODM4NzJDMjlGNDgiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6OENDRjNBN0I2NTZBMTFFMEI3QjRBODM4NzJDMjlGNDgiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo4Q0NGM0E3ODY1NkExMUUwQjdCNEE4Mzg3MkMyOUY0OCIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo4Q0NGM0E3OTY1NkExMUUwQjdCNEE4Mzg3MkMyOUY0OCIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PqqezsUAAAAfSURBVHjaYmRABcYwBiM2QSA4y4hNEKYDQxAEAAIMAHNGAzhkPOlYAAAAAElFTkSuQmCC");
}

/* Mermaid図表内の <p> には干渉しないよう :not(.mermaid-container *) でスコープ化 */
.lecture-render-root[data-lecture-theme="handout"] p:not(.mermaid-container *),
.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", "HG明朝E", "ＭＳ Ｐ明朝", "ＭＳ 明朝", serif !important;
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
  line-height: 1.9;
  letter-spacing: 0.025rem;
  color: #232323 !important;
}

.lecture-render-root[data-lecture-theme="handout"] strong {
  text-decoration: none;
  color: hsla(0, 75%, 50%, 1) !important;
  font-weight: 700;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-header {
  border-bottom: none !important;
  margin-bottom: 1.5rem;
  padding-bottom: 0;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-title {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "ヒラギノ角ゴ ProN W3", "Hiragino Kaku Gothic ProN",
    Arial, "メイリオ", Meiryo, sans-serif !important;
  font-weight: normal !important;
  font-size: 2rem !important;
  color: #232323 !important;
  letter-spacing: 0.05rem;
  margin: 0.5rem auto !important;
  text-align: center;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-subtitle {
  font-weight: normal;
  font-size: 1.5rem;
  color: #232323 !important;
  text-align: center;
  margin: 0.4rem auto 0.8rem;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  color: #232323 !important;
  margin-top: 0.8rem;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-author {
  font-size: 1.25rem;
  font-weight: normal;
  color: #232323 !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.2);
  padding-bottom: 0.2rem;
}

.lecture-render-root[data-lecture-theme="handout"] .lecture-doc-date {
  font-size: 1.1rem;
  font-weight: normal;
  color: #444444 !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.2);
  padding-bottom: 0.2rem;
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
  color: #232323 !important;
  letter-spacing: 0.04rem;
  margin-top: 1.6rem;
}

.lecture-render-root[data-lecture-theme="handout"] h1 {
  font-size: 1.85rem !important;
  margin: 1.5rem auto 1rem !important;
  text-align: center;
  border-bottom: none !important;
}

.lecture-render-root[data-lecture-theme="handout"] h2 {
  font-size: 1.55rem !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.25) !important;
  margin: 1.5rem 0 0.8rem !important;
  padding-bottom: 0.2rem;
}

.lecture-render-root[data-lecture-theme="handout"] h3 {
  font-size: 1.3rem !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.2) !important;
  margin: 1.2rem 0 0.6rem !important;
  padding-bottom: 0.15rem;
}

.lecture-render-root[data-lecture-theme="handout"] h4 {
  font-size: 1.15rem !important;
  margin: 1.2rem 0 0.5rem !important;
}

.lecture-render-root[data-lecture-theme="handout"] h5 {
  font-size: 1.1rem !important;
  margin: 1rem 0 0.5rem !important;
}

.lecture-render-root[data-lecture-theme="handout"] h6 {
  font-size: 1rem !important;
  margin: 1rem 0 0.5rem !important;
}

.lecture-render-root[data-lecture-theme="handout"] ul,
.lecture-render-root[data-lecture-theme="handout"] ol {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", "HG明朝E", "ＭＳ Ｐ明朝", "ＭＳ 明朝", serif !important;
  line-height: 1.75;
  letter-spacing: 0.02rem;
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
  padding-left: 2rem;
  color: #232323 !important;
}

.lecture-render-root[data-lecture-theme="handout"] ul li,
.lecture-render-root[data-lecture-theme="handout"] ol li {
  font-family: "游明朝", YuMincho, "ヒラギノ明朝 ProN W3", "Hiragino Mincho ProN", "HG明朝E", "ＭＳ Ｐ明朝", "ＭＳ 明朝", serif !important;
  padding-left: 0.4rem;
  color: #232323 !important;
}

.lecture-render-root[data-lecture-theme="handout"] ul ul,
.lecture-render-root[data-lecture-theme="handout"] ol ul,
.lecture-render-root[data-lecture-theme="handout"] ul ol,
.lecture-render-root[data-lecture-theme="handout"] ol ol {
  padding-left: 1.5rem;
}

.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) {
  border-collapse: collapse;
  border: 1px solid rgba(0, 0, 0, 0.25) !important;
  max-width: 100%;
  width: 100% !important;
  font-size: 0.95rem;
  overflow: auto;
  background-color: #ffffff !important;
  color: #232323 !important;
}

.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) th {
  text-align: center !important;
  font-weight: 600 !important;
  background-color: #eaeaea !important;
  color: #171717 !important;
  border: 1px solid rgba(0, 0, 0, 0.25) !important;
  padding: 6px 10px !important;
}

.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) tr,
.lecture-render-root[data-lecture-theme="handout"] table:not(.mermaid-container *) td {
  border: 1px solid rgba(0, 0, 0, 0.2) !important;
  padding: 6px 10px !important;
  color: #232323 !important;
  background-color: #ffffff !important;
}

.lecture-render-root[data-lecture-theme="handout"] a {
  color: #2b6cb0 !important;
}

/* 引用・コールアウト枠（ダークモード時でも暗い背景にならず、黒文字がくっきり読めるように明示） */
.lecture-render-root[data-lecture-theme="handout"] blockquote {
  border-left: 4px solid #bbbbbb !important;
  background-color: #f0f0f0 !important;
  padding: 0.6rem 1rem;
  margin: 1.2rem 0;
  color: #333333 !important;
}

.lecture-render-root[data-lecture-theme="handout"] blockquote * {
  color: #333333 !important;
}

.lecture-render-root[data-lecture-theme="handout"] .callout {
  background-color: #ffffff !important;
  color: #232323 !important;
  border: 1px solid #d4d4d8 !important;
  border-left: 5px solid #3b82f6 !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.lecture-render-root[data-lecture-theme="handout"] .callout-title {
  color: #111827 !important;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", YuGothic, "Hiragino Kaku Gothic ProN", sans-serif !important;
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
  display: inline-block;
  border: 1px solid #555555 !important;
  background-color: #666666 !important;
  color: #ffffff !important;
  white-space: nowrap;
  border-radius: 3px !important;
  padding: 0.1em 0.45em !important;
  margin: 0 3px;
  font-size: 0.88em !important;
  line-height: 1.35 !important;
  vertical-align: baseline;
}

.lecture-render-root[data-lecture-theme="handout"] .code-block-wrapper,
.lecture-render-root[data-lecture-theme="handout"] div.sourceCode {
  background-color: #ffffff !important;
  border: 1px solid #cccccc !important;
  margin-top: 1rem;
  margin-bottom: 1rem;
  border-radius: 5px !important;
}

.lecture-render-root[data-lecture-theme="handout"] .code-block-header {
  background-color: #e6e6e6 !important;
  color: #333333 !important;
  border-bottom: 1px solid #cccccc !important;
}

.lecture-render-root[data-lecture-theme="handout"] .code-block-wrapper pre {
  background-color: #ffffff !important;
  color: #24292e !important;
  line-height: 1.45 !important;
  font-size: 0.88rem !important;
}

/* KaTeX 数式の組版崩れ防止 */
.lecture-render-root[data-lecture-theme="handout"] .katex {
  color: #111111 !important;
  line-height: 1.2 !important;
  letter-spacing: normal !important;
}

/* Mermaid 図表のクリッピング・文字消え・背景暗転の完全防止 */
.lecture-render-root[data-lecture-theme="handout"] .mermaid-container {
  display: block !important;
  text-align: center !important;
  background-color: #ffffff !important;
  color: #1e293b !important;
  border: 1px solid #d4d4d8 !important;
  border-radius: 6px !important;
  padding: 16px !important;
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
.lecture-render-root .lecture-doc-title {
  color: #431407 !important;
  letter-spacing: 0.03em;
}
.lecture-render-root .lecture-doc-meta {
  justify-content: center;
  color: #57534e !important;
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
pub fn list_available_themes(workspace_path: Option<&Path>) -> Vec<ThemeInfo> {
    let mut themes = builtin_themes();

    if let Some(ws) = workspace_path {
        let themes_dir = ws.join("themes");
        if !themes_dir.exists() {
            if fs::create_dir_all(&themes_dir).is_ok() {
                let _ = fs::write(themes_dir.join("handout.css"), THEME_HANDOUT_CSS);
                let _ = fs::write(themes_dir.join("sunset-warm.css"), SAMPLE_CUSTOM_SUNSET_CSS);
            }
        }

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
                    if let Some(existing) = themes.iter_mut().find(|t| t.id == stem) {
                        existing.css = css_content;
                        existing.file_path = Some(css_path.to_string_lossy().to_string());
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
