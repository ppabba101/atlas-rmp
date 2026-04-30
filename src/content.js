// Atlas x RMP content script — SPA-aware DOM injection

// ─── Selectors ─────────────────────────────────────────────────────────────
// PLACEHOLDER selectors — verify with Step 0 discovery spike on live Atlas.
// Replace each value after running DevTools discovery queries on each page type.
// See selectors.md for the discovery worksheet.
//
// STEP 0 REMINDER (Workstream B / course harvesting):
// The courseRow selector and its sub-selectors below are also placeholders.
// Discover them alongside the instructor-name selectors by inspecting course
// listing pages in Atlas DevTools. See selectors.md §"Atlas Course Row Selectors".
const SELECTORS = {
  // course-detail: instructor name links on individual course pages
  // CONFIRMED via Step 0 discovery on ANTHRCUL 101 (2026-04-30): instructor names
  // are <a> tags with href containing "/instructor/". Names are in "Last, First"
  // format which splitName() already handles.
  "course-detail": [
    'a[href*="/instructor/"]',
  ],

  // search-results: instructor names in course listing cards
  // Same href pattern is used across Atlas for instructor links — try the
  // confirmed selector first; if it doesn't match, run the discovery query
  // (see selectors.md / README) on the search-results page and update.
  "search-results": [
    'a[href*="/instructor/"]',
  ],

  // instructor-profile: name heading on professor pages
  // CONFIRMED via Step 0 discovery on Ryan Huang's profile (2026-04-30):
  // instructor's name is in h1.text-large. Note: this selector runs on every
  // Atlas page; if you see spurious badges on non-instructor pages with an
  // h1.text-large, we'll need to add URL-based gating to scan().
  "instructor-profile": [
    'h1.text-large',
  ],

  // dashboard: instructor names visible on user dashboard
  // Same href pattern likely works (links to recently-viewed instructors).
  // Validate by visiting the dashboard with the extension loaded.
  "dashboard": [
    'a[href*="/instructor/"]',
  ],

  // course-guide: LSA Course Guide search results (webapps.lsa.umich.edu/cg/*)
  // CONFIRMED via Step 0 discovery on Fall 2026 EECS results page (2026-04-30):
  // every instructor is an <a href="mailto:..."> inside div.col-sm-3 whose
  // parent is div.row.bottompadding_main. Scoped to that container so we don't
  // false-positive on unrelated mailto links elsewhere.
  "course-guide": [
    'div.row.bottompadding_main a[href^="mailto:"]',
  ],

  // schedule-builder: Atlas Schedule Builder (atlas.ai.umich.edu/schedule-builder/)
  // CONFIRMED via Step 0 discovery on Fall 2026 plan (2026-04-30): each
  // instructor name in a section block is an <a class="display-block text-xsmall">
  // in "Last, First" format. "Instructor TBA" gets filtered by the comma-presence
  // pre-check in annotate(). High-value page: live section status, seats, time,
  // location, and the actual section instructor (not historical pool).
  "schedule-builder": [
    'a.display-block.text-xsmall',
  ],

  // courseRow: smallest DOM element containing one complete course/section listing
  // Used by captureAllCourses() for Workstream B Path b course harvesting.
  // PLACEHOLDER — Step 0 discovery: inspect a search results page, walk up the DOM
  // from any course code until you reach the element that holds ALL of: code,
  // instructor, time. That element is courseRow.
  courseRow: "[class*='course-row']",   // PLACEHOLDER — Step 0 discovery

  // Sub-selectors within a courseRow element (all PLACEHOLDER — Step 0 discovery)
  courseCode:     "[class*='course-code']",        // PLACEHOLDER — Step 0 discovery
  courseTitle:    "[class*='course-title']",       // PLACEHOLDER — Step 0 discovery
  courseTerm:     "[class*='term']",               // PLACEHOLDER — Step 0 discovery
  courseSectionId:"[class*='section']",            // PLACEHOLDER — Step 0 discovery
  courseInstructor:"[class*='instructor']",        // PLACEHOLDER — Step 0 discovery (may match instructor-name selector)
  courseMeetingTime:"[class*='meeting-time'], [class*='meetingTime']", // PLACEHOLDER — Step 0 discovery
  courseLocation: "[class*='location']",           // PLACEHOLDER — Step 0 discovery
  courseCredits:  "[class*='credits']",            // PLACEHOLDER — Step 0 discovery
};

