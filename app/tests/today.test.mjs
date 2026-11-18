import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UsageError, gitInfo, parseArgs, run } from "../today/nv-today.mjs";

/** A temporary home and one git repository with a first commit. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "nv-today-")), home = join(root, "home", "today"), repo = join(root, "cat-cafe");
  mkdirSync(repo, { recursive: true });
  const git = (...args) => { const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@example.com"); git("config", "user.name", "T"); git("config", "commit.gpgsign", "false");
  const commit = (file, text, message) => { writeFileSync(join(repo, file), text); git("add", "."); git("commit", "-q", "-m", message); };
  commit("a.txt", "one", "first");
  const nv = (...argv) => run(parseArgs(argv), home);
  return { root, home, repo, git, commit, nv };
}

test("a project is added once, listed with where it stands in git, and can be removed", () => {
  const w = world();
  const made = w.nv("add", w.repo, "--name", "Cat Cafe", "--kind", "work");
  assert.deepEqual([made.id, made.name, made.kind, made.focus], ["cat-cafe", "Cat Cafe", "work", null]);
  assert.equal(w.nv("add", w.repo).id, "cat-cafe", "the same folder is not added twice");
  const other = join(w.root, "Cat Cafe"); mkdirSync(other);
  assert.equal(w.nv("add", other).id, "cat-cafe-2");           // another folder with the same name gets its own id
  const p = w.nv("list").projects.find(x => x.id === "cat-cafe");
  assert.deepEqual([p.git.repo, p.git.branch, p.git.dirty, p.git.commits[0].subject], [true, "main", 0, "first"]);
  assert.deepEqual(p.reasons, ["nonote"]);
  assert.equal(p.verification.state, "none");
  assert.deepEqual(w.nv("list").projects.find(x => x.id === "cat-cafe-2").git, { repo: false });
  assert.deepEqual(w.nv("remove", "cat-cafe-2"), { removed: "cat-cafe-2", kept: "the project folder" });
  assert.throws(() => w.nv("add", join(w.root, "nope")), /is not a folder/);
  assert.throws(() => w.nv("add", w.repo, "--kind", "hobby"), UsageError);
  assert.throws(() => w.nv("remove", "nope"), /no project named nope/);
});

test("one main and one maintenance project: pinning a project takes the place from whoever had it", () => {
  const w = world();
  const b = join(w.root, "b"), c = join(w.root, "c"); mkdirSync(b); mkdirSync(c);
  w.nv("add", w.repo); w.nv("add", b); w.nv("add", c);
  w.nv("focus", "cat-cafe", "main"); w.nv("focus", "b", "maint");
  assert.deepEqual(w.nv("list").projects.slice(0, 2).map(p => [p.id, p.focus]), [["cat-cafe", "main"], ["b", "maint"]]);   // the focused ones come first
  w.nv("focus", "c", "main");
  assert.deepEqual(Object.fromEntries(w.nv("list").projects.map(p => [p.id, p.focus])), { c: "main", b: "maint", "cat-cafe": null });
  w.nv("focus", "c", "none");
  assert.equal(w.nv("list").projects.find(p => p.id === "c").focus, null);
  assert.throws(() => w.nv("focus", "c", "urgent"), /main, maint or none/);
  assert.equal(w.nv("kind", "c", "work").kind, "work");
});

test("a note keeps the next action and why work stopped; fields that are not given are kept", () => {
  const w = world();
  w.nv("add", w.repo);
  let p = w.nv("note", "cat-cafe", "--state", "로그인 화면 수정 완료.\n신규 가입만 확인", "--next", "기존 계정으로 재로그인 확인", "--why", "테스트 계정 없음");
  assert.equal(p.note.state, "로그인 화면 수정 완료. 신규 가입만 확인");   // one line, however it was typed
  assert.deepEqual([p.note.next, p.note.why, p.note.branch], ["기존 계정으로 재로그인 확인", "테스트 계정 없음", "main"]);
  assert.equal(p.note.head, gitInfo(w.repo).head);
  assert.deepEqual(p.reasons, ["stopped"]);
  p = w.nv("note", "cat-cafe", "--why", "");                          // "" clears one field, the others stay
  assert.deepEqual([p.note.next, p.note.why, p.reasons], ["기존 계정으로 재로그인 확인", "", []]);
  assert.equal(JSON.parse(readFileSync(join(w.home, "today.json"), "utf8")).projects[0].history.length, 1);
  assert.throws(() => w.nv("note", "cat-cafe"), /at least one of/);
  // The branch moved since the note: the board says so.
  w.git("checkout", "-q", "-b", "feat/login");
  assert.equal(w.nv("list").projects[0].moved, true);
});

test("a verification holds only while the code is exactly what was verified", () => {
  const w = world();
  w.nv("add", w.repo);
  let p = w.nv("note", "cat-cafe", "--next", "배포", "--verified", "node --test 12개 통과");
  assert.deepEqual([p.verification.state, p.verification.text], ["fresh", "node --test 12개 통과"]);
  // An uncommitted edit is already a change.
  writeFileSync(join(w.repo, "a.txt"), "two");
  p = w.nv("list").projects[0];
  assert.deepEqual([p.verification.state, p.verification.commits, p.verification.files], ["stale", 0, 1]);
  assert.deepEqual(p.reasons, ["stale", "dirty"]);
  // So is a commit.
  w.commit("b.txt", "new", "second");
  p = w.nv("list").projects[0];
  assert.deepEqual([p.verification.state, p.verification.commits, p.verification.files], ["stale", 1, 2]);
  // Saving the note again without --verified does not renew the old check.
  p = w.nv("note", "cat-cafe", "--state", "문구 수정");
  assert.equal(p.verification.state, "stale");
  // Checking again does, against the code as it is now, uncommitted work included.
  writeFileSync(join(w.repo, "c.txt"), "wip");
  p = w.nv("note", "cat-cafe", "--verified", "다시 실행해 통과");
  assert.equal(p.verification.state, "fresh");
  writeFileSync(join(w.repo, "c.txt"), "wip 2"); w.git("add", ".");
  assert.equal(w.nv("list").projects[0].verification.state, "stale");
  assert.equal(w.nv("note", "cat-cafe", "--verified", "").verification.state, "none");
});

test("git drafts where a project stands, and a folder that disappeared is said to be missing", () => {
  const w = world();
  w.nv("add", w.repo);
  assert.match(w.nv("draft", "cat-cafe").state, /^마지막 커밋: first \([0-9a-f]+\)\. 커밋하지 않은 변경 없음$/);
  writeFileSync(join(w.repo, "x.txt"), "x"); writeFileSync(join(w.repo, "y.txt"), "y");
  const d = w.nv("draft", "cat-cafe");
  assert.match(d.state, /커밋하지 않은 변경 2개: x\.txt, y\.txt/);
  assert.deepEqual(d.files, ["x.txt", "y.txt"]);
  rmSync(w.repo, { recursive: true, force: true });
  const p = w.nv("list").projects[0];
  assert.deepEqual([p.git.missing, p.reasons[0]], [true, "missing"]);
});

test("the command line: flags, the default command, unknown commands", () => {
  assert.deepEqual(parseArgs([]), { command: "list", args: [], flags: {} });
  assert.deepEqual(parseArgs(["note", "x", "--next", "do it", "--json"]), { command: "note", args: ["x"], flags: { next: "do it", json: true } });
  assert.throws(() => parseArgs(["note", "x", "--next"]), /--next needs a value/);
  const w = world();
  assert.throws(() => w.nv("frobnicate"), /unknown command/);
  assert.match(w.nv("help").help, /nv-today list/);
  assert.match(w.nv("list").tool, /bin[\\/]nv-today\.mjs$/);
});
