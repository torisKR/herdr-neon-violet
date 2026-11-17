//! Files and pull requests in one pane: a file tree with a preview, and the open pull requests
//! of the repository with their description, changed files and comments. Mouse and keys both work.
//!
//! Files          ↑↓/jk move · enter or click open/expand · ← collapse · space/b scroll preview · y copy path
//! Pull requests  ↑↓/jk move · enter or click open · c comment · m merge (asks first) · o open on GitHub
//! Both           tab switch · r refresh · q quit
//! `nv files --dump files|prs [dir]` prints one frame as plain text and exits.

use crate::ui::*;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind};
use serde_json::Value;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

const METHODS: [&str; 3] = ["squash", "merge", "rebase"];
const LIST_FIELDS: &str = "number,title,author,headRefName,baseRefName,isDraft,reviewDecision,updatedAt";
const VIEW_FIELDS: &str = "number,title,body,author,url,isDraft,mergeable,reviewDecision,additions,deletions,headRefName,headRefOid,baseRefName,comments,files,statusCheckRollup";
const PREVIEW_LIMIT: usize = 300_000;

struct Node {
    path: PathBuf,
    name: String,
    depth: usize,
    dir: bool,
    open: bool,
}

struct Pr {
    number: u64,
    title: String,
    author: String,
    draft: bool,
    review: String,
    updated: String,
}

#[derive(PartialEq, Clone, Copy)]
enum Tab {
    Files,
    Prs,
}

struct Comment {
    number: u64,
    body: String,
}

struct App {
    root: PathBuf,
    tab: Tab,
    // files
    nodes: Vec<Node>,
    sel: usize,
    top: usize,
    preview: Vec<String>,
    preview_top: usize,
    // pull requests
    prs: Vec<Pr>,
    pr_sel: usize,
    pr_top: usize,
    pr_error: String,
    detail: Vec<String>,
    detail_top: usize,
    detail_for: Option<u64>,
    detail_head: String,
    detail_width: usize,
    can_merge: bool,
    method: usize,
    confirm: bool,
    input: Option<Comment>,
    note: String,
}

fn children(dir: &Path, depth: usize) -> Vec<Node> {
    let mut out: Vec<Node> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                return None;
            }
            let dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(Node { path: e.path(), name, depth, dir, open: false })
        })
        .take(3000)
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

fn text_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn login(v: &Value) -> String {
    v.get("author").and_then(|a| a.get("login")).and_then(|l| l.as_str()).unwrap_or("unknown").to_string()
}

fn read_preview(path: &Path) -> io::Result<(Vec<u8>, u64)> {
    // Reject links and special files before opening: FIFOs may block at open,
    // and device files can produce an unbounded stream.
    if !std::fs::symlink_metadata(path)?.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "preview requires a regular file"));
    }
    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "preview requires a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(PREVIEW_LIMIT as u64).read_to_end(&mut bytes)?;
    Ok((bytes, metadata.len()))
}

impl App {
    fn new(root: PathBuf) -> App {
        let nodes = children(&root, 0);
        App {
            root, tab: Tab::Files, nodes, sel: 0, top: 0, preview: Vec::new(), preview_top: 0,
            prs: Vec::new(), pr_sel: 0, pr_top: 0, pr_error: String::new(), detail: Vec::new(), detail_top: 0,
            detail_for: None, detail_head: String::new(), detail_width: 0, can_merge: false, method: 0, confirm: false, input: None, note: String::new(),
        }
    }

    // ----- files -----

    fn activate_file(&mut self) {
        let Some(node) = self.nodes.get(self.sel) else { return };
        if node.dir {
            if node.open {
                let depth = node.depth;
                let end = self.nodes[self.sel + 1..].iter().position(|n| n.depth <= depth).map(|p| self.sel + 1 + p).unwrap_or(self.nodes.len());
                self.nodes.drain(self.sel + 1..end);
                self.nodes[self.sel].open = false;
            } else {
                let kids = children(&node.path, node.depth + 1);
                self.nodes[self.sel].open = true;
                let at = self.sel + 1;
                self.nodes.splice(at..at, kids);
            }
        } else {
            self.open_file();
        }
    }