// Attribute set on elements after annotation to prevent double-badging
const BADGE_ATTR = "data-rmp-badge";

// Auth-fail badge expiry: only show auth-fail badge if rmp:authFailed was set within 60min
const AUTH_FAIL_TTL_MS = 60 * 60 * 1000;

// Search-results enricher tunables
const ATLAS_DETAIL_TTL_MS = 24 * 60 * 60 * 1000; // 24-hour TTL for parsed detail-page extractions
const ENRICH_CONCURRENCY = 5;                    // max in-flight detail-page fetches
const ENRICH_DEBOUNCE_MS = 200;                  // dispatcher debounce

// ─── Auth-fail check ────────────────────────────────────────────────────────

async function isAuthFailed() {
  return new Promise((resolve) => {
    chrome.storage.local.get("rmp:authFailed", (result) => {
      const entry = result["rmp:authFailed"];
      if (!entry || !entry.ts) {
        resolve(false);
        return;
      }
      resolve(Date.now() - entry.ts < AUTH_FAIL_TTL_MS);
    });
  });
}

// ─── Badge rendering ────────────────────────────────────────────────────────

/**
 * Build the badge HTML string for a lookup result.
 * Handles 5 variants: good, ok, bad, miss, auth-fail.
 *
 * @param {object} result - Response from background LOOKUP
 * @param {boolean} authFailed - Whether global auth-fail state is active
 * @returns {string} HTML string for the badge span
 */
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function badgeHTML(result, authFailed) {
  // Improvement 3: auth-fail badge takes priority
  if (authFailed || (result && result.reason === "auth-failed")) {
    return `<span class="rmp-badge rmp-auth-fail" title="RMP auth token expired. Re-paste token in src/lib/rmp.js">` +
      `RMP auth expired — re-paste token</span>`;
  }

  if (!result || !result.found) {
    return `<span class="rmp-badge rmp-miss" title="No RMP profile found">no RMP</span>`;
  }

  const rating = result.avgRating;
  const ratingText = rating != null ? rating.toFixed(1) : "?";
  const numRatings = result.numRatings ?? 0;
  const url = esc(result.rmpUrl ?? "#");

  let cls;
  if (rating == null) {
    cls = "rmp-miss";
  } else if (rating >= 4) {
    cls = "rmp-good";
  } else if (rating >= 3) {
    cls = "rmp-ok";
  } else {
    cls = "rmp-bad";
  }

  const warnGlyph =
    result.confidence != null && result.confidence < 0.95
      ? ` <span class="rmp-warn" title="Fuzzy name match (confidence: ${(result.confidence * 100).toFixed(0)}%)">⚠️</span>`
      : "";

  return (
    `<a class="rmp-badge ${cls}" href="${url}" target="_blank" rel="noopener" ` +
    `title="${esc(result.firstName)} ${esc(result.lastName)} — ${numRatings} ratings">` +
    `${ratingText}${warnGlyph}</a>`
  );
}

// ─── Annotation ─────────────────────────────────────────────────────────────

/**
 * Annotate a single name element: send LOOKUP to background, inject badge.
 *
 * @param {Element} el
 */
async function annotate(el) {
  // Skip already-annotated elements
  if (el.hasAttribute(BADGE_ATTR)) return;

  // Skip Atlas's "Course Instructors" historical-pool table on course detail
  // pages — it shows everyone who's taught the course in the last 5 academic
  // years, not who's actually teaching the current term. Badging them is
  // misleading. The Course Sections table below it (current-term assignments)
  // is outside this container and still gets badges.
  if (el.closest(".course-instructors-table-container, .course-instructors-section")) {
    return;
  }

  el.setAttribute(BADGE_ATTR, "pending");

  const name = el.textContent?.trim();
  if (!name || name.length < 3) {
    el.removeAttribute(BADGE_ATTR);
    return;
  }
  // Skip placeholder text used by Atlas/Schedule Builder when no instructor is assigned
  if (/^instructor\s+tba$/i.test(name) || name.toLowerCase() === "tba") {
    el.removeAttribute(BADGE_ATTR);
    return;
  }
  // Require the text to look name-shaped: must contain a space OR a comma
  // (single-word matches like "Open" or section IDs are noise; Atlas's section
  // table renders names as "Torralva,Ben" with no space after the comma, so
  // comma-only counts as a valid name signal)
  if (!name.includes(" ") && !name.includes(",")) {
    el.removeAttribute(BADGE_ATTR);
    return;
  }

  // Check global auth-fail state before querying
  const authFailed = await isAuthFailed();

  if (authFailed) {
    el.setAttribute(BADGE_ATTR, "auth-fail");
    el.insertAdjacentHTML("afterend", badgeHTML(null, true));
    return;
  }

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "LOOKUP", name }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  } catch (e) {
    console.warn("[atlas-rmp] sendMessage failed for:", name, e.message);
    el.removeAttribute(BADGE_ATTR);
    return;
  }

  el.setAttribute(BADGE_ATTR, "done");

  const newAuthFailed = result?.reason === "auth-failed" || (await isAuthFailed());
  el.insertAdjacentHTML("afterend", badgeHTML(result, newAuthFailed));
}

