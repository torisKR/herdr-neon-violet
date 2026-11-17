//! The shared to-do list that the Herdr app's `todos` mod shows.
//!
//! One JSON file per machine: `<app home>/todos/todos.json`
//!   { "version": 1, "items": [ { "id", "text", "done", "source", "key", "cwd", "created", "done_at" } ] }
//!
//! People and agents change it through this command, so every writer goes through the same
//! read-modify-rename and the file is never left half written.

use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into()))
}

pub fn app_home() -> PathBuf {
    match std::env::var("HERDR_APP_HOME") {
        Ok(p) if !p.is_empty() => PathBuf::from(p),
        _ => home().join(".config").join("herdr-app"),
    }
}

pub fn store_path() -> PathBuf {
    app_home().join("todos").join("todos.json")
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn new_id() -> String {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:06x}", (n / 1000) & 0xff_ffff)
}

fn load() -> Vec<Value> {
    let text = fs::read_to_string(store_path()).unwrap_or_default();
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.get("items").and_then(|i| i.as_array().cloned()))
        .unwrap_or_default()
}

fn save(items: &[Value]) -> Result<(), String> {
    let path = store_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&json!({ "version": 1, "items": items })).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, text + "\n").map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn first_line(text: &str, max: usize) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").to_string();
    if line.chars().count() > max {
        line.chars().take(max - 1).collect::<String>() + "…"
    } else {
        line
    }
}

fn add(items: &mut Vec<Value>, text: &str, source: &str, key: &str, cwd: &str, done: bool) -> String {
    let id = new_id();
    items.push(json!({
        "id": id, "text": first_line(text, 160), "done": done, "source": source, "key": key, "cwd": cwd,
        "created": now(), "done_at": if done { json!(now()) } else { Value::Null },
    }));
    id
}

fn set_done(item: &mut Value, done: bool) {
    item["done"] = json!(done);
    item["done_at"] = if done { json!(now()) } else { Value::Null };
}

fn str_of<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

fn same_dir(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    !a.is_empty() && norm(a) == norm(b)
}

/// Options before the free text: --source, --key, --cwd, --json.
struct Opts {
    source: String,
    key: String,
    cwd: String,
    json: bool,
    rest: Vec<String>,
}

fn parse(args: &[String]) -> Opts {
    let mut o = Opts {
        source: "me".into(),
        key: String::new(),
        cwd: std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        json: false,
        rest: Vec::new(),
    };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--source" if i + 1 < args.len() => { o.source = args[i + 1].clone(); i += 1; }
            "--key" if i + 1 < args.len() => { o.key = args[i + 1].clone(); i += 1; }
            "--cwd" if i + 1 < args.len() => { o.cwd = args[i + 1].clone(); i += 1; }
            "--json" => o.json = true,
            other => o.rest.push(other.to_string()),
        }
        i += 1;
    }
    o
}

fn stdin_json() -> Value {
    let mut s = String::new();
    let _ = std::io::stdin().read_to_string(&mut s);
    serde_json::from_str(&s).unwrap_or(Value::Null)
}

/// Agent hooks. They must never fail the agent, so every path ends quietly.
fn hook(kind: &str, args: &[String]) -> Result<(), String> {
    let mut items = load();
    match kind {
        // Claude Code UserPromptSubmit: the instruction becomes an open item.
        "claude-prompt" => {
            let v = stdin_json();
            let prompt = str_of(&v, "prompt");
            let text = first_line(prompt, 160);
            if text.is_empty() || text.starts_with('/') {
                return Ok(());
            }
            add(&mut items, &text, "claude", str_of(&v, "session_id"), str_of(&v, "cwd"), false);
        }
        // Claude Code Stop: the turn ended, so its open items are checked.
        "claude-stop" => {
            let v = stdin_json();
            let session = str_of(&v, "session_id").to_string();
            if session.is_empty() {
                return Ok(());
            }
            for item in items.iter_mut() {
                if str_of(item, "source") == "claude" && str_of(item, "key") == session && item["done"] != json!(true) {
                    set_done(item, true);
                }
            }
        }
        // Codex `notify`: one JSON argument when a turn completes.
        "codex-notify" => {
            let v: Value = args.first().and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null);
            if str_of(&v, "type") != "agent-turn-complete" {
                return Ok(());
            }
            let cwd = str_of(&v, "cwd").to_string();
            let mut closed = false;
            for item in items.iter_mut() {
                if str_of(item, "source") == "codex" && item["done"] != json!(true) && same_dir(str_of(item, "cwd"), &cwd) {
                    set_done(item, true);
                    closed = true;
                }
            }
            if !closed {
                // Codex has no "turn started" event: record the instruction as already done.
                let text = v.get("input-messages").and_then(|m| m.as_array()).and_then(|m| m.last()).and_then(|m| m.as_str()).unwrap_or("");
                if !first_line(text, 160).is_empty() {
                    add(&mut items, text, "codex", str_of(&v, "thread-id"), &cwd, true);
                }
            }
        }
        _ => return Err(format!("unknown hook '{kind}'")),
    }
    save(&items)
}

pub fn main(args: &[String]) -> i32 {
    let sub = args.first().map(String::as_str).unwrap_or("list");
    let o = parse(args.get(1..).unwrap_or(&[]));
    let result: Result<(), String> = (|| {
        match sub {
            "path" => println!("{}", store_path().display()),
            "list" => {
                let items = load();
                if o.json {
                    println!("{}", json!({ "version": 1, "items": items }));
                } else if items.is_empty() {
                    println!("no to-dos");
                } else {
                    for it in &items {
                        println!("[{}] {}  {}  ({})", if it["done"] == json!(true) { "x" } else { " " }, str_of(it, "id"), str_of(it, "text"), str_of(it, "source"));
                    }
                }
            }
            "add" => {
                let text = o.rest.join(" ");
                if text.trim().is_empty() {
                    return Err("usage: nv todo add [--source claude|codex|me] <text>".into());
                }
                let mut items = load();
                let id = add(&mut items, &text, &o.source, &o.key, &o.cwd, false);
                save(&items)?;
                println!("{id}");
            }
            "done" | "undone" | "toggle" | "rm" => {
                let id = o.rest.first().cloned().unwrap_or_default();
                let mut items = load();
                let before = items.len();
                let mut hit = false;
                if sub == "rm" {
                    items.retain(|it| str_of(it, "id") != id);
                    hit = items.len() != before;
                } else {
                    for it in items.iter_mut() {
                        let by_id = !id.is_empty() && str_of(it, "id") == id;
                        let by_key = id.is_empty() && !o.key.is_empty() && str_of(it, "key") == o.key;
                        if by_id || by_key {
                            let done = match sub { "done" => true, "undone" => false, _ => it["done"] != json!(true) };
                            set_done(it, done);
                            hit = true;
                        }
                    }
                }
                if !hit {
                    return Err(format!("no to-do with id '{id}'"));
                }
                save(&items)?;
            }
            "clear-done" => {
                let mut items = load();
                items.retain(|it| it["done"] != json!(true));
                save(&items)?;
            }
            "hook" => {
                // Hooks swallow their own errors: a broken list must not stop an agent.
                let kind = o.rest.first().cloned().unwrap_or_default();
                let _ = hook(&kind, o.rest.get(1..).unwrap_or(&[]));
            }
            _ => return Err("usage: nv todo <list|add|done|undone|toggle|rm|clear-done|path|hook>".into()),
        }
        Ok(())
    })();
    match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}
