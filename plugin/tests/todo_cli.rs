use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

struct Store(PathBuf);

impl Store {
    fn new() -> Self {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        Self(std::env::temp_dir().join(format!("nv-todo-test-{}-{stamp}", std::process::id())))
    }

    fn command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_nv"));
        cmd.env("HERDR_APP_HOME", &self.0).env("NV_TODO_NO_SUMMARY", "1").arg("todo");
        cmd
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }
}

impl Drop for Store {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

#[test]
fn concurrent_additions_preserve_every_item() {
    let store = Store::new();
    let mut children = Vec::new();
    for i in 0..64 {
        children.push(store.command().args(["add", &format!("task {i}")]).stdout(std::process::Stdio::null()).spawn().unwrap());
    }
    for mut child in children { assert!(child.wait().unwrap().success()); }
    let result = store.run(&["list", "--json"]);
    assert!(result.status.success());
    let result: Value = serde_json::from_slice(&result.stdout).unwrap();
    let items = result["items"].as_array().unwrap();
    assert_eq!(items.len(), 64);
    assert_eq!(items.iter().map(|it| it["id"].as_str().unwrap()).collect::<std::collections::HashSet<_>>().len(), 64);
}

#[test]
fn corrupt_store_is_not_overwritten() {
    let store = Store::new();
    let path = store.0.join("todos/todos.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    for invalid in ["{broken-json", "{}", r#"{"items":null}"#, r#"{"items":[1]}"#] {
        fs::write(&path, invalid).unwrap();
        assert!(!store.run(&["add", "preserve existing data"]).status.success());
        assert_eq!(fs::read_to_string(&path).unwrap(), invalid);
    }
}

#[test]
fn notify_completes_only_the_matching_codex_session() {
    let store = Store::new();
    for key in ["first", "second"] {
        assert!(store.run(&["add", "--source", "codex", "--key", key, "--cwd", "/shared/repo", key]).status.success());
    }
    let payload = r#"{"type":"agent-turn-complete","thread-id":"first","cwd":"/shared/repo"}"#;
    assert!(store.run(&["hook", "codex-notify", payload]).status.success());
    let result: Value = serde_json::from_slice(&store.run(&["list", "--json"]).stdout).unwrap();
    let items = result["items"].as_array().unwrap();
    assert_eq!(items.iter().find(|it| it["key"] == "first").unwrap()["done"], true);
    assert_eq!(items.iter().find(|it| it["key"] == "second").unwrap()["done"], false);
}

#[test]
fn broken_store_hooks_do_not_interrupt_agents() {
    let store = Store::new();
    fs::create_dir_all(&store.0).unwrap();
    // A file in place of the directory makes lock creation fail before loading.
    fs::write(store.0.join("todos"), "keep this file").unwrap();
    let payload = r#"{"type":"agent-turn-complete","thread-id":"first","cwd":"/shared/repo"}"#;
    assert!(store.run(&["hook", "codex-notify", payload]).status.success());
    assert_eq!(fs::read_to_string(store.0.join("todos")).unwrap(), "keep this file");
}
