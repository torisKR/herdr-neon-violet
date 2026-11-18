# Stage: test (Tester)

**Goal:** proof on a real or emulated Android device that the acceptance checks pass, or a precise list of what fails.

**Inputs**
- `pipeline/brief/acceptance.md`, `pipeline/build/notes.md`
- Engine: {{engine}} · application id: `{{package}}`

**Do**
1. Find a device: `adb devices` (on macOS adb is in `~/Library/Android/sdk/platform-tools` when it is not on PATH). If none is connected, boot an emulator from the installed AVDs and wait until it has booted. The `adb-android-control` skill has the commands.
2. Build and install the debug build, clear logcat, start the app.
3. Run every acceptance check with adb input (tap, swipe, text). Save one screenshot per check to `pipeline/test/shots/NN-name.png` and look at it before you judge the check.
4. Watch `adb logcat` for crashes (`FATAL EXCEPTION`), ANRs and errors from the process of the app. Rotate the device once and send the app to the background and back once.
5. If a check fails because of a small defect, fix it in the code, rebuild and run all checks again (at most two rounds). Larger problems are reported, not patched.
6. Write `pipeline/test/report.md` (Korean): a table of checks with pass or fail and the screenshot, crash log excerpts, what you fixed.
7. Shut down an emulator you booted and stop Gradle daemons.

**result.json:** `{"status":"done","summary":"<n of m checks pass, report path>"}`. Use `"failed"` when a core-loop check still fails, and then list what the developer must fix, one defect per line, each with the check it breaks and what you saw:
```json
{"status":"failed","summary":"<n of m checks pass, report path>","defects":["<check 3: tapping Start shows a black screen; logcat: NullPointerException in GameScene._ready>","..."]}
```
With `defects` the pipeline sends them to the developer and you test the new build again. Leave `defects` out when the failure is not in the app (no device, the build does not install): then the stage is simply tried again.
