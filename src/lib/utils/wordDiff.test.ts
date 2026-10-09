// Standalone assert check (no JS unit-test runner in this repo). Run with:
//   bun src/lib/utils/wordDiff.test.ts

import assert from "node:assert/strict";
import { diffWords } from "./wordDiff";

const flagged = (side: { text: string; differs: boolean }[]) =>
  side.filter((w) => w.differs).map((w) => w.text);

// Identical text, ignoring case and punctuation, has no differences.
{
  const r = diffWords("Hei, jeg heter Nora.", "hei jeg heter Nora");
  assert.equal(r.differing, 0);
}

// A substituted word is flagged on both sides.
{
  const r = diffWords(
    "starte eval av lykke setting med kundeservice",
    "starte evalueringen med kundeservice",
  );
  assert.deepEqual(flagged(r.a), ["eval", "av", "lykke", "setting"]);
  assert.deepEqual(flagged(r.b), ["evalueringen"]);
  assert.equal(r.differing, 5);
}

// Empty input on one side flags every word on the other.
{
  const r = diffWords("", "en to tre");
  assert.equal(r.a.length, 0);
  assert.equal(r.differing, 3);
}

console.log("wordDiff: all checks passed");
