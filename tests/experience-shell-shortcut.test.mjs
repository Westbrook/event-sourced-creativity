import assert from "node:assert/strict";
import { test } from "node:test";
import { experienceShellShortcut } from "../src/experiences/shell-shortcut.ts";

test("experience shortcuts cannot open commands or mutate document history", () => {
  for (const key of ["k", "K", "z", "Z"]) {
    for (const shift of [false, true]) {
      assert.equal(experienceShellShortcut(true, key, true, false, shift), "suppress");
    }
  }
});

test("editable controls retain native undo and redo in either shell mode", () => {
  for (const restricted of [false, true]) {
    for (const shift of [false, true]) {
      assert.equal(experienceShellShortcut(restricted, "z", true, true, shift), "none");
    }
  }
  assert.equal(experienceShellShortcut(true, "k", true, true, false), "suppress");
});

test("full Forma keeps command and authored-history shortcuts", () => {
  assert.equal(experienceShellShortcut(false, "k", true, false, false), "commands");
  assert.equal(experienceShellShortcut(false, "K", true, true, false), "commands");
  assert.equal(experienceShellShortcut(false, "z", true, false, false), "undo");
  assert.equal(experienceShellShortcut(false, "Z", true, false, true), "redo");
});

test("Escape, typing and other shortcuts remain with their existing handlers", () => {
  for (const restricted of [false, true]) {
    for (const key of ["Escape", "Tab", "ArrowLeft", "Enter", "Process", "a"]) {
      assert.equal(experienceShellShortcut(restricted, key, true, false, false), "none");
    }
    assert.equal(experienceShellShortcut(restricted, "k", false, false, false), "none");
    assert.equal(experienceShellShortcut(restricted, "z", false, false, true), "none");
  }
});
