//! Devices — Android devices/emulators (adb) and iOS simulators/devices (macOS)
//! on the machine this pane runs on.
//! Keys: ↑↓ / j k select · enter boot a stopped emulator/simulator · y copy id · r refresh · q close
//! `nv devices --once` prints the list as plain text and exits.

use crate::ui::*;
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Clone)]
struct Row {
    kind: &'static str, // android | avd | sim | ios
    id: String,
    name: String,
    state: String, // online | stopped | unauthorized | offline | ...
    detail: String,
    emulator: bool,
    avd: String,
}

struct Tools {
    adb: String,
    emulator: String,
    /// NV_DEMO_DIR: read canned tool output from fixture files (screenshots, parser tests).
    demo: Option<PathBuf>,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default())
}

fn find_tool(name: &str, sub: &str, var: &str) -> String {
    if let Ok(p) = std::env::var(var) {
        if !p.is_empty() {
            return p;
        }
    }
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut roots: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"].iter().filter_map(|v| std::env::var(v).ok()).map(PathBuf::from).collect();
    roots.push(home().join("Library").join("Android").join("sdk"));
    roots.push(home().join("Android").join("Sdk"));
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Android").join("Sdk"));
    }
    for root in roots {
        let p = root.join(sub).join(&exe);
        if p.is_file() {
            return p.to_string_lossy().into_owned();
        }
    }
    name.to_string() // fall back to PATH
}

impl Tools {
    fn new() -> Tools {
        Tools {
            adb: find_tool("adb", "platform-tools", "NV_ADB"),
            emulator: find_tool("emulator", "emulator", "NV_EMULATOR"),
            demo: std::env::var("NV_DEMO_DIR").ok().filter(|d| !d.is_empty()).map(PathBuf::from),
        }
    }

    fn exec(&self, program: &str, args: &[&str]) -> Option<String> {
        if let Some(dir) = &self.demo {
            let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let raw = format!("{stem} {}", args.join(" "));
            let mut name = String::new();
            let mut gap = false;
            for c in raw.chars() {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                    name.push(c);
                    gap = false;
                } else if !gap {
                    name.push('_');
                    gap = true;
                }
            }
            return std::fs::read_to_string(dir.join(format!("{name}.txt"))).ok();
        }
        run(program, args)
    }

    fn mac(&self) -> bool {
        cfg!(target_os = "macos") || self.demo.is_some()
    }
}

fn android(t: &Tools) -> (bool, Vec<Row>) {
    let Some(out) = t.exec(&t.adb, &["devices", "-l"]) else { return (true, Vec::new()) };
    const STATES: [&str; 6] = ["device", "offline", "unauthorized", "recovery", "sideload", "bootloader"];
    let mut rows: Vec<Row> = Vec::new();
    for line in out.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let state = if STATES.contains(&parts[1]) { parts[1] } else if line.contains("no permissions") { "no permissions" } else { continue };
        let model = parts.iter().find_map(|p| p.strip_prefix("model:")).unwrap_or(parts[0]);
        rows.push(Row {
            kind: "android",
            id: parts[0].to_string(),
            name: model.replace('_', " "),
            state: if state == "device" { "online".into() } else { state.to_string() },
            detail: String::new(),
            emulator: parts[0].starts_with("emulator-"),
            avd: String::new(),
        });
    }
    std::thread::scope(|scope| {
        for r in rows.iter_mut().filter(|r| r.state == "online") {
            scope.spawn(move || {
                let version = t.exec(&t.adb, &["-s", &r.id, "shell", "getprop", "ro.build.version.release"]);
                if r.emulator {
                    if let Some(avd) = t.exec(&t.adb, &["-s", &r.id, "emu", "avd", "name"]) {
                        r.avd = avd.lines().next().unwrap_or("").trim().to_string();
                        if !r.avd.is_empty() {
                            r.name = r.avd.replace('_', " ");
                        }
                    }
                }
                r.detail = format!(
                    "Android {} · {}",
                    version.as_deref().map(str::trim).filter(|v| !v.is_empty()).unwrap_or("?"),
                    if r.emulator { "emulator" } else { "device" }
                );
            });
        }
    });
    (false, rows)
}

fn avds(t: &Tools, running: &[Row]) -> Vec<Row> {
    let Some(out) = t.exec(&t.emulator, &["-list-avds"]) else { return Vec::new() };
    out.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.contains(char::is_whitespace) && !running.iter().any(|r| r.avd == *l))
        .map(|name| Row {
            kind: "avd",
            id: name.to_string(),
            name: name.replace('_', " "),
            state: "stopped".into(),
            detail: "Android emulator · not running".into(),
            emulator: true,
            avd: name.to_string(),
        })
        .collect()
}

