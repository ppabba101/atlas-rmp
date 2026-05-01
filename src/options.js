// Options page for Atlas x RMP — manages RMP auth token, display preferences,
// per-page toggles, and cache. Loaded as an ES module from options.html so
// constants come from src/lib/.

import {
  SETTING_KEYS as PREF_KEYS,
  PAGE_TOGGLE_KEYS as PAGE_KEYS,
  CACHE_KEY_PREFIXES,
  RMP_AUTH_KEY,
} from "./lib/keys.js";
import { RMP_DEFAULT_AUTH, RMP_ENDPOINT } from "./lib/rmp.js";

// Trivial GraphQL ping used by the "Test token" button. Asks RMP for one school
// matching "University of Michigan Ann Arbor" — small payload, exercises auth.
const PING_QUERY = `
  query SchoolSearch($query: SchoolSearchQuery!) {
    newSearch {
      schools(query: $query) {
        edges { node { id } }
      }
    }
  }
`;

const $ = (id) => document.getElementById(id);

function flash(el) {
  if (!el) return;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 1200);
}

function setStatus(el, kind, text) {
  // kind: "ok" | "warn" | "info" | "idle"
  el.className = "chip chip-" + kind;
  el.textContent = text;
}

// ─── Token section ──────────────────────────────────────────────────────────

async function loadToken() {
  const tokenInput = $("token-input");
  const banner     = $("default-banner");

  return new Promise((resolve) => {
    chrome.storage.local.get(RMP_AUTH_KEY, (result) => {
      const stored = result?.[RMP_AUTH_KEY];
      if (typeof stored === "string" && stored.trim().length > 0) {
        tokenInput.value = stored;
        banner.classList.toggle("visible", stored === RMP_DEFAULT_AUTH);
      } else {
        tokenInput.value = "";
        banner.classList.add("visible");
      }
      resolve();
    });
  });
}

function saveToken() {
  const tokenInput = $("token-input");
  const banner     = $("default-banner");
  const flashEl    = $("save-flash");

  const value = (tokenInput.value || "").trim();
  if (value.length === 0) {
    // Empty input = clear stored token (revert to Day-0 default).
    chrome.storage.local.remove(RMP_AUTH_KEY, () => {
      banner.classList.add("visible");
      flash(flashEl);
    });
    return;
  }

  chrome.storage.local.set({ [RMP_AUTH_KEY]: value }, () => {
    // New token: clear the stale auth-fail marker so badges recover.
    chrome.storage.local.remove("rmp:authFailed");
    banner.classList.toggle("visible", value === RMP_DEFAULT_AUTH);
    flash(flashEl);
  });
}

async function testToken() {
  const tokenInput = $("token-input");
  const status     = $("test-status");

  const value = (tokenInput.value || "").trim() || RMP_DEFAULT_AUTH;

  setStatus(status, "info", "Testing...");

  try {
    const res = await fetch(RMP_ENDPOINT, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Authorization": value,
      },
      body: JSON.stringify({
        query: PING_QUERY,
        variables: { query: { text: "University of Michigan Ann Arbor" } },
      }),
    });

    if (res.status === 401) {
      setStatus(status, "warn", "FAIL — 401 unauthorized (token invalid/expired)");
      return;
    }
    if (!res.ok) {
      setStatus(status, "warn", `FAIL — HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const edges = data?.data?.newSearch?.schools?.edges ?? [];
    if (edges.length > 0) {
      setStatus(status, "ok", `OK — token works (HTTP ${res.status})`);
    } else {
      setStatus(status, "warn", "FAIL — empty response (token may be wrong scope)");
    }
  } catch (e) {
    setStatus(status, "warn", `FAIL — ${e.message || "network error"}`);
  }
}

// ─── Preferences section ────────────────────────────────────────────────────

async function loadPrefs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.values(PREF_KEYS), (result) => {
      $("pref-hideClosed").checked   = !!result[PREF_KEYS.hideClosedSections];
      $("pref-hideWait").checked     = !!result[PREF_KEYS.hideWaitlistedSections];
      $("pref-hideEmpty").checked    = !!result[PREF_KEYS.hideEmptyCards];
      const minRating = Number(result[PREF_KEYS.minRmpRating]) || 0;
      $("pref-minRating").checked    = minRating > 0;
      $("pref-minRatingValue").value = minRating;
      resolve();
    });
  });
}

function savePrefs() {
  const flashEl = $("prefs-flash");
  const minEnabled = $("pref-minRating").checked;
  const minVal     = Number($("pref-minRatingValue").value);
  const minClamped = Number.isFinite(minVal) ? Math.max(0, Math.min(5, minVal)) : 0;

  const payload = {
    [PREF_KEYS.hideClosedSections]:     $("pref-hideClosed").checked,
    [PREF_KEYS.hideWaitlistedSections]: $("pref-hideWait").checked,
    [PREF_KEYS.hideEmptyCards]:         $("pref-hideEmpty").checked,
    [PREF_KEYS.minRmpRating]:           minEnabled ? minClamped : 0,
  };

  chrome.storage.local.set(payload, () => flash(flashEl));
}

// ─── Per-page toggles section ───────────────────────────────────────────────

async function loadPageToggles() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.values(PAGE_KEYS), (result) => {
      for (const [name, key] of Object.entries(PAGE_KEYS)) {
        const stored = result[key];
        // Default-true: only `false` (strict) disables.
        const enabled = stored === false ? false : true;
        $("page-" + name).checked = enabled;
      }
      resolve();
    });
  });
}

function savePageToggles() {
  const flashEl = $("pages-flash");
  const payload = {};
  for (const [name, key] of Object.entries(PAGE_KEYS)) {
    payload[key] = $("page-" + name).checked;
  }
  chrome.storage.local.set(payload, () => flash(flashEl));
}

// ─── Cache section ──────────────────────────────────────────────────────────

function loadCacheCount() {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all || {});
    const count = keys.filter((k) =>
      CACHE_KEY_PREFIXES.some((p) => k.startsWith(p))
    ).length;
    $("cache-count").textContent = String(count);
  });
}

function clearCache() {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all || {}).filter((k) =>
      CACHE_KEY_PREFIXES.some((p) => k.startsWith(p))
    );
    if (keys.length === 0) {
      loadCacheCount();
      return;
    }
    chrome.storage.local.remove(keys, () => loadCacheCount());
  });
}

// ─── Wire up ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Footer version pulled from manifest so it updates with releases.
  const versionEl = $("ext-version");
  if (versionEl) versionEl.textContent = "v" + chrome.runtime.getManifest().version;

  loadToken();
  loadPrefs();
  loadPageToggles();
  loadCacheCount();

  $("save-token").addEventListener("click", saveToken);
  $("test-token").addEventListener("click", testToken);
  $("save-prefs").addEventListener("click", savePrefs);
  $("save-pages").addEventListener("click", savePageToggles);
  $("clear-cache").addEventListener("click", clearCache);

  // Enter key inside the token input acts like Save.
  $("token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveToken();
    }
  });

  // Live updates: reflect changes pushed from the popup or another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[RMP_AUTH_KEY]) loadToken();
    if (Object.values(PREF_KEYS).some((k) => changes[k])) loadPrefs();
    if (Object.values(PAGE_KEYS).some((k) => changes[k])) loadPageToggles();
    // Any cache key change — refresh count.
    if (Object.keys(changes).some((k) =>
      CACHE_KEY_PREFIXES.some((p) => k.startsWith(p))
    )) {
      loadCacheCount();
    }
  });
});
