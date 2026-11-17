//! ALL agents — every agent on this herdr server, tiled in one tab.
//! Keys: 1-9 jump to that agent · r refresh · q quit
//!       ctrl+d done · ctrl+w working · ctrl+i idle · ctrl+a all (plain d/w/i/a work too, b = blocked)

use crate::ui::*;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{Duration, Instant};

struct Agent {
    pane: String,
    name: String,
    status: String,
    place: String,
    cwd: String,
    lines: Vec<String>,
}

/// (icon, label, color, rank) of a status; lower rank is more urgent.
fn state(status: &str) -> (&'static str, &'static str, Rgb, u8) {
    match status {
        "blocked" => ("▲", "BLOCKED", PINK, 0),
        "working" => ("●", "WORKING", YELLOW, 1),
        "done" => ("✔", "DONE", GREEN, 2),
        "idle" => ("○", "IDLE", CYAN, 3),
        _ => ("·", "UNKNOWN", DIM, 4),
    }
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn labels(result: Option<Value>, list: &str, id: &str) -> HashMap<String, String> {
    result
        .and_then(|r| r.get(list).and_then(|l| l.as_array().cloned()))
        .unwrap_or_default()
        .iter()
        .map(|x| {
            let key = text(x, id);
            let label = text(x, "label");
            (key.clone(), if label.is_empty() { key } else { label })
        })
        .collect()
}

fn refresh(rows: usize) -> Result<Vec<Agent>, String> {
    let list = herdr(&["agent", "list"]).ok_or("herdr API not reachable")?;
    let spaces = labels(herdr(&["workspace", "list"]), "workspaces", "workspace_id");
    let tabs = labels(herdr(&["tab", "list"]), "tabs", "tab_id");
    let me = std::env::var("HERDR_PANE_ID").unwrap_or_default();
    let mut agents: Vec<Agent> = list
        .get("agents")
        .and_then(|a| a.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter(|a| text(a, "pane_id") != me)
        .map(|a| {
            let (ws, tab) = (text(a, "workspace_id"), text(a, "tab_id"));
            let name = text(a, "agent");
            Agent {
                pane: text(a, "pane_id"),
                name: if name.is_empty() { "agent".into() } else { name },
                status: text(a, "agent_status"),
                place: format!("{} / {}", spaces.get(&ws).unwrap_or(&ws), tabs.get(&tab).unwrap_or(&tab)),
                cwd: text(a, "cwd"),
                lines: Vec::new(),
            }
        })
        .collect();
    let bin = herdr_bin();
    let count = rows.to_string();
    std::thread::scope(|scope| {
        for a in agents.iter_mut() {
            let (bin, count) = (&bin, &count);
            scope.spawn(move || {
                let out = run(bin, &["agent", "read", &a.pane, "--lines", count, "--source", "recent"]).unwrap_or_default();
                a.lines = clean_lines(&out);
            });
        }
    });
    agents.sort_by(|a, b| state(&a.status).3.cmp(&state(&b.status).3).then(a.place.cmp(&b.place)));
    Ok(agents)
}

fn card(a: &Agent, index: usize, w: usize, h: usize) -> Vec<String> {
    let (b, base) = (fg(BORDER), bg(BG));
    let (icon, label, color, _) = state(&a.status);
    let number = if index < 9 { (index + 1).to_string() } else { " ".to_string() };
    let head = format!(
        " {}{BOLD}{number}{RESET}{base} {}{icon}{RESET}{base} {}{BOLD}{}{RESET}{base}{} · {} ",
        fg(YELLOW), fg(color), fg(VIOLET), a.name, fg(DIM), a.place
    );
    let inner = w.saturating_sub(4);
    let mut out = vec![format!("{b}╭─{}{b}─╮", fit_rule(&head, inner, &b))];
    let body = h.saturating_sub(2);
    let start = a.lines.len().saturating_sub(body);
    for i in 0..body {
        let line = a.lines.get(start + i).map(String::as_str).unwrap_or("");
        out.push(format!("{b}│{RESET}{base}{} {} {b}│", fg(TEXT), fit(line, inner, "")));
    }
    let folder = a.cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or("");
    let foot = format!(" {}{BOLD}{label}{RESET}{base}{} · {} ", fg(color), fg(DIM), if folder.is_empty() { a.pane.as_str() } else { folder });
    out.push(format!("{b}╰─{}{b}─╯", fit_rule(&foot, inner, &b)));
    out
}

fn render(agents: &[Agent], filter: &str, error: &str) -> Vec<String> {
    let (cols, rows) = size();
    let base = bg(BG);
    let shown: Vec<&Agent> = agents.iter().filter(|a| filter == "all" || a.status == filter).collect();
    let count = |s: &str| agents.iter().filter(|a| a.status == s).count();
    let tab = |key: &str, label: String, color: Rgb| {
        if filter == key {
            format!("{}{}{BOLD} {label} {RESET}{base}", bg(color), fg(BG))
        } else {
            format!("{} {label} {RESET}{base}", fg(color))
        }
    };
    let mut summary = vec![tab("all", format!("all {}", agents.len()), VIOLET)];
    for key in ["blocked", "working", "done", "idle"] {
        let (icon, label, color, _) = state(key);
        summary.push(tab(key, format!("{icon} {} {}", count(key), label.to_lowercase()), color));
    }
    let mut lines = vec![format!(" {}{BOLD}◆ ALL agents{RESET}{base}  {}", fg(VIOLET), summary.join(" "))];

    if !error.is_empty() {
        lines.push(format!(" {}{error}", fg(PINK)));
    } else if agents.is_empty() {
        lines.push(format!(" {}No agents yet. Start claude / codex / gemini in any pane and it shows up here.", fg(DIM)));
    } else if shown.is_empty() {
        lines.push(format!(" {}No {filter} agents right now. Press ctrl+a to show all.", fg(DIM)));
    } else {
        let n = shown.len();
        let ncol = (if cols >= 150 { 3 } else if cols >= 96 { 2 } else { 1 }).min(n).max(1);
        let nrow = n.div_ceil(ncol);
        let card_h = (rows.saturating_sub(3) / nrow).max(4);
        let card_w = (cols.saturating_sub(ncol - 1)) / ncol;
        for r in 0..nrow {
            let row: Vec<Vec<String>> = shown[r * ncol..(r * ncol + ncol).min(n)]
                .iter()
                .enumerate()
                .map(|(i, a)| card(a, r * ncol + i, card_w, card_h))
                .collect();
            for y in 0..card_h {
                let parts: Vec<&str> = row.iter().map(|c| c[y].as_str()).collect();
                lines.push(parts.join(&format!("{base} ")));
            }
        }
    }
    lines.resize(rows.saturating_sub(1), String::new());
    lines.push(format!("{} 1-9 jump  ctrl+d done  ctrl+w working  ctrl+i idle  ctrl+a all  b blocked  r refresh  q close", fg(DIM)));
    lines
}

pub fn main() -> i32 {
    let screen = Screen::new(false);
    let mut agents: Vec<Agent> = Vec::new();
    let mut error = String::new();
    let mut filter = "all".to_string();
    let mut last: Option<Instant> = None;
    loop {
        if last.map(|t| t.elapsed() >= Duration::from_millis(1500)).unwrap_or(true) {
            match refresh(size().1) {
                Ok(list) => {
                    agents = list;
                    error.clear();
                }
                Err(e) => error = e,
            }
            last = Some(Instant::now());
            screen.draw(&render(&agents, &filter, &error));
        }
        if !event::poll(Duration::from_millis(120)).unwrap_or(false) {
            continue;
        }
        match event::read() {
            Ok(Event::Key(k)) if k.kind != KeyEventKind::Release => {
                let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
                match k.code {
                    KeyCode::Char('q') => return 0,
                    KeyCode::Char('c') if ctrl => return 0,
                    KeyCode::Char('r') => last = None,
                    KeyCode::Char('d') => filter = "done".into(),
                    KeyCode::Char('w') => filter = "working".into(),
                    KeyCode::Char('i') | KeyCode::Tab => filter = "idle".into(),
                    KeyCode::Char('a') => filter = "all".into(),
                    KeyCode::Char('b') => filter = "blocked".into(),
                    KeyCode::Char(c @ '1'..='9') => {
                        let index = c as usize - '1' as usize;
                        let shown: Vec<&Agent> = agents.iter().filter(|a| filter == "all" || a.status == filter).collect();
                        if let Some(a) = shown.get(index) {
                            herdr(&["agent", "focus", &a.pane]);
                        }
                    }
                    _ => {}
                }
                screen.draw(&render(&agents, &filter, &error));
            }
            Ok(Event::Resize(_, _)) => screen.draw(&render(&agents, &filter, &error)),
            _ => {}
        }
    }
}
