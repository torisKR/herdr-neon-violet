// Prints a canned agent transcript and stays alive — used only to stage the
// README screenshots. Usage: node fake-agent.mjs <scenario>
const v = "\x1b[38;2;195;60;240m", p = "\x1b[38;2;255;31;110m", c = "\x1b[38;2;31;209;201m",
  y = "\x1b[38;2;255;230;0m", g = "\x1b[38;2;57;230;162m", t = "\x1b[38;2;236;228;255m",
  d = "\x1b[38;2;138;118;173m", b = "\x1b[1m", r = "\x1b[0m";

const S = {
  api: [
    `${v}${b}✻ claude${r} ${d}~/work/api-server${r}`,
    ``,
    `${t}> add rate limiting to /v1/orders and cover it with tests${r}`,
    ``,
    `${g}●${r} ${t}Read ${c}src/routes/orders.ts${r}`,
    `${g}●${r} ${t}Read ${c}src/middleware/index.ts${r}`,
    `${g}●${r} ${t}Write ${c}src/middleware/rate-limit.ts${r} ${d}(+48)${r}`,
    `${g}●${r} ${t}Update ${c}src/routes/orders.ts${r} ${d}(+3 -1)${r}`,
    `${y}●${r} ${t}Bash ${d}npm test -- rate-limit${r}`,
    `  ${d}PASS  test/rate-limit.test.ts (6 tests)${r}`,
    ``,
    `${y}✶ Running the full suite… ${d}(esc to interrupt)${r}`,
  ],
  web: [
    `${v}${b}>_ codex${r} ${d}~/work/web-app${r}`,
    ``,
    `${t}> the checkout button jumps on mobile, fix the layout shift${r}`,
    ``,
    `${c}•${r} ${t}Explored ${d}src/components/Checkout.tsx, styles/cart.css${r}`,
    `${c}•${r} ${t}Edited ${c}styles/cart.css${r} ${d}+6 -2${r}`,
    ``,
    `${p}${b}Allow command?${r} ${t}pnpm playwright test checkout${r}`,
    `  ${y}› 1. Yes${r}`,
    `    ${d}2. Yes, and don't ask again${r}`,
    `    ${d}3. No, tell codex what to do${r}`,
  ],
  docs: [
    `${v}${b}✻ claude${r} ${d}~/work/docs-site${r}`,
    ``,
    `${t}> write a getting-started page for the CLI${r}`,
    ``,
    `${g}●${r} ${t}Write ${c}docs/getting-started.md${r} ${d}(+112)${r}`,
    `${g}●${r} ${t}Update ${c}docs/_sidebar.md${r} ${d}(+1)${r}`,
    `${g}●${r} ${t}Bash ${d}npm run docs:build${r}`,
    `  ${d}✓ built 38 pages in 2.1s${r}`,
    ``,
    `${g}${b}✔ Done.${r} ${t}New page at ${c}http://localhost:4173/getting-started${r}`,
  ],
  infra: [
    `${v}${b}◆ gemini${r} ${d}~/work/infra${r}`,
    ``,
    `${t}> why did last night's backup job fail?${r}`,
    ``,
    `${c}✦${r} ${t}Reading ${c}logs/backup-2026-11-16.log${r}`,
    `${c}✦${r} ${t}The job hit the 30-minute timeout while uploading.${r}`,
    `  ${t}Upload speed dropped after 02:10.${r}`,
    ``,
    `${d}Waiting for your next message.${r}`,
  ],
};

process.stdout.write("\x1b[2J\x1b[H" + (S[process.argv[2]] || S.api).join("\r\n") + "\r\n");
setInterval(() => {}, 1 << 30);