    fn collapse_or_parent(&mut self) {
        let Some(node) = self.nodes.get(self.sel) else { return };
        if node.dir && node.open {
            self.activate_file();
        } else if node.depth > 0 {
            let depth = node.depth;
            if let Some(parent) = self.nodes[..self.sel].iter().rposition(|n| n.depth < depth) {
                self.sel = parent;
            }
        }
    }

    fn open_file(&mut self) {
        let Some(node) = self.nodes.get(self.sel) else { return };
        self.preview_top = 0;
        let rel = strip(&node.path.strip_prefix(&self.root).unwrap_or(&node.path).to_string_lossy().replace('\\', "/"));
        let mut lines = vec![format!("{}{BOLD}{rel}", fg(VIOLET)), String::new()];
        match read_preview(&node.path) {
            Err(e) => lines.push(format!("{}cannot read this file: {}", fg(PINK), strip(&e.to_string()))),
            Ok((bytes, size)) => {
                let head = &bytes[..];
                if head.contains(&0) {
                    lines.push(format!("{}binary file · {size} bytes", fg(DIM)));
                } else {
                    let text = String::from_utf8_lossy(head);
                    for (i, l) in text.lines().enumerate() {
                        lines.push(format!("{}{:>4} {}{}", fg(BORDER), i + 1, fg(TEXT), strip(l)));
                    }
                    if size > head.len() as u64 {
                        lines.push(format!("{}… the first 300 KB of {size} bytes are shown", fg(DIM)));
                    }
                }
            }
        }
        self.preview = lines;
    }

    // ----- pull requests -----

    fn gh(&self, args: &[&str]) -> (bool, String, String) {
        run_full("gh", args, Some(&self.root))
    }

    fn load_prs(&mut self) {
        let (ok, out, err) = self.gh(&["pr", "list", "--state", "open", "--limit", "50", "--json", LIST_FIELDS]);
        self.prs.clear();
        self.pr_error.clear();
        if !ok {
            let text = format!("{err}{out}");
            let lower = text.to_lowercase();
            self.pr_error = if lower.contains("not a git repository") {
                "Not a git repository".into()
            } else if lower.contains("no git remotes") || lower.contains("none of the git remotes") {
                "This folder has no GitHub remote".into()
            } else if lower.contains("gh auth login") || lower.contains("not logged in") {
                "GitHub CLI is not signed in here. Run: gh auth login".into()
            } else if lower.contains("not found") || lower.contains("cannot find") || lower.contains("no such file") {
                "GitHub CLI (gh) is not installed on this machine".into()
            } else {
                text.lines().next().unwrap_or("Could not list pull requests").to_string()
            };
            return;
        }
        let list: Value = serde_json::from_str(&out).unwrap_or(Value::Null);
        for p in list.as_array().into_iter().flatten() {
            self.prs.push(Pr {
                number: p.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
                title: text_of(p, "title"),
                author: login(p),
                draft: p.get("isDraft").and_then(|d| d.as_bool()).unwrap_or(false),
                review: text_of(p, "reviewDecision"),
                updated: text_of(p, "updatedAt").chars().take(10).collect(),
            });
        }
        self.pr_sel = self.pr_sel.min(self.prs.len().saturating_sub(1));
        if let Some(n) = self.detail_for {
            if !self.prs.iter().any(|p| p.number == n) {
                self.detail_for = None;
                self.detail.clear();
            }
        }
    }

    fn load_detail(&mut self, width: usize) {
        let Some(number) = self.prs.get(self.pr_sel).map(|p| p.number) else { return };
        self.load_detail_for(number, width);
    }

