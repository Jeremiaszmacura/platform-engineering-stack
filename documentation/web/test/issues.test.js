import assert from "node:assert/strict";
import { test } from "node:test";

import { LABEL, issueBody, newIssueURL, parseIssue } from "../site/assets/js/issues.js";

const QUOTE = { section: "volumes", quote: { exact: "provisioner", prefix: "the local-path ", suffix: ": the volume" } };

/** An issue as the GitHub API returns it, with the CRLF line ends of its web form. */
const issue = (body, extra = {}) => ({
  number: 7, html_url: "https://github.com/o/r/issues/7", user: { login: "me" }, created_at: "2026-11-21T10:00:00Z",
  body: body.replaceAll("\n", "\r\n"), ...extra,
});

test("a new issue is pre-filled with the label, a short title and the comment", () => {
  const url = new URL(newIssueURL("state.html", QUOTE, "Link the repo here.\nIt helps."));
  assert.equal(url.searchParams.get("labels"), `documentation,${LABEL}`);
  assert.equal(url.searchParams.get("title"), "docs(state.html): Link the repo here.");
  assert.match(url.searchParams.get("body"), /^Link the repo here\.\nIt helps\.\n/);
  const long = new URL(newIssueURL("state.html", QUOTE, "x".repeat(200))).searchParams.get("title");
  assert.equal(long.length, 80);
});

test("an issue body tells agents the file and quote, and parses back to the comment", () => {
  const body = issueBody("state.html", QUOTE, "Link the repo here.\nIt helps.");
  assert.match(body, /> provisioner/);
  assert.match(body, /File: `documentation\/web\/site\/state\.html`, section `#volumes`/);
  const comment = parseIssue(issue(body));
  assert.deepEqual(comment, {
    id: "7", url: "https://github.com/o/r/issues/7", author: "me", createdAt: "2026-11-21T10:00:00Z",
    page: "state.html", target: QUOTE, body: "Link the repo here.\r\nIt helps.",
  });
});

test("a figure comment round-trips", () => {
  const target = { section: "volumes", figure: "pvc-chain" };
  assert.deepEqual(parseIssue(issue(issueBody("state.html", target, "Show nodes."))).target, target);
});

test("issues without a valid anchor, and pull requests, are not comments", () => {
  assert.equal(parseIssue(issue("Just an issue")), null);
  assert.equal(parseIssue(issue("x\n```json doc-comment\n{not json\n```")), null);
  assert.equal(parseIssue(issue('x\n```json doc-comment\n{"page":"a.html","section":"s"}\n```')), null);
  assert.equal(parseIssue(issue(issueBody("state.html", QUOTE, "c"), { pull_request: {} })), null);
  assert.equal(parseIssue({ number: 1, body: null }), null);
});
