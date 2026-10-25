import fs from 'node:fs';
import path from 'node:path';
import { getPosts } from '../src/lib/posts.js';
import { encodeFilename } from '../src/lib/images.js';

const dist = path.resolve('dist');
const posts = getPosts();
const errors = [];
const topLevel = posts.filter((post) => !post.nested).length;

console.log(`posts: ${posts.length} (top-level ${topLevel}, nested ${posts.length - topLevel})`);

if (topLevel !== 60) errors.push(`expected 60 top-level posts, found ${topLevel}`);
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

const home = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!home.includes('小牛壮士')) errors.push('home page missing site title');
for (const post of posts) {
  if (!home.includes(post.permalink) && !home.includes(encodeURI(post.permalink))) {
    errors.push(`home page missing link ${post.permalink}`);
  }
}

console.log(`copied image files checked: ${copiedImages}`);
console.log(`unresolved image refs: ${posts.reduce((sum, post) => sum + post.missingImages.length, 0)}`);

if (errors.length) {
  console.error(`\n${errors.length} verification error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('verify ok');
