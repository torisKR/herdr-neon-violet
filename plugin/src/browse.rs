//! Text-mode web browser for a herdr pane. It renders in the terminal, so it works over SSH:
//! read docs or check a dev server on the remote machine.
//! Keys: j/k ↑↓ scroll · space/b page · N+enter follow link N · u or / new url/search
//!       h ← back · r reload · y copy url · o open in system browser · q quit
//! `nv browse --dump <url>` prints the rendered page as plain text and exits.

use crate::ui::*;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use std::io::Read;
use std::time::Duration;

const HOME: &str = "https://html.duckduckgo.com/html/";
const UA: &str = "Mozilla/5.0 (herdr-neon-violet text browser)";

#[derive(Clone, Copy, PartialEq)]
enum Style {
    Plain,
    Bold,
    Ital,
    Code,
    Link,
    Num,
    Dim,
}

struct Span {
    text: String,
    style: Style,
}

struct Block {
    kind: String,
    spans: Vec<Span>,
}

struct Page {
    title: String,
    blocks: Vec<Block>,
    links: Vec<String>,
}

// ---------- HTML → blocks ----------

fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let end = tail[1..].find(';').filter(|e| *e <= 10);
        let Some(end) = end else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let name = &tail[1..=end];
        let ch: Option<String> = if let Some(num) = name.strip_prefix('#') {
            let code = match num.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => num.parse::<u32>().ok(),
            };
            code.and_then(char::from_u32).map(|c| c.to_string())
        } else {
            let c = match name.to_ascii_lowercase().as_str() {
                "amp" => "&", "lt" => "<", "gt" => ">", "quot" => "\"", "apos" => "'", "nbsp" => " ",
                "mdash" => "—", "ndash" => "–", "hellip" => "…", "copy" => "©", "reg" => "®", "trade" => "™",
                "rsquo" => "’", "lsquo" => "‘", "ldquo" => "“", "rdquo" => "”", "middot" => "·",
                "laquo" => "«", "raquo" => "»", "bull" => "•", "times" => "×", "rarr" => "→", "larr" => "←", "deg" => "°",
                _ => "",
            };
            if c.is_empty() { None } else { Some(c.to_string()) }
        };
        match ch {
            Some(c) => {
                out.push_str(&c);
                rest = &tail[end + 2..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Drops comments, doctype, and whole elements whose content is never text (script, style, …).
fn strip_blocks(html: &str) -> String {
    const SKIP: [&str; 8] = ["script", "style", "noscript", "svg", "template", "head", "iframe", "select"];
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    'outer: while i < html.len() {
        let Some(off) = lower[i..].find('<') else {
            out.push_str(&html[i..]);
            break;
        };
        out.push_str(&html[i..i + off]);
        i += off;
        let here = &lower[i..];
        if here.starts_with("<!--") {
            i = here.find("-->").map(|e| i + e + 3).unwrap_or(html.len());
            continue;
        }
        if here.starts_with("<!") {
            i = here.find('>').map(|e| i + e + 1).unwrap_or(html.len());
            continue;
        }
        for tag in SKIP {
            let open = format!("<{tag}");
            if here.starts_with(&open) && !here.as_bytes().get(open.len()).map(|b| b.is_ascii_alphanumeric()).unwrap_or(false) {
                let close = format!("</{tag}");
                i = match here.find(&close) {
                    Some(c) => here[c..].find('>').map(|e| i + c + e + 1).unwrap_or(html.len()),
                    None => html.len(),
                };
                continue 'outer;
            }
        }
        out.push('<');
        i += 1;
    }
    out
}

fn attr(attrs: &str, name: &str) -> Option<String> {
    let lower = attrs.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(name) {
        let start = from + at;
        let before_ok = start == 0 || lower.as_bytes()[start - 1].is_ascii_whitespace();
        let rest = attrs[start + name.len()..].trim_start();
        if before_ok && rest.starts_with('=') {
            let value = rest[1..].trim_start();
            return Some(match value.chars().next() {
                Some(q @ ('"' | '\'')) => value[1..].split(q).next().unwrap_or("").to_string(),
                _ => value.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string(),
            });
        }
        from = start + name.len();
    }
    None
}

fn real_url(href: &str, base: &str) -> Option<String> {
    let joined = url::Url::parse(base).ok()?.join(&decode(href)).ok()?;
    if joined.host_str().map(|h| h.ends_with("duckduckgo.com")).unwrap_or(false) && joined.path() == "/l/" {
        if let Some((_, target)) = joined.query_pairs().find(|(k, _)| k.as_ref() == "uddg") {
            return Some(target.into_owned());
        }
    }
    if joined.scheme() == "javascript" {
        return None;
    }
    Some(joined.to_string())
}

fn is_block_tag(tag: &str) -> bool {
    matches!(
        tag,
        "p" | "div" | "section" | "article" | "header" | "footer" | "main" | "nav" | "aside" | "table" | "tr" | "form"
            | "figure" | "figcaption" | "dl" | "dt" | "dd" | "details" | "summary" | "center" | "body" | "html"
    )
}

fn collapse(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out
}

fn parse(html: &str, base: &str) -> Page {
    let lower = html.to_ascii_lowercase();
    let title = lower
        .find("<title")
        .and_then(|t| lower[t..].find('>').map(|g| t + g + 1))
        .and_then(|start| lower[start..].find("</title").map(|end| collapse(&decode(&html[start..start + end])).trim().to_string()))
        .unwrap_or_default();
    let html = strip_blocks(html);

    let mut blocks: Vec<Block> = Vec::new();
    let mut links: Vec<String> = Vec::new();
    let mut cur = Block { kind: "p".into(), spans: Vec::new() };
    let (mut pre, mut bold, mut ital, mut code, mut depth) = (0i32, 0i32, 0i32, 0i32, 0i32);
    let mut link: Option<String> = None;

    fn open(blocks: &mut Vec<Block>, cur: &mut Block, kind: &str) {
        let next = Block { kind: kind.to_string(), spans: Vec::new() };
        let done = std::mem::replace(cur, next);
        if !done.spans.is_empty() {
            blocks.push(done);
        }
    }

    let mut i = 0;
    while i < html.len() {
        let rest = &html[i..];
        let lt = rest.find('<').unwrap_or(rest.len());
        if lt > 0 {
            let mut t = decode(&rest[..lt]);
            if pre == 0 {
                t = collapse(&t);
            }
            if !t.is_empty() {
                let style = if link.is_some() { Style::Link } else if code > 0 { Style::Code } else if bold > 0 { Style::Bold } else if ital > 0 { Style::Ital } else { Style::Plain };
                cur.spans.push(Span { text: t, style });
            }
            i += lt;
            continue;
        }
        // at '<'
        let after = &rest[1..];
        let is_tag = after.starts_with('/') && after[1..].chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
            || after.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false);
        let Some(gt) = (if is_tag { rest.find('>') } else { None }) else {
            cur.spans.push(Span { text: "<".into(), style: Style::Plain });
            i += 1;
            continue;
        };
        let inner = &rest[1..gt];
        i += gt + 1;
        let closing = inner.starts_with('/');
        let body = inner.trim_start_matches('/');
        let name_len = body.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(body.len());
        let tag = body[..name_len].to_ascii_lowercase();
        let attrs = &body[name_len..];
        let step = if closing { -1 } else { 1 };

        match tag.as_str() {
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => open(&mut blocks, &mut cur, if closing { "p" } else { tag.as_str() }),
            "li" => {
                let kind = format!("li{}", depth.clamp(1, 3));
                open(&mut blocks, &mut cur, if closing { "p" } else { kind.as_str() });
            }
            "ul" | "ol" => {
                depth = (depth + step).max(0);
                open(&mut blocks, &mut cur, "p");
            }
            "pre" => {
                pre = (pre + step).max(0);
                open(&mut blocks, &mut cur, if closing { "p" } else { "pre" });
            }
            "blockquote" => open(&mut blocks, &mut cur, if closing { "p" } else { "quote" }),
            "br" => cur.spans.push(Span { text: "\n".into(), style: Style::Plain }),
            "hr" => {
                open(&mut blocks, &mut cur, "hr");
                cur.spans.push(Span { text: "-".into(), style: Style::Plain });
                open(&mut blocks, &mut cur, "p");
            }
            "td" | "th" => {
                if closing {
                    cur.spans.push(Span { text: "  ".into(), style: Style::Plain });
                }
            }
            "b" | "strong" => bold = (bold + step).max(0),
            "i" | "em" => ital = (ital + step).max(0),
            "code" | "kbd" => code = (code + step).max(0),
            "img" => {
                if let Some(alt) = attr(attrs, "alt").filter(|a| !a.trim().is_empty()) {
                    cur.spans.push(Span { text: format!("[{}]", decode(&alt)), style: Style::Dim });
                }
            }
            "a" => {
                if !closing {
                    link = attr(attrs, "href").and_then(|h| real_url(&h, base));
                } else if let Some(target) = link.take() {
                    links.push(target);
                    cur.spans.push(Span { text: format!("[{}]", links.len()), style: Style::Num });
                }
            }
            t if is_block_tag(t) => {
                let keep = cur.kind.starts_with("li") && !closing && cur.spans.is_empty();
                if !keep {
                    open(&mut blocks, &mut cur, "p");
                }
            }
            _ => {}
        }
    }
    if !cur.spans.is_empty() {
        blocks.push(cur);
    }
    Page { title, blocks, links }
}

// ---------- blocks → styled lines ----------

fn style_code(s: Style) -> String {
    match s {
        Style::Plain => fg(TEXT),
        Style::Bold => format!("{}{BOLD}", fg(TEXT)),
        Style::Ital => format!("{}{ITALIC}", fg(TEXT)),
        Style::Code => fg(CYAN),
        Style::Link => format!("{}{UNDERLINE}", fg(CYAN)),
        Style::Num => format!("{}{BOLD}", fg(YELLOW)),
        Style::Dim => fg(DIM),
    }
}

fn layout(blocks: &[Block], w: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    fn blank(out: &mut Vec<String>) {
        if out.last().map(|l| !l.is_empty()).unwrap_or(false) {
            out.push(String::new());
        }
    }
    for b in blocks {
        if b.kind == "hr" {
            blank(&mut out);
            out.push(format!("{}{}", fg(BORDER), "─".repeat(w.min(60))));
            blank(&mut out);
            continue;
        }
        let plain: String = b.spans.iter().map(|s| s.text.as_str()).collect();
        if plain.trim().is_empty() {
            continue;
        }
        if b.kind == "pre" {
            blank(&mut out);
            for l in plain.trim_matches('\n').split('\n') {
                out.push(format!("{}│ {}{}", fg(BORDER), fg(CYAN), l.replace('\t', "  ")));
            }
            blank(&mut out);
            continue;
        }
        let (mut prefix, mut indent, mut base) = (String::new(), String::new(), String::new());
        match b.kind.as_str() {
            "h1" | "h2" => {
                blank(&mut out);
                prefix = format!("{}{BOLD}{}", fg(VIOLET), if b.kind == "h1" { "◆ " } else { "◇ " });
                base = format!("{}{BOLD}", fg(VIOLET));
            }
            "h3" | "h4" | "h5" | "h6" => {
                blank(&mut out);
                prefix = format!("{}{BOLD}▸ ", fg(PINK));
                base = format!("{}{BOLD}", fg(PINK));
            }
            "quote" => {
                prefix = format!("{}│ ", fg(BORDER));
                indent = "  ".into();
                base = format!("{}{ITALIC}", fg(DIM));
            }
            k if k.starts_with("li") => {
                let d: usize = k[2..].parse().unwrap_or(1).max(1);
                indent = "  ".repeat(d);
                prefix = format!("{}{}• ", "  ".repeat(d - 1), fg(PINK));
            }
            _ => {}
        }
        let mut line = prefix.clone();
        let mut used = width(&prefix);
        let floor = indent.len();
        for s in &b.spans {
            let styled = if base.is_empty() || matches!(s.style, Style::Link | Style::Num) { style_code(s.style) } else { base.clone() };
            // split into words and runs of whitespace
            let mut word = String::new();
            let flush_word = |word: &mut String, line: &mut String, used: &mut usize, out: &mut Vec<String>| {
                if word.is_empty() {
                    return;
                }
                let ww = width(word);
                if *used + ww > w && *used > floor {
                    out.push(std::mem::replace(line, indent.clone()));
                    *used = floor;
                }
                line.push_str(&styled);
                line.push_str(word);
                line.push_str(RESET);
                *used += ww;
                word.clear();
            };
            for c in s.text.chars() {
                if c == '\n' {
                    flush_word(&mut word, &mut line, &mut used, &mut out);
                    out.push(std::mem::replace(&mut line, indent.clone()));
                    used = floor;
                } else if c.is_whitespace() {
                    flush_word(&mut word, &mut line, &mut used, &mut out);
                    if used > floor && used < w {
                        line.push(' ');
                        used += 1;
                    }
                } else {
                    word.push(c);
                }
            }
            flush_word(&mut word, &mut line, &mut used, &mut out);
        }
        if used > floor {
            out.push(line);
        }
        if !b.kind.starts_with("li") {
            blank(&mut out);
        }
    }
    out
}

// ---------- fetching ----------

fn to_url(input: &str) -> String {
    let s = input.trim();
    if s.is_empty() {
        return HOME.to_string();
    }
    if s.contains("://") {
        return s.to_string();
    }
    let host = s.split(['/', ':']).next().unwrap_or("");
    let numeric = !host.is_empty() && host.chars().all(|c| c.is_ascii_digit() || c == '.');
    if host == "localhost" || numeric {
        return format!("http://{s}");
    }
    let dotted = !s.contains(char::is_whitespace) && host.rsplit_once('.').map(|(a, tld)| !a.is_empty() && tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic())).unwrap_or(false);
    if dotted {
        return format!("https://{s}");
    }
    let query: String = url::form_urlencoded::byte_serialize(s.as_bytes()).collect();
    format!("{HOME}?q={query}")
}

