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
  el.setAttribute(BADGE_ATTR, "pending");

  const name = el.textContent?.trim();
  if (!name || name.length < 3) {
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

// ─── DOM scan ───────────────────────────────────────────────────────────────

/**
 * Collect all selector arrays into a flat list, deduplicate, query DOM.
 *
 * @param {Element|Document} root
 */
function scan(root) {
  // Only flatten the 4 instructor-annotation groups; courseRow sub-selectors are
  // plain strings (not arrays) and must not be queried as instructor-name elements.
  const INSTRUCTOR_SELECTOR_KEYS = ["course-detail", "search-results", "instructor-profile", "dashboard", "course-guide"];
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
