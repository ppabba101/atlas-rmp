// Name matching utilities for Atlas x RMP extension

/**
 * Nickname → canonical-form map for first-name matching. Asymmetric on
 * purpose: only nickname-to-canonical entries are listed; canonical-to-itself
 * entries would be no-ops since `NICKS.get(x) ?? x` returns `x` when the key
 * is missing. Add a new entry whenever you see a canonical/nickname pair miss
 * in the wild.
 *
 * Stephen / Steven are kept separate — they're independent names in practice,
 * not nicknames of each other.
 */
export const NICKS = new Map([
  ["wes", "westley"],
  ["alex", "alexander"],
  ["bob", "robert"],
  ["rob", "robert"],
  ["bill", "william"],
  ["will", "william"],
  ["jim", "james"],
  ["jake", "jacob"],
  ["mike", "michael"],
  ["mick", "michael"],
  ["dave", "david"],
  ["dan", "daniel"],
  ["danny", "daniel"],
  ["tom", "thomas"],
  ["tommy", "thomas"],
  ["chris", "christopher"],
  ["matt", "matthew"],
  ["steve", "stephen"],
  ["andy", "andrew"],
  ["drew", "andrew"],
  ["joe", "joseph"],
  ["joey", "joseph"],
  ["tony", "anthony"],
  ["ben", "benjamin"],
  ["ed", "edward"],
  ["ted", "edward"],
  ["sam", "samuel"],
  ["pat", "patrick"],
  ["rick", "richard"],
  ["dick", "richard"],
  ["nick", "nicholas"],
  ["pete", "peter"],
  ["greg", "gregory"],
  ["fred", "frederick"],
  ["jeff", "jeffrey"],
  ["geoff", "geoffrey"],
  ["ken", "kenneth"],
  ["marc", "mark"],
  ["liz", "elizabeth"],
  ["beth", "elizabeth"],
  ["kate", "katherine"],
  ["kathy", "katherine"],
  ["katie", "katherine"],
  ["sue", "susan"],
  ["annie", "anne"],
  ["sara", "sarah"],
  ["yaccov", "ya'acov"],
  ["yaacov", "ya'acov"],
]);

/**
 * Normalize a name string: lowercase, strip titles, strip middle initials, trim.
 *
 * Middle initials are only stripped when there are 3+ tokens, because in
 * 2-token names like "J. Smith" the leading initial-shaped token IS the
 * given name, not a middle initial — stripping it leaves "smith" alone and
 * causes false matches against any "Smith" in RMP results.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  if (!s || typeof s !== "string") return "";
  const cleaned = s
    .toLowerCase()
    .replace(/\b(dr|prof|professor|mr|ms|mrs|miss|mx)\b\.?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length < 3) return tokens.join(" ");
  // Strip interior single-letter tokens (with or without trailing period);
  // never touch the first or last token.
  return tokens
    .filter((t, i) => i === 0 || i === tokens.length - 1 || !/^[a-z]\.?$/.test(t))
    .join(" ");
}

/**
 * Split a full name into {first, last}.
 * Handles "Last, First" and "First Last" formats.
 * Returns normalized (lowercase) parts.
 *
 * @param {string} full
 * @returns {{first: string, last: string}}
 */
export function splitName(full) {
  if (!full || typeof full !== "string") return { first: "", last: "" };

  const trimmed = full.trim();

  // "Last, First" format
  if (trimmed.includes(",")) {
    const commaIdx = trimmed.indexOf(",");
    const last = trimmed.slice(0, commaIdx).trim().toLowerCase();
    const first = trimmed.slice(commaIdx + 1).trim().toLowerCase();
    return { first, last };
  }

  // "First Last" format (may have middle name/initial)
  const parts = trimmed.toLowerCase().split(/\s+/);
  if (parts.length === 1) {
    return { first: "", last: parts[0] };
  }
  const last = parts[parts.length - 1];
  const first = parts.slice(0, parts.length - 1).join(" ");
  return { first, last };
}

/**
 * Internal: check if two first names match, accounting for nicknames.
 * Both inputs should already be normalized/lowercased.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function firstNameMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  // Resolve to canonical forms via NICKS
  const canonA = NICKS.get(a) ?? a;
  const canonB = NICKS.get(b) ?? b;
  if (canonA === canonB) return true;

  // Prefix match — require minimum length 2 on the shorter side. A
  // single-letter prefix would match every name starting with that letter
  // ("a" → "anthony", "andrew", "alex"…); single-initial cases are handled
  // separately in pickBestMatch with a lower 0.80 confidence.
  const aShort = a.replace(/\.$/, "");
  const bShort = b.replace(/\.$/, "");
  if (aShort.length >= 2 && bShort.startsWith(aShort)) return true;
  if (bShort.length >= 2 && aShort.startsWith(bShort)) return true;

  return false;
}

/**
 * Whether two last-name strings refer to the same surname, allowing for
 * multi-word surnames that get split differently between Atlas and RMP.
 *
 * Atlas's splitName treats only the trailing word as the surname (so
 * "Raed Al Kontar" → first="raed al", last="kontar"), but RMP often stores
 * particle-prefixed surnames whole (firstName="Raed", lastName="Al Kontar").
 * Without this helper the exact-string compare drops valid matches.
 *
 * Accepts:
 *   - exact equality
 *   - one side is the trailing-token suffix of the other (space-aligned)
 */
