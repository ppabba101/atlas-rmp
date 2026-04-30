// RMP GraphQL client for Atlas x RMP extension

export const RMP_AUTH = "Basic dGVzdDp0ZXN0";
export const RMP_ENDPOINT = "https://www.ratemyprofessors.com/graphql";
export const SCHOOL_QUERY_TEXT = "University of Michigan Ann Arbor";

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
  const response = await fetch(RMP_ENDPOINT, {
    method: "POST",
    // credentials: "omit" — do NOT attach RMP cookies. host_permissions causes
    // MV3 service worker fetches to include them by default, which can push the
    // request past nginx's header-size limit (returns 400 "Request Header Or
    // Cookie Too Large"). The Authorization header is all RMP needs.
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "Authorization": RMP_AUTH,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 401) {
    // Improvement 3: persist auth-fail marker for content.js badge rendering
    chrome.storage.local.set({ "rmp:authFailed": { ts: Date.now() } });
    const err = new Error(
      "RMP auth token returned 401 — re-paste a fresh token into src/lib/rmp.js"
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