fn simulators(t: &Tools) -> Vec<Row> {
    if !t.mac() {
        return Vec::new();
    }
    let Some(out) = t.exec("xcrun", &["simctl", "list", "devices", "available", "--json"]) else { return Vec::new() };
    let Ok(data) = serde_json::from_str::<Value>(&out) else { return Vec::new() };
    let mut rows = Vec::new();
    for (runtime, list) in data.get("devices").and_then(|d| d.as_object()).into_iter().flatten() {
        // com.apple.CoreSimulator.SimRuntime.iOS-18-2 -> "iOS 18.2"
        let tail = runtime.rsplit('.').next().unwrap_or("");
        let os = match tail.split_once('-') {
            Some((name, version)) => format!("{name} {}", version.replace('-', ".")),
            None => tail.to_string(),
        };
        for d in list.as_array().into_iter().flatten() {
            let get = |k: &str| d.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            rows.push(Row {
                kind: "sim",
                id: get("udid"),
                name: get("name"),
                state: if get("state") == "Booted" { "online".into() } else { "stopped".into() },
                detail: format!("{os} · simulator"),
                emulator: false,
                avd: String::new(),
            });
        }
    }
    rows
}

/// Connected iPhones and iPads: lines like `iPhone 15 (18.1) (00008120-…)` under "== Devices ==".
fn ios_devices(t: &Tools) -> Vec<Row> {
    if !t.mac() {
        return Vec::new();
    }
    let Some(out) = t.exec("xcrun", &["xctrace", "list", "devices"]) else { return Vec::new() };
    let mut rows = Vec::new();
    let mut inside = false;
    for line in out.lines() {
        let line = line.trim();
        if line.starts_with("== ") {
            inside = line.starts_with("== Devices ==");
            continue;
        }
        if !inside || !line.ends_with(')') {
            continue;
        }
        let Some(cut) = line.rfind(" (") else { continue };
        let (rest, udid) = (&line[..cut], &line[cut + 2..line.len() - 1]);
        let Some(cut) = rest.rfind(" (") else { continue }; // the Mac itself has no version part
        if !rest.ends_with(')') {
            continue;
        }
        let (name, version) = (&rest[..cut], &rest[cut + 2..rest.len() - 1]);
        if version.chars().all(|c| c.is_ascii_digit() || c == '.') {
            rows.push(Row { kind: "ios", id: udid.to_string(), name: name.to_string(), state: "online".into(), detail: format!("iOS {version} · device"), emulator: false, avd: String::new() });
        }
    }
    rows
}

struct State {
    sections: Vec<(String, Vec<Row>)>,
    adb_missing: bool,
    sel: usize,
    note: String,
    loading: bool,
    phones: Vec<Row>,
    phones_at: Option<Instant>,
}

impl State {
    fn flat(&self) -> Vec<&Row> {
        self.sections.iter().flat_map(|(_, rows)| rows.iter()).collect()
    }

    fn refresh(&mut self, t: &Tools) {
        let (missing, connected) = android(t);
        let sims = simulators(t);
        if self.phones_at.map(|at| at.elapsed() > Duration::from_secs(15)).unwrap_or(true) {
            self.phones = ios_devices(t);
            self.phones_at = Some(Instant::now());
        }
        let stopped = avds(t, &connected);
        let mut ios: Vec<Row> = self.phones.clone();
        ios.extend(sims.iter().filter(|s| s.state == "online").cloned());
        self.adb_missing = missing;
        self.sections = vec![
            ("Android · connected".to_string(), connected),
            ("iOS · connected".to_string(), ios),
            ("Android emulators · not running".to_string(), stopped),
            ("iOS simulators · not running".to_string(), sims.into_iter().filter(|s| s.state != "online").collect()),
        ]
        .into_iter()
        .filter(|(_, rows)| !rows.is_empty())
        .collect();
        let total = self.flat().len();
        self.sel = self.sel.min(total.saturating_sub(1));
        self.loading = false;
    }
}

