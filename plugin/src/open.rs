//! Opens a neon-violet plugin pane. Used by the plugin actions.
//!   nv open agents    ALL agents tab (replaces one that is already open)
//!   nv open devices   devices popup
//!   nv open files     file explorer + pull requests tab, rooted at the focused pane's folder
//!   nv open browser   browser split (passes a clicked link along)

use crate::ui::herdr;
use serde_json::Value;

const PLUGIN: &str = "neon-violet";

fn tabs() -> Vec<Value> {
    herdr(&["tab", "list"]).and_then(|r| r.get("tabs").and_then(|t| t.as_array().cloned())).unwrap_or_default()
}

fn tab_id(t: &Value) -> String {
    t.get("tab_id").and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// Opens `entrypoint` as a tab named `label`, replacing a tab of that name.
/// A tab left over from before a server restart holds a plain shell, not the pane, so it is never reused.
fn open_tab(entrypoint: &str, label: &str, cwd: Option<&str>) {
    let before = tabs();
    for old in before.iter().filter(|t| t.get("label").and_then(|l| l.as_str()) == Some(label)) {
        herdr(&["tab", "close", &tab_id(old)]);
    }
    let known: Vec<String> = before.iter().map(tab_id).collect();
    let mut args = vec!["plugin", "pane", "open", "--plugin", PLUGIN, "--entrypoint", entrypoint, "--placement", "tab", "--focus"];
    if let Some(dir) = cwd {
        args.push("--cwd");
        args.push(dir);
    }
    herdr(&args);
    if let Some(created) = tabs().iter().map(tab_id).find(|id| !known.contains(id)) {
        herdr(&["tab", "rename", &created, label]);
        herdr(&["tab", "focus", &created]);
    }
}

pub fn main(args: &[String]) -> i32 {
    let ctx: Value = std::env::var("HERDR_PLUGIN_CONTEXT_JSON").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    match args.first().map(String::as_str).unwrap_or("agents") {
        "agents" => open_tab("agents", "ALL agents", None),
        "files" => {
            let cwd = ctx.get("focused_pane_cwd").and_then(|c| c.as_str()).map(str::to_string);
            open_tab("files", "Files", cwd.as_deref());
        }
        "devices" => {
            herdr(&["plugin", "pane", "open", "--plugin", PLUGIN, "--entrypoint", "devices"]);
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
            herdr(&a);
        }
    }
    0
}