struct Fetched {
    url: String,
    html: bool,
    body: String,
    status: u16,
}

fn fetch(target: &str) -> Result<Fetched, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).redirects(8).build();
    let resp = match agent.get(target).set("user-agent", UA).set("accept", "text/html,text/plain,*/*").call() {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(e.to_string()),
    };
    let status = resp.status();
    let final_url = resp.get_url().to_string();
    let ctype = resp.header("content-type").unwrap_or("").to_ascii_lowercase();
    let mut buf = Vec::new();
    resp.into_reader().take(4_000_000).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let body = String::from_utf8_lossy(&buf).into_owned();
    let html = ctype.contains("html") || ctype.contains("xml") || body.trim_start().starts_with('<');
    Ok(Fetched { url: final_url, html, body, status })
}

// ---------- screen ----------

struct Browser {
    url: String,
    title: String,
    blocks: Vec<Block>,
    links: Vec<String>,
    lines: Vec<String>,
    scroll: usize,
    history: Vec<String>,
    status: String,
    input: Option<String>,
    num: String,
}

impl Browser {
    fn relayout(&mut self) {
        let w = size().0.saturating_sub(4).clamp(20, 110);
        self.lines = layout(&self.blocks, w);
    }

    fn load(&mut self, target: &str, push: bool) {
        match fetch(target) {
            Ok(f) => {
                if push && !self.url.is_empty() {
                    self.history.push(self.url.clone());
                }
                self.url = f.url;
                if f.html {
                    let page = parse(&f.body, &self.url);
                    self.title = page.title;
                    self.blocks = page.blocks;
                    self.links = page.links;
                } else {
                    self.title = self.url.clone();
                    self.links.clear();
                    let text: String = f.body.chars().take(200_000).collect();
                    self.blocks = vec![Block { kind: "pre".into(), spans: vec![Span { text, style: Style::Plain }] }];
                }
                self.scroll = 0;
                self.status = if (200..400).contains(&f.status) { String::new() } else { format!("{}HTTP {}", fg(PINK), f.status) };
            }
            Err(e) => self.status = format!("{}{e}", fg(PINK)),
        }
        self.relayout();
    }