    fn load_detail_for(&mut self, number: u64, width: usize) {
        self.confirm = false;
        self.detail_head.clear();
        let (ok, out, err) = self.gh(&["pr", "view", &number.to_string(), "--json", VIEW_FIELDS]);
        self.detail_top = 0;
        self.detail_for = Some(number);
        self.detail_width = width;
        if !ok {
            self.detail = vec![format!("{}{}", fg(PINK), strip(err.lines().next().unwrap_or("could not load this pull request")))];
            self.can_merge = false;
            return;
        }
        let pr: Value = serde_json::from_str(&out).unwrap_or(Value::Null);
        let draft = pr.get("isDraft").and_then(|d| d.as_bool()).unwrap_or(false);
        let mergeable = text_of(&pr, "mergeable");
        self.detail_head = text_of(&pr, "headRefOid");
        self.can_merge = !draft && mergeable != "CONFLICTING" && !self.detail_head.is_empty();
        let (mut pass, mut fail, mut pending) = (0, 0, 0);
        for c in pr.get("statusCheckRollup").and_then(|c| c.as_array()).into_iter().flatten() {
            let conclusion = text_of(c, "conclusion");
            let result = if conclusion.is_empty() { text_of(c, "state") } else { conclusion }.to_uppercase();
            match result.as_str() {
                "SUCCESS" | "NEUTRAL" | "SKIPPED" => pass += 1,
                "FAILURE" | "ERROR" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" => fail += 1,
                _ => pending += 1,
            }
        }
        let w = width.saturating_sub(2).max(20);
        let mut d: Vec<String> = Vec::new();
        for l in wrap(&format!("#{number}  {}", text_of(&pr, "title")), w) {
            d.push(format!("{}{BOLD}{l}", fg(VIOLET)));
        }
        d.push(format!(
            "{}{} wants to merge {} into {}  {}+{} {}−{}",
            fg(DIM), strip(&login(&pr)), strip(&text_of(&pr, "headRefName")), strip(&text_of(&pr, "baseRefName")),
            fg(GREEN), pr.get("additions").and_then(|a| a.as_u64()).unwrap_or(0),
            fg(PINK), pr.get("deletions").and_then(|a| a.as_u64()).unwrap_or(0)
        ));
        let state = if draft { "draft" } else if mergeable == "CONFLICTING" { "has conflicts" } else if mergeable == "MERGEABLE" { "ready to merge" } else { "checking mergeability" };
        let mut chips = format!("{}{state}", fg(if self.can_merge && mergeable == "MERGEABLE" { GREEN } else { YELLOW }));
        if pass + fail + pending > 0 {
            chips.push_str(&format!("{}  ·  {}checks: {pass} passed", fg(DIM), fg(if fail > 0 { PINK } else if pending > 0 { YELLOW } else { GREEN })));
            if fail > 0 {
                chips.push_str(&format!(" · {fail} failed"));
            }
            if pending > 0 {
                chips.push_str(&format!(" · {pending} running"));
            }
        }
        let review = text_of(&pr, "reviewDecision");
        if !review.is_empty() {
            chips.push_str(&format!("{}  ·  {}", fg(DIM), review.replace('_', " ").to_lowercase()));
        }
        d.push(chips);
        d.push(String::new());
        let body = text_of(&pr, "body");
        if body.trim().is_empty() {
            d.push(format!("{}No description", fg(DIM)));
        } else {
            d.extend(wrap(&body, w).into_iter().map(|l| format!("{}{l}", fg(TEXT))));
        }
        let files: Vec<&Value> = pr.get("files").and_then(|f| f.as_array()).into_iter().flatten().collect();
        d.push(String::new());
        d.push(format!("{}{BOLD}Files changed ({})", fg(PINK), files.len()));
        for f in files.iter().take(200) {
            d.push(format!(
                "{}{:>5} {}{:>5}  {}{}",
                fg(GREEN), format!("+{}", f.get("additions").and_then(|a| a.as_u64()).unwrap_or(0)),
                fg(PINK), format!("−{}", f.get("deletions").and_then(|a| a.as_u64()).unwrap_or(0)),
                fg(TEXT), strip(&text_of(f, "path"))
            ));
        }
        let comments: Vec<&Value> = pr.get("comments").and_then(|c| c.as_array()).into_iter().flatten().collect();
        d.push(String::new());
        d.push(format!("{}{BOLD}Comments ({})", fg(PINK), comments.len()));
        let skip = comments.len().saturating_sub(30);
        for c in comments.iter().skip(skip) {
            d.push(String::new());
            d.push(format!("{}{BOLD}{}{RESET}{} · {}", fg(CYAN), strip(&login(c)), fg(DIM), strip(&text_of(c, "createdAt").chars().take(10).collect::<String>())));
            d.extend(wrap(&text_of(c, "body"), w).into_iter().map(|l| format!("{}{l}", fg(TEXT))));
        }
        self.detail = d;
    }

