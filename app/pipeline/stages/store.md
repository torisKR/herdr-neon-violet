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
5. Write `pipeline/store/manifest.json`, the list of every listing image, so the conductor can check them itself (exists, exact size, opaque, not blank, no duplicates):
   ```json
   {"items":[
     {"file":"fastlane/metadata/android/ko-KR/images/icon.png","w":512,"h":512,"use":"store icon"},
     {"file":"fastlane/metadata/android/ko-KR/images/featureGraphic.png","w":1024,"h":500,"alpha":false,"use":"feature graphic"},
     {"file":"fastlane/metadata/android/ko-KR/images/phoneScreenshots/1.png","w":1080,"h":1920,"alpha":false,"use":"screenshot 1"}]}
   ```
   List only one locale's copy of an image that is the same in both (the check reports identical files as duplicates).
6. Check the length of every text. Check the listing against Google Play policy with `play-policy-insights`.

**result.json:** `{"status":"done","summary":"<what is ready, the privacy policy link>"}`
