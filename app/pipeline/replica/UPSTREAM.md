# Where this folder comes from

This folder is a copy of **The Replica skill** by Jake Schincariol: eleven agent skills and six standard-library Python tools.

| | |
|---|---|
| Source | https://github.com/Jakeschincariol/replica-skill |
| Commit | `77c9436fb3d18c3d58169efb8caf4fe906b0dc51` (2026-10-03, "The Replica skill: 11 Claude skills, v1.0") |
| License | MIT, Copyright (c) 2026 Jake Schincariol. The full text is in `LICENSE` in this folder and stays with every copy. |
| Copied | 2026-11-19, with `git archive` of that commit: all 39 files |

## What differs from the source

**Nothing in the 39 files.** Two files were added and are not part of the source: this `UPSTREAM.md` and `upstream.json` (the same facts for programs, with a SHA-256 over the copied files, read with LF line endings). `app/tests/replica.test.mjs` recomputes that digest, so a change to any copied file fails the tests until it is written down here and in `upstream.json` (`modified`).

How the skills are used by the app pipeline (which stage, which part, the engine instead of the pack's web stack, who starts the next step) is not written into these files. It is in `app/pipeline/nv-replica.mjs` and is added to each agent's task file. See `docs/PIPELINE.md`.

## Updating

Updates of this pack never fetch the source. To move to a newer commit, on purpose:

1. Read the source's changes since the commit above, and its license.
2. Replace the 39 files with `git archive <new commit>` of the source (keep `UPSTREAM.md` and `upstream.json`).
3. Run the pack's own tests: `python3 -m unittest discover -s tests` in this folder.
4. Update the commit, date, file count and digest here and in `upstream.json`, check `nv-replica.mjs` against skills that changed, and run `node --test app/tests/*.test.mjs`.