    fn render(&mut self) -> Vec<String> {
        let (cols, rows) = size();
        let view = rows.saturating_sub(3);
        self.scroll = self.scroll.min(self.lines.len().saturating_sub(view));
        let bar = bg(BAR);
        let mut out = vec![
            format!("{bar}{}", fit(&format!(" {}{BOLD}◆{RESET}{bar} {}{}", fg(VIOLET), fg(TEXT), if self.title.is_empty() { "browser" } else { self.title.as_str() }), cols, &bar)),
            format!("{bar}{}", fit(&format!(" {}{}", fg(CYAN), self.url), cols, &bar)),
        ];
        for i in 0..view {
            out.push(format!("  {}", self.lines.get(self.scroll + i).map(String::as_str).unwrap_or("")));
        }
        let foot = if let Some(input) = &self.input {
            format!(" {}{BOLD}url / search ›{RESET}{bar} {}{input}█", fg(YELLOW), fg(TEXT))
        } else if !self.num.is_empty() {
            format!(" {}{BOLD}link {}{RESET}{bar}{}  enter open · esc cancel", fg(YELLOW), self.num, fg(DIM))
        } else if !self.status.is_empty() {
            format!(" {}", self.status)
        } else {
            let pct = if self.lines.is_empty() { 100 } else { ((self.scroll + view) * 100 / self.lines.len()).min(100) };
            format!(" {}j/k scroll · 12+enter link · u url · h back · y copy · o system browser · q quit {}{pct}%", fg(DIM), fg(BORDER))
        };
        out.push(format!("{bar}{}", fit(&foot, cols, &bar)));
        out
    }
}

