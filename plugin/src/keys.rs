//! Adds this pack's shortcuts to the Herdr app's keys.json without replacing keys already in use.
//!   nv merge-keys <keys.json> <additions.json>
//! `{{NV}}` inside the additions is replaced with the path of this binary.

use serde_json::{Map, Value};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

/// Replaces the `{{NV}}` placeholder in every string of the tree.
fn fill(v: &mut Value, nv: &str) {
    match v {
        Value::String(s) if s.contains("{{NV}}") => *s = s.replace("{{NV}}", nv),
        Value::Array(a) => a.iter_mut().for_each(|x| fill(x, nv)),
        Value::Object(o) => o.values_mut().for_each(|x| fill(x, nv)),
        _ => {}
    }
}

fn old_browser(action: &Value) -> bool {
    if action.get("command").and_then(Value::as_str) != Some("pane.split") { return false; }
    let Some(argv) = action.pointer("/args/argv").and_then(Value::as_array) else { return false };
    let path = argv.first().and_then(Value::as_str).unwrap_or("").replace('\\', "/");
    argv.len() == 2 && argv[1] == "browse" && ["/herdr-app/bin/nv", "/herdr-app/bin/nv.exe", "/plugin/bin/nv", "/plugin/bin/nv.exe"].iter().any(|suffix| path.ends_with(suffix))
}

/// Earlier defaults (the pack's or Herdr's) that a newer pack default replaces when the person never
/// changed them: ALL agents and Pull requests became toggles (press again to go back / close), and
/// the terminal paste key (Ctrl+V; Cmd+V on macOS, where `key` is still the additions' ctrl name)
/// now turns a screenshot into a file the agents can attach.
fn superseded(section: &str, key: &str, current: &Value) -> bool {
    match (section, key) {
        ("global", "ctrl-shift-a") => current == "layout.switch:all-agents",
        ("global", "ctrl-shift-g") => *current == serde_json::json!({"command":"pane.split","args":{"direction":"right","mod":"prs"}}),
        ("terminal", "ctrl-v") => current == "terminal.paste_image" || current == "terminal.paste",
        _ => false,
    }
}

fn remove_retired(keys: &mut Value) {
    let Some(root) = keys.as_object_mut() else { return };
    root.remove("mod:todos");
    for section in root.values_mut().filter_map(Value::as_object_mut) {
        section.retain(|_, action| {
            let command = action.as_str().or_else(|| action.get("command").and_then(Value::as_str)).unwrap_or("");
            !command.starts_with("todos.") && command != "mod.open:todos"
                && !(action.get("command").and_then(Value::as_str) == Some("mod.open")
                    && action.get("args").and_then(|args| args.get("name")).and_then(Value::as_str) == Some("todos"))
        });
    }
}

