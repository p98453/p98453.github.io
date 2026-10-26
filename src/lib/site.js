export const site = {
  title: '小牛壮士',
  subtitle: '个人博客',
  description: '林勇的个人博客',
  author: 'kukudelin',
  authorName: '林勇',
  lang: 'zh-CN',
  url: 'https://kukudelin.top',
  license: 'CC BY-NC 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/deed.zh',
  repo: 'https://github.com/p98453/p98453.github.io',
  started: 2025,
  thoughtsApi: 'https://thoughts.kukudelin.top',
  turnstileSiteKey: '',
};

export function categoryKey(name) {
  return String(name).replaceAll('/', '-');
}

export function absoluteUrl(pathname) {
  return new URL(pathname, site.url).toString();
}
