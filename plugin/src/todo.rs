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

/// A short headline for the list: the first sentence of the instruction, without links,
/// cut at a word boundary. The whole instruction is kept separately as `detail`.
fn headline(text: &str) -> String {
    const MAX: usize = 46;
    // Words that open a sentence without saying anything about the task.
    const FILLERS: [&str; 16] = ["지금", "추가로", "그리고", "아", "근데", "그런데", "또", "그럼", "혹시", "일단", "please", "also", "and", "then", "so", "ok"];
    // Words that mark the sentence that actually asks for something.
    const ASKS: [&str; 29] = [
        "해줘", "해줄래", "해주세요", "해줘요", "하자", "만들어", "추가", "수정", "구현", "고쳐", "바꿔", "확인", "진행", "설치", "적용",
        "정리", "삭제", "please", "add", "fix", "make", "create", "update", "implement", "remove", "change", "check", "install", "write",
    ];

    // Split into sentences: a terminator followed by white space or the end, or a line break.
    let mut sentences: Vec<Vec<String>> = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = text.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        let end_of_line = *c == '\n';
        let terminator = matches!(c, '.' | '?' | '!' | '。') && chars.get(i + 1).map(|n| n.is_whitespace()).unwrap_or(true);
        if !end_of_line {
            current.push(*c);
        }
        if end_of_line || terminator {
            sentences.push(current.split_whitespace().map(str::to_string).collect());
            current.clear();
        }
    }
    sentences.push(current.split_whitespace().map(str::to_string).collect());

    let cleaned: Vec<Vec<String>> = sentences
        .into_iter()
        .map(|words| {
            let mut words: Vec<String> = words.into_iter().filter(|w| !w.starts_with("http://") && !w.starts_with("https://")).collect();
            while words.len() > 1 && FILLERS.contains(&words[0].trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase().as_str()) {
                words.remove(0);
            }
            words
        })
        .filter(|words| !words.is_empty())
        .collect();
    // Korean endings attach to the word, so they match inside it; English verbs must be whole words
    // ("check" must not match "checkout").
    let asks = |words: &Vec<String>| {
        words.iter().any(|w| {
            let w = w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
            ASKS.iter().any(|a| if a.is_ascii() { w == *a } else { w.contains(a) })
        })
    };
    let chosen = cleaned
        .iter()
        .find(|w| w.len() >= 3 && asks(w))
        .or_else(|| cleaned.iter().find(|w| w.len() >= 3))
        .or_else(|| cleaned.first());
    let Some(words) = chosen else { return String::new() };

    let mut out = String::new();
    for word in words {
        let next = if out.is_empty() { word.chars().count() } else { out.chars().count() + 1 + word.chars().count() };
        if next > MAX {
            if out.is_empty() {
                out = word.chars().take(MAX - 1).collect();
            }
            out.push('…');
            return out;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out.trim_end_matches(['.', '。', '?', '!']).to_string()
}

/// Lets a person or an agent replace an item's headline with a better one.
fn retitle(items: &mut [Value], id: &str, title: &str) -> bool {
    let title: String = title.trim().chars().take(80).collect();
    for item in items.iter_mut() {
        if str_of(item, "id") == id && !title.is_empty() {
            if item.get("detail").and_then(|d| d.as_str()).unwrap_or("").is_empty() {
                item["detail"] = item["text"].clone();
            }
            item["text"] = json!(title);
            return true;
        }
    }
    false
}

fn add(items: &mut Vec<Value>, text: &str, source: &str, key: &str, cwd: &str, done: bool) -> String {
    let id = new_id();
    let detail: String = text.trim().chars().take(4000).collect();
    items.push(json!({
        "id": id, "text": headline(text), "detail": detail, "done": done, "source": source, "key": key, "cwd": cwd,
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
    // The session an event belongs to; Codex and Claude Code both send session_id and cwd.
    let session_of = |v: &Value| -> String {
        ["session_id", "thread_id", "conversation_id", "cwd"].iter().map(|k| str_of(v, k)).find(|s| !s.is_empty()).unwrap_or("").to_string()
    };
    match kind {
        // UserPromptSubmit (Claude Code, Codex): the instruction becomes an open item.
        "claude-prompt" | "codex-prompt" => {
            let agent = kind.split('-').next().unwrap_or("claude");
            let v = stdin_json();
            let prompt = str_of(&v, "prompt");
            let first = first_line(prompt, 160);
            if first.is_empty() || first.starts_with('/') {
                return Ok(());
            }
            add(&mut items, prompt, agent, &session_of(&v), str_of(&v, "cwd"), false);
        }
        // Stop (Claude Code, Codex): the turn ended, so that session's open items are checked.
        "claude-stop" | "codex-stop" => {
            let agent = kind.split('-').next().unwrap_or("claude");
            let v = stdin_json();
            let session = session_of(&v);
            if session.is_empty() {
                return Ok(());
            }
            for item in items.iter_mut() {
                if str_of(item, "source") == agent && str_of(item, "key") == session && item["done"] != json!(true) {
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

/// Adds (or removes) the to-do hooks in Claude Code's settings.json and Codex's hooks.json.
/// Both files use the same shape: { "hooks": { "<Event>": [ { "hooks": [ { "type": "command", "command": … } ] } ] } }.
/// Existing hooks are kept; a backup is written next to each file that changes.
fn install_hooks(remove: bool) -> Result<(), String> {
    let nv = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
    let targets = [("claude", home().join(".claude").join("settings.json")), ("codex", home().join(".codex").join("hooks.json"))];
    for (agent, path) in targets {
        let Ok(text) = fs::read_to_string(&path) else {
            println!("{agent}: {} not found, skipped", path.display());
            continue;
        };
        let mut root: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        if !root.is_object() {
            return Err(format!("{} is not a JSON object", path.display()));
        }
        if !root.get("hooks").map(|h| h.is_object()).unwrap_or(false) {
            root["hooks"] = json!({});
        }
        let mut changed = false;
        for (event, name) in [("UserPromptSubmit", "prompt"), ("Stop", "stop")] {
            let marker = format!("todo hook {agent}-{name}");
            if !root["hooks"].get(event).map(|e| e.is_array()).unwrap_or(false) {
                root["hooks"][event] = json!([]);
            }
            let list = root["hooks"][event].as_array_mut().unwrap();
            let before = list.len();
            list.retain(|entry| !entry.to_string().contains(&marker));
            changed |= list.len() != before;
            if !remove {
                list.push(json!({ "hooks": [ { "type": "command", "command": format!("\"{nv}\" {marker}"), "timeout": 5 } ] }));
                changed = true;
            }
        }
        if changed {
            fs::write(path.with_extension(format!("json.bak-{}", now())), &text).map_err(|e| e.to_string())?;
            fs::write(&path, serde_json::to_string_pretty(&root).map_err(|e| e.to_string())? + "\n").map_err(|e| e.to_string())?;
        }
        println!("{agent}: {} {}", if remove { "hooks removed from" } else { "hooks installed in" }, path.display());
    }
    Ok(())
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
            "title" => {
                // nv todo title <id> <new headline>
                let id = o.rest.first().cloned().unwrap_or_default();
                let title = o.rest.get(1..).unwrap_or(&[]).join(" ");
                let mut items = load();
                if !retitle(&mut items, &id, &title) {
                    return Err("usage: nv todo title <id> <new headline>".into());
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
            "hooks" => match o.rest.first().map(String::as_str) {
                Some("install") => install_hooks(false)?,
                Some("remove") => install_hooks(true)?,
                _ => return Err("usage: nv todo hooks <install|remove>".into()),
            },
            _ => return Err("usage: nv todo <list|add|done|undone|toggle|rm|clear-done|path|hooks install|hooks remove>".into()),
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
