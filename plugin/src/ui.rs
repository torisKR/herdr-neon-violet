//! Palette and terminal text helpers shared by every pane.

use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};
use std::io::{self, Write};
use unicode_width::UnicodeWidthChar;

pub type Rgb = (u8, u8, u8);

pub const BG: Rgb = (19, 10, 31); // #130a1f
pub const BAR: Rgb = (33, 18, 58); // #21123a
pub const SEL: Rgb = (42, 23, 69); // #2a1745
pub const BORDER: Rgb = (94, 74, 128); // #5e4a80
pub const VIOLET: Rgb = (195, 60, 240); // #c33cf0
pub const PINK: Rgb = (255, 31, 110); // #ff1f6e
pub const CYAN: Rgb = (31, 209, 201); // #1fd1c9
pub const YELLOW: Rgb = (255, 230, 0); // #ffe600
pub const GREEN: Rgb = (57, 230, 162); // #39e6a2
pub const TEXT: Rgb = (236, 228, 255); // #ece4ff
pub const DIM: Rgb = (138, 118, 173); // #8a76ad

pub const RESET: &str = "\x1b[0m";
pub const BOLD: &str = "\x1b[1m";
pub const ITALIC: &str = "\x1b[3m";
pub const UNDERLINE: &str = "\x1b[4m";

pub fn fg(c: Rgb) -> String {
    format!("\x1b[38;2;{};{};{}m", c.0, c.1, c.2)
}

pub fn bg(c: Rgb) -> String {
    format!("\x1b[48;2;{};{};{}m", c.0, c.1, c.2)
}

/// Byte length of the escape sequence starting at `i`, or 0 when there is none.
fn escape_len(b: &[u8], i: usize) -> usize {
    if b[i] != 0x1b {
        return 0;
    }
    match b.get(i + 1) {
        Some(b'[') => {
            let mut j = i + 2;
            while j < b.len() {
                if (0x40..=0x7e).contains(&b[j]) {
                    return j + 1 - i;
                }
                j += 1;
            }
            b.len() - i
        }
        Some(b']') => {
            let mut j = i + 2;
            while j < b.len() {
                if b[j] == 0x07 {
                    return j + 1 - i;
                }
                if b[j] == 0x1b && b.get(j + 1) == Some(&b'\\') {
                    return j + 2 - i;
                }
                j += 1;
            }
            b.len() - i
        }
        Some(b'(') | Some(b')') => 3.min(b.len() - i),
        Some(_) => 2,
        None => 1,
    }
}

fn char_width(c: char) -> usize {
    if c == '\t' {
        return 2;
    }
    UnicodeWidthChar::width(c).unwrap_or(0)
}

/// Text with escape sequences and control characters removed.
pub fn strip(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        let e = escape_len(b, i);
        if e > 0 {
            i += e;
            continue;
        }
        let c = s[i..].chars().next().unwrap();
        if c == '\t' {
            out.push_str("  ");
        } else if !c.is_control() {
            out.push(c);
        }
        i += c.len_utf8();
    }
    out
}

/// Visible width of a string that may contain escape sequences.
pub fn width(s: &str) -> usize {
    let b = s.as_bytes();
    let (mut i, mut w) = (0, 0);
    while i < b.len() {
        let e = escape_len(b, i);
        if e > 0 {
            i += e;
            continue;
        }
        let c = s[i..].chars().next().unwrap();
        w += char_width(c);
        i += c.len_utf8();
    }
    w
}

/// Truncates (with …) or pads a styled string to exactly `w` columns.
pub fn fit(s: &str, w: usize, pad_style: &str) -> String {
    if w == 0 {
        return String::new();
    }
    let full = width(s) > w;
    let limit = if full { w - 1 } else { w };
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len() + w);
    let (mut i, mut used) = (0, 0);
    while i < b.len() {
        let e = escape_len(b, i);
        if e > 0 {
            out.push_str(&s[i..i + e]);
            i += e;
            continue;
        }
        let c = s[i..].chars().next().unwrap();
        let cw = char_width(c);
        if used + cw > limit {
            break;
        }
        if c == '\t' {
            out.push_str("  ");
        } else {
            out.push(c);
        }
        used += cw;
        i += c.len_utf8();
    }
    if full {
        out.push('…');
        used += 1;
    }
    if used < w {
        out.push_str(pad_style);
        out.push_str(&" ".repeat(w - used));
    }
    out
}

/// Like `fit`, padding with `─` in `style` (card borders).
pub fn fit_rule(s: &str, w: usize, style: &str) -> String {
    let used = width(s);
    if used >= w {
        return fit(s, w, "");
    }
    format!("{s}{style}{}", "─".repeat(w - used))
}