// ─── Course harvesting (Workstream B Path b) ────────────────────────────────

/**
 * Read course data from a single course-row element and persist it to
 * chrome.storage.local. Fire-and-forget — no await needed at call sites.
 *
 * @param {Element} rowEl - A DOM element matching SELECTORS.courseRow
 */
function captureCourseRow(rowEl) {
  const text = (sel) => (rowEl.querySelector(sel)?.textContent ?? "").trim();

  const courseCode   = text(SELECTORS.courseCode).toUpperCase().replace(/[\s/]/g, "");
  const courseTitle  = text(SELECTORS.courseTitle);
  const term         = text(SELECTORS.courseTerm).toUpperCase().replace(/[\s/]/g, "");
  const sectionId    = text(SELECTORS.courseSectionId).toUpperCase().replace(/[\s/]/g, "");
  const instructorName = text(SELECTORS.courseInstructor);
  const meetingTime  = text(SELECTORS.courseMeetingTime);
  const location     = text(SELECTORS.courseLocation);
  const credits      = text(SELECTORS.courseCredits);

  // Skip if the key fields are missing — not a real course row
  if (!courseCode || !sectionId) return;

  const key = `atlas:course:${courseCode}:${term}:${sectionId}`;
  const data = { courseCode, courseTitle, term, sectionId, instructorName, meetingTime, location, credits, capturedAt: Date.now() };

  chrome.storage.local.set({ [key]: data });
  rowEl.setAttribute("data-atlas-captured", "true");
}

/**
 * Query all course rows under root and capture any not yet processed.
 *
 * @param {Element|Document} root
 */
function captureAllCourses(root) {
  let rows;
  try {
    rows = root.querySelectorAll(SELECTORS.courseRow);
  } catch (e) {
    // Invalid placeholder selector — skip silently
    return;
  }

  for (const el of rows) {
    if (el.getAttribute("data-atlas-captured") === "true") continue;
    captureCourseRow(el);
  }
}

// ─── Search-results enrichment (Atlas Browse Courses) ──────────────────────
//
// On Atlas search-results pages (detected by the presence of `.browse-cards-wrapper`
// in the DOM), each `.bookmarkable-card` is enriched inline with the list of
// instructors who teach the course PLUS RMP badges next to each. This lets the
// user scan an entire department's offerings at a glance.
//
// Architecture:
//   1. detectSearchResultsPage() → boolean (.browse-cards-wrapper presence)
//   2. enrichSearchResults() walks all cards, queues unprocessed ones.
//   3. A concurrency-limited queue (ENRICH_CONCURRENCY) fetches each detail
//      page, parses instructors, looks each up via the existing LOOKUP message,
//      and injects a sorted instructor list into the card.
//   4. A 24-hour cache at `atlas:detail:${courseCode}` short-circuits the fetch.

const ATLAS_ENRICH_ATTR = "data-atlas-rmp-enriched";
const enrichQueue = [];
let enrichInFlight = 0;
let enrichDebounceTimer = null;

/**
 * Send a LOOKUP message to background and return the result.
 * Mirrors the inline pattern used by annotate(); shared helper for the enricher.
 *
 * @param {string} name
 * @returns {Promise<object|null>}
 */
