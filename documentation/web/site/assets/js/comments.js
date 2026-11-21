// Reader comments on text and figures, kept as GitHub issues so agents can act on them. The documentation service
// creates and closes them as the reader signed in to GitHub; without it, the reader submits a pre-filled issue.

import { $, $$, currentPage, esc, place, plural } from "./util.js";
import { flatten, locate, quoteAt } from "./annotations.js";
import { LABEL, REPO, issueBody, issueTitle, newIssueURL, parseIssue } from "./issues.js";

const ISSUES_API = `https://api.github.com/repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=100`;
const SELECTION_DELAY_MS = 250;
/** Not commentable as text: elements with an id hold live data that is re-rendered. */
const SKIP = "[id], [data-app], figure, svg, button, nav, .term-tip, .comment-ui";
const ROOTS = ".page-head, section.chapter[id]";

/** Show this page's comments and let the reader add new ones. */
export function initComments(article) {
  if (!article || !("popover" in HTMLElement.prototype)) return;
  new Comments(article).bind();
}

/** The open comments on page, or none when GitHub can't be reached. */
async function fetchComments(page) {
  try {
    // no-cache revalidates with the ETag: a 304 doesn't count against GitHub's rate limit
    const res = await fetch(ISSUES_API, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).map(parseIssue).filter((c) => c?.page === page);
  } catch (err) {
    console.warn("comments: GitHub issues unavailable:", err.message);
    return [];
  }
}

/** Whether the documentation service can act on GitHub; false without it (e.g. on GitHub Pages) or its GitHub App. */
async function canActOnGitHub() {
  try {
    const res = await fetch("api/github/status", { cache: "no-store" });
    return res.ok && (await res.json()).configured === true;
  } catch {
    return false;
  }
}

/** A JSON request to the documentation service. */
const api = (method, path, body) => fetch(path, {
  method,
  headers: body ? { "Content-Type": "application/json" } : {},
  body: body ? JSON.stringify(body) : undefined,
});

/** The page's comment UI: marks, figure buttons, the Comment button and the box. */
class Comments {
  constructor(article) {
    this.article = article;
    this.comments = [];
    this.canAct = false; // the service can create and close issues
    this.retry = null; // the request to send again once the reader has signed in
    this.box = popover("div", "comment-box", "auto");
    this.box.setAttribute("role", "dialog");
    this.box.setAttribute("aria-label", "Comments");
    this.box.tabIndex = -1;
    this.addButton = popover("button", "comment-add", "manual");
    this.addButton.type = "button";
    this.addButton.textContent = "Comment";
    this.selected = null; // {target, range} of the text selected right now
    this.target = null; // what the box's form comments on
    this.anchor = null; // what the box is placed at
    this.timer = 0;
  }

