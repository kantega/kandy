// Standalone assert check (no JS unit-test runner in this repo). Run with:
//   bun src/lib/utils/keyboard.test.ts

import assert from "node:assert/strict";
import { formatKeyCombination, getKeyName } from "./keyboard";

const keyboardEvent = (value: { code?: string; key?: string }): KeyboardEvent =>
  value as KeyboardEvent;

// Stored name must be the compact token handy-keys parses; the display label
// keeps the spaces.
const compoundKeys = [
  ["ScrollLock", "scrolllock", "Scroll Lock"],
  ["CapsLock", "capslock", "Caps Lock"],
  ["NumLock", "numlock", "Num Lock"],
  ["PageUp", "pageup", "Page Up"],
  ["PageDown", "pagedown", "Page Down"],
  ["PrintScreen", "printscreen", "Print Screen"],
] as const;

for (const [code, stored, displayed] of compoundKeys) {
  assert.equal(getKeyName(keyboardEvent({ code })), stored);
  assert.equal(formatKeyCombination(stored, "macos"), displayed);
}

assert.equal(getKeyName(keyboardEvent({ key: "CapsLock" })), "capslock");
assert.equal(
  getKeyName(keyboardEvent({ code: "AudioVolumeUp" })),
  "audiovolumeup",
);

console.log("keyboard.test.ts: all assertions passed");
