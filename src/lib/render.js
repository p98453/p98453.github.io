import katex from 'katex';
import { Marked } from 'marked';
import { createHighlighter } from 'shiki';

const LANG_ALIAS = {
  python: 'python',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  css: 'css',
  yaml: 'yaml',
  yml: 'yaml',
  ruby: 'ruby',
  powershell: 'powershell',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
  html: 'html',
  xml: 'xml',
  javascript: 'javascript',
  js: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  sql: 'sql',
  toml: 'toml',
  ini: 'ini',
  diff: 'diff',
  cypher: 'text',
  'ssh-config': 'text',
  mermaid: 'mermaid',
};

const highlighterPromise = createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: [
    'python',
    'bash',
    'json',
    'markdown',
    'css',
    'yaml',
    'ruby',
    'powershell',
    'dockerfile',
    'text',
    'html',
    'javascript',
    'typescript',
    'sql',
    'toml',
    'ini',
    'diff',
  ],
});

function normalizeLang(lang) {
  const key = String(lang || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0];
  return LANG_ALIAS[key] || 'text';
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function maskRegions(source) {
  const masks = [];
  const put = (block) => {
    const token = `\uE000R${masks.length}\uE001`;
    masks.push(block);
    return token;
  };
  let text = source.replace(/```[\s\S]*?```/g, put);
  text = text.replace(/`[^`\n]*`/g, put);
  text = text.replace(/<img\b[^>]*>/gi, put);
  return {
    text,
    restore(value) {
      return value.replace(/\uE000R(\d+)\uE001/g, (_, index) => masks[Number(index)]);
    },
  };
}

function renderTex(tex, display) {
  let source = tex.trim();
  if (display && source.includes('\\\\')) {
    source = `\\begin{gathered}\n${source}\n\\end{gathered}`;
  }
  try {
    return katex.renderToString(source, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
  } catch {
    return display ? `<pre class="math-fallback">${escapeHtml(tex)}</pre>` : `<code>${escapeHtml(tex)}</code>`;
  }
}

function replaceMath(source) {
  const slots = [];
  const stash = (tex, display) => {
    const index = slots.length;
    slots.push({ tex, display });
    const tag = display ? 'div' : 'span';
    return display
      ? `\n<div class="math-slot" data-i="${index}"></div>\n`
      : `<span class="math-slot" data-i="${index}"></span>`;
  };

  let text = source.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, (_, tex) => stash(tex, true));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => stash(tex, false));
  text = text.replace(/(?<!\\)\$([^\n$]+?)(?<!\\)\$/g, (full, tex) => {
    if (!tex.trim()) return full;
    return stash(tex, false);
  });
  return { text, slots };
}

function fillMath(html, slots) {
  return html.replace(/<(div|span) class="math-slot" data-i="(\d+)"><\/\1>/g, (_, _tag, index) => {
    const slot = slots[Number(index)];
    if (!slot) return '';
    return renderTex(slot.tex, slot.display);
  });
}

function headingId(text, used) {
  const plain = text
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase();
  const base =
    plain
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]+/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section';
  const count = used.get(base) || 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

const usedIds = new Map();

async function createParser() {
  const highlighter = await highlighterPromise;
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      code(token) {
        const text = typeof token === 'string' ? token : token.text;
        const lang = typeof token === 'string' ? arguments[1] : token.lang;
        const normalized = normalizeLang(lang);
        if (normalized === 'mermaid') {
          return `<pre class="mermaid">${escapeHtml(text)}</pre>\n`;
        }
        return highlighter.codeToHtml(text, {
          lang: normalized,
          themes: {
            light: 'github-light',
            dark: 'github-dark',
          },
        });
      },
      heading(token) {
        const depth = Math.min((token.depth || 1) + 1, 6);
        const text = this.parser.parseInline(token.tokens);
        const id = headingId(text, usedIds);
        return `<h${depth} id="${id}">${text}<a class="heading-anchor" href="#${id}" aria-label="章节链接">#</a></h${depth}>\n`;
      },
    },
  });
  return marked;
}

let parserPromise = null;

export async function renderPost(post) {
  if (!parserPromise) parserPromise = createParser();
  const parser = await parserPromise;
  usedIds.clear();
  const masked = maskRegions(post.prepared);
  const math = replaceMath(masked.text);
  const markdown = masked.restore(math.text);
  let html = await parser.parse(markdown);
  html = fillMath(html, math.slots);
  html = html.replace(/<table(\s|>)/g, '<div class="table-scroll"><table$1');
  html = html.replace(/<\/table>/g, '</table></div>');
  html = html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noreferrer noopener"');
  return html;
}
