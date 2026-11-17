//! Prints a canned agent transcript and stays alive. Only used to stage the README screenshots.
//!   nv demo-agent <api|web|docs|infra>

use std::io::Write;

pub fn main(args: &[String]) -> i32 {
    let v = "\x1b[38;2;195;60;240m";
    let p = "\x1b[38;2;255;31;110m";
    let c = "\x1b[38;2;31;209;201m";
    let y = "\x1b[38;2;255;230;0m";
    let g = "\x1b[38;2;57;230;162m";
    let t = "\x1b[38;2;236;228;255m";
    let d = "\x1b[38;2;138;118;173m";
    let b = "\x1b[1m";
    let r = "\x1b[0m";
    let lines: Vec<String> = match args.first().map(String::as_str).unwrap_or("api") {
        "web" => vec![
            format!("{v}{b}>_ codex{r} {d}~/work/web-app{r}"),
            String::new(),
            format!("{t}> the checkout button jumps on mobile, fix the layout shift{r}"),
            String::new(),
            format!("{c}•{r} {t}Explored {d}src/components/Checkout.tsx, styles/cart.css{r}"),
            format!("{c}•{r} {t}Edited {c}styles/cart.css{r} {d}+6 -2{r}"),
            String::new(),
            format!("{p}{b}Allow command?{r} {t}pnpm playwright test checkout{r}"),
            format!("  {y}› 1. Yes{r}"),
            format!("    {d}2. Yes, and don't ask again{r}"),
            format!("    {d}3. No, tell codex what to do{r}"),
        ],
        "docs" => vec![
            format!("{v}{b}✻ claude{r} {d}~/work/docs-site{r}"),
            String::new(),
            format!("{t}> write a getting-started page for the CLI{r}"),
            String::new(),
            format!("{g}●{r} {t}Write {c}docs/getting-started.md{r} {d}(+112){r}"),
            format!("{g}●{r} {t}Update {c}docs/_sidebar.md{r} {d}(+1){r}"),
            format!("{g}●{r} {t}Bash {d}npm run docs:build{r}"),
            format!("  {d}✓ built 38 pages in 2.1s{r}"),
            String::new(),
            format!("{g}{b}✔ Done.{r} {t}New page at {c}http://localhost:4173/getting-started{r}"),
        ],
        "infra" => vec![
            format!("{v}{b}◆ gemini{r} {d}~/work/infra{r}"),
            String::new(),
            format!("{t}> why did last night's backup job fail?{r}"),
            String::new(),
            format!("{c}✦{r} {t}Reading {c}logs/backup-2026-11-16.log{r}"),
            format!("{c}✦{r} {t}The job hit the 30-minute timeout while uploading.{r}"),
            format!("  {t}Upload speed dropped after 02:10.{r}"),
            String::new(),
            format!("{d}Waiting for your next message.{r}"),
        ],
        _ => vec![
            format!("{v}{b}✻ claude{r} {d}~/work/api-server{r}"),
            String::new(),
            format!("{t}> add rate limiting to /v1/orders and cover it with tests{r}"),
            String::new(),
            format!("{g}●{r} {t}Read {c}src/routes/orders.ts{r}"),
            format!("{g}●{r} {t}Read {c}src/middleware/index.ts{r}"),
            format!("{g}●{r} {t}Write {c}src/middleware/rate-limit.ts{r} {d}(+48){r}"),
            format!("{g}●{r} {t}Update {c}src/routes/orders.ts{r} {d}(+3 -1){r}"),
            format!("{y}●{r} {t}Bash {d}npm test -- rate-limit{r}"),
            format!("  {d}PASS  test/rate-limit.test.ts (6 tests){r}"),
            String::new(),
            format!("{y}✶ Running the full suite… {d}(esc to interrupt){r}"),
        ],
    };
    let mut out = std::io::stdout();
    let _ = write!(out, "\x1b[2J\x1b[H{}\r\n", lines.join("\r\n"));
    let _ = out.flush();
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}
