//! nv — the neon-violet tools for herdr, in one binary.
//!
//!   nv agents             ALL agents board
//!   nv devices [--once]   adb devices, emulators, iOS simulators
//!   nv browse [url]       text-mode web browser      (--dump <url> prints the page)
//!   nv files [dir]        file explorer + pull requests (--dump files|prs prints one frame)
//!   nv open <pane>        opens a plugin pane (used by the plugin actions)
//!   nv todo ...           the shared to-do list
//!   nv merge-keys ...     adds this pack's shortcuts to the Herdr app's keys.json

mod agents;
mod browse;
mod demo;
mod devices;
mod files;
mod keys;
mod open;
mod todo;
mod ui;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest = args.get(1..).unwrap_or(&[]);
    let code = match args.first().map(String::as_str) {
        Some("agents") => agents::main(),
        Some("devices") => devices::main(rest),
        Some("browse") => browse::main(rest),
        Some("files") => files::main(rest),
        Some("open") => open::main(rest),
        Some("todo") => todo::main(rest),
        Some("merge-keys") => keys::main(rest),
        Some("demo-agent") => demo::main(rest),
        Some("--version") | Some("-V") => {
            println!("nv {}", env!("CARGO_PKG_VERSION"));
            0
        }
        _ => {
            eprintln!("usage: nv <agents|devices|browse|files|open|todo|merge-keys> [args]");
            2
        }
    };
    std::process::exit(code);
}
