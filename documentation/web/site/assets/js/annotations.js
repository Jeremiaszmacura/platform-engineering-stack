// Anchors comments by quoted text plus context (W3C TextQuoteSelector), so markup changes don't break them.

const CONTEXT = 32;

/** Join chunks with whitespace collapsed; at[i] is the [chunk, offset] of character i. */
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

/** The trimmed quote for text[start, end) with its context, or null if it is blank. */
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

/** The {start, end} of quote in text whose context matches best, or null if gone. */
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

/** Length of the common start of a and b. */
function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Length of the common end of a and b. */
function sharedEnd(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
