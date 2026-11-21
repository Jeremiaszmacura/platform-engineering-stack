// Doc comments are GitHub issues: the comment, then a JSON block that anchors it in the page.

export const REPO = "Jeremiaszmacura/platform-engineering-stack";
export const LABEL = "docs-feedback";
/** Every comment issue has these labels; the backend sets the same ones. */
const LABELS = ["documentation", LABEL];
const SITE_DIR = "documentation/web/site";
const TITLE_MAX = 80;
// GitHub stores bodies sent from its web form with CRLF. The last match counts: the reader's text comes first.
const SEPARATOR = /\r?\n\r?\n---\r?\n/g;
const ANCHOR = /```json doc-comment\r?\n([\s\S]*?)\r?\n```/g;

/** The GitHub page that opens a new issue pre-filled with comment on target of page. */
export function newIssueURL(page, target, comment) {
  const params = new URLSearchParams({ title: issueTitle(page, comment), body: issueBody(page, target, comment), labels: LABELS.join(",") });
  return `https://github.com/${REPO}/issues/new?${params}`;
}

/** "docs(page): first line of the comment", shortened to TITLE_MAX. */
export function issueTitle(page, comment) {
  const title = `docs(${page}): ${unmention(comment.split("\n")[0])}`;
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/** The comment, what and where it is about, and the anchor for the site. */
export function issueBody(page, target, comment) {
  const what = target.figure ? `Figure \`#${target.figure}\`` : `> ${unmention(target.quote.exact)}`;
  const anchor = JSON.stringify({ page, ...target });
  return `${unmention(comment)}\n\n---\n${what}\n\nFile: \`${SITE_DIR}/${page}\`, section \`#${target.section}\`\n\n\`\`\`json doc-comment\n${anchor}\n\`\`\``;
}

/** The doc comment an open issue holds, or null when it holds none. */
export function parseIssue(issue) {
  const match = !issue.pull_request && [...(issue.body ?? "").matchAll(ANCHOR)].at(-1);
  if (!match) return null;
  try {
    const { page, ...target } = JSON.parse(match[1]);
    if (typeof page !== "string" || !isTarget(target)) return null;
    const body = issue.body.slice(0, [...issue.body.matchAll(SEPARATOR)].at(-1)?.index).trim();
    return { id: String(issue.number), url: issue.html_url, author: issue.user?.login ?? "", createdAt: issue.created_at, page, target, body };
  } catch {
    return null;
  }
}

/** text with a zero-width space after each "@", so GitHub notifies nobody it names. */
const unmention = (text) => text.replaceAll("@", "@\u200b");

/** Whether target names a section and either a figure or a quote. */
const isTarget = (t) => typeof t.section === "string" && (typeof t.figure === "string" || typeof t.quote?.exact === "string");
