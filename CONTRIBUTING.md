# Contributing to Atlas × RMP

Atlas × RMP is a thin layer over a stack of UMich and RMP web surfaces, none of which expose stable contracts. Most contributions fall into one of three buckets: **fixing a selector that drifted**, **expanding the matcher to handle a new name shape**, or **adding support for a new Atlas page**.

Before contributing, please skim the **"Heads up: this is a fragile, unofficial plugin"** section in the README — every change you make is going to interact with at least one undocumented external system.

## How the moving parts fit together

| Surface | What we use it for | Failure mode |
|---|---|---|
| Atlas DOM (`atlas.ai.umich.edu`) | CSS selectors in `src/content.js` SELECTORS map find instructor name elements per page type | Atlas restructures markup → no badges appear |
| Atlas section-table-data API (`/api/section-table-data/{COURSE}/{TERM}/?course_id=…`) | Per-section status, seats, days/time, location, and instructor list for Browse Courses cards | Endpoint changes shape → "Loading instructors..." stays forever |
| LSA Course Guide HTML (`webapps.lsa.umich.edu/cg/`) | Cross-references waitlist counts, since Atlas's API lacks them. Parsed via DOMParser in content.js | Auth via Shibboleth/Okta expires; markup uses `.clsschedulerow` and `xs_label` anchors which could change |
| RateMyProfessors GraphQL (`www.ratemyprofessors.com/graphql`) | School lookup once, then a per-prof teacher-search query | RMP rotates auth token (extension shows red "auth expired" badge); schema changes silently |

Service worker (`src/background.js`) proxies CG fetches because content scripts at `atlas.ai.umich.edu` can't reach `webapps.lsa.umich.edu` without CORS errors. RMP queries also go through the worker, both for cross-origin reasons and to centralize auth-state handling.

## Re-discovering selectors

When a page type stops badging:

1. Load the extension unpacked at `chrome://extensions` (toggle Developer Mode → **Load unpacked** → select the `atlas-rmp/` folder).
2. Navigate to the broken Atlas page while logged in via UMich SSO + Okta.
3. Open DevTools (`F12`) → **Console**.
4. Run a discovery query to find candidate instructor elements:
   ```js
   document.querySelectorAll(
     '[class*="instructor"], [class*="prof"], [class*="teacher"], ' +
     'a[href*="/instructor/"], a[href*="/professor/"]'
   )
   ```
5. Inspect the returned nodes. Identify which one consistently wraps a plain instructor name (not a heading like "Course Instructors" or a "Bookmark" button).
6. Note the working selector and the name format (`"Last, First"` vs `"First Last"`, presence of titles like "Dr.", screen-reader duplicates, etc.).
7. Update the matching entry in `SELECTORS` in `src/content.js`.
8. Reload the extension at `chrome://extensions` and verify the smoke test below.

If the page is genuinely new (Atlas just shipped it), follow the same procedure and add a new entry to `SELECTORS`, plus a branch in `detectPageType()` for the URL pattern, plus a per-page enable toggle in `popup.html` / `options.html` / `popup.js` / `options.js` (search for `setting:enableOnSearchResults` for the existing pattern).

## RMP gotchas

**The default token (`Basic dGVzdDp0ZXN0`)** is RMP's own public test credential — base64 of `test:test`. It rotates every few months. The Options page is the canonical place to override it.

**Cookie-size limits.** The extension stores everything in `chrome.storage.local` (cache + settings). RMP fetches set `credentials: "omit"` because including session cookies pushes the request past nginx's header limit (returns `400 Request Header Or Cookie Too Large`).

**Schema drift.** RMP's GraphQL is undocumented. Fields the extension queries:
- `teacher { id, legacyId, firstName, lastName, department, avgRating, avgDifficulty, numRatings, wouldTakeAgainPercent, school { id, name } }`

If ratings stop returning data, capture a fresh `graphql` request from rmp.com in DevTools → Network and diff the response shape against `TEACHER_SEARCH_QUERY` in `src/lib/rmp.js`. Update the query fields and bump the manifest version.

**School scoping.** The teacher search is scoped to the UMich Ann Arbor school ID; on a miss the worker re-queries without a school filter and accepts any result whose school name starts with `University of Michigan` (covers Dearborn / Flint). EMU, MSU, and other Michigan-named schools are explicitly excluded.

## Testing

There are no automated tests — every check is manual against real Atlas data.

**Smoke test (10 known professors)**

Pass bar: 8/10 should resolve to the correct RMP profile, zero false positives.

| # | Professor | Department | Notes |
|---|---|---|---|
| 1 | Wes Weimer | CSE | High-volume; nickname → canonical via NICKS map |
| 2 | J. Alex Halderman | CSE | Middle initial in Atlas name |
| 3 | Ji Zhu | Statistics | Short name, watch for surname collisions |
| 4 | Stephen DeBacker | Mathematics | CamelCase surname |
| 5 | Andrew Snowden | Mathematics | |
| 6 | Smadar Karni | Mathematics | |
| 7 | Yuekai Sun | Statistics | |
| 8 | Ya'acov Ritov | Statistics | Apostrophe — encoding edge case |
| 9 | Sarah Koch | Mathematics | |
| 10 | Marwa Houalla | CSE / SI | Newer instructor; miss is acceptable |

**Procedure**

1. Load the extension unpacked.
2. Sign into Atlas via UMich SSO + Okta.
3. For each professor, search them on Atlas, verify badge rating against `ratemyprofessors.com`, and check the service worker DevTools (`chrome://extensions` → "service worker") for any unexpected warnings.
4. Click the toolbar popup → **Clear cache** between runs if you're debugging the matcher, since negative results stick around for 7 days.

**Extra spot-checks worth running before a release**

- Browse Courses with cache cold (Clear cache, then load `/courses/?subject=EECS`) — verify the section-list cards render with status / seats / waitlist / days/time/location.
- Toggle "Hide closed sections" + "Hide wait-list sections" with the page already loaded; cards whose sections are entirely filtered should collapse, not leave empty frames.
- Toggle each "Active on" page off then back on while sitting on that page; badges should disappear instantly and reappear instantly without a reload.
- Trigger a CG re-auth: visit Browse Courses, manually expire your CG cookie (or wait), then reload. The orange "LSA Course Guide auth expired" alert should appear in the popup, clicking re-auth should open CG, and re-opening the popup after re-authing should clear the alert.

## Code layout

```
atlas-rmp/
├── manifest.json          # MV3 manifest, host_permissions, content scripts
├── src/
│   ├── background.js      # Service worker. RMP LOOKUP + FETCH_CG message handlers,
│   │                      # toolbar badge sync, school-ID resolution.
│   ├── content.js         # Content script. Selectors, MutationObserver, badge
│   │                      # rendering, Browse Courses enrichment, filters,
│   │                      # toggle-driven cleanup.
│   ├── inject.css         # Badge + section-row styles.
│   ├── popup.{html,js}    # Toolbar popup UI.
│   ├── options.{html,js}  # Full Options page (token input, prefs, page toggles, cache).
│   └── lib/
│       ├── rmp.js         # GraphQL client, auth handling, cached token.
│       ├── nameMatch.js   # NICKS map, splitName, normalize, pickBestMatch.
│       └── cache.js       # 7-day TTL via chrome.storage.local.
├── icons/                 # Extension icons.
└── selectors notes        # Live in code comments next to each SELECTORS entry.
```
