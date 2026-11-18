# Stage: assets (lead Artist)

**Goal:** split the art of the first version among {{workers}} artists so that their pictures look like one hand drew them. You plan; they draw.

**Inputs**
- Chosen direction: {{design_choice}}
- `pipeline/design/directions.md`, `pipeline/brief/brief.md` (engine: {{engine}})

**Do**
1. Write `pipeline/assets/style.md` (Korean), the rules every artist follows: the palette as hex values, outline (width, color), shading and light direction, the pixel grid or stroke style, proportions of characters, how backgrounds are treated, and one prompt prefix to start every generation with. Short and exact: an artist who reads only this file must be able to match the others.
2. List every image the screens in the brief need. Only what the first-version scope uses.
3. Write `pipeline/assets/manifest.json`. Paths are relative to the project folder and are where the engine expects the file (Flutter: `assets/images/...`; Godot: `assets/...`; Unity: `Assets/Art/...`):
   ```json
   {"items":[
     {"file":"assets/images/cat_idle.png","w":64,"h":64,"alpha":true,"use":"player, idle","owner":"w1"},
     {"file":"assets/images/bg_cafe.png","w":1080,"h":1920,"alpha":false,"use":"main screen background","owner":"w2"}]}
   ```
   - `w`, `h`: the exact size in pixels. `alpha`: `true` when the background must be transparent (sprites, icons, the adaptive icon foreground), `false` when it must be fully opaque (backgrounds, the 1024x1024 store icon source).
   - `owner`: one of {{worker_ids}}. Share the work evenly, and keep things that must match exactly (the frames of one animation, one character's poses) with one owner.
   - Include the launcher icon source (1024x1024, `alpha` false) and the adaptive icon foreground (`alpha` true).
4. Write `pipeline/assets/manifest.md` (Korean) for people: the same list as a table, grouped by screen.
5. Do not generate the images yourself.

**{{result}}:** `{"status":"done","summary":"<how many images, how they are split>"}`
