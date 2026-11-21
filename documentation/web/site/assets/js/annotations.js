// A comment points at text by quoting it (the W3C Web Annotation TextQuoteSelector), not by its position in the DOM:
// the quote still matches after the markup around it changes, and its context tells repeated phrases apart.

/** Characters of context kept on each side of a quote. */
const CONTEXT = 32;

/**
 * Join text chunks (a section's text nodes) into one string, with each run of whitespace collapsed to one space so
 * that re-wrapping the HTML keeps quotes matching.
 * @param {string[]} chunks
 * @returns {{text: string, at: Array<[number, number]>}} the text, and the [chunk, offset] each character came from
 */
export function flatten(chunks) {
  const chars = [];
  const at = [];
  chunks.forEach((chunk, c) => {
    for (let o = 0; o < chunk.length; o++) {
      const space = /\s/.test(chunk[o]);
      if (space && (chars.length === 0 || chars.at(-1) === " ")) continue;
      chars.push(space ? " " : chunk[o]);
      at.push([c, o]);
    }
  });
  return { text: chars.join(""), at };
}

/**
 * The quote for text[start, end), without the spaces at its ends.
 * @returns {{exact: string, prefix: string, suffix: string} | null} null when only spaces are in the span
 */
export function quoteAt(text, start, end) {
  while (start < end && text[start] === " ") start++;
  while (end > start && text[end - 1] === " ") end--;
  if (start === end) return null;
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

/**
 * Where quote is in text: of every place its exact text appears, the one whose surroundings match its context best.
 * @returns {{start: number, end: number} | null} null when the exact text is no longer there
 */
export function locate(text, quote) {
  if (!quote?.exact) return null;
  let best = null;
  for (let i = text.indexOf(quote.exact); i !== -1; i = text.indexOf(quote.exact, i + 1)) {
    const end = i + quote.exact.length;
    const score = sharedEnd(text.slice(0, i), quote.prefix ?? "") + sharedStart(text.slice(end), quote.suffix ?? "");
    if (!best || score > best.score) best = { start: i, end, score };
  }
  return best && { start: best.start, end: best.end };
}

/** How many characters a and b have in common at their start. */
function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** How many characters a and b have in common at their end. */
function sharedEnd(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
