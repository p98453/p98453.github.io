import path from 'node:path';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

export function isImageFile(name) {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

/** Encode a filename so spaces, parentheses and other Markdown-hostile characters survive in URLs. */
export function encodeFilename(name) {
  return encodeURIComponent(name).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function publicImageUrl(permalink, filename) {
  const base = permalink.endsWith('/') ? permalink : `${permalink}/`;
  return `${base}${encodeFilename(filename)}`;
}

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function maskCode(src) {
  const masks = [];
  const put = (block) => {
    const token = `\uE000C${masks.length}\uE001`;
    masks.push(block);
    return token;
  };
  let out = src.replace(/```[\s\S]*?```/g, put);
  out = out.replace(/`[^`\n]*`/g, put);
  return {
    text: out,
    restore(value) {
      return value.replace(/\uE000C(\d+)\uE001/g, (_, index) => masks[Number(index)]);
    },
  };
}

function findClosingBracket(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchDestination(source, urlStart, names) {
  const window = source.slice(urlStart, urlStart + 900);
  let best = null;
  for (const name of names) {
    let from = 0;
    while (from < window.length) {
      const pos = window.indexOf(name, from);
      if (pos === -1) break;
      const prev = pos === 0 ? '/' : window[pos - 1];
      const pathPart = window.slice(0, pos);
      if ((prev === '/' || prev === '\\') && !pathPart.includes('\n') && !pathPart.includes(')')) {
        const after = urlStart + pos + name.length;
        const rest = source.slice(after, after + 240);
        const title = rest.match(/^\s*(?:"[^"]*"|'[^']*')?\s*\)/);
        if (title) {
          const end = after + title[0].length;
          if (!best || name.length > best.name.length) best = { name, end };
          break;
        }
      }
      from = pos + 1;
    }
  }
  return best;
}

function applyZoom(tag) {
  const zoom = tag.match(/zoom\s*:\s*(\d+(?:\.\d+)?)%/i);
  if (!zoom) return tag;
  const width = `width:${zoom[1]}%`;
  if (/style\s*=\s*(["'])([\s\S]*?)\1/i.test(tag)) {
    return tag.replace(/style\s*=\s*(["'])([\s\S]*?)\1/i, (_, quote, style) => {
      const next = style.trim().replace(/;?\s*$/, `;${width}`);
      return `style=${quote}${next}${quote}`;
    });
  }
  return tag.replace(/<img\b/i, `<img style="${width}"`);
}

function rewriteHtmlImages(source, byName, permalink, used, missing) {
  return source.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\bsrc\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!srcMatch) return tag;
    const src = srcMatch[2].trim();
    if (/^(https?:|data:|\/)/i.test(src)) return tag;
    const base = path.posix.basename(src.split('?')[0].replaceAll('\\', '/'));
    const file = byName.get(base);
    if (!file) {
      missing.push(src);
      return tag;
    }
    used.add(file);
    const url = publicImageUrl(permalink, path.basename(file));
    let next = tag.replace(srcMatch[0], `src="${url}"`);
    next = applyZoom(next);
    if (!/\bloading\s*=/i.test(next)) next = next.replace(/<img\b/i, '<img loading="lazy"');
    if (!/\bdecoding\s*=/i.test(next)) next = next.replace(/<img\b/i, '<img decoding="async"');
    return next;
  });
}

function rewriteMarkdownImages(source, names, byName, permalink, used) {
  let out = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('![', index)) {
      const close = findClosingBracket(source, index + 1);
      if (close !== -1 && source[close + 1] === '(') {
        const hit = matchDestination(source, close + 2, names);
        if (hit) {
          const file = byName.get(hit.name);
          used.add(file);
          const alt = source.slice(index + 2, close).replaceAll('\\]', ']');
          const url = publicImageUrl(permalink, path.basename(file));
          out += `<img src="${url}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" />`;
          index = hit.end;
          continue;
        }
      }
    }
    out += source[index];
    index += 1;
  }
  return out;
}

function collectUnresolved(source) {
  const missing = [];
  const md = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  for (const match of source.matchAll(md)) {
    const dest = match[2].trim().replace(/\s+["'][^"']*["']\s*$/, '');
    if (/^(https?:|data:|\/)/i.test(dest)) continue;
    missing.push(dest);
  }
  const html = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi;
  for (const match of source.matchAll(html)) {
    const src = match[2].trim();
    if (/^(https?:|data:|\/)/i.test(src)) continue;
    missing.push(src);
  }
  return missing;
}

/**
 * Turn local Markdown and HTML images into root-absolute URLs under the post permalink.
 * Filenames are matched inside the post's own asset folder, so duplicate basenames
 * across posts stay attached to the right article.
 */
export function prepareMarkdown(body, imageFiles, permalink) {
  const byName = new Map(imageFiles.map((file) => [path.basename(file), file]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const masked = maskCode(body);
  const used = new Set();
  const missing = [];
  let text = rewriteHtmlImages(masked.text, byName, permalink, used, missing);
  text = rewriteMarkdownImages(text, names, byName, permalink, used);
  missing.push(...collectUnresolved(text));
  return {
    markdown: masked.restore(text),
    used: [...used],
    missing: [...new Set(missing)],
  };
}
