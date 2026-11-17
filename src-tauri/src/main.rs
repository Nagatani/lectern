// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lectern_lib::converter::build_standalone_html;
use lectern_lib::fs_ops::{read_file_utf8, write_file_utf8};
use lectern_lib::pdf::render_html_to_pdf;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // CLI Mode: `cargo run -- --cli <input.md> [--mode document|slide] [--output <out.html|out.pdf>]`
    if let Some(cli_idx) = args.iter().position(|a| a == "--cli") {
        if let Err(e) = run_cli(&args[cli_idx + 1..]) {
            eprintln!("CLI Error: {}", e);
            std::process::exit(1);
        }
        return;
    }

    // Default: Launch Tauri GUI Application
    lectern_lib::run()
}

fn run_cli(cli_args: &[String]) -> Result<(), String> {
    if cli_args.is_empty() {
        return Err(
            "使用法: --cli <input.md> [--mode document|slide] [--output <out.html|out.pdf>]"
                .to_string(),
        );
    }

    let input_path = PathBuf::from(&cli_args[0]);
    let mut mode = "document".to_string();
    let mut output_path: Option<PathBuf> = None;

    let mut i = 1;
    while i < cli_args.len() {
        match cli_args[i].as_str() {
            "--mode" | "-m" => {
                if i + 1 < cli_args.len() {
                    mode = cli_args[i + 1].clone();
                    i += 2;
                } else {
                    return Err("--mode の後に document または slide を指定してください".to_string());
                }
            }
            "--output" | "-o" => {
                if i + 1 < cli_args.len() {
                    output_path = Some(PathBuf::from(&cli_args[i + 1]));
                    i += 2;
                } else {
                    return Err("--output の後に出力ファイルパスを指定してください".to_string());
                }
            }
            _ => {
                i += 1;
            }
        }
    }

    let md = read_file_utf8(&input_path)?;
    let full_html = build_standalone_html(&md, None, &mode);

    let out = output_path.unwrap_or_else(|| {
        let mut p = input_path.clone();
        p.set_extension("html");
        p
    });

    let is_pdf = out
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);

    if is_pdf {
        let bytes = render_html_to_pdf(&full_html, &out)?;
        println!(
            "✅ PDF出力完了: {} ({:.1} KB, mode={})",
            out.display(),
            bytes as f64 / 1024.0,
            mode
        );
    } else {
        write_file_utf8(&out, &full_html)?;
        println!(
            "✅ HTML出力完了: {} ({:.1} KB, mode={})",
            out.display(),
            full_html.len() as f64 / 1024.0,
            mode
        );
    }

    Ok(())
}
