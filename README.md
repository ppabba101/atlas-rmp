# Atlas x RMP

A Manifest V3 Chrome extension that injects RateMyProfessor ratings inline next to instructor names on `atlas.ai.umich.edu`. Personal use only. Covers all 4 Atlas page types (course detail, search results, instructor profile, dashboard) with a 7-day TTL cache, negative caching, SPA-aware MutationObserver, and confidence warnings for fuzzy name matches.

---

## Prerequisites

**You must be logged into Atlas before the extension can do anything.** `atlas.ai.umich.edu` sits behind UMich SSO. The login flow is:

1. Visit `atlas.ai.umich.edu` in Chrome (the same Chrome instance where the extension is loaded)
2. UMich Weblogin (Cosign/Shibboleth) prompts for uniqname + password
3. Duo/Okta MFA push fires to your phone or Mac
4. Approve via TouchID in Okta Verify (on Mac) or push notification (on phone)
5. Atlas loads with a session cookie scoped to `umich.edu` — typically valid for 8–10 hours

The extension **piggybacks on this authenticated session**. The content script reads DOM that Atlas renders for *you*; it does not authenticate independently. As long as you can browse Atlas normally, the extension can annotate it. If your SSO session expires, Atlas will redirect you to login again — the extension simply waits for the new authenticated page to load.

The background service worker hits `ratemyprofessors.com` for RMP data, which uses its own public auth token (`Basic dGVzdDp0ZXN0`) — completely separate from UMich SSO.

---

## Loading the extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `atlas-rmp/` folder (the one containing `manifest.json`)
5. The extension loads. A generic icon appears in the toolbar if placeholder icons are still in place.
6. Navigate to `atlas.ai.umich.edu` — badges should begin appearing next to instructor names once selectors are tuned (see Step 0 below).

---

## Step 0: Selector discovery

The CSS selectors in `src/content.js` are placeholders. Before the extension annotates any names, you must discover real Atlas selectors.

**Procedure (~15 min):**

1. Load the extension unpacked (see above).
2. Navigate to each of the 4 Atlas page types:
   - Course detail (click into a specific course)
   - Course search results (search for any course code)
   - Instructor profile (click on an instructor name)
   - Dashboard (your Atlas home page)
3. On each page, open DevTools (F12) → Console tab.
4. Run this discovery query:
   ```js
   document.querySelectorAll('[class*="instructor"], [class*="prof"], [class*="teacher"], a[href*="/instructor/"], a[href*="/professor/"]')
   ```
5. Inspect the returned elements. Find the one(s) that contain instructor names.
6. Note the working selector and the name format (e.g., "Last, First" or "First Last", with/without titles).
7. Record your findings in `selectors.md`.
8. Update the `SELECTORS` map in `src/content.js` with the confirmed selectors, replacing the placeholder lines.

---

## Step 7: Smoke test

After selector discovery and initial browsing, run this checklist to verify the extension works correctly.

**Pass bar**: 8 out of 10 professors must resolve to the correct RMP profile, with zero false positives.

**Procedure:**

1. Load the extension in Chrome.
2. Navigate to `atlas.ai.umich.edu`.
3. For each professor below, find their name on Atlas (via course search or their profile page) and record:
   - Name as shown on Atlas
   - Badge rating shown by the extension
   - Actual RMP rating (check manually at ratemyprofessors.com)
   - Match / mismatch / miss status
   - Confidence score if shown (⚠️ glyph = below 0.95)

| # | Professor | Expected RMP match | Department |
|---|-----------|-------------------|------------|
| 1 | Wes Weimer | Yes | CSE |
| 2 | J. Alex Halderman | Yes | CSE |
| 3 | Ji Zhu | Yes | Statistics |
| 4 | Stephen DeBacker | Yes | Mathematics |
| 5 | Andrew Snowden | Yes | Mathematics |
| 6 | Smadar Karni | Yes | Mathematics |
| 7 | Yuekai Sun | Yes | Statistics |
| 8 | Ya'acov Ritov | Yes | Statistics |
| 9 | Sarah Koch | Yes | Mathematics |
| 10 | Marwa Houalla | Possibly (newer instructor) | CSE / SI |

**False positive**: a badge showing the wrong professor's rating. Zero are acceptable.

---

## Exporting Atlas course data for the planning agent

The extension captures `{courseCode, term, instructor, section, time}` tuples to `chrome.storage.local` as you browse Atlas (Path b in the plan's Workstream B section).

To export the cache for handoff to the planning agent:

1. Open the extension's service worker DevTools: go to `chrome://extensions`, click "service worker" link under the Atlas x RMP card.
2. In the service worker console, run:
   ```js
   chrome.storage.local.get(null, (data) => {
     const atlasCourses = Object.fromEntries(
       Object.entries(data).filter(([k]) => k.startsWith("atlas:course:"))
     );
     console.log(JSON.stringify(atlasCourses, null, 2));
   });
   ```
3. Copy the JSON output into `.omc/atlas-data/courses.json`.
4. The planning agent will read this file when running Workstream B.

You can also export the RMP cache the same way (filter prefix `prof:`) and save to `.omc/atlas-data/professors.json`.

---

## Updating the RMP auth token

The extension uses a hardcoded `Authorization` header to query RMP's GraphQL API. If you see a red **"RMP auth expired — re-paste token"** badge on Atlas, the token has rotated and needs to be refreshed.

**To get a fresh token:**

1. Open `ratemyprofessors.com` in Chrome.
2. Open DevTools → **Network** tab.
3. Search for any professor (to trigger a GraphQL request).
4. In the Network tab, find a request to `graphql` (filter by "graphql").
5. Click the request → **Headers** tab.
6. Copy the value of the `Authorization` header (it starts with `Basic `).
7. Open `atlas-rmp/src/lib/rmp.js`.
8. Replace the value of `RMP_AUTH` on line 4 with your copied value:
   ```js
   export const RMP_AUTH = "Basic <your-new-token-here>";
   ```
9. Reload the extension at `chrome://extensions` (click the refresh icon on the Atlas x RMP card).
10. Reload Atlas — badges should resume normally.
