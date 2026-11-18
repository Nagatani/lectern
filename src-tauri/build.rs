use base64::Engine;
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    generate_inlined_katex_css();
    tauri_build::build()
}

fn generate_inlined_katex_css() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let out_css_path = out_dir.join("katex_standalone.css");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let katex_dir = manifest_dir
        .parent()
        .map(|p| p.join("node_modules/katex/dist"))
        .unwrap_or_else(|| PathBuf::from("../node_modules/katex/dist"));

    let css_path = katex_dir.join("katex.min.css");
    let fonts_dir = katex_dir.join("fonts");

    println!("cargo:rerun-if-changed={}", css_path.display());

    let Ok(mut css) = fs::read_to_string(&css_path) else {
        let _ = fs::write(&out_css_path, "/* KaTeX CSS fallback */");
        return;
    };

    // Replace every `url(fonts/<FontName>.woff2) format("woff2"),url(fonts/<FontName>.woff) format("woff"),url(fonts/<FontName>.ttf) format("truetype")`
    // with `url(data:font/woff2;base64,<BASE64>) format("woff2")` so exported HTML is 100% self-contained with zero external font requests.
    if let Ok(entries) = fs::read_dir(&fonts_dir) {
        let engine = base64::engine::general_purpose::STANDARD;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("woff2") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let b64 = engine.encode(&bytes);

            let pattern_full = format!(
                r#"url(fonts/{stem}.woff2) format("woff2"),url(fonts/{stem}.woff) format("woff"),url(fonts/{stem}.ttf) format("truetype")"#,
                stem = stem
            );
            let replacement = format!(
                r#"url("data:font/woff2;base64,{}") format("woff2")"#,
                b64
            );

            if css.contains(&pattern_full) {
                css = css.replace(&pattern_full, &replacement);
            } else {
                let pattern_woff2 = format!("url(fonts/{}.woff2)", stem);
                let rep_woff2 = format!(r#"url("data:font/woff2;base64,{}")"#, b64);
                css = css.replace(&pattern_woff2, &rep_woff2);
            }
        }
    }

    let _ = fs::write(&out_css_path, css);
}