function lookupRmp(name) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "LOOKUP", name }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Read a 24-hour-TTL cache entry. Stored under arbitrary key with shape
 * `{ ...payload, capturedAt: number }`.
 *
 * @param {string} key
 * @returns {Promise<object|null>}
 */
function getDetailCache(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key];
      if (!entry || typeof entry.capturedAt !== "number") {
        resolve(null);
        return;
      }
      if (Date.now() - entry.capturedAt > ATLAS_DETAIL_TTL_MS) {
        chrome.storage.local.remove(key);
        resolve(null);
        return;
      }
      resolve(entry);
    });
  });
}

function setDetailCache(key, payload) {
  chrome.storage.local.set({ [key]: { ...payload, capturedAt: Date.now() } });
}

/**
 * Extract a normalized course code (e.g. "EECS183") from a card's text content.
 * Atlas duplicates the code (visible + screen-reader), so we just take the
 * first match.
 *
 * @param {Element} card
 * @returns {string|null}
 */
function extractCourseCode(card) {
  const text = card.textContent ?? "";
  const m = text.match(/^\s*([A-Z]{2,5}\s*\d{3}[A-Z]?)/);
  if (!m) return null;
  return m[1].replace(/\s+/g, "").toUpperCase();
}

/**
 * Render the instructor list inside a card. Sorts by RMP rating descending;
 * unmatched (no RMP) sort to the bottom.
 *
 * @param {Element} card
 * @param {Array<{name: string, result: object|null}>} instructorResults
 * @param {boolean} authFailed
 */
function renderInstructorList(card, instructorResults, authFailed, sectionInfo) {
  const target = card.querySelector(".card-content") ?? card;

  // Remove any prior render (loading state / stale render)
  const prior = card.querySelector(".atlas-rmp-instructors, .atlas-rmp-instructors-empty, .atlas-rmp-loading");
  if (prior) prior.remove();

  if (!instructorResults || instructorResults.length === 0) {
    const empty = document.createElement("div");
    empty.className = "atlas-rmp-instructors-empty";
    empty.textContent = "No instructors posted yet for this term";
    target.appendChild(empty);
    return;
  }

  const sorted = [...instructorResults].sort((a, b) => {
    const ar = a.result && a.result.found && typeof a.result.avgRating === "number" ? a.result.avgRating : -Infinity;
    const br = b.result && b.result.found && typeof b.result.avgRating === "number" ? b.result.avgRating : -Infinity;
    if (br !== ar) return br - ar;
    // Stable-ish tiebreak by name
    return a.name.localeCompare(b.name);
  });

  const wrapper = document.createElement("div");
  wrapper.className = "atlas-rmp-instructors";

  const ul = document.createElement("ul");
  ul.className = "atlas-rmp-instructor-list";

  for (const { name, result } of sorted) {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.className = "atlas-rmp-instructor-name";
    nameSpan.textContent = name;
    li.appendChild(nameSpan);
    // Reuse existing badge HTML so styling stays consistent
    li.insertAdjacentHTML("beforeend", badgeHTML(result, authFailed));
    ul.appendChild(li);
  }

  wrapper.appendChild(ul);

  // Optional section-summary footer (only when we got real term data)
  if (sectionInfo && sectionInfo.lectures > 0) {
    const footer = document.createElement("div");
    footer.className = "atlas-rmp-section-info";
    const parts = [];
    parts.push(`${sectionInfo.lectures} lecture${sectionInfo.lectures === 1 ? "" : "s"}`);
    if (sectionInfo.openCount > 0) parts.push(`${sectionInfo.openCount} open`);
    if (sectionInfo.waitlistCount > 0) parts.push(`${sectionInfo.waitlistCount} wait list`);
    if (sectionInfo.closedCount > 0) parts.push(`${sectionInfo.closedCount} closed`);
    if (typeof sectionInfo.openSeats === "number" && sectionInfo.openSeats >= 0) {
      parts.push(`${sectionInfo.openSeats} seats left`);
    }
    footer.textContent = parts.join(" · ");
    wrapper.appendChild(footer);
  }

  target.appendChild(wrapper);
}

/**
 * Render a "loading" placeholder while the detail-page fetch + lookups are in
 * flight. Replaced by renderInstructorList() once results arrive.
 */
