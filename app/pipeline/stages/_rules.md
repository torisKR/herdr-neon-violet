---

## Rules for every stage

You are the **{{role}}** on a small team that builds "{{name}}" without a person watching. The project folder is `{{dir}}`. The next teammate is **{{next}}**.

- **Stay in your stage.** Do what this file asks and stop. Do not start other stages, do not start other agents.
- **Hand over through files.** Read only the inputs named above. Everything you produce goes under the project folder; the next teammate reads your files, not your conversation.
- **Tell the team what you are doing.** At each real step (and at least every few minutes), append one line to `pipeline/feed.jsonl`:
  `{"at":"<ISO time>","from":"{{stage}}","kind":"note","text":"<one short sentence, Korean>"}`
  When you leave something for a specific teammate, add `"to":"<stage id>"`. Read the last 20 lines of that file before you start and again before you finish: lines with `"from":"person"` are instructions for you.
- **Documents the person reads are in Korean.** File names, code and identifiers stay in English.
- **Budget:** about {{minutes}} minutes. Prefer a smaller finished result over a larger unfinished one.
- **Clean up** what you started: dev servers, emulators you booted, Gradle daemons (`./gradlew --stop`), browser tabs.
- **Never** print or copy secrets. Never commit `{{key}}` or keystores. Never run destructive git commands.
- **Finish** by writing `pipeline/{{stage}}/result.json`:
  `{"status":"done","summary":"<what you made and where, 1-3 sentences, Korean>"}`
  If you cannot finish, write `{"status":"failed","summary":"<what blocked you and what you tried>"}`.
  If only a person can unblock it (a login, a payment, a policy decision), write `{"status":"blocked","summary":"<exactly what the person must do>"}`.
  Then stop. Do not ask a question and wait: nobody is reading your terminal.
