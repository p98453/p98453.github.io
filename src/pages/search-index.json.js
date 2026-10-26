import { getPosts } from '../lib/posts.js';
import { homeDate } from '../lib/format.js';

export const prerender = true;

export function GET() {
  const items = getPosts().map((post) => ({
    title: post.title,
    url: post.permalink,
    date: homeDate(post),
    iso: post.dateText,
    description: post.description,
    text: [post.title, post.description, ...post.categories, ...post.tags].join(' ').toLowerCase(),
  }));
  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
