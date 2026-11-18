# Stage: assets (Artist)

**Goal:** every image the first version needs, in the chosen direction, ready for the developer to drop in.

**Inputs**
- Chosen direction: {{design_choice}}
- `pipeline/design/directions.md`, `pipeline/brief/brief.md` (engine: {{engine}})

**Do**
1. List what the screens in the brief need in `pipeline/assets/manifest.md`: file, size, where it is used. Only what the first-version scope uses.
2. Generate them with the `sprite-gen` skill (sprites, animation atlases, backgrounds, logo lettering) or a pixel art skill, in one consistent style. Remove backgrounds and export at the sizes the engine wants.
3. Put them where the engine expects them (Flutter: `assets/images/...`, listed for `pubspec.yaml` in the manifest; Godot: `assets/...`, nearest-neighbour import for pixel art; Unity: `Assets/Art/...`).
4. Make the launcher icon source: 1024x1024 without transparency for the store icon, and a separate foreground for the adaptive icon.
5. Look at each result. Regenerate ones that are off-style or broken.

**result.json:** `{"status":"done","summary":"<how many assets, where the manifest is>"}`
