import fs from 'node:fs';
import path from 'node:path';
import { getPosts } from '../src/lib/posts.js';
import { encodeFilename } from '../src/lib/images.js';

const dist = path.resolve('dist');
const posts = getPosts();
const errors = [];
const topLevel = posts.filter((post) => !post.nested).length;

console.log(`posts: ${posts.length} (top-level ${topLevel}, nested ${posts.length - topLevel})`);

if (topLevel !== 61) errors.push(`expected 61 top-level posts, found ${topLevel}`);
if (posts.length < 60) errors.push(`expected at least 60 published posts, found ${posts.length}`);

const cnamePath = path.join(dist, 'CNAME');
if (!fs.existsSync(cnamePath)) errors.push('dist/CNAME is missing');
else if (fs.readFileSync(cnamePath, 'utf8').trim() !== 'kukudelin.top') {
  errors.push(`dist/CNAME is ${fs.readFileSync(cnamePath, 'utf8').trim()}`);
}

const knownMissing = new Set([
  'image-20260112230959985.png',
  'image-20260111215335802.png',
]);

let copiedImages = 0;
for (const post of posts) {
  const page = path.join(dist, ...post.permalink.split('/').filter(Boolean), 'index.html');
  if (!fs.existsSync(page)) {
    errors.push(`missing page ${post.permalink}`);
    continue;
  }
  const html = fs.readFileSync(page, 'utf8');
  if (!html.includes(post.title)) errors.push(`title not rendered: ${post.title}`);

  for (const image of post.images) {
    const filename = path.basename(image);
    const output = path.join(dist, ...post.permalink.split('/').filter(Boolean), filename);
    if (!fs.existsSync(output)) errors.push(`image not copied: ${post.permalink}${filename}`);
    else copiedImages += 1;
  }

  for (const image of post.usedImages) {
    const filename = path.basename(image);
    const encoded = encodeFilename(filename);
    if (!html.includes(encoded) && !html.includes(filename)) {
      errors.push(`page does not reference ${filename} (${post.permalink})`);
    }
  }

  for (const missing of post.missingImages) {
    const base = path.posix.basename(missing.replaceAll('\\', '/'));
    if (!knownMissing.has(base)) errors.push(`unexpected missing image in ${path.basename(post.file)}: ${missing}`);
  }
}

const spots = [
  ['/2025/06/21/卷积神经网络（CNN）原理/', 'CNN.png'],
  ['/2025/06/21/卷积神经网络（CNN）原理/', '池化层动画演示01.webp'],
  ['/2025/06/21/卷积神经网络（CNN）原理/', '屏幕截图 2025-07-21 190547.png'],
  ['/2025/04/10/线性回归（一）：线性回归理论以及代码复现/', 'hat{y}_i)^2.png'],
  ['/2025/08/21/LoRA，QLoRA大模型微调/', 'image-20250821195522388.png'],
  ['/2026/01/27/docker笔记/', 'image-20260111230730393.png'],
];

for (const [permalink, filename] of spots) {
  const output = path.join(dist, ...permalink.split('/').filter(Boolean), filename);
  const page = path.join(dist, ...permalink.split('/').filter(Boolean), 'index.html');
  if (!fs.existsSync(output)) errors.push(`spot image missing on disk: ${permalink}${filename}`);
  if (!fs.existsSync(page)) errors.push(`spot page missing: ${permalink}`);
  else {
    const html = fs.readFileSync(page, 'utf8');
    const encoded = encodeFilename(filename);
    if (!html.includes(encoded)) errors.push(`spot image not in html: ${filename}`);
  }
}

function readHtml(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const indexPages = [path.join(dist, 'index.html')];
const pageDir = path.join(dist, 'page');
if (fs.existsSync(pageDir)) {
  for (const entry of fs.readdirSync(pageDir)) {
    indexPages.push(path.join(pageDir, entry, 'index.html'));
  }
}
const home = readHtml(indexPages[0]);
const indexHtml = indexPages.map(readHtml).join('\n');
if (!home.includes('小牛壮士')) errors.push('home page missing site title');
if (!home.includes('class="seal"') || !home.includes('>林<')) errors.push('home seal is not 林');
const placeholders = [
  '一次把博客迁移交给 AI 助手：写作还是我，运营交给它。',
  '从 HTTPS Token 换到 SSH 密钥，顺手清理泄露隐患。',
  'pip 太慢了，试试 uv。',
];
for (const text of placeholders) {
  if (indexHtml.includes(text)) errors.push(`placeholder summary shipped: ${text}`);
}
if (!posts.some((post) => post.description) && indexHtml.includes('class="summary"')) {
  errors.push('summary rendered without a frontmatter description');
}
for (const post of posts) {
  if (!indexHtml.includes(post.permalink) && !indexHtml.includes(encodeURI(post.permalink))) {
    errors.push(`index pages missing link ${post.permalink}`);
  }
}
const sampleSource = path.join(dist, ...posts[0].permalink.split('/').filter(Boolean), 'source.md');
if (!fs.existsSync(sampleSource)) errors.push(`markdown source missing for ${posts[0].permalink}`);

console.log(`copied image files checked: ${copiedImages}`);
console.log(`unresolved image refs: ${posts.reduce((sum, post) => sum + post.missingImages.length, 0)}`);

if (errors.length) {
  console.error(`\n${errors.length} verification error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('verify ok');
