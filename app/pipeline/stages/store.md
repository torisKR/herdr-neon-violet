# Stage: store (Marketer)

**Goal:** everything the Play listing needs, generated and checked, in `fastlane/metadata/android` so the release stages can upload it.

**Inputs**
- `pipeline/brief/brief.md`, `pipeline/design/directions.md`, `pipeline/test/shots/` (real screenshots)
- Application id: `{{package}}`

**Do**
1. Listing text in Korean (`ko-KR`) and English (`en-US`) under `fastlane/metadata/android/<locale>/`: `title.txt` (30 characters at most), `short_description.txt` (80), `full_description.txt` (4000). Use the `aso` skill for keywords. No claims about things the app does not do.
2. Graphics with Codex image generation (the `sprite-gen` skill with the codex provider) into `fastlane/metadata/android/<locale>/images/`:
   - `icon.png` 512x512 and `featureGraphic.png` 1024x500
   - `phoneScreenshots/1.png` and on, at least four, 1080x1920: real screenshots from the test stage in a simple frame with a short caption. Do not invent screens that do not exist.
3. Privacy policy on Notion: create a page titled "{{name}} 개인정보처리방침" stating what the app collects (check the code and its SDKs: ads, analytics, permissions), why, how long, and a contact. Publish it to the web and save the public link in `pipeline/store/privacy-url.txt`. Use the Notion tools you have; if you cannot publish the page, that is `blocked`.
4. Data safety and content rating answers as `pipeline/store/console-answers.md` (Korean), so the first console setup takes minutes.
5. Check the size of every image and the length of every text. Check the listing against Google Play policy with `play-policy-insights`.

**result.json:** `{"status":"done","summary":"<what is ready, the privacy policy link>"}`
