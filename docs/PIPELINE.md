# App pipeline (Auto app)

A team of agents takes an idea from research to the Play Store, and you watch them work in Herdr.

Open it from the **+** menu (**Auto app**) or with Ctrl+Shift+Y (Cmd+Shift+Y on macOS). Give it a project folder and say what to build; it runs from planning to release.

The folder can be empty or an existing project. A Flutter (`pubspec.yaml`), Godot (`project.godot`) or Unity (`ProjectSettings/ProjectVersion.txt`) project keeps its engine and the Android application id it already has (from `android/app/build.gradle(.kts)`, `export_presets.cfg` or `ProjectSettings.asset`): the brief plans its next version instead of choosing again, so a published app is never released under a new id. A folder that is another stack (a `package.json` for web, Expo or React Native, or a native Gradle project) is refused when the app is created, with that reason: this pipeline builds Android apps with Flutter, Godot or Unity only.

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

### Casting the team before the start

The new-app form has a **Team** section with one row per role. Each row offers every agent CLI installed on this computer, and you choose:

- **the agent**: `claude`, `codex`, `grok`, `agy`, `gemini`, `opencode`, `cursor-agent`, and any other CLI the + menu knows (it is added on first use);
- **its model**: click the model chip to step through the CLI's own list (`grok models`, `agy models`, `cursor-agent models`; Claude's `opus`, `sonnet`, `haiku`), or type any model name for the selected role. Empty means the CLI's default;
- **how many work at once** (×1 to ×4) on research, design and assets;
- **a reviewer**: another agent that checks the work before it is handed on, or none.

A stage that has not started yet can be recast from its details on the board. On the command line: `--cast build=claude:opus --cast design=codex*3 --review build=codex`, and later `nv-pipeline cast <id> <stage> <agent>[:<model>][*<workers>] [--review <agent>|none]`. `nv-pipeline agents` lists what is installed and the models found.

`gemini`, `opencode` and `cursor-agent` are started like `agy`: without the flag that skips every permission prompt. They stop at their first prompt and the board shows that they need you, unless you change how they are started in `settings.json` (`agents`).

## Several agents on one stage, and loops

A stage is no longer always one agent.

- **Workers.** With ×2 or more, research and design run that many agents at the same time, each proposing on its own; their options are merged into one set of cards. For assets a **lead** first writes the style guide and splits the image list (`pipeline/assets/manifest.json`, each item with an `owner`), then the artists draw their own items at the same time.
- **Reviewer.** After the workers finish, the reviewer reads what the stage was asked for and what it made, and writes `pipeline/<stage>/review.json`: pass, or a list of what to fix. A fix list sends the workers back for another round (three rounds at most, `rounds` in settings). By default Claude reviews the assets and Codex reviews the build; `"review": {"build": "none"}` or `"review": false` in settings turns it off.
- **Test back to build.** When the tester reports defects in the app (`defects` in its result), the pipeline does not stop: the developer gets the list in `pipeline/build/fixes.md`, and build and test run again (three loops at most, `loops` in settings).

## Graphics the conductor checks itself

The assets and store stages list every image in a manifest (`pipeline/assets/manifest.json`, `pipeline/store/manifest.json`): file, width, height, whether it must be transparent or opaque, what it is for. When the workers are done the conductor reads every file itself, without an agent:

- the file exists and is a real PNG, JPEG, WebP or GIF;
- it has exactly the listed size;
- it is transparent where it must be (sprites, the adaptive icon foreground) and opaque where it must be (backgrounds, the store icon);
- it is not a blank image of one color, and not a copy of another item.

What fails goes back to the worker who owns that file as a fix list. If it still fails after the last round, the stage fails and says which files. `pipeline/<stage>/sheet.html` shows every image on one page for the reviewer and for you. `"checks": false` in settings turns the checks off.

