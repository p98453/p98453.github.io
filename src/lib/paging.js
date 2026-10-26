export const PER_PAGE = 12;

export function pageCount(count) {
  return Math.max(1, Math.ceil(count / PER_PAGE));
}

export function slicePage(items, page) {
  const start = (Math.max(1, page) - 1) * PER_PAGE;
  return items.slice(start, start + PER_PAGE);
}

export function pageHref(base, page) {
  const root = base.endsWith('/') ? base : `${base}/`;
  if (page <= 1) return root;
  return `${root}page/${page}/`;
}

/** Page numbers from 2 upward, including legacy URLs that now redirect. */
export function pageEntries(count, legacyMax = 0) {
  const pages = pageCount(count);
  const max = Math.max(pages, legacyMax);
  const entries = [];
  for (let page = 2; page <= max; page += 1) {
    entries.push({ page, redirect: page > pages });
  }
  return entries;
}
