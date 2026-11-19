import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { TERMS, findTerm } from "../site/assets/js/glossary.js";

const SITE = new URL("../site/", import.meta.url);

/** The text of every page, without markup and without code, which is never marked. */
function siteText() {
  return readdirSync(SITE).filter((name) => name.endsWith(".html"))
    .map((name) => readFileSync(new URL(name, SITE), "utf8"))
    .join(" ")
    .replace(/<(pre|code)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/** The id of the first term mentioned in text, or null. */
const firstTerm = (text, skip) => findTerm(text, new Set(skip))?.term.id ?? null;

/** All-caps words that aren't abbreviations: query keywords, HTTP and API verbs, stock tickers, a product name. */
const NOT_ABBREVIATIONS = new Set(["ALL", "AND", "OR", "GET", "LIST", "SELECT", "AAPL", "AMZN", "GOOGL", "MSFT", "NVDA", "NGINX"]);

test("every term is explained in two to four sentences, with a link to the Kubernetes docs", () => {
  for (const term of TERMS.filter((t) => t.text)) {
    const sentences = term.text.split(/(?<=[.!?])\s+/).length;
    assert.ok(sentences >= 2 && sentences <= 4, `${term.id}: ${sentences} sentences`);
    assert.match(term.url, /^https:\/\/kubernetes\.io\/docs\/[\w/#-]+$/, term.id);
  }
});

test("every entry has an explanation or a full form", () => {
  for (const term of TERMS) assert.ok(term.text || term.full, term.id);
});

test("every abbreviation on the site has its full form", () => {
  const words = new Set(siteText().match(/(?<!\w)[A-Z][A-Z0-9]+(?=s?(?!\w))/g));
  const missing = [...words].filter((w) => !NOT_ABBREVIATIONS.has(w) && !TERMS.some((t) => t.pattern.test(w)));
  assert.deepEqual(missing, [], "add these to glossary.js");
});

test("term ids are unique", () => {
  assert.equal(new Set(TERMS.map((t) => t.id)).size, TERMS.length);
});

test("every term is used somewhere on the site", () => {
  const text = siteText();
  for (const term of TERMS) assert.ok(term.pattern.test(text), `${term.id} appears on no page`);
});

test("a term is found as a whole word, with its plural and its usual spellings", () => {
  assert.equal(firstTerm("two pods run"), "pod");
  assert.equal(firstTerm("Every Node"), "node");
  assert.equal(firstTerm("its own service account"), "serviceaccount");
  assert.equal(firstTerm("its ServiceAccount"), "serviceaccount");
  assert.equal(firstTerm("a ClusterRoleBinding"), "rolebinding");
  assert.equal(firstTerm("a ClusterRole"), "role");
  assert.equal(firstTerm("a 2Gi PVC"), "pvc");
  assert.equal(firstTerm("the Gateway API"), "gateway-api");
  assert.equal(firstTerm("an init container"), "init-container");
  assert.equal(firstTerm("it was OOM-killed"), "OOM");
  assert.equal(firstTerm("two IPs"), "IP");
  assert.equal(firstTerm("the API server"), "api-server");
});

test("an abbreviation inside a longer name is not marked", () => {
  assert.equal(firstTerm("an HTTPRoute"), "httproute");
  assert.equal(firstTerm("IPVS rules"), "IPVS");
  assert.equal(firstTerm("SNAT"), "SNAT");
  assert.equal(firstTerm("SQLite and DNSCache"), null);
});

test("a longer name or a different meaning is not a term", () => {
  assert.equal(firstTerm("node-exporter"), null);
  assert.equal(firstTerm("Node.js 24"), null);
  assert.equal(firstTerm("the stock-app service"), null);
  assert.equal(firstTerm("Envoy Gateway"), null);
  assert.equal(firstTerm("the Prometheus job"), null);
  assert.equal(firstTerm("the kustomization file"), null);
  assert.equal(firstTerm("an init container", ["init-container"]), null);
});

test("the earliest mention wins, and skipped terms are passed over", () => {
  assert.equal(firstTerm("a Service selects pods"), "service");
  assert.equal(firstTerm("a Service selects pods", ["service"]), "pod");
  const found = findTerm("one NodePort here");
  assert.deepEqual({ id: found.term.id, index: found.index, length: found.length }, { id: "nodeport", index: 4, length: 8 });
});
