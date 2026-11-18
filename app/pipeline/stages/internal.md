# Stage: internal (Release manager)

**Goal:** a signed release bundle on the Google Play **internal** track, with the listing uploaded.

**Inputs**
- `pipeline/build/notes.md`, `pipeline/test/report.md`, `fastlane/metadata/android`
- Engine: {{engine}} · application id: `{{package}}`
- Play service account key: `{{key}}` (never copy it into the project, never print it)

**Do**
1. Flutter: use the `toris-flutter-play-store-release` skill: `setup` if Fastlane is not configured, then `build`, then `deploy` to the **internal** track with the key above (`json_key_file` or `SUPPLY_JSON_KEY`). Godot or Unity: export a signed AAB, then `fastlane supply --aab <file> --track internal --package_name {{package}} --json_key "{{key}}"`.
2. Signing: use the upload keystore the project already has; otherwise create `~/keystores/{{id}}-upload.jks`, keep its passwords in `android/key.properties` (git-ignored) or the system keychain, and note where in `pipeline/internal/signing.md` (no passwords in that file).
3. Upload the listing as well (text and images from the store stage), and nothing else: `fastlane supply --track internal --skip_upload_aab --skip_upload_apk --metadata_path fastlane/metadata/android --package_name {{package}} --json_key "{{key}}"`.
   **Every `fastlane supply` call in this stage names `--track internal`.** Without a track fastlane uploads to production, and without `--skip_upload_apk` it picks up any APK it finds in the project. This stage never touches production.
4. If Google answers that the package does not exist, the app was never created in Play Console. Create it there with the `ego-browser` skill (name and default language from the brief, the privacy policy link from `pipeline/store/privacy-url.txt`, the answers from `pipeline/store/console-answers.md`), then upload again. If the console needs something only the account owner can do (identity, payments), that is `blocked`.
5. Confirm with `fastlane run google_play_track_version_codes track:internal package_name:{{package}} json_key:"{{key}}"` that the new version code is there. Write `pipeline/internal/report.md`: the version, the track link, how a tester installs it.

**result.json:** `{"status":"done","summary":"<version code on internal, link>"}`
