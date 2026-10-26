import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';

const endpoint = (process.env.THOUGHTS_WORKER_ORIGIN || 'https://thoughts.kukudelin.top').replace(/\/$/, '');
const token = process.env.UPLOAD_TOKEN || '';
const directory = process.argv[2] || 'private-thoughts';

if (!token) {
  console.error('Set UPLOAD_TOKEN in the environment. Do not pass it as an argument.');
  process.exit(1);
}

const root = path.resolve(directory);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`No markdown directory at ${root}. Create it locally; it is not part of the published site.`);
  process.exit(1);
}

function slugFrom(file, data) {
  if (typeof data.slug === 'string' && data.slug.trim()) return data.slug.trim();
  return path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

function assetName(file) {
  return path.basename(file).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '');
}

// Upload local images referenced as ![alt](relative.jpg) and point them at the gated Worker route.
async function uploadImages(markdown, slug, baseDir) {
  const uploaded = new Map();
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const src = match[2];
    if (/^[a-z]+:|^\//i.test(src) || uploaded.has(src)) continue;
    const file = path.resolve(baseDir, src);
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!file.startsWith(root + path.sep) || !type || !fs.existsSync(file)) {
      console.error(`${slug}: image ${src} is missing or not a supported image.`);
      process.exit(1);
    }
    const name = assetName(file);
    const bytes = fs.readFileSync(file);
    const version = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
    const response = await fetch(`${endpoint}/admin/thoughts/${slug}/assets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body: bytes,
    });
    if (!response.ok) {
      console.error(`${slug}: image ${src} failed: ${response.status} ${await response.text()}`);
      process.exit(1);
    }
    uploaded.set(src, `/api/thoughts/${slug}/assets/${name}?v=${version}`);
    console.log(`  image ${name}`);
  }
  return markdown.replace(pattern, (whole, alt, src) => (uploaded.has(src) ? `![${alt}](${uploaded.get(src)})` : whole));
}

const files = fs.readdirSync(root).filter((name) => name.endsWith('.md')).sort();
if (!files.length) {
  console.error(`No .md files in ${root}.`);
  process.exit(1);
}

for (const name of files) {
  const file = path.join(root, name);
  const parsed = matter(fs.readFileSync(file, 'utf8'));
  const date = parsed.data.date instanceof Date
    ? parsed.data.date.toISOString().slice(0, 10)
    : String(parsed.data.date || '').slice(0, 10);
  const slug = slugFrom(name, parsed.data);
  const tags = Array.isArray(parsed.data.tags)
    ? parsed.data.tags.map(String)
    : typeof parsed.data.tags === 'string' ? parsed.data.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
  const payload = {
    slug,
    tags,
    title: String(parsed.data.title || '').trim(),
    date,
    markdown: await uploadImages(parsed.content.trim(), slug, root),
  };
  const response = await fetch(`${endpoint}/admin/thoughts`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    console.error(`${name} failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  console.log(`uploaded ${payload.slug}`);
}