**Antigravity (`agy`)** is known to the pipeline but not cast by default: the only way it runs unattended is by skipping its permission prompts, and that is your decision, not a default. To have it test the build (a different model from the one that wrote it), add to settings: `"cast": {"test": "agy"}, "agents": {"agy": ["agy", "--dangerously-skip-permissions", "-i", "{prompt}"]}`. Without the flag it stops at its first permission prompt and the board shows that it needs you.

Change it in `~/.config/herdr-app/pipeline/settings.json`: `"cast": {"test": "claude"}` reassigns a stage, `"agents": {"claude": ["claude", "--model", "opus", "{prompt}"]}` changes how a model is started, `"fallback"` names the stand-in.

## Replica skills inside the stages

A run can use the eleven skills of [The Replica skill](https://github.com/Jakeschincariol/replica-skill) (MIT, Jake Schincariol): the reference app is analysed into a recon map and a feature matrix, real reviews are read for what to improve, and the conductor checks feature parity, leftovers of the reference and the store listing itself before anything is uploaded. It is a choice per run: turn on **Use the Replica skills** on the Auto app form, or pass `--replica` to `nv-pipeline new`. A run made without it, and every run made before this existed, works exactly as described above.

You still only give a folder, an idea and, if you have them, references (a store link, a web page, screenshots). Nobody names a skill or the next step: the conductor does.

### The pack's own order, and the order here

The pack runs its skills one after another:

```
recon → architect → design → build → backend → test → diff → entrepreneur → brand → launch → deploy
```

In this pipeline they are parts of the nine stages. Two things move earlier on purpose: the reviews are read **before** the ideas and the brief, so what users complain about shapes the first version instead of arriving after it is built; and the brand direction (names to avoid, a palette of our own) is set with the design, so the artist and the developer never work in the reference's colours.

| Stage | Skills (the part of each that this stage does) | Files in `replica/` |
|---|---|---|
| research | `replica-recon`; `replica-entrepreneur` (early: collect and rank reviews, draft angles) | `recon.md`, `features.csv`, `reviews.csv`, `feedback.md`, `fixes.md`, `sources.md` |
| brief | `replica-architect` (the engine table above instead of the pack's web stack; fixes the first version in the matrix) | `architecture.md`, `features.csv` |
| design | `replica-design` (tokens per direction); `replica-brand` (early: name candidates, palette family, voice, what to avoid) | `design/candidates/<option>/tokens.json`, `design/components.md`, `brand.md`, `brand.json` |
| assets | no skill: uses the chosen direction's tokens and the brand | `design/tokens.json` (settled by the conductor from the chosen option) |
| build | `replica-build`; `replica-backend` (only when the architecture has a server side) | `features.csv`, `build-log.md`, `backend.md` |
| test | `replica-test` (on the device, with adb); `replica-diff` (parity against the first version) | `test-plan.md`, `bugs.md`, `parity.md` |
| store | `replica-entrepreneur` (final: the one angle); `replica-brand` (final: name checks, logo brief, the sweep); `replica-launch` | `fixes.md`, `brand.md`, `brand.json`, `launch/listing.json`, `launch/pricing.md`, `launch/launch-plan.md`, `launch/landing.md` |
| internal | `replica-deploy` (preflight and the internal track) | `deploy.md` |
| release | `replica-deploy` (the promotion and its result) | `deploy.md` |

`replica/` holds what the skills write (analysis, plans, the matrix, reports). `pipeline/` stays this pipeline's own: tasks, results, reviews, the feed and the state. Both are in the app's project folder, not in this pack.

### What each agent is told

Each agent's task file gets one extra section with only the skills of its stage: the skill file to read (its path in the installed pack), the part to do, the files handed to it, the files to write, the tool to run, and when it counts as done. The other skills are not put in front of it. The same section says where the skill files do not apply: this task wins over a skill file, the conductor starts the next step (a skill's "Next: /replica-…" is ignored), nobody answers questions, and the stack is the project's engine (Flutter, Godot, Unity) with adb and fastlane, not the Next.js, Expo, Stripe and Vercel of the pack's examples. The task file is what carries the skill to any agent CLI; a slash command is never assumed to exist.

With several workers on a stage, one of them (`w1`) writes the shared files of `replica/` and the others are told to leave them alone; design candidates are separate per worker (`design/candidates/w2-a/…`), and the conductor copies the tokens of the option that is chosen, by you or unattended, to `design/tokens.json` when the artist starts.

### What the conductor checks itself

After a stage's agents finish, the conductor checks what the skills had to leave, with the pack's own Python tools where there is one. A file that merely exists is not enough:

- `features.csv` has the columns `feature,area,priority,original,clone,notes` and only allowed values, with a reason for every `skip`; `reviews.csv` has `source,url,date,rating,text` and every row has its link and its text. `reviews.py` ranks reviews, it does not collect them: the number of reviews really collected is recorded, and zero is an honest answer when no source could be reached (`sources.md` lists what was opened, when, and what was not reached).
- design: `contrast.py` on the tokens of every option. test: `parity.py` (every must-have of the first version done) and no open S1 or S2 bug in `bugs.md`. store: `sweep.py` (nothing of the reference in the project) and `listing.py`. internal and release: the version code, which must be the same one in both.
- What fails goes back to the same stage for another round, like a failed image check. A must-have that is not done or an open serious bug is a defect in the app: it goes to the developer, and the tester checks again. A check that still fails after the last round fails the stage with the reason.
- A part can be reported as not needed only where the plan allows it (`replica-backend` for an app with no server side), with the reason; that is recorded and shown. Anything else reported as skipped is refused.
- Parity is judged against the first version: rows left out on purpose (`skip`) and what was changed on purpose are not gaps, and the look is meant to differ.

Per stage, the state file keeps the pack's version, each skill's outcome and each check's result (`stages.<id>.replica`), and the board shows them on the desk.

### Code that changes after the tests

When the tests pass, the conductor records the project's source exactly as it is (`pipeline/replica-verified.json`). Before the internal stage starts it compares: if any source file changed since (the marketer renamed a string while settling the brand, say), or the sweep finds the reference in the code, nothing is uploaded. The developer gets the list, and build and test run again, within the usual loop limit. Notes, the listing files and build output do not count as source.

An upload stage is never started again to repair its record: if the internal or release stage ran but its check fails (no version code, or a different one than was tested), the pipeline stops for you with what is wrong. After you put it right, continuing takes the result that is there.

### What it needs, and where it comes from

- **Python 3.8 or newer** (`python3`, `python` or `py -3`). The tools use the standard library only.
- The pack is a copy in this repository, `app/pipeline/replica/`, of commit `77c9436` of the source, unmodified, with its MIT license; `app/pipeline/replica/UPSTREAM.md` records the source, the commit and how to move to a newer one. The installers copy it to `~/.config/herdr-app/pipeline/replica/` as one folder, so the paths between skills hold, and register the eleven skills in `~/.claude/skills` and `~/.agents/skills` where those exist (a skill folder of the same name that is your own is left alone). **Update** in the + menu installs the copy of the version you pull; nothing is fetched from the source's main branch.
- The post that pointed to the pack ([Threads, @s.ha_min](https://www.threads.com/@s.ha_min/post/Df2A-DKGT2B), read 2026-11-19 from the page's text) describes "Replica 스킬" as eleven skills from analysing an app to releasing your own, installed in Claude Code with two commands and called from recon to deploy, and says to change the name, colours and logo before release. That matches the source's README (eleven skills, `/plugin marketplace add Jakeschincariol/replica-skill` and `/plugin install replica-skill@replica-skill`, recon … deploy). The page's text has no link to the repository, so the post and the repository are matched by that description, not by a link.
- `nv-pipeline replica` shows where the pack is, its version, the Python it found and what is missing. When the pack or Python is missing, a run with Replica waits before its first stage and says so on the board; press **Continue** once it is there.

### Limits

- What is tested on every change: the whole handover with stand-in agents and the pack's real Python tools (`app/tests/replica.test.mjs`). Not yet run: a full run with real models, a test on a real device, and a real store upload with Replica on. Expect the first real runs to show where a task needs clearer wording.
- If a stage fails on a Replica check, the desk shows which check and why. Fix the file or press **Run again** for that stage; a run that stopped continues from the stage it was at, and finished stages are not redone.
- Supported projects are the pipeline's own: Flutter apps, Godot and Unity games, released to Google Play. A web project, the App Store, payments and domains are in the skills but not in this pipeline: the skills' steps for them are written as not applicable.
- Trademark and store-name checks are listed for you to run; an agent marks a check as run only when it ran it.
- The layout comparison (`imgdiff.py`) is used only when same-state screenshots of both apps exist, which an unattended run usually does not have.

## The board

- **Office:** every teammate is a pixel character at a desk. The one working bobs at a glowing screen with its latest note in a speech bubble; a finished one passes an envelope to the next desk; one that needs you waves an exclamation mark; the rest doze. **Click a desk to open that agent's screen** over the board (and its details below); every worker, lead and reviewer of the stage has its own Show and Open-as-tab buttons.
- **State:** each desk carries a filled badge, and a line above the office counts them: **Working**, **Waiting**, **Done**, **Needs you**, **Failed**. The state is what is really happening, not only what the state file says: a desk whose agent reports that it stopped is **Not responding** (the conductor reminds it twice, then fails the stage and the stand-in model takes over), and a run whose conductor is gone (the app or the computer restarted) is **Stalled**, with a Continue button that picks it up where it was.
- Clicking an app in the top bar always shows its board, also when the new-app form is open.
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
- Every worker, lead and reviewer is a **new agent** that reads one task file and writes one result file. It is ended as soon as the result is in, so no conversation grows across the run.
- Stages hand over through files in `<project>/pipeline/`, not through context.
- Each stage has a time budget and one retry; review rounds and test loops are limited; past that the pipeline stops and says why.
- An agent that stops without a result (it finished its turn, asked a question, or its provider refused the request) is not waited for until the budget runs out: it is reminded, then ended.
- The conductor itself exits whenever it waits for you; the board starts it again when you choose.

## What keeps it from releasing by accident

- State is never held across a stage: before every decision the conductor reads the mode, approvals and stop request from disk, and every write is a short locked read-modify-write. Switching to "ask before production" or pressing Stop while a stage runs takes effect.
- One conductor per app (a lock file names the process); a second one is refused.
- The internal stage's fastlane commands all name `--track internal` and skip stray APKs; only the release stage promotes to production, and only in unattended mode or after you approve.
- An agent that stopped to ask you something is kept and taken over when you continue, not started again. Removing an app ends its agents.

## Command line

```sh
nv-pipeline new "Cat Cafe" --idea "idle cat cafe game" --dir ~/projects/cat-cafe --mode promote \
            --cast build=claude:opus --cast design=codex*3 --review build=codex [--replica]
nv-pipeline run cat-cafe [--until build]
nv-pipeline replica            # the Replica pack: where it is, its version, Python, which stage uses which skill
nv-pipeline status | pick <id> <option> | approve <id> | mode <id> auto|promote|review
nv-pipeline agents [--refresh] | cast <id> <stage> <agent>[:<model>][*<workers>] [--review <agent>|none]
nv-pipeline say <id> "make it cuter" | retry <id> [stage] | stop <id> | remove <id>
```

`nv-pipeline` is `node ~/.config/herdr-app/bin/nv-pipeline.mjs`. Settings (optional) in `~/.config/herdr-app/pipeline/settings.json`: `root` (where new projects go, default `~/projects`), `cast`, `agents` and `fallback` (above), `review` (who reviews which stage), `retries`, `rounds`, `loops`, `checks`. Stage instructions are in `~/.config/herdr-app/pipeline/stages/*.md` and can be edited; installing an update replaces them.