function renderLoadingState(card) {
  const target = card.querySelector(".card-content") ?? card;
  const prior = card.querySelector(".atlas-rmp-instructors, .atlas-rmp-instructors-empty, .atlas-rmp-loading");
  if (prior) prior.remove();
  const loading = document.createElement("div");
  loading.className = "atlas-rmp-loading";
  loading.textContent = "Loading instructors...";
  target.appendChild(loading);
}

/**
 * Process a single card: fetch detail page (or use cache), parse instructors,
 * look each up on RMP, and inject the result list.
 *
 * @param {{card: Element, detailUrl: string, courseCode: string}} job
 */
async function processCard(job) {
  const { card, detailUrl, courseCode } = job;

  try {
    renderLoadingState(card);

    // Extract term code from the detail URL (e.g. ".../EECS281/2610/" → "2610")
    const termMatch = detailUrl.match(/\/(\d{4})\/?$/);
    const termCode = termMatch?.[1] || "";

    const cacheKey = `atlas:detail:${courseCode}:${termCode}`;
    let instructors = null;
    let sectionInfo = null;

    const cached = await getDetailCache(cacheKey);
    if (cached && Array.isArray(cached.instructors)) {
      instructors = cached.instructors;
      sectionInfo = cached.sectionInfo || null;
    } else {
      // Strict term-specific lookup: section-table-data has per-section term-
      // specific assignments. It needs course_id (e.g. "012114"), which is only
      // present on the detail page HTML, not on search-result cards. Two-step:
      // (1) fetch detail HTML, regex-extract course_id; (2) call
      // section-table-data with course_id, pull unique LEC-section instructors.
      // No historical-pool fallback — if the term has no published sections,
      // we surface that honestly instead of misleading users with old data.
      let courseId = null;
      try {
        const htmlRes = await fetch(detailUrl, { credentials: "include" });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const m = html.match(/course_id["':\s=]+(["']?)(\d{5,7})\1/);
          courseId = m?.[2] || null;
        }
      } catch (e) {
        console.warn("[atlas-rmp] detail HTML fetch failed:", detailUrl, e.message);
      }

      if (courseId && termCode) {
        const stdUrl =
          "https://atlas.ai.umich.edu/api/section-table-data/" +
          encodeURIComponent(courseCode) +
          "/" + termCode + "/?course_id=" + courseId;
        try {
          const res = await fetch(stdUrl, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            const offered = Array.isArray(data?.offered_classes) ? data.offered_classes : [];
            const lectures = offered.filter((c) => c?.section_type === "LEC");
            const seen = new Set();
            instructors = [];
            for (const lec of lectures) {
              for (const inst of lec.instructors || []) {
                const n = inst?.name?.trim();
                if (!n) continue;
                const k = n.toLowerCase();
                if (seen.has(k)) continue;
                seen.add(k);
                instructors.push(n);
              }
            }
            // Section summary for the card footer
            if (lectures.length > 0) {
              let openSeats = 0;
              let openCount = 0;
              let waitlistCount = 0;
              let closedCount = 0;
              for (const lec of lectures) {
                if (lec.status === "open") openCount += 1;
                else if (lec.status === "wait list" || lec.status === "waitlist") waitlistCount += 1;
                else if (lec.status === "closed") closedCount += 1;
                if (typeof lec.open_seat_count === "number") openSeats += lec.open_seat_count;
              }
              sectionInfo = { lectures: lectures.length, openCount, waitlistCount, closedCount, openSeats };
            }
          } else {
            console.warn("[atlas-rmp] section-table-data HTTP", res.status, stdUrl);
          }
        } catch (e) {
          console.warn("[atlas-rmp] section-table-data fetch failed:", stdUrl, e.message);
        }
      }

      instructors = instructors || [];
      setDetailCache(cacheKey, { instructors, sectionInfo });
    }

    const authFailed = await isAuthFailed();

    let instructorResults;
    if (authFailed) {
      instructorResults = instructors.map((name) => ({ name, result: { reason: "auth-failed" } }));
    } else {
      instructorResults = await Promise.all(
        instructors.map(async (name) => ({ name, result: await lookupRmp(name) }))
      );
    }

    const finalAuthFailed = authFailed || instructorResults.some((r) => r.result?.reason === "auth-failed");
    renderInstructorList(card, instructorResults, finalAuthFailed, sectionInfo);
    card.setAttribute(ATLAS_ENRICH_ATTR, "done");
  } catch (e) {
    console.warn("[atlas-rmp] enrichment failed for", courseCode, e);
    // Leave the card in 'pending' so a future scan can retry on next mutation
    card.removeAttribute(ATLAS_ENRICH_ATTR);
    const loading = card.querySelector(".atlas-rmp-loading");
    if (loading) loading.remove();
  } finally {
    enrichInFlight -= 1;
    drainEnrichQueue();
  }
}

function drainEnrichQueue() {
  while (enrichInFlight < ENRICH_CONCURRENCY && enrichQueue.length > 0) {
    const job = enrichQueue.shift();
    enrichInFlight += 1;
    // Fire and forget; processCard always decrements in its finally.
    processCard(job);
  }
}

function detectSearchResultsPage() {
  return !!document.querySelector(".browse-cards-wrapper");
}

/**
 * Walk all `.bookmarkable-card` elements on the page; for any not yet enriched,
 * queue them for processing. Idempotent — safe to call repeatedly (e.g. from
 * the MutationObserver).
 */
function enrichSearchResults() {
  if (!detectSearchResultsPage()) return;

  const cards = document.querySelectorAll(".bookmarkable-card");
  for (const card of cards) {
    if (card.hasAttribute(ATLAS_ENRICH_ATTR)) continue;

    const link = card.querySelector("a");
    const detailUrl = link?.href;
    if (!detailUrl) continue;

    const courseCode = extractCourseCode(card);
    if (!courseCode) continue;

    card.setAttribute(ATLAS_ENRICH_ATTR, "pending");
    enrichQueue.push({ card, detailUrl, courseCode });
  }

  drainEnrichQueue();
}

/**
 * Debounced dispatcher for enrichSearchResults(). 200ms debounce so a flood of
 * mutations during page render fires once instead of 32 times.
 */
function debouncedEnrich() {
  if (enrichDebounceTimer) clearTimeout(enrichDebounceTimer);
  enrichDebounceTimer = setTimeout(() => {
    enrichDebounceTimer = null;
    enrichSearchResults();
  }, ENRICH_DEBOUNCE_MS);
}

// ─── DOM scan ───────────────────────────────────────────────────────────────

/**
 * Collect all selector arrays into a flat list, deduplicate, query DOM.
 *
 * @param {Element|Document} root
 */
function scan(root) {
  // Only flatten the 4 instructor-annotation groups; courseRow sub-selectors are
  // plain strings (not arrays) and must not be queried as instructor-name elements.
  const INSTRUCTOR_SELECTOR_KEYS = ["course-detail", "search-results", "instructor-profile", "dashboard", "course-guide", "schedule-builder"];
  const instructorSelectors = INSTRUCTOR_SELECTOR_KEYS.flatMap(k => SELECTORS[k] ?? []);
  const unique = [...new Set(instructorSelectors)];

  for (const selector of unique) {
    let elements;
    try {
      elements = root.querySelectorAll(selector);
    } catch (e) {
      // Invalid placeholder selector — skip silently
      continue;
    }

    for (const el of elements) {
      // Skip if already annotated or if it's a badge itself
      if (el.hasAttribute(BADGE_ATTR)) continue;
      if (el.classList.contains("rmp-badge")) continue;
      // Skip very short or empty text (likely icons/buttons)
      const text = el.textContent?.trim() ?? "";
      if (text.length < 3) continue;
      annotate(el);
    }
  }

  // Opportunistic course-data harvesting (Workstream B Path b)
  captureAllCourses(root);

  // Atlas search-results enrichment (Option 2): inject instructor list + RMP
  // badges onto every `.bookmarkable-card` on Browse Courses pages.
  debouncedEnrich();
}

// ─── MutationObserver (Improvement 2) ───────────────────────────────────────

let debounceTimer = null;

function debouncedScan() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    scan(document.body);
  }, 300);
}

// Atlas may re-render existing text nodes via virtual-DOM diffing rather than
// adding new nodes; characterData catches text mutations that childList misses
// (spec line 111).
const observer = new MutationObserver(debouncedScan);

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
  characterDataOldValue: true,
});

// ─── Initial scan ────────────────────────────────────────────────────────────

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => scan(document.body));
} else {
  scan(document.body);
}
