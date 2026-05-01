// RMP GraphQL client for Atlas x RMP extension

// Day-0 default auth token. Used as a fallback when chrome.storage.local
// "rmp:authToken" is unset (e.g. on a fresh install before the user opens the
// Options page). Anyone using the extension out-of-the-box gets the same
// public test token shipped with RMP's web client.
export const RMP_DEFAULT_AUTH = "Basic dGVzdDp0ZXN0";
export const RMP_AUTH_STORAGE_KEY = "rmp:authToken";
export const RMP_ENDPOINT = "https://www.ratemyprofessors.com/graphql";
export const SCHOOL_QUERY_TEXT = "University of Michigan Ann Arbor";

// Module-scope cache: avoids repeated chrome.storage.local reads on every gql()
// call. Invalidated by clearRmpAuthCache() when the user saves a new token.
let cachedAuth = null;

/**
 * Resolve the Authorization header value, preferring chrome.storage.local
 * "rmp:authToken" over the Day-0 default. Caches the result in module scope.
 *
 * @returns {Promise<string>} Authorization header value (e.g. "Basic ...")
 */
export async function getRmpAuth() {
  if (cachedAuth) return cachedAuth;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(RMP_AUTH_STORAGE_KEY, (result) => {
        const stored = result?.[RMP_AUTH_STORAGE_KEY];
        cachedAuth =
          typeof stored === "string" && stored.trim().length > 0
            ? stored.trim()
            : RMP_DEFAULT_AUTH;
        resolve(cachedAuth);
      });
    } catch (e) {
      // chrome.storage may be unavailable in test contexts — fall back gracefully.
      cachedAuth = RMP_DEFAULT_AUTH;
      resolve(cachedAuth);
    }
  });
}

// Listen for storage changes so a token update from the Options/Popup page
// invalidates the cache automatically. Guarded for non-extension contexts.
try {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[RMP_AUTH_STORAGE_KEY]) {
        cachedAuth = null;
      }
    });
  }
} catch (_) { /* ignore */ }

export const SCHOOL_SEARCH_QUERY = `
  query SchoolSearch($query: SchoolSearchQuery!) {
    newSearch {
      schools(query: $query) {
        edges {
          node {
            id
            legacyId
            name
            city
            state
          }
        }
      }
    }
  }
`;

export const TEACHER_SEARCH_QUERY = `
  query TeacherSearch($query: TeacherSearchQuery!) {
    newSearch {
      teachers(query: $query) {
        edges {
          node {
            id
            legacyId
            firstName
            lastName
            department
            avgRating
            avgDifficulty
            numRatings
            wouldTakeAgainPercent
            school {
              id
              name
            }
          }
        }
      }
    }
  }
`;

/**
 * Execute a GraphQL query against RMP.
 * Improvement 3: On 401, set chrome.storage.local rmp:authFailed marker AND throw
 * a tagged error with error.code = "auth-failed".
 *
 * @param {string} query - GraphQL query string
 * @param {object} variables - Query variables
 * @returns {Promise<object>} - Parsed JSON response
 */
export async function gql(query, variables) {
  const auth = await getRmpAuth();
  const response = await fetch(RMP_ENDPOINT, {
    method: "POST",
    // credentials: "omit" — do NOT attach RMP cookies. host_permissions causes
    // MV3 service worker fetches to include them by default, which can push the
    // request past nginx's header-size limit (returns 400 "Request Header Or
    // Cookie Too Large"). The Authorization header is all RMP needs.
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "Authorization": auth,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 401) {
    // Improvement 3: persist auth-fail marker for content.js badge rendering
    chrome.storage.local.set({ "rmp:authFailed": { ts: Date.now() } });
    const err = new Error(
      "RMP auth token returned 401 — update your token in the extension Options page"
    );
    err.code = "auth-failed";
    throw err;
  }

  if (!response.ok) {
    let body = "";
    try { body = await response.text(); } catch (_) { /* ignore */ }
    throw new Error(
      `RMP GraphQL returned HTTP ${response.status}` +
      (body ? ` — body: ${body.slice(0, 500)}` : "")
    );
  }

  return response.json();
}
