# Contributing to Atlas × RMP

## How Atlas's APIs work

Atlas exposes three data surfaces the extension uses:

| Surface | How it's used |
|---------|---------------|
| `course-instructors.json` | Returns the instructor list for a given course code and term. The content script fetches this to get canonical instructor names before querying RMP. |
| `section-table-data` + `course_id` query param | Returns section rows (section number, status, days/time, location, instructor) for the Browse Courses card view. The extension reads this to render the per-card section breakdown. |
| Atlas DOM selectors (search-results page) | The extension reads rendered HTML on the course search results page, instructor profile page, Schedule Builder, and LSA Course Guide using CSS selectors defined in `src/content.js`. |

## How to discover selectors for a new page type

When Atlas updates its markup or you want to support a new page, spend ~15 minutes with DevTools:

1. Load the extension unpacked (`chrome://extensions` → **Load unpacked**).
2. Navigate to the target Atlas page while logged in via UMich SSO + Okta.
3. Open DevTools (F12) → **Console** tab.
4. Run this discovery query to find candidate instructor elements:
   ```js
   document.querySelectorAll(
     '[class*="instructor"], [class*="prof"], [class*="teacher"], ' +
     'a[href*="/instructor/"], a[href*="/professor/"]'
   )
   ```
5. Inspect the returned elements. Identify which ones contain plain instructor names.
6. Note the working selector and name format (e.g., `"Last, First"` vs `"First Last"`, presence of titles like "Dr.").
7. Record findings in `selectors.md` with the page URL pattern and date observed.
8. Update the `SELECTORS` map in `src/content.js` (see next section).

Re-run the smoke test (10 known professors, listed below) to verify zero false positives before opening a PR.

## Adding a new page type

1. Open `src/content.js` and locate the `SELECTORS` map near the top of the file.
2. Add a new entry keyed by a descriptive page-type name:
   ```js
   SELECTORS['my-new-page'] = {
     match: /atlas\.ai\.umich\.edu\/my-path/,   // URL pattern
     query: '.the-discovered-css-selector',      // selector from Step 4 above
     nameFormat: 'first-last',                   // or 'last-first'
   };
   ```
3. Add a corresponding handler in the `handlePage()` function that calls `injectBadges()` with the new selector.
4. Run the smoke test (see Testing below).
5. Open a pull request with the new selector documented in `selectors.md`.

## RMP GraphQL gotchas

**`Basic dGVzdDp0ZXN0` token history**
RateMyProfessor's public GraphQL endpoint (`https://www.ratemyprofessors.com/graphql`) historically required only this static token. It is base64 for `test:test` — a placeholder credential the RMP frontend shipped publicly. The token has occasionally rotated; when it does, the background service worker will receive a 401 and set the "auth expired" badge. See the README for the refresh procedure.

**Cookie size limits**
The extension uses `chrome.storage.local` (not cookies) for its 7-day cache. Do not attempt to store RMP responses in document cookies — Atlas pages set strict `SameSite` and size constraints that will silently drop oversized values.

**Schema drift**
RMP's GraphQL schema is undocumented and has changed without notice. The fields the extension queries are:
- `teacher { id, firstName, lastName, avgRating, numRatings, wouldTakeAgainPercent, avgDifficulty, department }`

If ratings stop returning data, open DevTools → Network, capture a fresh RMP GraphQL response in your browser, and diff it against the query in `src/lib/rmp.js`. Update the query fields to match the live schema and bump the extension version.

## Testing

**Smoke test — 10 known professors**

Pass bar: 8/10 must resolve to the correct RMP profile with zero false positives.

For each professor, find their name on Atlas (course search or profile page) and verify:
- Badge rating matches the rating shown at `ratemyprofessors.com`
- No ⚠️ low-confidence glyph (or if present, the matched name is correct)
- No badge shown for a different professor with a similar name

| # | Professor | Department | Notes |
|---|-----------|------------|-------|
| 1 | Wes Weimer | CSE | High-volume, reliable match |
| 2 | J. Alex Halderman | CSE | Middle initial in Atlas name |
| 3 | Ji Zhu | Statistics | Short name, watch for collisions |
| 4 | Stephen DeBacker | Mathematics | CamelCase surname |
| 5 | Andrew Snowden | Mathematics | |
| 6 | Smadar Karni | Mathematics | |
| 7 | Yuekai Sun | Statistics | |
| 8 | Ya'acov Ritov | Statistics | Apostrophe in name — encoding edge case |
| 9 | Sarah Koch | Mathematics | |
| 10 | Marwa Houalla | CSE / SI | Newer instructor; miss is acceptable |

**How to run**

1. Load the extension unpacked at `chrome://extensions`.
2. Log into Atlas via UMich SSO + Okta.
3. For each professor above, search their name on Atlas and record badge vs. actual RMP rating.
4. Open the extension's service worker DevTools (`chrome://extensions` → "service worker") and check the console for any errors or low-confidence warnings.