    fn start_comment(&mut self) {
        if let Some(number) = self.detail_for {
            self.input = Some(Comment { number, body: String::new() });
        }
    }

    fn send_comment(&mut self, number: u64, body: &str, width: usize) {
        let (ok, _, err) = self.gh(&["pr", "comment", &number.to_string(), "--body", body]);
        self.note = if ok { format!("{}comment posted on #{number}", fg(GREEN)) } else { format!("{}comment failed: {}", fg(PINK), strip(err.lines().next().unwrap_or(""))) };
        if ok && self.detail_for == Some(number) {
            self.load_detail_for(number, width);
        }
    }

    fn merge_args(&self) -> Option<Vec<String>> {
        let number = self.detail_for?;
        if self.detail_head.is_empty() { return None; }
        Some(vec!["pr".into(), "merge".into(), number.to_string(), format!("--{}", METHODS[self.method]), "--match-head-commit".into(), self.detail_head.clone()])
    }

    fn merge(&mut self) {
        let Some(args) = self.merge_args() else { return };
        let number = self.detail_for.unwrap();
        let (ok, _, err) = self.gh(&args.iter().map(String::as_str).collect::<Vec<_>>());
        if ok {
            self.note = format!("{}merged #{number} ({})", fg(GREEN), METHODS[self.method]);
            self.detail.clear();
            self.detail_for = None;
            self.load_prs();
        } else {
            self.note = format!("{}merge failed: {}", fg(PINK), strip(err.lines().next().unwrap_or("")));
        }
    }

    // ----- screen -----

    fn left_width(&self, cols: usize) -> usize {
        (cols / 3).clamp(24, 52).min(cols.saturating_sub(20))
    }

