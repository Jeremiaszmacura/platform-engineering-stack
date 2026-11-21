// Kubernetes terms in the text explain themselves: hover, focus or tap the first mention in each section.

import { $$, esc, place } from "./util.js";
import { TERMS, findTerm } from "./glossary.js";

/** Text inside these is never marked: code, links, headings, navigation and controls. */
const SKIP = "a, code, pre, kbd, h1, h2, h3, h4, button, svg, nav, .eyebrow, .term, .term-tip";
const SHOW_DELAY_MS = 120;
const HIDE_DELAY_MS = 250;

/** Mark the terms in article's static text and wire up the explanation box. */
export function explainTerms(article) {
  if (!article || !("popover" in HTMLElement.prototype)) return;
  for (const section of $$(".page-head, section.chapter", article)) markSection(section);
  new TermTip().bind();
}

/** Wrap the first mention of every term within section. */
function markSection(section) {
  const seen = new Set();
  for (const node of textNodes(section)) markText(node, seen);
}

/** The text nodes of root that may hold a term, in document order. */
function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

/** Wrap every term in the text node that seen doesn't hold yet, and add it to seen. */
function markText(node, seen) {
  let rest = node;
  for (let found = findTerm(rest.data, seen); found; found = findTerm(rest.data, seen)) {
    seen.add(found.term.id);
    const mention = rest.splitText(found.index);
    rest = mention.splitText(found.length);
    mention.replaceWith(termElement(found.term, mention.data));
  }
}

/** The marked mention: focusable, so keyboard users get the explanation too. */
function termElement(term, text) {
  const el = document.createElement("span");
  el.className = "term";
  el.tabIndex = 0;
  el.dataset.term = term.id;
  el.textContent = text;
  return el;
}

/** The one explanation box, shared by every term on the page: shows for the term under the pointer or focus. */
class TermTip {
  constructor() {
    this.box = document.createElement("div");
    this.box.className = "term-tip";
    this.box.id = "term-tip";
    this.box.popover = "manual";
    this.current = null;
    this.timer = 0;
  }

  /** Listen for the pointer, focus and keys anywhere on the page. */
  bind() {
    document.addEventListener("pointerover", (e) => this.onPointerOver(e));
    document.documentElement.addEventListener("mouseleave", () => this.later(() => this.hide(), HIDE_DELAY_MS));
    document.addEventListener("click", (e) => termAt(e.target) && this.show(termAt(e.target)));
    document.addEventListener("pointerdown", (e) => !termAt(e.target) && !this.box.contains(e.target) && this.hide());
    document.addEventListener("focusin", (e) => this.onFocus(e));
    document.addEventListener("keydown", (e) => e.key === "Escape" && this.dismiss());
    addEventListener("scroll", () => this.current && place(this.box, this.current), { passive: true, capture: true });
    addEventListener("resize", () => this.current && place(this.box, this.current));
  }

  /** A mouse over a term opens its box after a moment; leaving both the term and the box closes it. */
  onPointerOver(e) {
    if (e.pointerType !== "mouse") return;
    const el = termAt(e.target);
    if (el) this.later(() => this.show(el), SHOW_DELAY_MS);
    else if (this.box.contains(e.target)) clearTimeout(this.timer);
    else if (this.current) this.later(() => this.hide(), HIDE_DELAY_MS);
  }

  /** Focus on a term opens its box; focus anywhere but the box closes it. */
  onFocus(e) {
    const el = termAt(e.target);
    if (el) this.show(el);
    else if (!this.box.contains(e.target)) this.hide();
  }

  /** Run action after ms, replacing any action still waiting. */
  later(action, ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(action, ms);
  }

  /** Explain term element el, right after it in the page so Tab reaches the box's link next. */
  show(el) {
    clearTimeout(this.timer);
    if (el === this.current) return;
    this.hide();
    this.box.innerHTML = tipContent(TERMS.find((t) => t.id === el.dataset.term));
    el.after(this.box);
    this.box.showPopover();
    el.setAttribute("aria-describedby", this.box.id);
    place(this.box, el);
    this.current = el;
  }

  /** Close the box, if open. */
  hide() {
    clearTimeout(this.timer);
    if (!this.current) return;
    this.box.hidePopover();
    this.current.removeAttribute("aria-describedby");
    this.current = null;
  }

  /** Escape closes the box and returns focus to its term. */
  dismiss() {
    const el = this.current;
    if (!el) return;
    el.focus(); // first, or the focus would open the box again
    this.hide();
  }
}

/** The box's content for term: its name, then whichever of full form, explanation and docs link it has. */
function tipContent(term) {
  return [
    `<b>${esc(term.name)}</b>`,
    term.full ? `<span class="full">${esc(term.full)}</span>` : "",
    term.text ? `<p>${esc(term.text)}</p>` : "",
    term.url ? `<a href="${esc(term.url)}" target="_blank" rel="noopener">More in the Kubernetes docs ↗</a>` : "",
  ].join("");
}

/** The marked term at or around target, if any. */
const termAt = (target) => target.closest?.(".term");
