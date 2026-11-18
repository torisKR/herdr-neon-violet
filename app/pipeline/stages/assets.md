# Stage: assets (Artist)

**Goal:** every image the first version needs, in the chosen direction, ready for the developer to drop in.

**Inputs**
- Chosen direction: {{design_choice}}
- `pipeline/design/directions.md`, `pipeline/brief/brief.md` (engine: {{engine}})

**Do**
1. When you work alone: write `pipeline/assets/style.md` (Korean: palette as hex, outline, shading and light direction, pixel grid or stroke style, one prompt prefix for every generation) and `pipeline/assets/manifest.json`, the list of every image the screens in the brief need and nothing more:
   ```json
   {"items":[
     {"file":"assets/images/cat_idle.png","w":64,"h":64,"alpha":true,"use":"player, idle"},
     {"file":"assets/images/bg_cafe.png","w":1080,"h":1920,"alpha":false,"use":"main screen background"}]}
   ```
   Paths are relative to the project folder, where the engine expects the file (Flutter: `assets/images/...`; Godot: `assets/...`, nearest-neighbour import for pixel art; Unity: `Assets/Art/...`). `w`, `h` are exact pixels. `alpha` is `true` when the background must be transparent and `false` when the image must be fully opaque. Also write `pipeline/assets/manifest.md` (Korean) with the same list as a table for people.
   When a lead has already written the style and the manifest, read them and change neither.
2. Generate your images with the `sprite-gen` skill (sprites, animation atlases, backgrounds, logo lettering) or a pixel art skill, every one starting from the style file. Remove backgrounds where `alpha` is true and export at exactly the listed size.
3. Include the launcher icon source: 1024x1024 without transparency for the store icon, and a separate foreground with transparency for the adaptive icon (both are manifest items).
4. Look at each result at its real size. Regenerate ones that are off-style, unreadable or broken.
5. The conductor checks every manifest item itself when you are done: the file exists, has the listed size, is transparent or opaque as listed, is not blank and is not a copy of another item. What fails comes back to you as a fix list, so check sizes before you finish (`file`, `sips -g pixelWidth -g pixelHeight`, or the image tool you used).

**Images:** if you can generate images yourself (Codex has an image tool), do that directly and save the files at the paths above; otherwise use the skills named above.

**result.json:** `{"status":"done","summary":"<how many assets you made, where the manifest is>"}`