    fn render(&mut self) -> Vec<String> {
        let (cols, rows) = size();
        let base = bg(BG);
        let bar = bg(BAR);
        let lw = self.left_width(cols);
        let rw = cols.saturating_sub(lw + 1);
        let view = rows.saturating_sub(2);

        let tab = |on: bool, label: String| {
            if on { format!("{}{}{BOLD} {label} {RESET}{bar}", bg(VIOLET), fg(BG)) } else { format!("{} {label} {RESET}{bar}", fg(DIM)) }
        };
        let head = format!(
            "{bar} {}{} {}  {}{}",
            tab(self.tab == Tab::Files, "Files".to_string()),
            tab(self.tab == Tab::Prs, format!("Pull requests {}", self.prs.len())),
            fg(BORDER), fg(DIM), strip(&self.root.to_string_lossy())
        );
        let mut out = vec![fit(&head, cols, &bar)];

        // keep the selection on screen
        let (sel, top, total) = match self.tab {
            Tab::Files => (self.sel, &mut self.top, self.nodes.len()),
            Tab::Prs => (self.pr_sel, &mut self.pr_top, self.prs.len()),
        };
        if sel < *top {
            *top = sel;
        } else if view > 0 && sel >= *top + view {
            *top = sel + 1 - view;
        }
        *top = (*top).min(total.saturating_sub(1));
        let top = *top;

        let (right, right_top): (&Vec<String>, usize) = match self.tab {
            Tab::Files => (&self.preview, self.preview_top),
            Tab::Prs => (&self.detail, self.detail_top),
        };
        let hint = match self.tab {
            Tab::Files => "Select a file to preview it".to_string(),
            Tab::Prs if !self.pr_error.is_empty() => self.pr_error.clone(),
            Tab::Prs if self.prs.is_empty() => "No open pull requests".to_string(),
            Tab::Prs => "Select a pull request".to_string(),
        };
        for y in 0..view {
            let i = top + y;
            let selected = i == sel && i < total;
            let row_bg = if selected { bg(SEL) } else { base.clone() };
            let left = match self.tab {
                Tab::Files => match self.nodes.get(i) {
                    Some(n) => {
                        let icon = if n.dir { if n.open { "▾ " } else { "▸ " } } else { "  " };
                        let color = if n.dir { CYAN } else if n.name.starts_with('.') { DIM } else { TEXT };
                        format!("{row_bg} {}{}{icon}{}{}{}", "  ".repeat(n.depth), fg(BORDER), fg(color), if n.dir || selected { BOLD } else { "" }, strip(&n.name))
                    }
                    None => String::new(),
                },
                Tab::Prs => match self.prs.get(i) {
                    Some(p) => {
                        let dot = if p.draft { DIM } else if p.review == "APPROVED" { GREEN } else if p.review == "CHANGES_REQUESTED" { PINK } else { YELLOW };
                        format!("{row_bg} {}● {}#{} {}{}{} {}{}", fg(dot), fg(VIOLET), p.number, fg(TEXT), if selected { BOLD } else { "" }, strip(&p.title), fg(DIM), format_args!("{} · {}", strip(&p.author), strip(&p.updated)))
                    }
                    None => String::new(),
                },
            };
            let right_line = match right.get(right_top + y) {
                Some(l) => l.clone(),
                None if right.is_empty() && y == 1 => format!("{}{}", fg(DIM), strip(&hint)),
                None => String::new(),
            };
            out.push(format!("{}{RESET}{base}{}│{RESET}{base} {}", fit(&left, lw, &row_bg), fg(BORDER), fit(&right_line, rw.saturating_sub(1), "")));
        }

        let foot = if let Some(input) = &self.input {
            format!(" {}{BOLD}comment #{} ›{RESET}{bar} {}{}█   {}enter send · esc cancel", fg(YELLOW), input.number, fg(TEXT), strip(&input.body), fg(DIM))
        } else if self.confirm {
            format!(" {}{BOLD}{} merge #{}?{RESET}{bar}  {}y yes · s change method · any other key cancels", fg(PINK), METHODS[self.method], self.detail_for.unwrap_or(0), fg(TEXT))
        } else if !self.note.is_empty() {
            format!(" {}", self.note)
        } else if self.tab == Tab::Files {
            format!(" {}↑↓ move · enter open · ← collapse · space/b scroll · y copy path · tab pull requests · r refresh · q quit", fg(DIM))
        } else {
            format!(" {}↑↓ move · enter open · c comment · m merge · o open on GitHub · tab files · r refresh · q quit", fg(DIM))
        };
        out.push(format!("{bar}{}", fit(&foot, cols, &bar)));
        out
    }

    fn switch(&mut self, tab: Tab) {
        self.tab = tab;
        self.confirm = false;
        if tab == Tab::Prs && self.prs.is_empty() && self.pr_error.is_empty() {
            self.load_prs();
        }
    }

    fn activate(&mut self, right_width: usize) {
        match self.tab {
            Tab::Files => self.activate_file(),
            Tab::Prs => self.load_detail(right_width),
        }
    }

    fn scroll_right(&mut self, delta: isize) {
        let (top, len) = match self.tab {
            Tab::Files => (&mut self.preview_top, self.preview.len()),
            Tab::Prs => (&mut self.detail_top, self.detail.len()),
        };
        *top = (*top as isize + delta).clamp(0, len.saturating_sub(1) as isize) as usize;
    }

    fn move_sel(&mut self, delta: isize) {
        let (sel, len) = match self.tab {
            Tab::Files => (&mut self.sel, self.nodes.len()),
            Tab::Prs => (&mut self.pr_sel, self.prs.len()),
        };
        *sel = (*sel as isize + delta).clamp(0, len.saturating_sub(1) as isize) as usize;
    }
}

