// Opens a neon-violet plugin pane. Used by the plugin actions.
//   node open.mjs agents   -> ALL agents tab (reuses it if already open)
//   node open.mjs devices  -> devices popup
//   node open.mjs browser  -> browser split (passes a clicked link along)
import { execFileSync } from "node:child_process";

const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const which = process.argv[2] || "agents";

function herdr(args) {
  const out = execFileSync(HERDR, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try { return JSON.parse(out).result; } catch { return null; }
}

let ctx = {};
try { ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}"); } catch {}

if (which === "agents") {
  // Focus an existing "ALL agents" tab instead of opening a second one.
  const tabs = herdr(["tab", "list"])?.tabs || [];
  const existing = tabs.find((t) => t.label === "ALL agents");
  if (existing) {
    herdr(["tab", "focus", existing.tab_id]);
  } else {
    const before = new Set(tabs.map((t) => t.tab_id));
    herdr(["plugin", "pane", "open", "--plugin", "neon-violet", "--entrypoint", "agents", "--placement", "tab", "--focus"]);
    const created = (herdr(["tab", "list"])?.tabs || []).find((t) => !before.has(t.tab_id));
    if (created) {
      herdr(["tab", "rename", created.tab_id, "ALL agents"]);
      herdr(["tab", "focus", created.tab_id]);
    }
  }
} else if (which === "devices") {
  herdr(["plugin", "pane", "open", "--plugin", "neon-violet", "--entrypoint", "devices"]);
} else {
  const url = process.env.HERDR_PLUGIN_CLICKED_URL || ctx.clicked_url || "";
  const args = ["plugin", "pane", "open", "--plugin", "neon-violet", "--entrypoint", "browser",
    "--placement", "split", "--direction", "right", "--focus"];
  if (url) args.push("--env", `NV_URL=${url}`);
  herdr(args);
}
