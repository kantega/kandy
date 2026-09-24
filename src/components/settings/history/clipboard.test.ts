// Standalone assert check (no JS unit-test runner in this repo). Run with:
//   bun src/components/settings/history/clipboard.test.ts

import assert from "node:assert";
import { copyToClipboard, type ClipboardWriter } from "./clipboard";

const writer = (impl: (text: string) => Promise<void>): ClipboardWriter => ({
  writeText: impl,
});

const run = async () => {
  let written: string | null = null;
  const ok = await copyToClipboard(
    "hei",
    writer(async (text) => {
      written = text;
    }),
  );
  assert.strictEqual(ok, true, "a successful write reports success");
  assert.strictEqual(written, "hei", "the text reaches the clipboard");

  const failed = await copyToClipboard(
    "hei",
    writer(async () => {
      throw new Error("denied");
    }),
  );
  assert.strictEqual(failed, false, "a rejected write reports failure");

  console.log("clipboard.test.ts: all assertions passed");
};

run();
