// 7-day TTL cache via chrome.storage.local for Atlas x RMP extension

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/**
 * Get a cached value. Returns null if missing or expired.
 *
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export async function getCached(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key];
      if (!entry) {
        resolve(null);
        return;
      }
      if (Date.now() - entry.timestamp > CACHE_TTL) {
        // Expired — remove and return null
        chrome.storage.local.remove(key);
        resolve(null);
        return;
      }
      resolve(entry.data);
    });
  });
}

/**
 * Store a value in cache with current timestamp.
 *
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function setCached(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [key]: { data: value, timestamp: Date.now() } },
      resolve
    );
  });
}
