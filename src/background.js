// MV3 module compatibility note: This service worker uses ES modules ("type": "module" in manifest).
// If Chrome rejects with a module-related error on load, fallback options are:
//   (a) Switch to non-module worker + use importScripts() at top
//   (b) Bundle lib/* into a single file via esbuild/webpack
// Try modules first; only fall back if it actually breaks. See open-questions.md item 3.

import {
  gql,
  SCHOOL_SEARCH_QUERY,
  TEACHER_SEARCH_QUERY,
  SCHOOL_QUERY_TEXT,
} from "./lib/rmp.js";
import { pickBestMatch, splitName, normalize } from "./lib/nameMatch.js";
import { getCached, setCached } from "./lib/cache.js";

const SCHOOL_ID_KEY = "rmp:schoolId";

// Module-scope promise lock: prevents concurrent startups from firing duplicate
// school-search requests before the first response is cached.
let schoolIdPromise = null;

/**
 * Resolve and cache the UMich Ann Arbor school ID from RMP.
 * Prefers the Ann Arbor result when multiple schools match.
 * Uses a promise lock so concurrent callers share a single in-flight request.
 *
 * @returns {Promise<string>} RMP school GraphQL ID
 */
function getSchoolId() {
  if (schoolIdPromise) return schoolIdPromise;
  schoolIdPromise = (async () => {
    try {
      const cached = await getCached(SCHOOL_ID_KEY);
      if (cached) {
        console.log("[atlas-rmp] School ID from cache:", cached);
        return cached;
      }

      console.log("[atlas-rmp] Fetching UMich school ID from RMP...");
      const data = await gql(SCHOOL_SEARCH_QUERY, {
        query: { text: SCHOOL_QUERY_TEXT },
      });
      const edges = data?.data?.newSearch?.schools?.edges ?? [];

      if (edges.length === 0) {
        throw new Error("No schools returned from RMP for query: " + SCHOOL_QUERY_TEXT);
      }

      // Prefer Ann Arbor result; fall back to first result
      const annArborEdge =
        edges.find(
          (e) =>
            (e.node.city ?? "").toLowerCase().includes("ann arbor") ||
            (e.node.name ?? "").toLowerCase().includes("ann arbor")
        ) ?? edges[0];

      const schoolId = annArborEdge.node.id;
      console.log(
        "[atlas-rmp] Resolved school ID:",
        schoolId,
        "legacyId:",
        annArborEdge.node.legacyId
      );

      await setCached(SCHOOL_ID_KEY, schoolId);
      return schoolId;
    } catch (e) {
      schoolIdPromise = null; // allow retry on failure
      throw e;
    }
  })();
  return schoolIdPromise;
}

/**
 * Look up a professor on RMP by full name.
 * Uses negative caching: a miss is stored so we don't re-query for 7 days.
 *
 * @param {string} fullName
 * @returns {Promise<object>} Result object for sendResponse
 */
