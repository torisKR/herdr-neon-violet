use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

struct Store(PathBuf);

impl Store {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let sequence = NEXT.fetch_add(1, Ordering::Relaxed);
        Self(std::env::temp_dir().join(format!("nv-todo-test-{}-{stamp}-{sequence}", std::process::id())))
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
fn list_assigns_priorities_to_legacy_items_without_rewriting_the_store() {
    let store = Store::new();
    let path = store.0.join("todos/todos.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let cases = [
        ("긴급 서버 장애 복구", 0), ("URGENT restore service", 0), ("至急対応", 0), ("紧急处理", 0),
        ("결제 오류 해결", 1), ("fix broken scrolling", 1), ("重要な不具合", 1), ("修复错误", 1),
        ("새 화면 추가", 2), ("prefix and debugger catalog", 2),
        ("나중에 색상 조정", 3), ("optional decoration", 3), ("任意の装飾", 3), ("以后添加", 3),
        ("optional but critical data loss", 0),
    ];
    let items: Vec<Value> = cases.iter().enumerate().map(|(id, (text, _))| serde_json::json!({
        "id": id.to_string(), "text": text, "done": false, "source": "me", "created": 1,
    })).collect();
    let original = serde_json::to_string(&serde_json::json!({ "version": 1, "items": items })).unwrap();
    fs::write(&path, &original).unwrap();
    let output = store.run(&["list", "--json"]);
    assert!(output.status.success());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    for (item, (_, expected)) in result["items"].as_array().unwrap().iter().zip(cases) {
        assert_eq!(item["priority"], expected, "{}", item["text"]);
        assert_eq!(item["priority_auto"], true);
    }
    assert_eq!(fs::read_to_string(path).unwrap(), original);
}

#[test]
fn manual_priority_survives_completion_reopening_and_retitle_and_can_return_to_auto() {
    let store = Store::new();
    let added = store.run(&["add", "긴급 데이터 손실 복구"]);
    assert!(added.status.success());
    let id = String::from_utf8(added.stdout).unwrap().trim().to_string();
    assert!(store.run(&["priority", &id, "low"]).status.success());
    for args in [vec!["done", &id], vec!["undone", &id], vec!["title", &id, "new title"]] {
        assert!(store.run(&args).status.success());
    }
    let list = || -> Value { serde_json::from_slice(&store.run(&["list", "--json"]).stdout).unwrap() };
    assert_eq!(list()["items"][0]["priority"], 3);
    assert_eq!(list()["items"][0]["priority_auto"], false);
    assert_eq!(list()["items"][0]["done"], false);
    assert!(store.run(&["priority", &id, "auto"]).status.success());
    assert_eq!(list()["items"][0]["priority"], 0);
    assert_eq!(list()["items"][0]["priority_auto"], true);
    let stored: Value = serde_json::from_str(&fs::read_to_string(store.0.join("todos/todos.json")).unwrap()).unwrap();
    assert!(stored["items"][0].get("priority").is_none());
    assert!(stored["items"][0].get("priority_auto").is_none());
}

#[test]
fn priority_aliases_and_invalid_changes_preserve_the_original_instruction() {
    let store = Store::new();
    let added = store.run(&["add", "plain task"]);
    let id = String::from_utf8(added.stdout).unwrap().trim().to_string();
    for (value, expected) in [("p0", 0), ("high", 1), ("2", 2), ("p3", 3)] {
        assert!(store.run(&["priority", &id, value]).status.success());
        let result: Value = serde_json::from_slice(&store.run(&["list", "--json"]).stdout).unwrap();
        assert_eq!(result["items"][0]["priority"], expected);
        assert_eq!(result["items"][0]["detail"], "plain task");
    }
    let path = store.0.join("todos/todos.json");
    let before = fs::read_to_string(&path).unwrap();
    for args in [vec!["priority", &id, "4"], vec!["priority", &id], vec!["priority", "missing", "urgent"]] {
        assert!(!store.run(&args).status.success());
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }
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
