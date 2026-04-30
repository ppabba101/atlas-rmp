// Name matching utilities for Atlas x RMP extension

/**
 * Nickname-to-formal first name map.
 * Covers common cases from the smoke-test professor list and general UMich faculty.
 */
export const NICKS = new Map([
  ["wes", "westley"],
  ["westley", "westley"],
  ["alex", "alexander"],
  ["alexander", "alexander"],
  ["al", "albert"],
  ["albert", "albert"],
  ["bob", "robert"],
  ["robert", "robert"],
  ["rob", "robert"],
  ["bill", "william"],
  ["william", "william"],
  ["will", "william"],
  ["jim", "james"],
  ["james", "james"],
  ["jake", "jacob"],
  ["jacob", "jacob"],
  ["mike", "michael"],
  ["michael", "michael"],
  ["mick", "michael"],
  ["dave", "david"],
  ["david", "david"],
  ["dan", "daniel"],
  ["daniel", "daniel"],
  ["danny", "daniel"],
  ["tom", "thomas"],
  ["thomas", "thomas"],
  ["tommy", "thomas"],
  ["chris", "christopher"],
  ["christopher", "christopher"],
  ["matt", "matthew"],
  ["matthew", "matthew"],
  ["steve", "stephen"],
  ["stephen", "stephen"],
  ["steven", "steven"],
  ["andy", "andrew"],
  ["andrew", "andrew"],
  ["drew", "andrew"],
  ["joe", "joseph"],
  ["joseph", "joseph"],
  ["joey", "joseph"],
  ["tony", "anthony"],
  ["anthony", "anthony"],
  ["ben", "benjamin"],
  ["benjamin", "benjamin"],
  ["ed", "edward"],
  ["edward", "edward"],
  ["ted", "edward"],
  ["sam", "samuel"],
  ["samuel", "samuel"],
  ["pat", "patrick"],
  ["patrick", "patrick"],
  ["rick", "richard"],
  ["richard", "richard"],
  ["dick", "richard"],
  ["nick", "nicholas"],
  ["nicholas", "nicholas"],
  ["pete", "peter"],
  ["peter", "peter"],
  ["greg", "gregory"],
  ["gregory", "gregory"],
  ["fred", "frederick"],
  ["frederick", "frederick"],
  ["jeff", "jeffrey"],
  ["jeffrey", "jeffrey"],
  ["geoff", "geoffrey"],
  ["geoffrey", "geoffrey"],
  ["ken", "kenneth"],
  ["kenneth", "kenneth"],
  ["mark", "mark"],
  ["marc", "mark"],
  ["liz", "elizabeth"],
  ["elizabeth", "elizabeth"],
  ["beth", "elizabeth"],
  ["kate", "katherine"],
  ["katherine", "katherine"],
  ["kathy", "katherine"],
  ["katie", "katherine"],
  ["sue", "susan"],
  ["susan", "susan"],
  ["amy", "amy"],
  ["ann", "ann"],
  ["anne", "anne"],
  ["annie", "anne"],
  ["mary", "mary"],
  ["sarah", "sarah"],
  ["sara", "sarah"],
  ["ji", "ji"],
  ["ya'acov", "ya'acov"],
  ["yaccov", "ya'acov"],
  ["yaacov", "ya'acov"],
  ["smadar", "smadar"],
  ["yuekai", "yuekai"],
  ["marwa", "marwa"],
]);

/**
 * Normalize a name string: lowercase, strip titles, strip middle initials, trim.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .toLowerCase()
    // Strip titles
    .replace(/\b(dr|prof|professor|mr|ms|mrs|miss|mx)\b\.?/g, "")
    // Strip middle initials (single letter followed by period or surrounded by spaces)
    .replace(/\b[a-z]\.\s*/g, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
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

  // One is prefix/initial of the other (e.g. "j." vs "james")
  const aShort = a.replace(/\.$/, "");
  const bShort = b.replace(/\.$/, "");
  if (bShort.startsWith(aShort) && aShort.length >= 1) return true;
  if (aShort.startsWith(bShort) && bShort.length >= 1) return true;

  return false;
}

/**
 * Pick the best RMP match for an Atlas name.
 * Hard last-name gate: last name must match (exact or very close).
 * Returns {node, confidence} or null if no match meets 0.8 floor.
 *
 * Confidence scoring:
 *   1.00 — exact last + exact first
 *   0.95 — exact last + nickname/canonical first match
 *   0.85 — exact last + partial first (prefix)
 *   0.80 — exact last + first initial only
 *   null  — last name doesn't match or confidence < 0.80
 *
 * @param {string} atlasName - Name as rendered on Atlas
 * @param {Array<{node: object}>} rmpNodes - RMP teacher search edge nodes
 * @returns {{node: object, confidence: number} | null}
 */
export function pickBestMatch(atlasName, rmpNodes) {
  if (!atlasName || !rmpNodes || rmpNodes.length === 0) return null;

  const { first: atlasFirst, last: atlasLast } = splitName(normalize(atlasName));

  if (!atlasLast) return null;

  let best = null;
  let bestConfidence = 0;

  for (const edge of rmpNodes) {
    const node = edge.node ?? edge;
    const rmpFirst = (node.firstName ?? "").toLowerCase().trim();
    const rmpLast = (node.lastName ?? "").toLowerCase().trim();

    // Hard last-name gate
    if (rmpLast !== atlasLast) continue;

    let confidence = 0;

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

    if (confidence >= 0.80 && confidence > bestConfidence) {
      bestConfidence = confidence;
      best = { node, confidence };
    }
  }

  return best;
}
