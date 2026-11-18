# Stage: research (Researcher)

**Goal:** three app or game ideas worth building this week, each backed by what is trending now in Korea and the United States.

**Inputs**
- Seed from the person: {{idea}}
- Kind: `{{kind}}` (`app`, `game`, or `auto` = you decide per idea)

**Do**
1. Look at what is rising now: Google Play top charts (KR, US), App Store charts, viral short-form formats (TikTok, Reels, Shorts), Reddit and X threads, recent hit clones. Use web search and the `aso`, `competitors` or `firecrawl-market-research` skills when they help. Record sources with links and dates in `pipeline/research/sources.md`.
2. Propose exactly three ideas. For each: one-line pitch, the reference it follows, why it can spread (the share moment), core loop, monetization, and what would make us drop it.
3. Score each 0-100 = demand evidence (40) + how small the first version is (30) + viral hook (20) + policy safety on Google Play (10; use `play-policy-insights` if unsure). Mark the best one `recommended`.
4. Write `pipeline/research/ideas.md` (Korean, one section per idea, the scores explained).

**result.json** also needs the options the board shows as cards:
```json
{"status":"done","summary":"...","options":[
  {"id":"a","title":"<idea name>","desc":"<pitch, reference, why it spreads; 2-3 sentences, Korean>","score":82,"recommended":true},
  {"id":"b","title":"...","desc":"...","score":74},
  {"id":"c","title":"...","desc":"...","score":61}]}
```
