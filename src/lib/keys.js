// Shared chrome.storage.local key definitions for the popup, Options page,
// and (by reference) the content script. content.js can't import this file
// because content scripts don't support ES modules without bundling, so it
// duplicates the storage-key strings inline — keep that duplication in sync
// with this file when adding or renaming a setting.

export const SETTING_KEYS = {
  hideClosedSections:     "setting:hideClosedSections",
  hideWaitlistedSections: "setting:hideWaitlistedSections",
  hideEmptyCards:         "setting:hideEmptyCards",
  minRmpRating:           "setting:minRmpRating",
};

// Single source of truth for per-page toggles. Each entry maps:
//   pageType   → return value of detectPageType() in content.js
//   id         → camelCase suffix on the popup/options checkbox id (page-{id})
//   key        → chrome.storage.local key (default: enabled when missing)
const PAGE_TOGGLE_DEFS = [
  ["course-detail",      "courseDetail",      "setting:enableOnCourseDetail"],
  ["instructor-profile", "instructorProfile", "setting:enableOnInstructorProfile"],
  ["browse-instructors", "browseInstructors", "setting:enableOnBrowseInstructors"],
  ["search-results",     "searchResults",     "setting:enableOnSearchResults"],
  ["schedule-builder",   "scheduleBuilder",   "setting:enableOnScheduleBuilder"],
  ["course-guide",       "courseGuide",       "setting:enableOnCourseGuide"],
];

// pageType → storage key (used by content.js shape, mirrored in its inline copy)
export const PAGE_ENABLE_KEYS = Object.fromEntries(
  PAGE_TOGGLE_DEFS.map(([pageType, , key]) => [pageType, key])
);

// Popup/options HTML uses checkbox ids of the form `page-{camelCase}`. This
// map drives both the load (read storage → set checkbox) and the save
// (read checkbox → write storage) paths.
export const PAGE_TOGGLE_KEYS = Object.fromEntries(
  PAGE_TOGGLE_DEFS.map(([, name, key]) => [name, key])
);

// Cache-key prefixes the popup/options Clear-cache button wipes. Anything
// that has a TTL and is reconstructable goes here; auth-fail flags, the
// school ID, the RMP token, and settings entries are intentionally excluded.
export const CACHE_KEY_PREFIXES = ["prof:", "atlas:detail:", "cg:section:"];

// Top-level chrome.storage.local keys for non-cache state.
export const RMP_AUTH_KEY    = "rmp:authToken";
export const AUTH_FAILED_KEY = "rmp:authFailed";
export const CG_AUTH_KEY     = "cg:authNeeded";