  /** Wire up the events and show the stored comments. */
  bind() {
    for (const figure of $$("figure.figure", this.article)) this.addFigureButton(figure);
    document.addEventListener("selectionchange", () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.offerSelection(), SELECTION_DELAY_MS);
    });
    this.addButton.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the selection
    this.addButton.addEventListener("click", () => this.selected && this.open([], this.selected.range, this.selected.target));
    this.article.addEventListener("click", (e) => this.onMarkClick(e));
    this.article.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && this.onMarkClick(e));
    this.box.addEventListener("click", (e) => this.onBoxClick(e));
    this.box.addEventListener("submit", (e) => this.onSubmit(e));
    this.box.addEventListener("toggle", (e) => e.newState === "closed" && this.onClose());
    // The sign-in tab says when it is done; then the request that needed it is sent again.
    new BroadcastChannel("github-sign-in").addEventListener("message", (e) => this.onSignedIn(e.data === 200));
    addEventListener("scroll", () => this.follow(), { passive: true, capture: true });
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && this.refresh());
    this.refresh();
  }

  /** Load the open comments from GitHub and show them. */
  async refresh() {
    [this.comments, this.canAct] = await Promise.all([fetchComments(currentPage()), canActOnGitHub()]);
    this.render();
  }

  /** Keep the box and the Comment button at their anchors while scrolling. */
  follow() {
    if (this.box.matches(":popover-open")) place(this.box, this.anchor);
    if (this.addButton.matches(":popover-open") && this.selected) place(this.addButton, this.selected.range);
  }

  /** Redraw marks, figure outlines and the note for lost comments. */
  render() {
    for (const mark of $$("mark.comment-mark", this.article)) unwrap(mark);
    const open = this.comments;
    const lost = open.filter((c) => !c.target.figure && !this.markText(c));
    for (const figure of $$("figure.figure", this.article)) this.paintFigure(figure, open);
    lost.push(...open.filter((c) => c.target.figure && !document.getElementById(c.target.figure)));
    this.showLost(lost);
  }

  /** Mark comment's text; false if the text is gone. */
  markText(comment) {
    const root = this.root(comment.target.section);
    const range = root && rangeOf(root, comment.target.quote);
    if (range) wrap(root, range, comment.id);
    return Boolean(range);
  }

  /** The chapter with id key, or the page head for "page-head". */
  root(key) {
    return key === "page-head" ? $(".page-head", this.article) : $(`section.chapter[id="${CSS.escape(key)}"]`, this.article);
  }

  /** Add a Comment button to figure. */
  addFigureButton(figure) {
    const key = figureKey(figure);
    if (!key) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comment-ui comment-figure";
    const section = figure.closest("section.chapter[id]")?.id || "page-head";
    button.addEventListener("click", () => this.open(this.comments.filter((c) => c.target.figure === key), button, { section, figure: key }));
    figure.append(button);
  }

  /** Outline figure and show its comment count. */
  paintFigure(figure, open) {
    const button = $(".comment-figure", figure);
    if (!button) return;
    const count = open.filter((c) => c.target.figure === figureKey(figure)).length;
    figure.classList.toggle("has-comment", count > 0);
    button.textContent = count ? plural(count, "comment") : "Comment";
  }

  /** List comments whose text or figure is gone. */
  showLost(lost) {
    $(".comment-lost", this.article)?.remove();
    if (!lost.length) return;
    const note = document.createElement("p");
    note.className = "callout warn comment-ui comment-lost";
    note.innerHTML = `${plural(lost.length, "comment")} no longer ${lost.length === 1 ? "matches" : "match"} this page. <button type="button">Show</button>`;
    $("button", note).addEventListener("click", (e) => this.open(lost, e.currentTarget));
    $(".page-head", this.article).after(note);
  }

  /** Show the Comment button under a commentable selection. */
  offerSelection() {
    const selection = getSelection();
    const range = selection.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    const root = range && $$(ROOTS, this.article).find((r) => r.contains(range.commonAncestorContainer));
    const quote = root && quoteOf(root, range);
    if (!quote) {
      this.selected = null;
      if (this.addButton.matches(":popover-open")) this.addButton.hidePopover();
      return;
    }
    this.selected = { target: { section: root.id || "page-head", quote }, range: range.cloneRange() };
    if (!this.addButton.matches(":popover-open")) this.addButton.showPopover();
    place(this.addButton, range);
  }

  /** Open the comments of the clicked mark and the marks around it. */
  onMarkClick(e) {
    const marks = ancestors(e.target, "mark.comment-mark");
    if (!marks.length || !getSelection().isCollapsed) return;
    e.preventDefault();
    e.stopPropagation(); // don't also open the term explanation
    const ids = new Set(marks.map((m) => m.dataset.comment));
    this.open(this.comments.filter((c) => ids.has(c.id)), marks.at(-1));
  }

  /** Open the box at anchor, with a form when target is given. */
  open(comments, anchor, target = null) {
    if (this.addButton.matches(":popover-open")) this.addButton.hidePopover();
    this.target = target;
    this.anchor = anchor;
    this.box.innerHTML = comments.map((c) => commentHTML(c, this.canAct)).join("") + (target ? formHTML(this.canAct) : "");
    if (!this.box.matches(":popover-open")) this.box.showPopover();
    place(this.box, anchor);
    ($("textarea", this.box) || this.box).focus({ preventScroll: true });
  }

  /** Forget the pending request and give focus back to the commented text. */
  onClose() {
    this.retry = null;
    if (document.activeElement === document.body) this.anchor?.focus?.({ preventScroll: true });
  }

  /** Cancel, Sign in, Resolve (closes the issue as completed) and Delete (closes it as not planned). */
  onBoxClick(e) {
    const action = e.target.closest("[data-action]")?.dataset.action;
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (action === "cancel") this.box.hidePopover();
    if (action === "sign-in") window.open("api/github/login", "_blank");
    if (action === "resolve") this.send(() => api("POST", `api/comments/${id}/resolve`), () => this.drop(id));
    if (action === "delete") this.send(() => api("DELETE", `api/comments/${id}`), () => this.drop(id));
  }

  /** Create the comment's issue through the service, or open GitHub's pre-filled new-issue page without it. */
  onSubmit(e) {
    e.preventDefault();
    const text = e.target.elements.body.value.trim();
    if (!text || !this.target) return;
    const page = currentPage();
    getSelection().removeAllRanges();
    if (!this.canAct) {
      window.open(newIssueURL(page, this.target, text), "_blank", "noopener");
      this.box.hidePopover();
      return;
    }
    const issue = { title: issueTitle(page, text), body: issueBody(page, this.target, text) };
    this.send(() => api("POST", "api/comments", issue), async (res) => this.add(parseIssue(await res.json())));
  }

  /** Send request; on 401 ask the reader to sign in to GitHub and send it again after; on success close and run done. */
  async send(request, done) {
    let res;
    try {
      res = await request();
    } catch {
      return this.showError("The documentation service did not answer.");
    }
    if (res.status === 401) return this.askSignIn(() => this.send(request, done));
    if (!res.ok) return this.showError((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
    this.box.hidePopover();
    await done(res);
  }

  /** Ask the reader to sign in to GitHub; retry runs once they have. */
  askSignIn(retry) {
    this.box.innerHTML = SIGN_IN;
    this.retry = retry;
    $('[data-action="sign-in"]', this.box).focus();
  }

  /** The sign-in tab finished: send the pending request again, or say it failed. */
  onSignedIn(ok) {
    const retry = this.retry;
    this.retry = null;
    if (!retry) return;
    if (ok) retry();
    else this.showError("GitHub sign-in failed.");
  }

  /** Show message at the top of the box. */
  showError(message) {
    $(".comment-error", this.box)?.remove();
    this.box.insertAdjacentHTML("afterbegin", `<p class="comment-error" role="alert">${esc(message)}</p>`);
  }

  /** Show a comment just created. */
  add(comment) {
    if (comment) this.comments.push(comment);
    this.render();
  }

  /** Stop showing comment id, now that its issue is closed. */
  drop(id) {
    this.comments = this.comments.filter((c) => c.id !== id);
    this.render();
  }
}

// One line: the box keeps line breaks (white-space: pre-wrap) for comment text.
const SIGN_IN = `<p>Sign in to GitHub once to save comments as issues in your name. GitHub opens in a new tab; your token stays in the cluster's Vault.</p>
  <div class="actions"><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="sign-in" class="primary">Sign in with GitHub</button></div>`;

/** The form for a new comment; without the service it hands the comment to GitHub's new-issue page. */
const formHTML = (canAct) => `<form><textarea name="body" rows="3" required aria-label="Your comment" placeholder="What should change?"></textarea>
  ${canAct ? "" : "<small>Opens a pre-filled GitHub issue: submit it there.</small>"}
  <div class="actions"><button type="button" data-action="cancel">Cancel</button><button type="submit" class="primary">${canAct ? "Comment" : "Create issue"}</button></div></form>`;

/** One comment in the box, with Resolve and Delete when the service can close its issue. */
const commentHTML = (c, canAct) => `<article data-id="${esc(c.id)}"><p>${esc(c.body)}</p><footer>
  <span><a href="${esc(c.url)}" target="_blank" rel="noopener">#${esc(c.id)}</a> · ${esc(c.author)} · <time datetime="${esc(c.createdAt)}">${esc(new Date(c.createdAt).toLocaleDateString())}</time></span>
  ${canAct ? '<button type="button" data-action="resolve">Resolve</button><button type="button" data-action="delete">Delete</button>' : `<a href="${esc(c.url)}" target="_blank" rel="noopener">Open issue ↗</a>`}</footer></article>`;

/** A new popover element in the page. */
function popover(tag, className, kind) {
  const el = document.createElement(tag);
  el.className = `comment-ui ${className}`;
  el.popover = kind;
  document.body.append(el);
  return el;
}

/** A figure's key: the id of its diagram. */
const figureKey = (figure) => $("[id]", figure)?.id;

/** el and its ancestors matching selector, innermost first. */
function ancestors(el, selector) {
  const found = [];
  for (let m = el.closest?.(selector); m; m = m.parentElement.closest(selector)) found.push(m);
  return found;
}

/** The commentable text nodes of root. */
function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const skip = node.parentElement.closest(SKIP);
      return skip && skip !== root && root.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

/** root's commentable text, flattened. */
function textIndex(root) {
  const nodes = textNodes(root);
  return { nodes, ...flatten(nodes.map((n) => n.data)) };
}

/** The quote of range within root, or null. */
function quoteOf(root, range) {
  const { nodes, text, at } = textIndex(root);
  const inside = (i) => range.comparePoint(nodes[at[i][0]], at[i][1]) === 0 && range.comparePoint(nodes[at[i][0]], at[i][1] + 1) === 0;
  const first = at.findIndex((_, i) => inside(i));
  const last = at.findLastIndex((_, i) => inside(i));
  return first === -1 ? null : quoteAt(text, first, last + 1);
}

/** The range of quote within root, or null. */
function rangeOf(root, quote) {
  const { nodes, text, at } = textIndex(root);
  const found = locate(text, quote);
  if (!found) return null;
  const range = document.createRange();
  range.setStart(nodes[at[found.start][0]], at[found.start][1]);
  range.setEnd(nodes[at[found.end - 1][0]], at[found.end - 1][1] + 1);
  return range;
}

/** Wrap range's text in marks for comment id. */
function wrap(root, range, id) {
  const parts = textNodes(root).filter((n) => range.intersectsNode(n)).map((node) => ({
    node,
    start: node === range.startContainer ? range.startOffset : 0,
    end: node === range.endContainer ? range.endOffset : node.length,
  }));
  parts.filter((p) => p.node.data.slice(p.start, p.end).trim()).forEach(({ node, start, end }, i) => {
    if (end < node.length) node.splitText(end);
    const text = start > 0 ? node.splitText(start) : node;
    const mark = document.createElement("mark");
    mark.className = "comment-mark";
    mark.dataset.comment = id;
    if (i === 0) {
      mark.tabIndex = 0;
      mark.setAttribute("aria-haspopup", "dialog");
    }
    text.replaceWith(mark);
    mark.append(text);
  });
}

/** Remove mark, keeping its text. */
function unwrap(mark) {
  const parent = mark.parentNode;
  mark.replaceWith(...mark.childNodes);
  parent.normalize();
}
