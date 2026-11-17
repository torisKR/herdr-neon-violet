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

    let (mut added, mut kept) = (Vec::new(), Vec::new());
    if let (Some(root), Some(sections)) = (keys.as_object_mut(), add.as_object()) {
        for (section, binds) in sections {
            let slot = root.entry(section.clone()).or_insert_with(|| Value::Object(Map::new()));
            let (Some(slot), Some(binds)) = (slot.as_object_mut(), binds.as_object()) else { continue };
            for (key, action) in binds {
                match slot.get(key) {
                    Some(current) if current != action => kept.push(format!("{section} {key}")),
                    _ => {
                        slot.insert(key.clone(), action.clone());
                        added.push(format!("{section} {key}"));
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
