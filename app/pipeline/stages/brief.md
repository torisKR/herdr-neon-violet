# Stage: brief (Planner)

**Goal:** a one-page brief that the designer, developer and tester can follow without asking anything.

**Inputs**
- Chosen idea: {{idea_choice}}
- `pipeline/research/ideas.md`, `pipeline/research/sources.md`

**Do**
1. Decide the engine with this table and write the reason in the brief:

   | What it is | Engine |
   |---|---|
   | An app (not a game) | **Flutter** |
   | Pixel game, puzzle, ink-style 2D RPG, small idle game | **Godot** (light tooling, code-centred work) |
   | Mobile 2D game with strong lighting, animation and effects | **Unity** or **Godot**; Unity when ads, IAP or other service SDKs matter most |
   | 3D tycoon, 3D fishing, low-poly survival or action | **Unity + URP** |
   | Unsure, or one engine for several mobile genres | **Unity + URP** (the main engine) |
   | Realistic 3D horror or action for PC | Unreal: out of scope for this mobile pipeline, report `blocked` |

2. Write `pipeline/brief/brief.md` (Korean, one page): who it is for and the reference, the core loop in five steps, the **first-version scope** as a checklist of at most 8 items, what is explicitly **out** of scope, the screens, monetization, the share moment, and **kill criteria** (when we stop).
3. Write `pipeline/brief/acceptance.md`: 5 to 10 checks the tester will run on a device, each one something a person can see ("tap Start, the first level appears within 2 seconds").
4. Choose the Android application id (`kr.toris.<name>`, lowercase letters and digits only) and the store title.

**result.json**
```json
{"status":"done","summary":"...","engine":"flutter|godot|unity","package":"kr.toris.example","title":"<store title>"}
```
