# Atlas × RMP

> RateMyProfessor scores inline on UMich Atlas — see who teaches well before you enroll.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-brightgreen.svg)
![GitHub stars](https://img.shields.io/github/stars/ppabba101/atlas-rmp?style=social)

## What it does

Atlas × RMP injects RateMyProfessor rating badges next to instructor names on UMich Atlas, the LSA Course Guide, and Schedule Builder — no tab-switching, no copy-pasting names. Badges appear automatically as you browse; ratings are cached locally for 7 days and matched by name with a confidence warning (⚠️) when the match is fuzzy.

| Where | What you see |
|---|---|
| Atlas course detail | Badges next to each section's instructor |
| Atlas Browse Courses | Per-card section breakdown — status, seats, waitlist count, days/time, location, and an RMP badge per instructor |
| Atlas Browse Instructors | Badge next to each instructor card |
| Atlas instructor profile | Badge next to the heading |
| Atlas Schedule Builder | Badge next to each section's instructor |
| LSA Course Guide | Badge next to instructor mailto links |

## Heads up: this is a fragile, unofficial plugin

This extension is **held together by assumptions about UMich's web infrastructure that nobody at UMich has agreed to keep stable.** It is not built, blessed, or maintained by the University of Michigan, the LSA Course Guide team, RateMyProfessors, or any official entity. It works today because:

- Atlas's URL paths (`/courses/...`, `/instructor/...`, `/instructors/`, `/schedule-builder/`) match a handful of empirically-discovered patterns
- Atlas's section data comes from an **undocumented internal JSON API** (`/api/section-table-data/...`) that could change shape or disappear without notice
- The LSA Course Guide's HTML structure (`.clsschedulerow`, `.col-md-*` cells, `xs_label` anchors) hasn't shifted recently
- RateMyProfessors' GraphQL schema and public auth token (`Basic dGVzdDp0ZXN0`) are publicly observable but not contractually stable
- UMich Shibboleth SSO + Okta hold session cookies that we piggyback on — when those expire, lookups quietly fail

Any of those can change in a regular Tuesday afternoon deploy. **When something breaks, expect to either wait for an update or contribute one yourself** — see [CONTRIBUTING.md](CONTRIBUTING.md) for the discovery procedure.

The extension only works for **current UMich students with active SSO + Okta access** to Atlas and the LSA Course Guide.

## Install

1. Clone or download this repo
2. Open `chrome://extensions`, toggle **Developer Mode** (top-right), click **Load unpacked**, select the `atlas-rmp/` folder
3. Open [Atlas](https://atlas.ai.umich.edu) — log in via UMich SSO + Okta first
4. Done — badges appear automatically next to instructor names

The extension toolbar icon opens a popup with display filters, per-page enable toggles, the RMP token status, and a cache control. Right-click the icon → **Options** for the full settings page.

## Updating the RMP token

The extension ships with RMP's public default token (`Basic dGVzdDp0ZXN0`). When RMP rotates it, you'll see a red **"RMP auth expired — update token in Options"** badge. To refresh:

1. Open `ratemyprofessors.com` in Chrome → DevTools (`F12`) → **Network** tab → search any professor.
2. Click any `graphql` request → **Headers** → copy the `Authorization` value (starts with `Basic `).
3. Click the extension's toolbar icon → **Open full Options →** → paste into the token field → **Save**.

## Troubleshooting

**Badges don't appear**
Confirm you're logged into Atlas (UMich SSO + Okta MFA — approve the Duo push if prompted, then reload). The extension piggybacks on your authenticated session.

**Wrong rating shown**
A ⚠️ glyph next to a badge means the name match confidence is below 0.95. Open DevTools → Console to see the matched name and score. Persistent false positives are bugs — please open a GitHub issue with the Atlas name vs. the RMP record.

**"RMP auth expired" red badge**
Follow the token refresh steps above.

**"LSA Course Guide auth expired" orange alert**
Click **Re-authenticate to CG** in the popup, complete Okta in the new tab, then come back to the popup — the alert should clear automatically. Waitlist counts on Browse Courses won't load until you re-auth.

**Stale "no RMP" hits after pulling an update**
Negative lookups are cached for 7 days. After upgrading the matcher, click **Clear cache** in the popup so previously-failed names re-query.

**An entire page type stopped working**
Atlas changed something. See [CONTRIBUTING.md](CONTRIBUTING.md#re-discovering-selectors) — the discovery procedure usually takes 10–15 minutes per page.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome, especially for selector updates and new page types.

## License

MIT — see [LICENSE](LICENSE).