fn render(s: &State) -> Vec<String> {
    let (cols, rows) = size();
    let base = bg(BG);
    let flat = s.flat();
    let online = flat.iter().filter(|r| r.state == "online").count();
    let status = if s.loading { "scanning…".to_string() } else { format!("{online} connected · {} not connected", flat.len() - online) };
    let mut lines = vec![format!(" {}{BOLD}◆ Devices{RESET}{base}  {}{status}", fg(VIOLET), fg(DIM)), String::new()];

    let mut body: Vec<(String, bool)> = Vec::new();
    let mut index = 0;
    for (title, list) in &s.sections {
        body.push((format!(" {}{BOLD}{title}{RESET}{base}", fg(PINK)), false));
        for r in list {
            let selected = index == s.sel;
            let row_bg = if selected { bg(SEL) } else { base.clone() };
            let dot = match r.state.as_str() {
                "online" => format!("{}●", fg(GREEN)),
                "stopped" => format!("{}○", fg(DIM)),
                _ => format!("{}▲", fg(PINK)),
            };
            let normal = r.state == "online" || r.state == "stopped";
            let line = format!(
                " {}{row_bg} {dot} {}{}{}{RESET}{row_bg} {}{} {}{}",
                if selected { format!("{}{BOLD}›{RESET}", fg(YELLOW)) } else { " ".to_string() },
                fg(TEXT),
                if selected { BOLD } else { "" },
                fit(&r.name, 30, ""),
                fg(CYAN),
                fit(&r.id, 38, ""),
                fg(if normal { DIM } else { PINK }),
                if normal { &r.detail } else { &r.state }
            );
            body.push((if selected { fit(&line, cols, &row_bg) } else { line }, selected));
            index += 1;
        }
        body.push((String::new(), false));
    }
    if !s.loading && flat.is_empty() {
        body.push((format!(" {}No devices found.", fg(DIM)), false));
    }
    if s.adb_missing {
        body.push((format!(" {}adb not found{} — install Android platform-tools or set ANDROID_HOME.", fg(YELLOW), fg(DIM)), false));
    }
    let view = rows.saturating_sub(4);
    let at = body.iter().position(|(_, selected)| *selected).unwrap_or(0);
    let top = if at >= view { at + 2 - view } else { 0 };
    lines.extend(body.into_iter().skip(top).take(view).map(|(l, _)| l));
    lines.resize(rows.saturating_sub(1), String::new());
    lines.push(if s.note.is_empty() {
        format!("{} ↑↓ select   enter boot emulator/simulator   y copy id   r refresh   q close", fg(DIM))
    } else {
        format!(" {}", s.note)
    });
    lines
}

fn boot(t: &Tools, row: &Row) -> String {
    match row.kind {
        "avd" => match command(&t.emulator).args(["-avd", &row.id]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn() {
            Ok(_) => format!("{}booting {}…", fg(GREEN), row.name),
            Err(_) => format!("{}could not start the emulator", fg(PINK)),
        },
        "sim" if row.state != "online" => {
            run("xcrun", &["simctl", "boot", &row.id]);
            let _ = command("open").args(["-a", "Simulator"]).spawn();
            format!("{}booting {}…", fg(GREEN), row.name)
        }
        _ => format!("{}{} is already running", fg(DIM), row.name),
    }
}

pub fn main(args: &[String]) -> i32 {
    let tools = Tools::new();
    let mut s = State { sections: Vec::new(), adb_missing: false, sel: 0, note: String::new(), loading: true, phones: Vec::new(), phones_at: None };

    if args.first().map(String::as_str) == Some("--once") {
        s.refresh(&tools);
        for (title, rows) in &s.sections {
            println!("{title}");
            for r in rows {
                println!("  {:<30} {:<40} {}", r.name, r.id, if r.state == "online" || r.state == "stopped" { &r.detail } else { &r.state });
            }
        }
        if s.adb_missing {
            println!("adb not found");
        }
        return 0;
    }

    let screen = Screen::new(false);
    screen.draw(&render(&s));
    let mut last: Option<Instant> = None;
    loop {
        if last.map(|t| t.elapsed() >= Duration::from_secs(3)).unwrap_or(true) {
            s.refresh(&tools);
            last = Some(Instant::now());
            screen.draw(&render(&s));
        }
        if !event::poll(Duration::from_millis(150)).unwrap_or(false) {
            continue;
        }
        match event::read() {
            Ok(Event::Key(k)) if k.kind != KeyEventKind::Release => {
                s.note.clear();
                let total = s.flat().len();
                match k.code {
                    KeyCode::Char('q') | KeyCode::Esc => return 0,
                    KeyCode::Char('c') if k.modifiers.contains(KeyModifiers::CONTROL) => return 0,
                    KeyCode::Down | KeyCode::Char('j') => s.sel = (s.sel + 1).min(total.saturating_sub(1)),
                    KeyCode::Up | KeyCode::Char('k') => s.sel = s.sel.saturating_sub(1),
                    KeyCode::Char('r') => last = None,
                    KeyCode::Char('y') => {
                        if let Some(id) = s.flat().get(s.sel).map(|r| r.id.clone()) {
                            osc52(&id);
                            s.note = format!("{}copied {id}", fg(GREEN));
                        }
                    }
                    KeyCode::Enter => {
                        if let Some(row) = s.flat().get(s.sel).map(|r| (*r).clone()) {
                            s.note = boot(&tools, &row);
                        }
                    }
                    _ => {}
                }
                screen.draw(&render(&s));
            }
            Ok(Event::Resize(_, _)) => screen.draw(&render(&s)),
            _ => {}
        }
    }
}
