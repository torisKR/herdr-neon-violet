# Stage: research (Researcher)

**Goal:** three app or game ideas worth building this week, each backed by what is trending now in Korea and the United States.

**Inputs**
- Seed from the person: {{idea}}
- Kind: `{{kind}}` (`app`, `game`, or `auto` = you decide per idea)
- References from the person: see the rules below

**Do**
1. Look at what is rising now: Google Play top charts (KR, US), App Store charts, viral short-form formats (TikTok, Reels, Shorts), Reddit and X threads, recent hit clones. Use web search and the `aso`, `competitors` or `firecrawl-market-research` skills when they help. Record sources with links and dates in `pipeline/research/sources.md`.
2. When references were given, look at each one first (store page, screenshots, what players say) and write in `pipeline/research/references.md` what makes it work: the loop, the hook, the audience, the monetization. The three ideas are then our own takes in that direction: each says what it **keeps** (genre, loop) and what it **changes** (theme, name, look, the twist that makes it ours).
3. Propose exactly three ideas. For each: one-line pitch, the reference it follows, why it can spread (the share moment), core loop, monetization, and what would make us drop it.
4. Score each 0-100 = demand evidence (40) + how small the first version is (30) + viral hook (20) + policy safety on Google Play (10; use `play-policy-insights` if unsure). Mark the best one `recommended`.
5. Write `pipeline/research/ideas.md` (Korean, one section per idea, the scores explained).

**result.json** also needs the options the board shows as cards:
```json
{"status":"done","summary":"...","options":[
  {"id":"a","title":"<idea name>","desc":"<pitch, reference, why it spreads; 2-3 sentences, Korean>","score":82,"recommended":true},
  {"id":"b","title":"...","desc":"...","score":74},
  {"id":"c","title":"...","desc":"...","score":61}]}
```
