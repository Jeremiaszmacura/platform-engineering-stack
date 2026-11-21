// Reader comments on the page's text and figures. Select text, or use a figure's Comment button, to write one;
// commented text turns yellow and shows its comments on click, where they can be resolved or deleted.
// Comments are kept in this browser's localStorage, so the documentation service stays read-only.

import { $, $$, currentPage, esc, place, plural } from "./util.js";
import { flatten, locate, quoteAt } from "./annotations.js";

const STORAGE_KEY = "doc-comments";
const SELECTION_DELAY_MS = 250;
/** Text inside these can't be commented: elements with an id are filled by the page's script with live data. */
const SKIP = "[id], [data-app], figure, svg, button, nav, .term-tip, .comment-ui";
const ROOTS = ".page-head, section.chapter[id]";

/** Mark this page's comments in article and let the reader add, resolve and delete them. */
export function initComments(article) {
  if (!article || !("popover" in HTMLElement.prototype)) return;
  new Comments(article, new CommentStore(currentPage())).bind();
}

/** Every comment of the site, kept in localStorage; when storage is blocked they last until the page is left. */
class CommentStore {
  constructor(page) {
    this.page = page;
    this.reload();
  }

  /** Read the comments again, e.g. after another tab changed them. */
  reload() {
    this.all = readStorage();
  }

  /** This page's comments that are not resolved, oldest first. */
  open() {
    return this.all.filter((c) => c.page === this.page && !c.resolved);
  }

  /** Save a new comment with body on target: {section, quote} for text, {figure} for a figure. */
  add(target, body) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.all.push({ id, page: this.page, target, body, createdAt: new Date().toISOString(), resolved: false });
    this.save();
  }

  /** Mark comment id resolved: it stays stored but no longer shows. */
  resolve(id) {
    const comment = this.all.find((c) => c.id === id);
    if (comment) comment.resolved = true;
    this.save();
  }

  /** Delete comment id. */
  remove(id) {
    this.all = this.all.filter((c) => c.id !== id);
    this.save();
  }

  /** Write every comment back to localStorage. */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.all));
    } catch {
      // Storage is blocked or full: the comments last for this page view only.
    }
  }
}

/** The stored comments, skipping any entry that isn't a comment. */
function readStorage() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list.filter(isComment) : [];
  } catch {
    return [];
  }
}

const isComment = (c) => typeof c?.id === "string" && typeof c.page === "string" && typeof c.body === "string"
  && (typeof c.target?.figure === "string" || (typeof c.target?.section === "string" && typeof c.target.quote?.exact === "string"));

/** The page's comments: the marks and figure buttons that show them, the Comment button and the comment box. */
class Comments {
  constructor(article, store) {
    this.article = article;
    this.store = store;
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

  /** Add the figure buttons, listen for selections, clicks and other tabs, and show the stored comments. */
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
    // Back to the commented text when the box closes with the focus in it.
    this.box.addEventListener("toggle", (e) => e.newState === "closed" && document.activeElement === document.body && this.anchor?.focus?.({ preventScroll: true }));
    addEventListener("scroll", () => this.follow(), { passive: true, capture: true });
    addEventListener("storage", (e) => e.key === STORAGE_KEY && (this.store.reload(), this.render()));
    this.render();
  }

  /** Keep the box and the Comment button next to what they belong to while the page scrolls. */
  follow() {
    if (this.box.matches(":popover-open")) place(this.box, this.anchor);
    if (this.addButton.matches(":popover-open") && this.selected) place(this.addButton, this.selected.range);
  }

  /** Show the stored comments: yellow marks on text, an outline and a count on figures, and a note for lost ones. */
  render() {
    for (const mark of $$("mark.comment-mark", this.article)) unwrap(mark);
    const open = this.store.open();
    const lost = open.filter((c) => c.target.section && !this.markText(c));
    for (const figure of $$("figure.figure", this.article)) this.paintFigure(figure, open);
    lost.push(...open.filter((c) => c.target.figure && !document.getElementById(c.target.figure)));
    this.showLost(lost);
  }

  /** Mark comment's quote in its section; false when the quoted text is no longer there. */
  markText(comment) {
    const root = this.root(comment.target.section);
    const range = root && rangeOf(root, comment.target.quote);
    if (range) wrap(root, range, comment.id);
    return Boolean(range);
  }

  /** The commentable part of the page that key names: a chapter's id, or "page-head". */
  root(key) {
    return key === "page-head" ? $(".page-head", this.article) : $(`section.chapter[id="${CSS.escape(key)}"]`, this.article);
  }

  /** Give figure a Comment button, if it holds a diagram with an id to anchor to. */
  addFigureButton(figure) {
    const key = figureKey(figure);
    if (!key) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "comment-ui comment-figure";
    button.addEventListener("click", () => this.open(this.store.open().filter((c) => c.target.figure === key), button, { figure: key }));
    figure.append(button);
  }

  /** Outline figure in yellow and count its comments on its button when it has any. */
  paintFigure(figure, open) {
    const button = $(".comment-figure", figure);
    if (!button) return;
    const count = open.filter((c) => c.target.figure === figureKey(figure)).length;
    figure.classList.toggle("has-comment", count > 0);
    button.textContent = count ? plural(count, "comment") : "Comment";
  }

