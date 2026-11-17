//! Opens a neon-violet plugin pane. Used by the plugin actions.
//!   nv open agents    ALL agents tab (focuses one that is already open)
//!   nv open devices   devices popup
//!   nv open files     file explorer + pull requests tab, rooted at the focused pane's folder
//!   nv open browser   browser split (passes a clicked link along)

use crate::ui::herdr;
use serde_json::Value;

const PLUGIN: &str = "neon-violet";

fn tabs(call: &mut impl FnMut(&[&str]) -> Option<Value>) -> Result<Vec<Value>, String> {
    call(&["tab", "list"])
        .and_then(|r| r.get("tabs").and_then(|t| t.as_array().cloned()))
        .ok_or_else(|| "could not list tabs".to_string())
}

fn tab_id(t: &Value) -> String {
    t.get("tab_id").and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// Focuses an existing named tab without terminating any of its panes.
fn open_tab(entrypoint: &str, label: &str, cwd: Option<&str>) -> Result<(), String> {
    open_tab_with(entrypoint, label, cwd, herdr)
}

fn open_tab_with(entrypoint: &str, label: &str, cwd: Option<&str>, mut call: impl FnMut(&[&str]) -> Option<Value>) -> Result<(), String> {
    let before = tabs(&mut call)?;
    if let Some(old) = before.iter().find(|t| t.get("label").and_then(|l| l.as_str()) == Some(label) && !tab_id(t).is_empty()) {
        call(&["tab", "focus", &tab_id(old)]).ok_or("could not focus the existing tab")?;
        return Ok(());
    }
    let known: Vec<String> = before.iter().map(tab_id).collect();
    let mut args = vec!["plugin", "pane", "open", "--plugin", PLUGIN, "--entrypoint", entrypoint, "--placement", "tab", "--focus"];
    if let Some(dir) = cwd {
        args.push("--cwd");
        args.push(dir);
    }
    let opened = call(&args).ok_or("could not open the plugin pane")?;
    let returned_id = tab_id(&opened);
    let created = if !returned_id.is_empty() {
        returned_id
    } else {
        let new_ids: Vec<String> = tabs(&mut call)?.iter().map(tab_id).filter(|id| !id.is_empty() && !known.contains(id)).collect();
        if new_ids.len() != 1 {
            return Err("could not identify the new plugin tab".into());
        }
        new_ids[0].clone()
    };
    call(&["tab", "rename", &created, label]).ok_or("could not rename the plugin tab")?;
    call(&["tab", "focus", &created]).ok_or("could not focus the plugin tab")?;
    Ok(())
}

pub fn main(args: &[String]) -> i32 {
    let ctx: Value = std::env::var("HERDR_PLUGIN_CONTEXT_JSON").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let result = match args.first().map(String::as_str).unwrap_or("agents") {
        "agents" => open_tab("agents", "ALL agents", None),
        "files" => {
            let cwd = ctx.get("focused_pane_cwd").and_then(|c| c.as_str()).map(str::to_string);
            open_tab("files", "Files", cwd.as_deref())
        }
        "devices" => {
            herdr(&["plugin", "pane", "open", "--plugin", PLUGIN, "--entrypoint", "devices"]).map(|_| ()).ok_or_else(|| "could not open devices".to_string())
        }
        _ => {
            let url = std::env::var("HERDR_PLUGIN_CLICKED_URL")
                .ok()
                .or_else(|| ctx.get("clicked_url").and_then(|u| u.as_str()).map(str::to_string))
                .unwrap_or_default();
            let env = format!("NV_URL={url}");
            let mut a = vec!["plugin", "pane", "open", "--plugin", PLUGIN, "--entrypoint", "browser", "--placement", "split", "--direction", "right", "--focus"];
            if !url.is_empty() {
                a.push("--env");
                a.push(&env);
            }
            herdr(&a).map(|_| ()).ok_or_else(|| "could not open the browser".to_string())
        }
    };
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn existing_named_tab_is_only_focused() {
        let mut calls = Vec::new();
        let result = open_tab_with("files", "Files", Some("/tmp"), |args| {
            calls.push(args.iter().map(|s| s.to_string()).collect::<Vec<_>>());
            match args {
                ["tab", "list"] => Some(json!({"tabs": [{"tab_id": "user-tab", "label": "Files"}]})),
                ["tab", "focus", "user-tab"] => Some(json!({})),
                _ => panic!("unexpected mutation: {args:?}"),
            }
        });
        assert!(result.is_ok());
        assert_eq!(calls, [vec!["tab", "list"], vec!["tab", "focus", "user-tab"]]);
    }

    #[test]
    fn failed_creation_retains_existing_tabs() {
        let mut calls = Vec::new();
        let result = open_tab_with("files", "Files", None, |args| {
            calls.push(args.iter().map(|s| s.to_string()).collect::<Vec<_>>());
            if args == ["tab", "list"] {
                Some(json!({"tabs": [{"tab_id": "work", "label": "Shell"}]}))
            } else {
                None
            }
        });
        assert!(result.is_err());
        assert_eq!(calls.len(), 2);
        assert_eq!(&calls[1][..3], ["plugin", "pane", "open"]);
    }

    #[test]
    fn returned_tab_id_is_used_without_renaming_other_new_tabs() {
        let mut calls = Vec::new();
        let result = open_tab_with("agents", "ALL agents", None, |args| {
            calls.push(args.iter().map(|s| s.to_string()).collect::<Vec<_>>());
            match args {
                ["tab", "list"] => Some(json!({"tabs": []})),
                ["plugin", "pane", "open", ..] => Some(json!({"tab_id": "created"})),
                ["tab", "rename", "created", "ALL agents"] | ["tab", "focus", "created"] => Some(json!({})),
                _ => panic!("unexpected call: {args:?}"),
            }
        });
        assert!(result.is_ok());
        assert_eq!(calls.len(), 4);
    }
}
