// Toolbar popup for Atlas x RMP — quick filter toggles + per-page enable
// toggles + token/cache status. Same chrome.storage.local keys as options.js
// so changes propagate to content.js and the Options page automatically.

const RMP_AUTH_KEY     = "rmp:authToken";
const RMP_DEFAULT_AUTH = "Basic dGVzdDp0ZXN0";
const AUTH_FAILED_KEY  = "rmp:authFailed";
const CG_AUTH_KEY      = "cg:authNeeded";

const PREF_KEYS = {
  hideClosedSections:     "setting:hideClosedSections",
  hideWaitlistedSections: "setting:hideWaitlistedSections",
  hideEmptyCards:         "setting:hideEmptyCards",
  minRmpRating:           "setting:minRmpRating",
};

// Per-page toggles. Default: all true. Mirrored in options.js + content.js.
const PAGE_KEYS = {
  courseDetail:      "setting:enableOnCourseDetail",
  instructorProfile: "setting:enableOnInstructorProfile",
  dashboard:         "setting:enableOnDashboard",
  searchResults:     "setting:enableOnSearchResults",
  scheduleBuilder:   "setting:enableOnScheduleBuilder",
  courseGuide:       "setting:enableOnCourseGuide",
};

// chrome.storage entries that count as RMP cache: per-prof lookups (`prof:...`)
// and per-detail enrichments (`atlas:detail:...`). The school-id, settings,
// and auth-token entries are excluded.
const CACHE_KEY_PREFIXES = ["prof:", "atlas:detail:"];

const $ = (id) => document.getElementById(id);

// ─── Preferences ────────────────────────────────────────────────────────────

function loadPrefs() {
  chrome.storage.local.get(Object.values(PREF_KEYS), (result) => {
    $("pref-hideClosed").checked = !!result[PREF_KEYS.hideClosedSections];
    $("pref-hideWait").checked   = !!result[PREF_KEYS.hideWaitlistedSections];
    $("pref-hideEmpty").checked  = !!result[PREF_KEYS.hideEmptyCards];
    const minRating = Number(result[PREF_KEYS.minRmpRating]) || 0;
    $("pref-minRating").checked      = minRating > 0;
    $("pref-minRatingValue").value   = minRating;
  });
}

function persistBoolPref(key, checked) {
  chrome.storage.local.set({ [key]: checked });
}

function persistMinRating() {
  const enabled = $("pref-minRating").checked;
  const raw     = Number($("pref-minRatingValue").value);
  const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(5, raw)) : 0;
  chrome.storage.local.set({ [PREF_KEYS.minRmpRating]: enabled ? clamped : 0 });
}

// ─── Per-page toggles ───────────────────────────────────────────────────────

function loadPageToggles() {
  chrome.storage.local.get(Object.values(PAGE_KEYS), (result) => {
    for (const [name, key] of Object.entries(PAGE_KEYS)) {
      const stored = result[key];
      // Default: true when missing. Only `false` (strict) disables.
      const enabled = stored === false ? false : true;
      $("page-" + name).checked = enabled;
    }
  });
}

function persistPageToggle(name, checked) {
  chrome.storage.local.set({ [PAGE_KEYS[name]]: checked });
}

// ─── CG auth banner ─────────────────────────────────────────────────────────

function loadCgAuthCard() {
  chrome.storage.local.get(CG_AUTH_KEY, (result) => {
    const needed = result?.[CG_AUTH_KEY];
    const card = $("cg-auth-card");
    if (card) card.style.display = (needed && needed.ts) ? "block" : "none";
  });
}

// ─── Token status ───────────────────────────────────────────────────────────

function loadTokenStatus() {
  const el = $("token-status");
  chrome.storage.local.get([RMP_AUTH_KEY, AUTH_FAILED_KEY], (result) => {
    const stored = result?.[RMP_AUTH_KEY];
    const failed = result?.[AUTH_FAILED_KEY];
    if (failed && failed.ts) {
      el.className = "chip chip-warn";
      el.textContent = "expired — open Options";
      el.onclick = openOptions;
      return;
    }
    if (typeof stored === "string" && stored.trim().length > 0 && stored !== RMP_DEFAULT_AUTH) {
      el.className = "chip chip-ok";
      el.textContent = "custom (OK)";
      el.onclick = null;
    } else {
      el.className = "chip chip-default";
      el.textContent = "default";
      el.onclick = null;
    }
  });
}

// ─── Cache ──────────────────────────────────────────────────────────────────

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
    if (keys.length === 0) return;
    chrome.storage.local.remove(keys, () => {
      loadCacheCount();
    });
  });
}

// ─── Open Options ───────────────────────────────────────────────────────────

function openOptions(e) {
  if (e) e.preventDefault();
  if (chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("src/options.html"));
  }
}

// ─── Wire up ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadPrefs();
  loadPageToggles();
  loadTokenStatus();
  loadCacheCount();
  loadCgAuthCard();

  $("cg-reauth-btn").addEventListener("click", () => {
    const cgUrl = "https://webapps.lsa.umich.edu/cg/";
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url: cgUrl });
    } else {
      window.open(cgUrl);
    }
  });

  $("pref-hideClosed").addEventListener("change", (e) =>
    persistBoolPref(PREF_KEYS.hideClosedSections, e.target.checked)
  );
  $("pref-hideWait").addEventListener("change", (e) =>
    persistBoolPref(PREF_KEYS.hideWaitlistedSections, e.target.checked)
  );
  $("pref-hideEmpty").addEventListener("change", (e) =>
    persistBoolPref(PREF_KEYS.hideEmptyCards, e.target.checked)
  );
  $("pref-minRating").addEventListener("change", persistMinRating);
  $("pref-minRatingValue").addEventListener("input", persistMinRating);

  for (const name of Object.keys(PAGE_KEYS)) {
    $("page-" + name).addEventListener("change", (e) =>
      persistPageToggle(name, e.target.checked)
    );
  }

  $("clear-cache").addEventListener("click", (e) => {
    e.preventDefault();
    clearCache();
  });

  $("open-options").addEventListener("click", openOptions);

  // Live updates: reflect external changes (e.g., user updated token via the
  // Options page while the popup is open).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[RMP_AUTH_KEY] || changes[AUTH_FAILED_KEY]) loadTokenStatus();
    if (changes[CG_AUTH_KEY]) loadCgAuthCard();
    if (Object.values(PREF_KEYS).some((k) => changes[k])) loadPrefs();
    if (Object.values(PAGE_KEYS).some((k) => changes[k])) loadPageToggles();
  });
});
