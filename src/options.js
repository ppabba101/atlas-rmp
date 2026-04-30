// Options page for Atlas x RMP — manages RMP auth token + display preferences.
// Uses chrome.storage.local for all persistence; the same keys are read by
// background.js, content.js, and popup.js.

const RMP_AUTH_KEY      = "rmp:authToken";
const RMP_DEFAULT_AUTH  = "Basic dGVzdDp0ZXN0";
const RMP_ENDPOINT      = "https://www.ratemyprofessors.com/graphql";

const PREF_KEYS = {
  hideClosedSections: "setting:hideClosedSections",
  hideEmptyCards:     "setting:hideEmptyCards",
  minRmpRating:       "setting:minRmpRating",
};

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
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 1200);
}

function setStatus(el, kind, text) {
  el.className = "status " + kind;
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
        banner.classList.remove("visible");
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

  setStatus(status, "idle", "Testing...");

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
      setStatus(status, "fail", "FAIL — 401 unauthorized (token invalid/expired)");
      return;
    }
    if (!res.ok) {
      setStatus(status, "fail", `FAIL — HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const edges = data?.data?.newSearch?.schools?.edges ?? [];
    if (edges.length > 0) {
      setStatus(status, "ok", `OK — token works (HTTP ${res.status})`);
    } else {
      setStatus(status, "fail", "FAIL — empty response (token may be wrong scope)");
    }
  } catch (e) {
    setStatus(status, "fail", `FAIL — ${e.message || "network error"}`);
  }
}

// ─── Preferences section ────────────────────────────────────────────────────

async function loadPrefs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.values(PREF_KEYS), (result) => {
      $("pref-hideClosed").checked     = !!result[PREF_KEYS.hideClosedSections];
      $("pref-hideEmpty").checked      = !!result[PREF_KEYS.hideEmptyCards];
      const minRating = Number(result[PREF_KEYS.minRmpRating]) || 0;
      $("pref-minRating").checked      = minRating > 0;
      $("pref-minRatingValue").value   = minRating;
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
    [PREF_KEYS.hideClosedSections]: $("pref-hideClosed").checked,
    [PREF_KEYS.hideEmptyCards]:     $("pref-hideEmpty").checked,
    [PREF_KEYS.minRmpRating]:       minEnabled ? minClamped : 0,
  };

  chrome.storage.local.set(payload, () => flash(flashEl));
}

// ─── Wire up ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadToken();
  loadPrefs();

  $("save-token").addEventListener("click", saveToken);
  $("test-token").addEventListener("click", testToken);
  $("save-prefs").addEventListener("click", savePrefs);

  // Enter key inside the token input acts like Save.
  $("token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveToken();
    }
  });
});
