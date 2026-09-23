import test from "node:test";
import assert from "node:assert/strict";
import {
  rewriteScope,
  tagMismatchMessage,
  versionRequiredByRef,
} from "../publish-npm-lib.mjs";

test("push and pull requests do not require an npm version", () => {
  assert.equal(versionRequiredByRef("branch", "refs/heads/main"), null);
  assert.equal(versionRequiredByRef(undefined, undefined), null);
  assert.equal(versionRequiredByRef("tag", "v1.2.3"), null);
  assert.equal(tagMismatchMessage(null, { "api-types": "0.1.0", "agent-loop": "0.2.0" }), null);
});

test("npm-v tag must match every package version", () => {
  assert.equal(versionRequiredByRef("tag", "npm-v0.4.0"), "0.4.0");
  assert.equal(
    tagMismatchMessage("0.4.0", { "api-types": "0.4.0", "agent-loop": "0.4.0" }),
    null,
  );
  assert.match(
    tagMismatchMessage("0.4.0", { "api-types": "0.4.0", "agent-loop": "0.3.0" }),
    /packages\/agent-loop version 0\.3\.0/,
  );
});

test("rewriteScope only renames the workspace scope", () => {
  assert.equal(rewriteScope("@ppeng/agent-loop"), "@mage-ai-lab/agent-loop");
  assert.equal(
    rewriteScope('import "@ppeng/api-types";'),
    'import "@mage-ai-lab/api-types";',
  );
});
