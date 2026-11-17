// Adds this pack's shortcuts to the Herdr app's keys.json without replacing keys you already use.
//   node merge-keys.mjs <path to keys.json> <path to plugin/browse.mjs>
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [target, browse] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const add = JSON.parse(JSON.stringify(JSON.parse(readFileSync(join(here, "keys.json"), "utf8"))).replace("{{BROWSE}}", JSON.stringify(browse).slice(1, -1)));
const keys = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
if (existsSync(target)) copyFileSync(target, `${target}.bak-${stamp}`);

const added = [], kept = [];
for (const [section, binds] of Object.entries(add)) {
  keys[section] ??= {};
  for (const [key, action] of Object.entries(binds)) {
    if (key in keys[section] && JSON.stringify(keys[section][key]) !== JSON.stringify(action)) kept.push(`${section} ${key}`);
    else { keys[section][key] = action; added.push(`${section} ${key}`); }
  }
}
writeFileSync(target, JSON.stringify(keys, null, 2) + "\n");
console.log(`keys added: ${added.join(", ") || "none"}`);
if (kept.length) console.log(`already used, left as they were: ${kept.join(", ")}`);
