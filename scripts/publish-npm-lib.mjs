/** Pure helpers for npm publish. No registry calls. */

export const SCOPE_FROM = "@ppeng/";
export const SCOPE_TO = "@mage-ai-lab/";

export function rewriteScope(text) {
  return text.split(SCOPE_FROM).join(SCOPE_TO);
}

/**
 * Version required by the current Git ref.
 * Push, PR, and non-npm tags return null (publish is not gated).
 * Tag `npm-v<version>` returns that version.
 */
export function versionRequiredByRef(refType, refName) {
  if (refType !== "tag") return null;
  const tag = refName ?? "";
  if (!tag.startsWith("npm-v")) return null;
  const expected = tag.slice("npm-v".length);
  return expected || null;
}

/** Null when the tag matches every package version. */
export function tagMismatchMessage(expected, versions) {
  if (expected == null) return null;
  for (const [name, version] of Object.entries(versions)) {
    if (version !== expected) {
      return `tag npm-v${expected} does not match packages/${name} version ${version}`;
    }
  }
  return null;
}