function lastNameMatches(atlasLast, rmpLast) {
  if (!atlasLast || !rmpLast) return false;
  if (atlasLast === rmpLast) return true;
  if (rmpLast.endsWith(" " + atlasLast)) return true;
  if (atlasLast.endsWith(" " + rmpLast)) return true;
  return false;
}

/**
 * Whether the full normalized name token-sets are equal regardless of how
 * Atlas and RMP partitioned them into first/last. "Raed Al Kontar" matches
 * whether RMP stored it as ("Raed", "Al Kontar") or ("Raed Al", "Kontar").
 */
function tokenSetEquals(atlasFull, rmpFull) {
  const a = atlasFull.split(/\s+/).filter(Boolean);
  const b = rmpFull.split(/\s+/).filter(Boolean);
  if (a.length === 0 || a.length !== b.length) return false;
  const aSet = new Set(a);
  for (const t of b) if (!aSet.has(t)) return false;
  return true;
}

/**
 * Pick the best RMP match for an Atlas name.
 * Last-name gate: must match by exact equality OR multi-word suffix
 * (handles Arabic/Dutch/Spanish particle surnames split across firstName).
 * Returns {node, confidence} or null if no match meets 0.8 floor.
 *
 * Confidence scoring:
 *   1.00 — full-name token sets equal (covers any first/last partitioning)
 *   1.00 — last match + exact first
 *   0.95 — last match + nickname/canonical first match
 *   0.85 — last match + partial first (prefix)
 *   0.80 — last match + first initial only, or last-only with no atlasFirst
 *   null  — last name doesn't match or confidence < 0.80
 *
 * @param {string} atlasName - Name as rendered on Atlas
 * @param {Array<{node: object}>} rmpNodes - RMP teacher search edge nodes
 * @returns {{node: object, confidence: number} | null}
 */
export function pickBestMatch(atlasName, rmpNodes) {
  if (!atlasName || !rmpNodes || rmpNodes.length === 0) return null;

  const atlasFull = normalize(atlasName);
  const { first: atlasFirst, last: atlasLast } = splitName(atlasFull);

  if (!atlasLast) return null;

  let best = null;
  let bestConfidence = 0;

  for (const edge of rmpNodes) {
    const node = edge.node ?? edge;
    const rmpFirst = (node.firstName ?? "").toLowerCase().trim();
    const rmpLast = (node.lastName ?? "").toLowerCase().trim();
    const rmpFull = (rmpFirst + " " + rmpLast).trim();

    let confidence = 0;

    // Highest-confidence path: token-set equality across the whole name. This
    // captures "Raed Al Kontar" no matter which side of the comma each token
    // landed on after first/last partitioning.
    if (tokenSetEquals(atlasFull, rmpFull)) {
      confidence = 1.00;
    } else if (lastNameMatches(atlasLast, rmpLast)) {
      if (!atlasFirst) {
        // No first name available — last-name-only match at 0.80
        confidence = 0.80;
      } else {
        const normAtlasFirst = normalize(atlasFirst);
        const normRmpFirst = normalize(rmpFirst);

        if (normAtlasFirst === normRmpFirst) {
          // Exact first name match
          confidence = 1.00;
        } else if (firstNameMatch(normAtlasFirst, normRmpFirst)) {
          // Nickname or canonical match
          confidence = 0.95;
        } else {
          // Partial prefix match
          const aShort = normAtlasFirst.replace(/\.$/, "");
          const bShort = normRmpFirst.replace(/\.$/, "");
          if (
            (aShort.length >= 2 && bShort.startsWith(aShort)) ||
            (bShort.length >= 2 && aShort.startsWith(bShort))
          ) {
            confidence = 0.85;
          } else if (aShort.length === 1 || bShort.length === 1) {
            // Single initial match
            if (aShort[0] === bShort[0]) {
              confidence = 0.80;
            }
          }
        }
      }
    } else {
      continue;
    }

    if (confidence >= 0.80 && confidence > bestConfidence) {
      bestConfidence = confidence;
      best = { node, confidence };
    }
  }

  return best;
}
