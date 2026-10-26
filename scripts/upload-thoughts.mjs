import fs from 'node:fs';
import path from 'node:path';
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
  const payload = {
    slug: slugFrom(name, parsed.data),
    title: String(parsed.data.title || '').trim(),
    date,
    markdown: parsed.content.trim(),
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
