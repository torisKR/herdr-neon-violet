# Graphical Browser and document previews

The Desktop Browser tool uses [MattJColes/herdr-web-browser](https://github.com/MattJColes/herdr-web-browser), MIT, version 1.3.2 pinned to `b409c5f2625676964e21ad54ff6a6627abb05e3b`.
It renders Chromium through the live terminal graphics supported by Herdr Desktop. The launcher keeps the renderer on the computer running Herdr, including when a remote workspace is selected. Closing its floating window ends only its own browser-view terminal.

The implementation was compared with [azizuysal/herdr-browser](https://github.com/azizuysal/herdr-browser) and [zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser). The pinned Rust plugin already provides the renderer, input and DOM automation needed here.

## Install

Run `./scripts/install-browser.sh` on macOS or Linux with Rust/Cargo and Git installed. It builds the pinned plugin, installs its Desktop assets, and downloads its dedicated Chrome for Testing. HTML Browser previews also require Node.js. The regular Unix pack installer attempts browser setup after applying its key migration; missing build tools or a failed download leave the rest of the pack installed and print retry instructions. On native Windows (and on Unix without that runtime) the Browser uses `nv-web` instead: Node.js 22+ and an installed Chrome or Edge, nothing to build. The TUI plugin's `nv browse` text reader is unchanged.

The installer preserves existing keys, adds the upstream Browser menu, and makes the pack's Browser menu / Command-Shift-U open the live view. Pressing the shortcut again closes the window. It does not import browser cookies; the browser starts with its own profile. Where Claude Code (`~/.claude/skills`) or Codex (`~/.agents/skills`) is set up, it installs the `herdr-hc` skill, which teaches agents hc orchestration, herdr-app and nv-web.

## nv-web: Chrome/Edge for people and agents

`app/browser/nv-web.mjs` (installed as `~/.config/herdr-app/bin/nv-web.mjs`) starts Chrome or Edge with the DevTools port on and a separate profile (`~/.config/herdr-app/browser/profile`). Every owner gets its own window and tab: the person is `person`, an agent is its `$HC_TERMINAL_ID`, which is the default owner. Several agents can therefore test pages side by side without taking each other's tab, and Chrome keeps windows behind Herdr running.

The Browser window has three parts: the address bar with a chip per owner (switch to watch an agent's tab), the live view in a terminal (`nv-web view`, Kitty graphics: click, drag, wheel and typing go to the page), and the Inspect panel. **Inspect** works like Orca's: click an element, say what should change, and **Send** gives the chosen agent the selector, styles, HTML, an outlined screenshot and, in React, Vue or Svelte development builds, the source file and line, by `hc send`. **New agent** starts one in a tab with that request. The panel also counts console errors and failed requests and can send them as one fix request.

```sh
nv-web open localhost:3000        # node ~/.config/herdr-app/bin/nv-web.mjs …
nv-web snapshot                   # [n] numbered controls and the page text
nv-web click 3 | type 2 'Hello' --submit | key enter | scroll 600
nv-web inspect 3                  # selector, styles, HTML, source file:line
nv-web console --errors           # kept by a watcher for every tab
nv-web network --failed
nv-web css '.cta { color: red }'  # try a fix live; css --reset
nv-web screenshot /tmp/page.png
```

## Use with agents

The title of each browser window shows its exact owner terminal, for example `t49`:

```sh
herdr-web-browser --owner t49 snapshot
herdr-web-browser --owner t49 open http://localhost:3000
herdr-web-browser --owner t49 click 3
herdr-web-browser --owner t49 type 2 'Hello' --submit
herdr-web-browser --owner t49 screenshot /tmp/browser.png
herdr-web-browser --owner t49 console
herdr-web-browser --owner t49 network
```

Take target numbers from a fresh snapshot. Always pass the owner shown in the window; another agent's tab remains separate. The view's address bar, mouse, keyboard, back/forward/reload and tab shortcuts work directly. See `herdr-web-browser agent-help` for the upstream command reference.

The browser runs on this computer: remote `localhost` servers need an SSH port forward or a reachable network URL. A remote workspace does not silently change what `localhost` means.

## File previews

- `.env`, `.env.local`, `.env.production.local` and `*.env` use Shell highlighting in the file editor. The Code highlighting panel also has a `.env` mode.
- Markdown and HTML have a Source / Preview toggle in both editors. These native text previews preserve the current unsaved buffer; HTML text preview does not apply CSS or JavaScript.
- HTML's Browser button writes a private snapshot of the unsaved buffer and opens it in Chromium for CSS and JavaScript rendering. Local source files retain a base URL for relative CSS and images. The source file is not saved or changed. Remote file snapshots render their inline content; their relative assets are not read from an unrelated local directory.

No Aside runtime or account is required by this browser integration. Browser investigation and web QA for this task use Ego Browser as requested.
