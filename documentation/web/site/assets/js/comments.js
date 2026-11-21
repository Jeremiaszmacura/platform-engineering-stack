// Reader comments on text and figures, kept in localStorage so the service stays read-only.

import { $, $$, currentPage, esc, place, plural } from "./util.js";
import { flatten, locate, quoteAt } from "./annotations.js";

const STORAGE_KEY = "doc-comments";
const SELECTION_DELAY_MS = 250;
/** Not commentable as text: elements with an id hold live data that is re-rendered. */
const SKIP = "[id], [data-app], figure, svg, button, nav, .term-tip, .comment-ui";
const ROOTS = ".page-head, section.chapter[id]";

/** Show this page's comments and let the reader add, resolve and delete them. */
export function initComments(article) {
  if (!article || !("popover" in HTMLElement.prototype)) return;
  new Comments(article, new CommentStore(currentPage())).bind();
}

/** All comments of the site, in localStorage. */
class CommentStore {
  constructor(page) {
    this.page = page;
    this.reload();
  }

  /** Re-read the comments from storage. */
  reload() {
    this.all = readStorage();
  }

  /** This page's unresolved comments. */
  open() {
    return this.all.filter((c) => c.page === this.page && !c.resolved);
  }

  /** Save a comment on target: {section, quote} or {figure}. */
  add(target, body) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.all.push({ id, page: this.page, target, body, createdAt: new Date().toISOString(), resolved: false });
    this.save();
  }

  /** Resolve a comment: kept, but hidden. */
  resolve(id) {
    const comment = this.all.find((c) => c.id === id);
    if (comment) comment.resolved = true;
    this.save();
  }

  /** Delete a comment. */
  remove(id) {
    this.all = this.all.filter((c) => c.id !== id);
    this.save();
  }

  /** Write the comments to localStorage. */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.all));
    } catch {
      // Storage blocked: comments last for this page view.
    }
  }
}

/** The stored comments, skipping invalid entries. */
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

/** The page's comment UI: marks, figure buttons, the Comment button and the box. */
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
    this.box.addEventListener("toggle", (e) => e.newState === "closed" && document.activeElement === document.body && this.anchor?.focus?.({ preventScroll: true }));
    addEventListener("scroll", () => this.follow(), { passive: true, capture: true });
    addEventListener("storage", (e) => e.key === STORAGE_KEY && (this.store.reload(), this.render()));
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
    const open = this.store.open();
    const lost = open.filter((c) => c.target.section && !this.markText(c));
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
    button.addEventListener("click", () => this.open(this.store.open().filter((c) => c.target.figure === key), button, { figure: key }));
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
    this.open(this.store.open().filter((c) => ids.has(c.id)), marks.at(-1));
  }

  /** Open the box at anchor, with a form when target is given. */
  open(comments, anchor, target = null) {
    if (this.addButton.matches(":popover-open")) this.addButton.hidePopover();
    this.target = target;
    this.anchor = anchor;
    this.box.innerHTML = comments.map(commentHTML).join("") + (target ? FORM : "");
    if (!this.box.matches(":popover-open")) this.box.showPopover();
    place(this.box, anchor);
    ($("textarea", this.box) || this.box).focus({ preventScroll: true });
  }

  /** Handle Resolve, Delete and Cancel. */
  onBoxClick(e) {
    const action = e.target.closest("[data-action]")?.dataset.action;
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (action === "resolve") this.store.resolve(id);
    if (action === "delete") this.store.remove(id);
    if (!action) return;
    this.box.hidePopover();
    this.render();
  }

  /** Save the new comment. */
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

/** One comment in the box. */
const commentHTML = (c) => `<article data-id="${esc(c.id)}"><p>${esc(c.body)}</p><footer>
  <time datetime="${esc(c.createdAt)}">${esc(new Date(c.createdAt).toLocaleString())}</time>
  <button type="button" data-action="resolve">Resolve</button><button type="button" data-action="delete">Delete</button></footer></article>`;

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
