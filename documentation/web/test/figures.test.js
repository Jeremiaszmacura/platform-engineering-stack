import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const SITE = new URL("../site/", import.meta.url);
const pages = readdirSync(SITE).filter((name) => name.endsWith(".html"));

test("every figure says whether it is live or an example", () => {
  for (const page of pages) {
    const figures = readFileSync(new URL(page, SITE), "utf8").match(/<[a-z]+ class="figure"[^>]*>/g) || [];
    for (const figure of figures) assert.match(figure, /data-source="(live|example)"/, `${page}: ${figure}`);
  }
});