/// Plain lines from terminal output: no escapes, no trailing blank lines.
pub fn clean_lines(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|l| strip(l).trim_end().to_string())
        .collect();
    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    lines
}

/// Word-wraps plain text to `w` columns.
pub fn wrap(text: &str, w: usize) -> Vec<String> {
    let w = w.max(8);
    let mut out = Vec::new();
    for para in text.replace("\r\n", "\n").split('\n') {
        let para = strip(para);
        if para.trim().is_empty() {
            out.push(String::new());
            continue;
        }
        let mut line = String::new();
        let mut used = 0;
        for word in para.split(' ') {
            let ww = width(word);
            if used > 0 && used + 1 + ww > w {
                out.push(std::mem::take(&mut line));
                used = 0;
            }
            if used > 0 {
                line.push(' ');
                used += 1;
            }
            if ww > w {
                // a word longer than the line: hard split
                for c in word.chars() {
                    let cw = char_width(c);
                    if used + cw > w {
                        out.push(std::mem::take(&mut line));
                        used = 0;
                    }
                    line.push(c);
                    used += cw;
                }
            } else {
                line.push_str(word);
                used += ww;
            }
        }
        out.push(line);
    }
    out
}

pub fn size() -> (usize, usize) {
    match crossterm::terminal::size() {
        Ok((c, r)) if c > 0 && r > 0 => (c as usize, r as usize),
        _ => (80, 24),
    }
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Puts text on the clipboard of whoever is looking at the terminal (OSC 52).
pub fn osc52(text: &str) {
    let mut out = io::stdout();
    let _ = write!(out, "\x1b]52;c;{}\x07", base64(text.as_bytes()));
    let _ = out.flush();
}

/// The alternate screen in raw mode; restored when dropped.
pub struct Screen {
    mouse: bool,
}

impl Screen {
    pub fn new(mouse: bool) -> Screen {
        let _ = enable_raw_mode();
        let mut out = io::stdout();
        let _ = write!(out, "\x1b[?1049h\x1b[?25l{}\x1b[2J", bg(BG));
        if mouse {
            let _ = crossterm::execute!(out, EnableMouseCapture);
        }
        let _ = out.flush();
        Screen { mouse }
    }

    /// Draws full lines; each is cut or padded to the terminal width so nothing wraps.
    pub fn draw(&self, lines: &[String]) {
        let (cols, rows) = size();
        let base = bg(BG);
        let mut buf = String::from("\x1b[H");
        for i in 0..rows {
            let line = lines.get(i).map(String::as_str).unwrap_or("");
            buf.push_str(&base);
            buf.push_str("\x1b[2K");
            buf.push_str(&fit(line, cols, &base));
            buf.push_str(RESET);
            if i + 1 < rows {
                buf.push_str("\r\n");
            }
        }
        let mut out = io::stdout();
        let _ = out.write_all(buf.as_bytes());
        let _ = out.flush();
    }
}

impl Drop for Screen {
    fn drop(&mut self) {
        let mut out = io::stdout();
        if self.mouse {
            let _ = crossterm::execute!(out, DisableMouseCapture);
        }
        let _ = write!(out, "{RESET}\x1b[?25h\x1b[?1049l");
        let _ = out.flush();
        let _ = disable_raw_mode();
    }
}

/// A child process that never opens a console window on Windows.
pub fn command(program: &str) -> std::process::Command {
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c.stdin(std::process::Stdio::null());
    c
}

/// Runs a program and returns its stdout when it exits successfully.
pub fn run(program: &str, args: &[&str]) -> Option<String> {
    let out = command(program).args(args).stderr(std::process::Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Runs a program and returns (success, stdout, stderr).
pub fn run_full(program: &str, args: &[&str], cwd: Option<&std::path::Path>) -> (bool, String, String) {
    let mut c = command(program);
    c.args(args);
    if let Some(dir) = cwd {
        c.current_dir(dir);
    }
    match c.output() {
        Ok(o) => (
            o.status.success(),
            String::from_utf8_lossy(&o.stdout).into_owned(),
            String::from_utf8_lossy(&o.stderr).into_owned(),
        ),
        Err(e) => (false, String::new(), e.to_string()),
    }
}

/// The herdr binary that owns this pane.
pub fn herdr_bin() -> String {
    std::env::var("HERDR_BIN_PATH").unwrap_or_else(|_| "herdr".to_string())
}

/// Calls the herdr CLI and returns the `result` of its JSON reply.
pub fn herdr(args: &[&str]) -> Option<serde_json::Value> {
    let out = run(&herdr_bin(), args)?;
    let v: serde_json::Value = serde_json::from_str(out.trim()).ok()?;
    v.get("result").cloned()
}
