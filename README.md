# Atlas × RMP

> RateMyProfessor scores inline on UMich Atlas — see who teaches well before you enroll.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-brightgreen.svg)
![GitHub stars](https://img.shields.io/github/stars/pranavpabba/atlas-rmp?style=social)

## What it does

Atlas × RMP injects RateMyProfessor rating badges directly next to instructor names on UMich Atlas and the LSA Course Guide — no tab-switching required. Badges appear automatically as you browse; ratings are cached for 7 days and fuzzy-matched by name with a confidence warning (⚠️) when the match is uncertain.

| Course | Instructor | Badge shown |
|--------|------------|-------------|
| EECS 281 | Wes Weimer | ★ 4.8 |

## Install

1. Clone or download this repo
2. Open `chrome://extensions` → enable **Developer Mode** (top-right toggle) → click **Load unpacked** → select the `atlas-rmp/` folder
3. Open [Atlas](https://atlas.ai.umich.edu) — you must be logged into UMich SSO + Okta first
4. Done — badges appear automatically next to instructor names

## Where it works

| Page | What you see |
|------|--------------|
| Atlas course detail | Badges next to each section's instructor |
| Atlas Browse Courses | Per-card section breakdown with status, days/time, location, RMP badges, sorted by status |
| Atlas Schedule Builder | Badges next to each section's instructor |
| Atlas instructor profile | Badge next to instructor name heading |
| LSA Course Guide | Badges next to instructor mailto links |

## Updating the RMP token

The extension uses RateMyProfessor's public GraphQL API with the token `Basic dGVzdDp0ZXN0`. If you see a red **"RMP auth expired"** badge, the token has rotated.

**To refresh it (or use the extension's Options page if available):**

1. Open `ratemyprofessors.com` in Chrome, open DevTools → **Network** tab, search for any professor.
2. Find a `graphql` request → **Headers** tab → copy the `Authorization` value (starts with `Basic `).
3. Open `src/lib/rmp.js`, replace `RMP_AUTH` on line 4 with your copied value, then reload the extension at `chrome://extensions`.

## Troubleshooting

**Badges don't appear at all**
Make sure you are logged into Atlas (UMich SSO + Okta MFA). The extension piggybacks on your authenticated session — if Atlas shows a login redirect, approve the Duo/Okta push first, then reload.

**Wrong rating shown (wrong professor)**
A ⚠️ glyph next to a badge means the name match confidence is below 0.95. Open DevTools → Console to see the matched name and score. Report persistent false positives in a GitHub issue.

**"RMP auth expired" red badge**
Follow the token refresh steps above.

**Extension loads but nothing happens on a new page type**
CSS selectors may have drifted. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to discover selectors and add support for a new page type.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
