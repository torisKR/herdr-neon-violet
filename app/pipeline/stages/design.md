# Stage: design (Designer)

**Goal:** three clearly different visual directions to choose from, each with one mock image of the real main screen.

**Inputs**
- `pipeline/brief/brief.md` (engine: {{engine}})

**Do**
1. Define three directions that differ in mood, palette and shape language, not in small details. Start from how the reference titles look, then make one safer and one bolder.
2. For each, make **one mock image** of the main screen (portrait 1080x1920, PNG) at `pipeline/design/option-a.png`, `option-b.png`, `option-c.png`. Use the `sprite-gen` skill (pixel and game art; Codex image generation) or `imagegen-frontend-mobile` (app screens). The image shows the main screen from the brief, not a mood board.
3. Look at each image yourself. Regenerate one that is unreadable or off-brief.
4. Write `pipeline/design/directions.md` (Korean): for each direction the palette (hex), type, shape rules, and why it fits the audience. Recommend one.

**Images:** if you can generate images yourself (Codex has an image tool), do that directly and save the files at the paths above; otherwise use the skills named above.

**result.json**
```json
{"status":"done","summary":"...","options":[
  {"id":"a","title":"<direction name>","desc":"<mood, palette, why; Korean>","image":"pipeline/design/option-a.png","recommended":true},
  {"id":"b","title":"...","desc":"...","image":"pipeline/design/option-b.png"},
  {"id":"c","title":"...","desc":"...","image":"pipeline/design/option-c.png"}]}
```