async function lookupProfessor(fullName) {
  const cacheKey = "prof:" + fullName.toLowerCase().trim();

  const cached = await getCached(cacheKey);
  if (cached !== null) {
    console.log("[atlas-rmp] Cache hit for:", fullName, cached);
    return cached;
  }

  console.log("[atlas-rmp] Looking up:", fullName);

  let schoolId;
  try {
    schoolId = await getSchoolId();
  } catch (e) {
    if (e.code === "auth-failed") {
      return { found: false, reason: "auth-failed" };
    }
    console.error("[atlas-rmp] Failed to get school ID:", e);
    return { found: false, reason: "error", message: e.message };
  }

  const { last } = splitName(normalize(fullName));
  if (!last) {
    return { found: false, reason: "invalid-name" };
  }

  let data;
  try {
    data = await gql(TEACHER_SEARCH_QUERY, {
      query: { text: last, schoolID: schoolId },
    });
  } catch (e) {
    if (e.code === "auth-failed") {
      return { found: false, reason: "auth-failed" };
    }
    console.error("[atlas-rmp] Teacher search failed:", e);
    return { found: false, reason: "error", message: e.message };
  }

  const edges = data?.data?.newSearch?.teachers?.edges ?? [];
  console.log(
    "[atlas-rmp] Teacher search for",
    fullName,
    "returned",
    edges.length,
    "results"
  );

  let match = pickBestMatch(fullName, edges);

  // Cross-campus fallback: Atlas surfaces instructors from UMich Ann Arbor,
  // Dearborn, AND Flint. RMP often files those professors under their primary
  // campus (Dearborn / Flint), or even at affiliated MI schools (EMU, etc.).
  // When the Ann Arbor lookup misses, retry without a schoolID filter and
  // accept matches at any school whose name contains "Michigan".
  if (!match) {
    console.log("[atlas-rmp] No Ann Arbor match — trying Michigan-wide search:", fullName);
    let broaderData = null;
    try {
      broaderData = await gql(TEACHER_SEARCH_QUERY, {
        query: { text: last },
      });
    } catch (e) {
      if (e.code === "auth-failed") {
        return { found: false, reason: "auth-failed" };
      }
      console.warn("[atlas-rmp] Michigan-wide search failed:", e.message);
    }

    if (broaderData) {
      const allEdges = broaderData?.data?.newSearch?.teachers?.edges ?? [];
      const miEdges = allEdges.filter((e) =>
        /michigan/i.test(e.node?.school?.name || "")
      );
      console.log(
        "[atlas-rmp] Michigan-wide search:",
        allEdges.length,
        "total,",
        miEdges.length,
        "at Michigan-named schools"
      );
      match = pickBestMatch(fullName, miEdges);
      if (match) {
        console.log(
          "[atlas-rmp] Cross-campus match for",
          fullName,
          "->",
          match.node.firstName,
          match.node.lastName,
          "@",
          match.node.school?.name,
          "confidence:",
          match.confidence
        );
      }
    }
  }

  if (!match) {
    console.log("[atlas-rmp] No match found for:", fullName);
    const missResult = { found: false, reason: "no-match" };
    await setCached(cacheKey, missResult);
    return missResult;
  }

  console.log(
    "[atlas-rmp] Match found for",
    fullName,
    "->",
    match.node.firstName,
    match.node.lastName,
    "@",
    match.node.school?.name,
    "confidence:",
    match.confidence
  );

  const result = {
    found: true,
    confidence: match.confidence,
    firstName: match.node.firstName,
    lastName: match.node.lastName,
    department: match.node.department,
    avgRating: match.node.avgRating,
    avgDifficulty: match.node.avgDifficulty,
    numRatings: match.node.numRatings,
    wouldTakeAgainPercent: match.node.wouldTakeAgainPercent,
    legacyId: match.node.legacyId,
    schoolName: match.node.school?.name ?? null,
    rmpUrl:
      "https://www.ratemyprofessors.com/professor/" + match.node.legacyId,
  };

  await setCached(cacheKey, result);
  return result;
}

// Message listener: handles {type: "LOOKUP", name} from content.js
// Returns true to indicate async sendResponse
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "LOOKUP") return false;

  const { name } = message;
  if (!name) {
    sendResponse({ found: false, reason: "no-name" });
    return true;
  }

  lookupProfessor(name)
    .then(sendResponse)
    .catch((e) => {
      console.error("[atlas-rmp] Unhandled error in lookupProfessor:", e);
      sendResponse({ found: false, reason: "error", message: e.message });
    });

  return true; // Keep message channel open for async response
});

// FETCH_CG handler: content scripts on atlas.ai.umich.edu can't fetch
// webapps.lsa.umich.edu directly (no Access-Control-Allow-Origin header on
// CG's responses; the browser blocks even with host_permissions in MV3).
// The service worker has unrestricted host_permission fetch access, so we
// proxy CG fetches here and return the raw HTML body to the content script.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FETCH_CG") return false;
  const { url } = message;
  if (typeof url !== "string" || !url.startsWith("https://webapps.lsa.umich.edu/cg/")) {
    sendResponse({ ok: false, error: "invalid-url" });
    return true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  fetch(url, { credentials: "include", signal: controller.signal })
    .then(async (res) => {
      const body = await res.text();
      // Detect Shibboleth redirect: the service worker follows the 302
      // transparently, so we check the final URL rather than the status code.
      if (res.url && res.url.includes("shibboleth.umich.edu")) {
        chrome.storage.local.set({ "cg:authNeeded": { ts: Date.now() } });
        sendResponse({ ok: false, status: res.status, finalUrl: res.url, body, error: "cg-auth-redirect" });
        return;
      }
      // No redirect to Shibboleth ⇒ CG auth is working. Clear any stale flag
      // unconditionally — previously we required `clsschedulerow` in the body
      // (only present on detail pages with section tables), which left the
      // flag stuck after re-authentication if anything else was pinged first.
      chrome.storage.local.remove("cg:authNeeded");
      sendResponse({ ok: res.ok, status: res.status, finalUrl: res.url, body });
    })
    .catch((e) => {
      // Network/CORS errors when the redirect was blocked before completing
      // are also treated as a potential auth failure. We set the flag
      // conservatively; it will be cleared on the next successful CG fetch.
      chrome.storage.local.set({ "cg:authNeeded": { ts: Date.now() } });
      sendResponse({ ok: false, error: e.message || String(e) });
    })
    .finally(() => clearTimeout(timer));

  return true; // async
});

