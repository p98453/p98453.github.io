import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { categoryKey } from './site.js';
import { isImageFile, prepareMarkdown } from './images.js';

const POSTS_ROOT = path.resolve('content/posts');

let cache = null;

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateParts(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: String(value.getFullYear()),
      month: pad(value.getMonth() + 1),
      day: pad(value.getDate()),
      hours: pad(value.getHours()),
      minutes: pad(value.getMinutes()),
      seconds: pad(value.getSeconds()),
    };
  }
  const match = String(value ?? '')
    .trim()
    .match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    throw new Error(`无法解析日期: ${value}`);
  }
  return {
    year: match[1],
    month: pad(match[2]),
    day: pad(match[3]),
    hours: pad(match[4] || 0),
    minutes: pad(match[5] || 0),
    seconds: pad(match[6] || 0),
  };
}

function stripLeadingDate(name) {
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function discoverMarkdown(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
      continue;
    }
    if (!entry.isDirectory()) continue;
    for (const child of fs.readdirSync(full)) {
      if (child.endsWith('.md')) files.push(path.join(full, child));
    }
  }
  return files;
}

function slugFor(file) {
  const relative = path.relative(POSTS_ROOT, file);
  const directory = path.dirname(relative);
  const stem = path.basename(file, '.md');
  if (directory === '.') return stripLeadingDate(stem);
  // The one nested historical post keeps the live URL:
  // /:year/:month/:day/<folder-without-date>/<full-filename>/
  return `${stripLeadingDate(directory)}/${stem}`;
}

function assetDirFor(file) {
  const directory = path.dirname(file);
  if (directory !== POSTS_ROOT) return directory;
  const sibling = path.join(directory, path.basename(file, '.md'));
  if (fs.existsSync(sibling) && fs.statSync(sibling).isDirectory()) return sibling;
  return null;
}

function listImages(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => isImageFile(name))
    .map((name) => path.join(directory, name))
    .sort();
}

function descriptionOf(data) {
  const value = data && data.description;
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function excerptOf(body) {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[\s\S]*?\]\((?:\\\)|[^)])*\)/g, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/[#>*_~\-[\]()`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...text];
  if (chars.length <= 72) return chars.join('');
  return `${chars.slice(0, 72).join('')}…`;
}

function loadPosts() {
  const posts = discoverMarkdown(POSTS_ROOT).map((file) => {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = matter(raw);
    const title = String(parsed.data.title || path.basename(file, '.md')).trim();
    const parts = dateParts(parsed.data.date);
    const slug = slugFor(file);
    const permalink = `/${parts.year}/${parts.month}/${parts.day}/${slug}/`;
    const assetDir = assetDirFor(file);
    const images = listImages(assetDir);
    const body = parsed.content.replace(/^\n+/, '');
    const prepared = prepareMarkdown(body, images, permalink);
    const chars = body.replace(/```[\s\S]*?```/g, '').replace(/\s/g, '').length;
    return {
      file,
      assetDir,
      images,
      title,
      dateText: `${parts.year}-${parts.month}-${parts.day}`,
      dateKey: `${parts.year}-${parts.month}-${parts.day} ${parts.hours}:${parts.minutes}:${parts.seconds}`,
      date: new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12, 0, 0)),
      year: parts.year,
      month: parts.month,
      day: parts.day,
      slug,
      permalink,
      categories: asList(parsed.data.categories),
      tags: asList(parsed.data.tags),
      description: descriptionOf(parsed.data),
      body,
      prepared: prepared.markdown,
      usedImages: prepared.used,
      missingImages: prepared.missing,
      excerpt: excerptOf(body),
      readingMinutes: Math.max(1, Math.round(chars / 450)),
      hasMermaid: /```mermaid\b/i.test(body),
      nested: path.dirname(file) !== POSTS_ROOT,
    };
  });

  posts.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : a.title.localeCompare(b.title, 'zh')));

  const seen = new Set();
  for (const post of posts) {
    if (seen.has(post.permalink)) {
      throw new Error(`重复的永久链接: ${post.permalink}`);
    }
    seen.add(post.permalink);
  }
  return posts;
}

export function getPosts() {
  if (!cache) cache = loadPosts();
  return cache;
}

export function getPost(permalink) {
  return getPosts().find((post) => post.permalink === permalink);
}

export function getCategories() {
  const map = new Map();
  for (const post of getPosts()) {
    for (const name of post.categories) {
      const key = categoryKey(name);
      if (!map.has(key)) map.set(key, { key, names: new Set(), posts: [] });
      const entry = map.get(key);
      entry.names.add(name);
      if (!entry.posts.includes(post)) entry.posts.push(post);
    }
  }
  return [...map.values()]
    .map((entry) => ({
      key: entry.key,
      label: [...entry.names].find((name) => name.includes('/')) || [...entry.names][0],
      names: [...entry.names],
      posts: entry.posts,
    }))
    .sort((a, b) => b.posts.length - a.posts.length || a.label.localeCompare(b.label, 'zh'));
}

export function getCategory(key) {
  return getCategories().find((category) => category.key === key);
}

export function getTags() {
  const map = new Map();
  for (const post of getPosts()) {
    for (const tag of post.tags) {
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag).push(post);
    }
  }
  return [...map.entries()]
    .map(([name, posts]) => ({ name, posts }))
    .sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name, 'zh'));
}

export function getTag(name) {
  return getTags().find((tag) => tag.name === name);
}

export function getYears() {
  const map = new Map();
  for (const post of getPosts()) {
    if (!map.has(post.year)) map.set(post.year, []);
    map.get(post.year).push(post);
  }
  return [...map.entries()]
    .map(([year, posts]) => ({ year, posts }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

export function getMonths(year) {
  const posts = getPosts().filter((post) => post.year === year);
  const map = new Map();
  for (const post of posts) {
    if (!map.has(post.month)) map.set(post.month, []);
    map.get(post.month).push(post);
  }
  return [...map.entries()]
    .map(([month, items]) => ({ year, month, posts: items }))
    .sort((a, b) => b.month.localeCompare(a.month));
}
