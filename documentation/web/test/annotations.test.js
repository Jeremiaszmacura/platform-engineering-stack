import assert from "node:assert/strict";
import { test } from "node:test";

import { flatten, locate, quoteAt } from "../site/assets/js/annotations.js";

test("flatten collapses whitespace across chunks and maps each character back to its chunk", () => {
  const { text, at } = flatten(["  A pod\n    asks ", " for", "\tstorage."]);
  assert.equal(text, "A pod asks for storage.");
  assert.deepEqual(at[0], [0, 2]);
  assert.deepEqual(at[text.indexOf("for")], [1, 1]);
  assert.deepEqual(at[text.indexOf("storage")], [2, 1]);
  assert.equal(at.length, text.length);
});

test("quoteAt trims spaces and keeps context on both sides", () => {
  const text = "The class creates the volume only after the scheduler has picked a node.";
  const start = text.indexOf("volume") - 1;
  const quote = quoteAt(text, start, start + " volume ".length);
  assert.equal(quote.exact, "volume");
  assert.equal(quote.prefix, "The class creates the ");
  assert.equal(quote.suffix, " only after the scheduler has pi");
  assert.equal(quoteAt(text, 3, 4), null);
});

test("locate tells repeated text apart by its context", () => {
  const text = "a PVC is a claim. Deleting the PVC deletes the directory.";
  const second = text.lastIndexOf("PVC");
  const quote = quoteAt(text, second, second + 3);
  assert.deepEqual(locate(text, quote), { start: second, end: second + 3 });
});

test("locate still finds a quote after the text around it changes", () => {
  const before = flatten(["Pods are ephemeral;\n    data is not."]).text;
  const quote = quoteAt(before, before.indexOf("data"), before.length);
  const after = flatten(["Containers come and go. Pods are ephemeral; data is not."]).text;
  assert.equal(after.slice(locate(after, quote).start), "data is not.");
});

test("locate returns null when the quoted text is gone or the quote is empty", () => {
  assert.equal(locate("nothing here", { exact: "PVC", prefix: "", suffix: "" }), null);
  assert.equal(locate("text", { exact: "", prefix: "", suffix: "" }), null);
  assert.equal(locate("text", null), null);
});