fn open_external(target: &str) -> bool {
    let result = if cfg!(target_os = "macos") {
        command("open").arg(target).spawn()
    } else if cfg!(windows) {
        command("cmd").args(["/c", "start", "", target]).spawn()
    } else {
        command("xdg-open").arg(target).spawn()
    };
    result.is_ok()
}

pub fn main(args: &[String]) -> i32 {
    let mut b = Browser { url: String::new(), title: String::new(), blocks: Vec::new(), links: Vec::new(), lines: Vec::new(), scroll: 0, history: Vec::new(), status: String::new(), input: None, num: String::new() };

    if args.first().map(String::as_str) == Some("--dump") {
        let Some(target) = args.get(1) else {
            eprintln!("usage: nv browse --dump <url>");
            return 2;
        };
        b.load(&to_url(target), false);
        if !b.status.is_empty() && b.lines.is_empty() {
            eprintln!("{}", strip(&b.status));
            return 1;
        }
        println!("{}\n{}\n", b.title, b.url);
        for l in &b.lines {
            println!("{}", strip(l));
        }
        return 0;
    }

    let start = std::env::var("NV_URL").ok().filter(|u| !u.is_empty()).or_else(|| args.first().cloned());
    let screen = Screen::new(false);
    match start {
        Some(target) => {
            b.status = format!("{}loading…", fg(YELLOW));
            screen.draw(&b.render());
            b.load(&to_url(&target), true);
        }
        None => b.input = Some(String::new()),
    }
    screen.draw(&b.render());

    loop {
        if !event::poll(Duration::from_millis(250)).unwrap_or(false) {
            continue;
        }
        match event::read() {
            Ok(Event::Key(k)) if k.kind != KeyEventKind::Release => {
                let view = size().1.saturating_sub(3);
                let mut go: Option<(String, bool)> = None;
                if b.input.is_some() {
                    match k.code {
                        KeyCode::Enter => {
                            let typed = b.input.take().unwrap_or_default();
                            go = Some((to_url(&typed), true));
                        }
                        KeyCode::Esc => b.input = None,
                        KeyCode::Backspace => {
                            if let Some(input) = b.input.as_mut() {
                                input.pop();
                            }
                        }
                        KeyCode::Char(c) if !k.modifiers.contains(KeyModifiers::CONTROL) => {
                            if let Some(input) = b.input.as_mut() {
                                input.push(c);
                            }
                        }
                        _ => {}
                    }
                } else if let KeyCode::Char(c @ '0'..='9') = k.code {
                    b.num.push(c);
                } else if !b.num.is_empty() {
                    match k.code {
                        KeyCode::Enter => {
                            let n: usize = b.num.parse().unwrap_or(0);
                            b.num.clear();
                            match n.checked_sub(1).and_then(|i| b.links.get(i)) {
                                Some(target) => go = Some((target.clone(), true)),
                                None => b.status = format!("{}no such link", fg(PINK)),
                            }
                        }
                        _ => b.num.clear(),
                    }
                } else {
                    b.status.clear();
                    match k.code {
                        KeyCode::Char('q') => return 0,
                        KeyCode::Char('c') if k.modifiers.contains(KeyModifiers::CONTROL) => return 0,
                        KeyCode::Char('j') | KeyCode::Down => b.scroll += 1,
                        KeyCode::Char('k') | KeyCode::Up => b.scroll = b.scroll.saturating_sub(1),
                        KeyCode::Char(' ') | KeyCode::Char('f') | KeyCode::PageDown => b.scroll += view.saturating_sub(1),
                        KeyCode::Char('b') | KeyCode::PageUp => b.scroll = b.scroll.saturating_sub(view.saturating_sub(1)),
                        KeyCode::Char('g') | KeyCode::Home => b.scroll = 0,
                        KeyCode::Char('G') | KeyCode::End => b.scroll = b.lines.len(),
                        KeyCode::Char('u') | KeyCode::Char('/') => b.input = Some(String::new()),
                        KeyCode::Char('r') => go = Some((b.url.clone(), false)),
                        KeyCode::Char('h') | KeyCode::Left | KeyCode::Backspace => {
                            if let Some(prev) = b.history.pop() {
                                go = Some((prev, false));
                            }
                        }
                        KeyCode::Char('y') => {
                            osc52(&b.url);
                            b.status = format!("{}url copied to your clipboard", fg(GREEN));
                        }
                        KeyCode::Char('o') => {
                            b.status = if open_external(&b.url) { format!("{}opened in the system browser of this machine", fg(GREEN)) } else { format!("{}could not open a system browser", fg(PINK)) };
                        }
                        _ => {}
                    }
                }
                if let Some((target, push)) = go {
                    b.status = format!("{}loading {target} …", fg(YELLOW));
                    screen.draw(&b.render());
                    b.load(&target, push);
                }
                screen.draw(&b.render());
            }
            Ok(Event::Resize(_, _)) => {
                b.relayout();
                screen.draw(&b.render());
            }
            _ => {}
        }
    }
}