// On install: pre-warm the school ID cache
chrome.runtime.onInstalled.addListener(() => {
  console.log("[atlas-rmp] Extension installed — pre-warming school ID cache");
  getSchoolId().catch((e) => {
    console.error("[atlas-rmp] School ID pre-warm failed:", e.message);
  });
  syncAuthFailedBadge();
  syncCgAuthBadge();
});

// ─── Toolbar action: surface auth-fail state on the icon ───────────────────
//
// Whenever rmp:authFailed or cg:authNeeded flips on/off, update the toolbar
// badge + tooltip so the user sees the problem before opening Atlas. The popup
// also exposes dedicated cards, but the badge is the most discoverable signal.
//
// Priority: RMP auth failure (red "!") takes precedence; CG auth needed shows
// an orange "!" when RMP is healthy. When both are clear the badge is removed.

const AUTH_FAIL_BADGE_TEXT = "!";
const AUTH_FAIL_TITLE     = "Atlas x RMP — auth expired. Click to update token in extension Options.";
const CG_AUTH_TITLE       = "LSA Course Guide auth expired — click to re-authenticate";
const DEFAULT_TITLE       = "Atlas x RMP";

function setAuthFailedBadge(isFailed) {
  try {
    if (chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: isFailed ? AUTH_FAIL_BADGE_TEXT : "" });
    }
    if (chrome.action?.setBadgeBackgroundColor) {
      chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
    }
    if (chrome.action?.setTitle) {
      chrome.action.setTitle({ title: isFailed ? AUTH_FAIL_TITLE : DEFAULT_TITLE });
    }
  } catch (e) {
    // chrome.action may be unavailable in some test contexts — ignore.
  }
}

function syncAuthFailedBadge() {
  chrome.storage.local.get("rmp:authFailed", (result) => {
    const entry = result?.["rmp:authFailed"];
    setAuthFailedBadge(!!(entry && entry.ts));
  });
}

/**
 * Paint an orange "!" badge when CG auth is needed (and RMP auth is healthy).
 * If RMP auth is also failed, RMP takes visual priority (red badge stays).
 */
function syncCgAuthBadge() {
  chrome.storage.local.get(["rmp:authFailed", "cg:authNeeded"], (result) => {
    const rmpFailed = !!(result?.["rmp:authFailed"]?.ts);
    const cgNeeded  = !!(result?.["cg:authNeeded"]?.ts);
    if (rmpFailed) return; // RMP badge already shown; don't downgrade to orange
    try {
      if (cgNeeded) {
        if (chrome.action?.setBadgeText)            chrome.action.setBadgeText({ text: AUTH_FAIL_BADGE_TEXT });
        if (chrome.action?.setBadgeBackgroundColor) chrome.action.setBadgeBackgroundColor({ color: "#ea580c" });
        if (chrome.action?.setTitle)                chrome.action.setTitle({ title: CG_AUTH_TITLE });
      } else {
        if (chrome.action?.setBadgeText)  chrome.action.setBadgeText({ text: "" });
        if (chrome.action?.setTitle)      chrome.action.setTitle({ title: DEFAULT_TITLE });
      }
    } catch (e) {
      // chrome.action may be unavailable in some test contexts — ignore.
    }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes["rmp:authFailed"]) {
    const newVal = changes["rmp:authFailed"].newValue;
    const isFailed = !!(newVal && newVal.ts);
    setAuthFailedBadge(isFailed);
    // When RMP auth clears, let CG badge take over if still needed.
    if (!isFailed) syncCgAuthBadge();
  }
  if (changes["cg:authNeeded"]) {
    syncCgAuthBadge();
  }
});

// Cold start (service worker wake-up) also needs to repaint the badge.
syncAuthFailedBadge();
syncCgAuthBadge();
