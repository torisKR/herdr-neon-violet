# Today (pick up where you left)

With many projects, the expensive part is not the work but starting again: what was the last state, what was left, was it tested. Today is one tab that answers that for the projects you register, so you can open one after days away and start within a minute.

Open it from the **+** menu (**Today**) or with Ctrl+Shift+J (Cmd+Shift+J on macOS).

## What it shows

Two places at the top: **Main work** (the one project you focus on today) and **Maintenance** (one urgent upkeep job). Every other project is in the list below, which can be folded away. A filter switches between all, personal and work projects.

Each project card answers:

| Question | On the card |
|---|---|
| What do I do next? | **Next action**: one sentence, the largest line |
| Where did I leave it? | **Where it stands**: what is done, what is not checked yet |
| Why did it stop? | **Why it stopped**: a failing test, a missing setting, waiting for someone |
| What did I put off? | **Decisions on hold** |
| Can I trust the last result? | **Verified**: what was really checked and when, and whether **the code changed since** |
| Where do I continue? | **Continue at**: the machine, the folder, the branch and commit, how much is uncommitted |

Small marks say why a project may need attention. They are facts that can be checked, never a score: it stopped for a reason, its verification is out of date, it has uncommitted changes, its folder is missing.

## Using it

1. **Register** the folders you want to come back to: **+ Folder** (a folder picker on this computer) or **+ This folder** (the folder of the terminal in focus, on its machine). Start with two or three.
2. **Pin** one as Main and, when something is urgent, one as Maintenance. Pinning another project takes the place from the one that had it.
3. **When you stop**, press **Leave a note** and fill the short fields; the next action comes first. **Draft from git** fills in the state from the last commit and what is uncommitted. If an agent is working in that folder, **Ask the agent to write it** sends it the request and it records the note itself.
4. **When you come back**, read the card and press **Continue**: Herdr goes to the project's space, or makes one in its folder on its machine. **Continue with an agent** also starts an agent there (Claude when it is installed, else the first one that is) and gives it the note as its first message, with how to leave the next note when it stops.

## Verification that goes stale

"Verified" is stamped against the code exactly as it was: the commit and everything uncommitted. Any later change, committed or not, turns it into **the code changed since: check again**, with how many commits and files changed. Saving a note does not renew an old verification; write a new one, or press **Checked again now** when you really ran it again. An agent that continues a project is told not to rely on a stale verification.

## Several machines

The tab runs the same small script on this computer and on every connected machine (`hc machine ls`), so a project is listed where it lives and Continue opens its space on that machine. Notes are kept on the machine the project is on: stop on the Windows machine, open Herdr on the Mac with the Windows machine connected, and the note is there. Code and an agent's own session are not moved between machines; that is outside this feature.

A machine that cannot be reached, or that has no Node.js, is left out. The tab sends its own copy of the script, so a machine does not need this pack to be listed; it needs it for agents there to write notes themselves (the command they are given is that machine's `bin/nv-today.mjs`).

## Command line and agents

Notes are a plain file, `~/.config/herdr-app/today/today.json`, and agents can read and write them:

```sh
nv-today list
nv-today add ~/projects/cat-cafe --name "Cat Cafe" --kind work
nv-today focus cat-cafe main
nv-today note cat-cafe --state "login screen done; sign-up checked, re-login not" \
        --next "log out and back in with an existing account" --why "" --verified "sign-up on a Pixel 8"
nv-today draft cat-cafe | remove cat-cafe
```

`nv-today` is `node ~/.config/herdr-app/bin/nv-today.mjs`. It spends no tokens: it reads git and its own file.

## What it does not do yet

- It does not rank projects or guess which one is worth more. You pin; it shows the facts.
- It does not read usage, revenue or store data.
- It does not use `toris-agent` (`toris receipt`, `toris brief`). The note has the same parts (state, next action, verification, changes), so those can be connected later.