pub fn main(args: &[String]) -> i32 {
    let dump = if args.first().map(String::as_str) == Some("--dump") { args.get(1).cloned() } else { None };
    let dir_arg = if dump.is_some() { args.get(2) } else { args.first() };
    let root = dir_arg.map(PathBuf::from).or_else(|| std::env::current_dir().ok()).unwrap_or_else(|| PathBuf::from("."));
    let mut app = App::new(root);

    if let Some(what) = dump {
        let (cols, _) = size();
        let rw = cols.saturating_sub(app.left_width(cols) + 2);
        if what == "prs" {
            app.switch(Tab::Prs);
            app.load_detail(rw);
        } else if let Some(i) = app.nodes.iter().position(|n| !n.dir) {
            app.sel = i;
            app.open_file();
        }
        for l in app.render() {
            println!("{}", strip(&l).trim_end());
        }
        return 0;
    }

    let screen = Screen::new(true);
    screen.draw(&app.render());
    loop {
        if !event::poll(Duration::from_millis(250)).unwrap_or(false) {
            continue;
        }
        let (cols, rows) = size();
        let lw = app.left_width(cols);
        let rw = cols.saturating_sub(lw + 2);
        let page = rows.saturating_sub(3).max(1) as isize;
        match event::read() {
            Ok(Event::Key(k)) if k.kind != KeyEventKind::Release => {
                if app.input.is_some() {
                    match k.code {
                        KeyCode::Enter => {
                            if let Some(comment) = app.input.take() {
                                if !comment.body.trim().is_empty() {
                                    app.send_comment(comment.number, comment.body.trim(), rw);
                                }
                            }
                        }
                        KeyCode::Esc => app.input = None,
                        KeyCode::Backspace => {
                            if let Some(input) = app.input.as_mut() {
                                input.body.pop();
                            }
                        }
                        KeyCode::Char(c) if !k.modifiers.contains(KeyModifiers::CONTROL) => {
                            if let Some(input) = app.input.as_mut() {
                                input.body.push(c);
                            }
                        }
                        _ => {}
                    }
                } else if app.confirm {
                    match k.code {
                        KeyCode::Char('y') => {
                            app.confirm = false;
                            app.merge();
                        }
                        KeyCode::Char('s') => app.method = (app.method + 1) % METHODS.len(),
                        _ => app.confirm = false,
                    }
                } else {
                    app.note.clear();
                    match k.code {
                        KeyCode::Char('q') => return 0,
                        KeyCode::Char('c') if k.modifiers.contains(KeyModifiers::CONTROL) => return 0,
                        KeyCode::Tab => app.switch(if app.tab == Tab::Files { Tab::Prs } else { Tab::Files }),
                        KeyCode::Down | KeyCode::Char('j') => app.move_sel(1),
                        KeyCode::Up | KeyCode::Char('k') => app.move_sel(-1),
                        KeyCode::Enter | KeyCode::Right => app.activate(rw),
                        KeyCode::Left if app.tab == Tab::Files => app.collapse_or_parent(),
                        KeyCode::Char(' ') | KeyCode::PageDown => app.scroll_right(page),
                        KeyCode::Char('b') | KeyCode::PageUp => app.scroll_right(-page),
                        KeyCode::Char('r') => {
                            if app.tab == Tab::Files {
                                app.nodes = children(&app.root, 0);
                                app.sel = 0;
                            } else {
                                app.load_prs();
                                if app.detail_for.is_some() {
                                    app.load_detail(rw);
                                }
                            }
                        }
                        KeyCode::Char('y') if app.tab == Tab::Files => {
                            if let Some(n) = app.nodes.get(app.sel) {
                                let path = n.path.to_string_lossy().into_owned();
                                osc52(&path);
                                app.note = format!("{}copied {}", fg(GREEN), strip(&path));
                            }
                        }
                        KeyCode::Char('c') if app.tab == Tab::Prs && app.detail_for.is_some() => app.start_comment(),
                        KeyCode::Char('m') if app.tab == Tab::Prs && app.detail_for.is_some() => {
                            if app.can_merge {
                                app.confirm = true;
                            } else {
                                app.note = format!("{}this pull request cannot be merged yet (draft or conflicts)", fg(PINK));
                            }
                        }
                        KeyCode::Char('o') if app.tab == Tab::Prs => {
                            if let Some(n) = app.detail_for.or_else(|| app.prs.get(app.pr_sel).map(|p| p.number)) {
                                app.gh(&["pr", "view", &n.to_string(), "--web"]);
                                app.note = format!("{}opened #{n} in the browser of this machine", fg(GREEN));
                            }
                        }
                        _ => {}
                    }
                }
                screen.draw(&app.render());
            }
            Ok(Event::Mouse(m)) => {
                let (x, y) = (m.column as usize, m.row as usize);
                match m.kind {
                    MouseEventKind::Down(MouseButton::Left) => {
                        if y == 0 {
                            // " Files " starts at column 1; everything right of it is the other tab
                            app.switch(if x < 9 { Tab::Files } else { Tab::Prs });
                        } else if y < rows.saturating_sub(1) && x < lw {
                            let (top, len) = if app.tab == Tab::Files { (app.top, app.nodes.len()) } else { (app.pr_top, app.prs.len()) };
                            let index = top + y - 1;
                            if index < len {
                                if app.tab == Tab::Files { app.sel = index } else { app.pr_sel = index }
                                app.activate(rw);
                            }
                        }
                    }
                    MouseEventKind::ScrollDown => {
                        if x < lw { app.move_sel(3) } else { app.scroll_right(3) }
                    }
                    MouseEventKind::ScrollUp => {
                        if x < lw { app.move_sel(-3) } else { app.scroll_right(-3) }
                    }
                    _ => continue,
                }
                screen.draw(&app.render());
            }
            Ok(Event::Resize(_, _)) => screen.draw(&app.render()),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!("nv-preview-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn preview_reads_only_the_prefix_of_a_large_file() {
        let dir = TempDir::new();
        let path = dir.0.join("large.bin");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"prefix").unwrap();
        file.set_len(20_000_000).unwrap();
        let (bytes, size) = read_preview(&path).unwrap();
        assert_eq!(bytes.len(), PREVIEW_LIMIT);
        assert_eq!(size, 20_000_000);
        assert!(bytes.starts_with(b"prefix"));
    }

    #[test]
    fn file_preview_removes_terminal_controls_before_styling() {
        let dir = TempDir::new();
        std::fs::write(dir.0.join("content.txt"), "before\x1b]52;c;dGVzdA==\x07\x1b[31mafter\x1b[0m\n\x1bé\t한글").unwrap();
        let mut app = App::new(dir.0.clone());
        app.open_file();
        let preview = app.preview.join("\n");
        assert!(strip(&preview).contains("beforeafter"));
        assert!(strip(&preview).contains("é  한글"));
        assert!(!preview.contains("\x1b]52;") && !preview.contains("\x1b[31m"));
    }

    #[test]
    fn directories_are_not_opened_as_preview_streams() {
        let dir = TempDir::new();
        assert_eq!(read_preview(&dir.0).unwrap_err().kind(), io::ErrorKind::InvalidInput);
    }

    #[cfg(unix)]
    #[test]
    fn links_and_special_files_are_rejected_before_opening() {
        use std::os::unix::{fs::symlink, net::UnixListener};
        let dir = TempDir::new();
        let link = dir.0.join("device-link");
        symlink("/dev/zero", &link).unwrap();
        assert_eq!(read_preview(&link).unwrap_err().kind(), io::ErrorKind::InvalidInput);
        let socket = dir.0.join("socket");
        let _listener = UnixListener::bind(&socket).unwrap();
        assert_eq!(read_preview(&socket).unwrap_err().kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn comment_draft_keeps_its_target_after_navigation() {
        let dir = TempDir::new();
        let mut app = App::new(dir.0.clone());
        app.detail_for = Some(11);
        app.start_comment();
        app.input.as_mut().unwrap().body.push_str("comment for the first PR");
        // A mouse activation can replace the detail pane while a draft is open.
        app.detail_for = Some(22);
        assert!(strip(&app.render().join("\n")).contains("comment #11"));
        let draft = app.input.take().unwrap();
        assert_eq!(draft.number, 11);
        assert_eq!(draft.body, "comment for the first PR");
    }

    #[test]
    fn merge_requires_the_displayed_head_commit() {
        let dir = TempDir::new();
        let mut app = App::new(dir.0.clone());
        app.detail_for = Some(11);
        assert!(app.merge_args().is_none());
        app.detail_head = "reviewed-head".into();
        assert_eq!(app.merge_args().unwrap(), ["pr", "merge", "11", "--squash", "--match-head-commit", "reviewed-head"]);
    }
}
