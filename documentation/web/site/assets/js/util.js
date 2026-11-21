export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape text for use in HTML markup and attributes. */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
/** Text as inline code. */
export const code = (value) => `<code>${esc(value)}</code>`;

/** Namespace -> CSS colour; colour always means namespace on this site. */
export const NS_COLORS = {
  outside: "var(--ns-outside)",
  "envoy-gateway-system": "var(--ns-gateway)",
  apps: "var(--ns-apps)",
  data: "var(--ns-data)",
  vault: "var(--ns-vault)",
  monitoring: "var(--ns-monitoring)",
  docs: "var(--ns-docs)",
};
export const nsColor = (namespace) => NS_COLORS[namespace] || "var(--ns-system)";
/** A namespace name in its colour. */
export const nsTag = (namespace) => `<span class="ns" style="--c:${nsColor(namespace)}">${esc(namespace)}</span>`;

/** A pass/fail mark for tables. */
export const mark = (ok, yes = "yes", no = "no") => `<span class="mark ${ok ? "y" : "n"}">${ok ? "✓ " + esc(yes) : "✗ " + esc(no)}</span>`;

/** Format a number for a live tile or edge label: 0.0123 -> "0.01", 1234 -> "1.2k". */
export function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const abs = Math.abs(value);
  if (abs >= 1000) return (value / 1000).toFixed(1) + "k";
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs === 0) return "0";
  return value.toFixed(digits);
}

/** "2 pods" / "1 pod". */
export const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Fill element (selector or node) with HTML, if it exists on this page. */
export function fill(target, html) {
  const el = typeof target === "string" ? $(target) : target;
  if (el) el.innerHTML = html;
  return el;
}

/** Render rows into a table body; an empty list shows emptyText across all columns. */
export function rows(target, items, render, columns, emptyText = "Nothing in the cluster right now.") {
  return fill(target, items.length ? items.map(render).join("") : `<tr><td colspan="${columns}" class="muted">${esc(emptyText)}</td></tr>`);
}

/** The page's file name, e.g. "state.html". */
export const currentPage = () => location.pathname.split("/").pop() || "index.html";

const GAP_PX = 8;

/** Place fixed box below anchor (element or Range), or above if there is no room. */
export function place(box, anchor) {
  const line = anchor.getClientRects()[0] || anchor.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const fitsBelow = line.bottom + GAP_PX + size.height <= innerHeight - GAP_PX;
  const top = fitsBelow || line.top < size.height + 2 * GAP_PX ? line.bottom + GAP_PX : line.top - GAP_PX - size.height;
  const left = Math.max(GAP_PX, Math.min(line.left, width - size.width - GAP_PX));
  box.style.top = `${top}px`;
  box.style.left = `${left}px`;
}
