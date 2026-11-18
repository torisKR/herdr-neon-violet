# Stage: build (Developer)

**Goal:** a working first version that does exactly the scope in the brief and passes its own checks.

**Inputs**
- `pipeline/brief/brief.md`, `pipeline/brief/acceptance.md`, `pipeline/assets/manifest.md`
- Engine: **{{engine}}** · Android application id: `{{package}}`

**Do**
1. Create the project in this folder if it does not exist yet:
   - Flutter: `flutter create --org kr.toris --platforms android .` (on macOS Flutter is at `~/development/flutter/bin` when it is not on PATH). Follow the `flutter-apply-architecture-best-practices` skill.
   - Godot: a Godot 4 project (`project.godot`) with an Android export preset.
   - Unity: a Unity project with URP and the Android module, IL2CPP and ARM64.
2. Implement the first-version scope checklist, item by item. Nothing from the "out of scope" list. Use the assets from the manifest.
3. Set the application id to `{{package}}`, version 1.0.0 (code 1), and the launcher icon.
4. Keep it honest: analyzer or linter clean, unit tests for the logic of the core loop, and a debug build that succeeds (`flutter build apk --debug`, or the Android debug export of the engine).
5. Write `pipeline/build/notes.md`: how to build and run, which code each scope item maps to, anything the tester should know.
6. Commit your work in small commits (`git init` first when the folder has no repository). Do not push.

**result.json:** `{"status":"done","summary":"<what works, the debug build path>"}`