  /** A note under the page's head listing the comments whose text or figure is gone, so they can be resolved. */
  showLost(lost) {
    $(".comment-lost", this.article)?.remove();
    if (!lost.length) return;
    const note = document.createElement("p");
    note.className = "callout warn comment-ui comment-lost";
    note.innerHTML = `${plural(lost.length, "comment")} no longer ${lost.length === 1 ? "matches" : "match"} this page. <button type="button">Show</button>`;
    $("button", note).addEventListener("click", (e) => this.open(lost, e.currentTarget));
    $(".page-head", this.article).after(note);
  }

  /** Offer the Comment button under the selected text, when it is commentable. */
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

  /** A click or Enter on commented text shows its comments (all of them, when comments overlap). */
  onMarkClick(e) {
    const marks = ancestors(e.target, "mark.comment-mark");
    if (!marks.length || !getSelection().isCollapsed) return;
    e.preventDefault();
    e.stopPropagation(); // the term explanation, if the mark holds a term, waits for the box to close
    const ids = new Set(marks.map((m) => m.dataset.comment));
    this.open(this.store.open().filter((c) => ids.has(c.id)), marks.at(-1));
  }

  /** Show comments in the box at anchor, with a form for a new comment on target when given. */
  open(comments, anchor, target = null) {
    if (this.addButton.matches(":popover-open")) this.addButton.hidePopover();
    this.target = target;
    this.anchor = anchor;
    this.box.innerHTML = comments.map(commentHTML).join("") + (target ? FORM : "");
    if (!this.box.matches(":popover-open")) this.box.showPopover();
    place(this.box, anchor);
    ($("textarea", this.box) || this.box).focus({ preventScroll: true });
  }

  /** Resolve, Delete and Cancel in the box. */
  onBoxClick(e) {
    const action = e.target.closest("[data-action]")?.dataset.action;
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (action === "resolve") this.store.resolve(id);
    if (action === "delete") this.store.remove(id);
    if (!action) return;
    this.box.hidePopover();
    this.render();
  }

  /** Save the new comment and show it. */
  onSubmit(e) {
    e.preventDefault();
    const body = e.target.elements.body.value.trim();
    if (!body || !this.target) return;
    this.store.add(this.target, body);
    this.box.hidePopover();
    getSelection().removeAllRanges();
    this.render();
  }
}

const FORM = `<form><textarea name="body" rows="3" required aria-label="Your comment" placeholder="Add a comment"></textarea>
  <div class="actions"><button type="button" data-action="cancel">Cancel</button><button type="submit">Comment</button></div></form>`;

/** One comment in the box, with its date and actions. */
const commentHTML = (c) => `<article data-id="${esc(c.id)}"><p>${esc(c.body)}</p><footer>
  <time datetime="${esc(c.createdAt)}">${esc(new Date(c.createdAt).toLocaleString())}</time>
  <button type="button" data-action="resolve">Resolve</button><button type="button" data-action="delete">Delete</button></footer></article>`;

/** A popover element of the given kind ("auto" closes on Escape and outside clicks), added to the page. */
function popover(tag, className, kind) {
  const el = document.createElement(tag);
  el.className = `comment-ui ${className}`;
  el.popover = kind;
  document.body.append(el);
  return el;
}

/** A figure is identified by the first element with an id inside it, which its script draws into. */
const figureKey = (figure) => $("[id]", figure)?.id;

/** el and its ancestors that match selector, innermost first. */
function ancestors(el, selector) {
  const found = [];
  for (let m = el.closest?.(selector); m; m = m.parentElement.closest(selector)) found.push(m);
  return found;
}

/** The text nodes of root that can be commented, in document order. */
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

/** The commentable text of root, flattened, with the text nodes it came from. */
function textIndex(root) {
  const nodes = textNodes(root);
  return { nodes, ...flatten(nodes.map((n) => n.data)) };
}

/** The quote for the commentable text range covers in root, or null when it covers none. */
function quoteOf(root, range) {
  const { nodes, text, at } = textIndex(root);
  const inside = (i) => range.comparePoint(nodes[at[i][0]], at[i][1]) === 0 && range.comparePoint(nodes[at[i][0]], at[i][1] + 1) === 0;
  const first = at.findIndex((_, i) => inside(i));
  const last = at.findLastIndex((_, i) => inside(i));
  return first === -1 ? null : quoteAt(text, first, last + 1);
}

/** The range quote covers in root today, or null when its text is gone. */
function rangeOf(root, quote) {
  const { nodes, text, at } = textIndex(root);
  const found = locate(text, quote);
  if (!found) return null;
  const range = document.createRange();
  range.setStart(nodes[at[found.start][0]], at[found.start][1]);
  range.setEnd(nodes[at[found.end - 1][0]], at[found.end - 1][1] + 1);
  return range;
}

/** Wrap the commentable text of range in yellow marks for comment id; the first one takes keyboard focus. */
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

/** Put mark's text back where the mark was. */
function unwrap(mark) {
  const parent = mark.parentNode;
  mark.replaceWith(...mark.childNodes);
  parent.normalize();
}
