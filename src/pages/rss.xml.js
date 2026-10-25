import rss from '@astrojs/rss';
import { getPosts } from '../lib/posts.js';
import { site } from '../lib/site.js';

export function GET(context) {
  const posts = getPosts();
  return rss({
    title: site.title,
    description: site.description,
    site: context.site,
    trailingSlash: true,
    customData: `<language>zh-cn</language><author>${site.author}</author>`,
    items: posts.map((post) => ({
      title: post.title,
      pubDate: post.date,
      description: post.excerpt,
      link: post.permalink,
      categories: [...post.categories, ...post.tags],
    })),
  });
}
