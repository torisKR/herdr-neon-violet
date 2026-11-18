# Review: {{stage}} (round {{round}} of {{rounds}})

**Goal:** decide whether the work of this stage can be handed on, or what exactly must be fixed first. You review; you do not fix.

**Inputs**
- What the stage was asked to do: `{{task_file}}`
- What it produced: the files that task names, and the workers' `pipeline/{{stage}}/result*.json`
- What the conductor's automatic checks found:
{{issues}}

**Do**
1. {{focus}}
2. Judge against the brief and the stage's task, not against your own taste. An issue is something that is wrong, missing, broken or off-style enough that the next teammate or a user would notice. Preferences are not issues.
3. Write at most 8 issues, the most important first. Each one says **which file** and **what to change**, concretely enough to act on without asking ("assets/images/cat_idle.png: outline is 1px, the others use 2px"). When the work is split among workers, start the issue with the file so its owner can be found.
4. If nothing has to change, pass it. In the last round, pass unless something would break the app or the release.
5. Do not edit, regenerate or delete anything the stage made.

**{{result}}**
```json
{"status":"done","verdict":"pass","issues":[],"summary":"<what you checked and the verdict, 1-2 sentences, Korean>"}
```
Use `"verdict":"fix"` with the `issues` list (Korean) when something must be fixed.
