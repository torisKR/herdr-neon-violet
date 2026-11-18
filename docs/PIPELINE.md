# App pipeline (Auto app)

A team of agents takes an idea from research to the Play Store, and you watch them work in Herdr.

Open it from the **+** menu (**Auto app**) or with Ctrl+Shift+Y (Cmd+Shift+Y on macOS). Give it a project folder and say what to build; it runs from planning to release.

## The team

| Stage | Teammate | Makes |
|---|---|---|
| research | Researcher | three scored ideas from what is trending in Korea and the US |
| brief | Planner | a one-page brief, the engine, the first-version scope, kill criteria |
| design | Designer | three visual directions, each with a mock image |
| assets | Artist | sprites, icons and UI art in the chosen direction |
| build | Developer | the first version, exactly the brief's scope |
| test | Tester | the acceptance checks on a device with adb, with screenshots |
| store | Marketer | listing text and graphics, the privacy policy on Notion |
| internal | Release manager | a signed bundle on the Play internal track (fastlane) |
| release | Publisher | the tested build promoted to production (20% rollout) |

Apps are built with Flutter. Games follow this table in the brief stage: pixel, puzzle, ink-style 2D RPG and small idle games use Godot; 2D with heavy lighting and effects uses Unity or Godot; 3D tycoon, fishing and low-poly action use Unity + URP, which is also the default when unsure.

## References

Point it at what you want it to be like: Play Store or App Store links, repositories, web pages, or screenshots (drop them on the form). On the command line: `--ref <link or image>`, as many as you like.

References are studied, not copied. Every stage is told the same rule: take the genre, the core loop and the flow; make the name, logo, characters, art, sounds, text and levels new, and never use a name or icon that could be confused with the original. A reference is looked at from the outside (its store page, screenshots, using it). Analysis tools such as REA may be used to understand how a feature behaves, never to take code, assets, text or data out of another app or to get around its protections. Repositories are used only as their license allows. The researcher writes what each reference does well (`pipeline/research/references.md`), the brief ends with how ours differs, and the designer replaces any direction that could be mistaken for a reference. If something could only be done by copying, the stage stops and says so.

## Which model does what

Each teammate is a different CLI where that plays to its strength:

| Stages | Model | Started as |
|---|---|---|
| research | Grok (live trends) | `grok --permission-mode auto` |
| brief, build, test, store, internal, release | Claude (skills, Notion) | `claude --permission-mode auto` |
| design, assets | Codex (generates the images itself) | `codex --no-daemon -a never -s workspace-write` |

A model that is not installed, or whose first try at a stage failed (a usage limit, a crash), is replaced by Claude for that stage. The board shows the model at every desk.

**Antigravity (`agy`)** is known to the pipeline but not cast by default: the only way it runs unattended is by skipping its permission prompts, and that is your decision, not a default. To have it test the build (a different model from the one that wrote it), add to settings: `"cast": {"test": "agy"}, "agents": {"agy": ["agy", "--dangerously-skip-permissions", "-i", "{prompt}"]}`. Without the flag it stops at its first permission prompt and the board shows that it needs you.

Change it in `~/.config/herdr-app/pipeline/settings.json`: `"cast": {"test": "claude"}` reassigns a stage, `"agents": {"claude": ["claude", "--model", "opus", "{prompt}"]}` changes how a model is started, `"fallback"` names the stand-in.

## The board

- **Office:** every teammate is a pixel character at a desk. The one working bobs at a glowing screen with its latest note in a speech bubble; a finished one passes an envelope to the next desk; one that needs you waves an exclamation mark; the rest doze. Click a desk for details.
- **Team chat:** what they tell each other, including hand-offs. Type to tell the working agent something.
- **Choices:** ideas and designs appear as cards (designs with their image). Click one to choose. Production has an approve button.

## How much it asks you

Switch per app, any time:

| Mode | Asks you |
|---|---|
| Unattended | nothing, production included |
| Ask before production (default) | only before the production release |
| Ask at every choice | which idea, which design, and before production |

## The Play service account key

Uploads use fastlane with a Google Play service account key. The first time, drop the `.json` on the board (or `nv-pipeline key set <file>`). It is checked, copied to `~/.config/herdr-app/pipeline/secrets/play-key.json` (owner-only) and never copied into a project. Without it the pipeline still plans, builds and tests, then waits before the first upload.

An app that has never been uploaded must exist in Play Console first; the release manager creates it there through the browser when fastlane reports that the package does not exist.

## Why it does not leak tokens or memory

- The conductor (`bin/nv-pipeline.mjs`) is a script: sequencing, retries and waiting cost no tokens.
- Every stage is a **new agent** that reads one task file and writes one result file. It is ended as soon as the result is in, so no conversation grows across the run.
- Stages hand over through files in `<project>/pipeline/`, not through context.
- Each stage has a time budget and one retry; past that the pipeline stops and says why.
- The conductor itself exits whenever it waits for you; the board starts it again when you choose.

## What keeps it from releasing by accident

- State is never held across a stage: before every decision the conductor reads the mode, approvals and stop request from disk, and every write is a short locked read-modify-write. Switching to "ask before production" or pressing Stop while a stage runs takes effect.
- One conductor per app (a lock file names the process); a second one is refused.
- The internal stage's fastlane commands all name `--track internal` and skip stray APKs; only the release stage promotes to production, and only in unattended mode or after you approve.
- An agent that stopped to ask you something is kept and taken over when you continue, not started again. Removing an app ends its agents.

## Command line

```sh
nv-pipeline new "Cat Cafe" --idea "idle cat cafe game" --dir ~/projects/cat-cafe --mode promote
nv-pipeline run cat-cafe [--until build]
nv-pipeline status | pick <id> <option> | approve <id> | mode <id> auto|promote|review
nv-pipeline say <id> "make it cuter" | retry <id> [stage] | stop <id> | remove <id>
```

`nv-pipeline` is `node ~/.config/herdr-app/bin/nv-pipeline.mjs`. Settings (optional) in `~/.config/herdr-app/pipeline/settings.json`: `root` (where new projects go, default `~/projects`), `cast`, `agents` and `fallback` (above), `retries`. Stage instructions are in `~/.config/herdr-app/pipeline/stages/*.md` and can be edited.
