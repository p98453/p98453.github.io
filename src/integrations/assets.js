import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPosts } from '../lib/posts.js';

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

function matchPost(urlPath) {
  const posts = getPosts()
    .filter((post) => post.assetDir)
    .sort((a, b) => b.permalink.length - a.permalink.length);
  return posts.find((post) => urlPath.startsWith(post.permalink) && urlPath.length > post.permalink.length);
}

export function postAssets() {
  return {
    name: 'post-assets',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, res, next) => {
          try {
            const raw = (req.url || '').split('?')[0];
            const urlPath = decodeURIComponent(raw);
            const post = matchPost(urlPath);
            if (!post) return next();
            const relative = urlPath.slice(post.permalink.length);
            if (!relative || relative.includes('..')) return next();
            const file = path.resolve(post.assetDir, relative);
            const root = path.resolve(post.assetDir) + path.sep;
            if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
            res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            fs.createReadStream(file).pipe(res);
          } catch {
            next();
          }
        });
      },
      'astro:build:done': ({ dir }) => {
        const dist = fileURLToPath(dir);
        let copied = 0;
        for (const post of getPosts()) {
          if (!post.images.length) continue;
          const destDir = path.join(dist, ...post.permalink.split('/').filter(Boolean));
          fs.mkdirSync(destDir, { recursive: true });
          for (const image of post.images) {
            fs.copyFileSync(image, path.join(destDir, path.basename(image)));
            copied += 1;
          }
        }
        console.log(`post-assets: copied ${copied} images`);
      },
    },
  };
}
