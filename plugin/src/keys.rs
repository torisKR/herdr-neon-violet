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
    if cfg!(windows) {
        if let Some(global) = add.get_mut("global").and_then(Value::as_object_mut) {
            if global.get("ctrl-shift-u").and_then(Value::as_str) == Some("mod.open:nv-browser") {
                global.insert("ctrl-shift-u".into(), serde_json::json!({"command":"pane.split","args":{"direction":"right","argv":["{{NV}}","browse"]}}));
            }
        }
    }
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
                let stale = slot.get(&name).map(|c| c.to_string().contains("browse.mjs") || action == "mod.open:nv-browser" && old_browser(c)).unwrap_or(false);
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