pub fn main(args: &[String]) -> i32 {
    let (Some(target), Some(additions)) = (args.first(), args.get(1)) else {
        eprintln!("usage: nv merge-keys <keys.json> <additions.json>");
        return 2;
    };
    let nv = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "nv".into());
    let mut add: Value = match fs::read_to_string(additions).ok().and_then(|t| serde_json::from_str(&t).ok()) {
        Some(v) => v,
        None => {
            eprintln!("cannot read {additions}");
            return 1;
        }
    };
    // Windows used to get the text browser here; the Browser mod now opens a live Chrome view there too,
    // and an untouched old text-browser binding is replaced below (old_browser).
    fill(&mut add, &nv);

    let existing = fs::read_to_string(target).ok();
    let mut keys: Value = match &existing {
        Some(text) => match serde_json::from_str(text) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("{target} is not valid JSON ({e}); left untouched");
                return 1;
            }
        },
        None => Value::Object(Map::new()),
    };
    if let Some(text) = &existing {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = fs::write(format!("{target}.bak-{stamp}"), text);
    }
    remove_retired(&mut keys);

    let (mut added, mut kept) = (Vec::new(), Vec::new());
    if let (Some(root), Some(sections)) = (keys.as_object_mut(), add.as_object()) {
        for (section, binds) in sections {
            let slot = root.entry(section.clone()).or_insert_with(|| Value::Object(Map::new()));
            let (Some(slot), Some(binds)) = (slot.as_object_mut(), binds.as_object()) else { continue };
            for (key, action) in binds {
                // The additions are written with ctrl; on macOS the same shortcuts use Command.
                let name = if cfg!(target_os = "macos") { key.replace("ctrl-", "cmd-") } else { key.clone() };
                if name != *key && slot.get(key) == Some(action) {
                    slot.remove(key); // an earlier version installed it under the ctrl name on macOS
                }
                // An older version of this pack bound the browser to a Node script that no longer exists.
                let stale = slot.get(&name).map(|c| c.to_string().contains("browse.mjs") || action == "mod.open:nv-browser" && old_browser(c)
                    || superseded(section, key, c)).unwrap_or(false);
                match slot.get(&name) {
                    Some(current) if current != action && !stale => kept.push(format!("{section} {name}")),
                    _ => {
                        slot.insert(name.clone(), action.clone());
                        added.push(format!("{section} {name}"));
                    }
                }
            }
        }
    }
    let text = serde_json::to_string_pretty(&keys).unwrap_or_default() + "\n";
    if let Err(e) = fs::write(target, text) {
        eprintln!("cannot write {target}: {e}");
        return 1;
    }
    println!("keys added: {}", if added.is_empty() { "none".to_string() } else { added.join(", ") });
    if !kept.is_empty() {
        println!("already used, left as they were: {}", kept.join(", "));
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn browser_migration_recognizes_only_the_old_pack_launcher() {
        assert!(old_browser(&json!({"command":"pane.split","args":{"argv":["/Users/example/.config/herdr-app/bin/nv","browse"]}})));
        assert!(old_browser(&json!({"command":"pane.split","args":{"argv":["C:\\Users\\example\\.config\\herdr-app\\bin\\nv.exe","browse"]}})));
        assert!(!old_browser(&json!({"command":"pane.split","args":{"argv":["/opt/custom/nv","browse"]}})));
        assert!(!old_browser(&json!({"command":"pane.split","args":{"argv":["/Users/example/.config/herdr-app/bin/nv","files"]}})));
    }

    #[test]
    fn only_untouched_old_defaults_become_toggles() {
        assert!(superseded("global", "ctrl-shift-a", &json!("layout.switch:all-agents")));
        assert!(superseded("terminal", "ctrl-v", &json!("terminal.paste_image")));
        assert!(superseded("terminal", "ctrl-v", &json!("terminal.paste")));
        assert!(!superseded("terminal", "ctrl-v", &json!("send:0016")));
        assert!(!superseded("global", "ctrl-v", &json!("terminal.paste")));
        assert!(superseded("global", "ctrl-shift-g", &json!({"command":"pane.split","args":{"direction":"right","mod":"prs"}})));
        assert!(!superseded("global", "ctrl-shift-g", &json!({"command":"pane.split","args":{"direction":"down","mod":"prs"}})));
        assert!(!superseded("global", "ctrl-shift-a", &json!("layout.switch:main")));
        assert!(!superseded("global", "ctrl-shift-x", &json!("layout.switch:all-agents")));
    }

    #[test]
    fn merge_replaces_old_defaults_and_keeps_customized_keys() {
        let dir = std::env::temp_dir().join(format!("nv-keys-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let (target, additions) = (dir.join("keys.json"), dir.join("add.json"));
        let prefix = if cfg!(target_os = "macos") { "cmd" } else { "ctrl" };
        let mut global = Map::new();
        global.insert(format!("{prefix}-shift-a"), json!("layout.switch:all-agents"));
        global.insert(format!("{prefix}-shift-g"), json!("tab.new"));
        global.insert(format!("{prefix}-shift-u"), json!({"command":"pane.split","args":{"direction":"right","argv":["C:/Users/x/.config/herdr-app/bin/nv.exe","browse"]}}));
        fs::write(&target, json!({ "global": global }).to_string()).unwrap();
        fs::write(&additions, json!({ "global": {
            "ctrl-shift-a": "mod.open:nv-toggle-agents", "ctrl-shift-g": "mod.open:nv-toggle-prs", "ctrl-shift-u": "mod.open:nv-browser"
        } }).to_string()).unwrap();
        assert_eq!(main(&[target.to_string_lossy().into_owned(), additions.to_string_lossy().into_owned()]), 0);
        let keys: Value = serde_json::from_str(&fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(keys["global"][format!("{prefix}-shift-a")], "mod.open:nv-toggle-agents");
        assert_eq!(keys["global"][format!("{prefix}-shift-g")], "tab.new");
        assert_eq!(keys["global"][format!("{prefix}-shift-u")], "mod.open:nv-browser");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn retirement_removes_only_obsolete_bindings_and_preserves_other_keys() {
        let mut keys = json!({ "global": {
            "old": "todos.fold", "old-command": { "command": "todos.details" }, "old-overlay": { "command": "mod.open", "args": { "name": "todos" } },
            "keep": "tab.new", "custom": { "command": "mod.open", "args": { "name": "my-panel" } }
        }, "mod:todos": { "x": "todos.details" }, "mod:editor": { "save": "editor.save" } });
        remove_retired(&mut keys);
        assert_eq!(keys["global"].as_object().unwrap().len(), 2);
        assert_eq!(keys["global"]["keep"], "tab.new");
        assert_eq!(keys["global"]["custom"]["args"]["name"], "my-panel");
        assert!(keys.get("mod:todos").is_none());
        assert_eq!(keys["mod:editor"]["save"], "editor.save");
    }
}
