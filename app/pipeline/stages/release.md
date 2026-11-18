# Stage: release (Publisher)

**Goal:** the build on the internal track goes to **production**. This stage runs only after the pipeline allowed it (unattended mode, or the person approved).

**Inputs**
- `pipeline/internal/report.md` (the version code that was uploaded), `pipeline/test/report.md`
- Application id: `{{package}}` · Play service account key: `{{key}}`

**Do**
1. Check once more: the test report has no failing core-loop check, and the internal version code matches the report. If not, stop with `failed`.
2. Promote, do not rebuild: `fastlane supply --track internal --track_promote_to production --rollout 0.2 --package_name {{package}} --json_key "{{key}}" --skip_upload_aab --skip_upload_apk --skip_upload_metadata --skip_upload_images --skip_upload_screenshots` (for Flutter the `deploy` mode of the `toris-flutter-play-store-release` skill does the same). A 20% staged rollout unless the brief says otherwise.
3. Confirm with `fastlane run google_play_track_version_codes track:production package_name:{{package}} json_key:"{{key}}"`.
4. Write `pipeline/release/report.md` (Korean): version, rollout, the Play link, what to watch in the first 48 hours (crash rate, ANR rate, reviews) and how to halt the rollout.

**result.json:** `{"status":"done","summary":"<version on production, rollout, link>"}`
