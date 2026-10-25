export const site = {
  title: '小牛壮士',
  subtitle: '个人博客',
  description: '林勇的个人博客',
  author: 'kukudelin',
  lang: 'zh-CN',
  url: 'https://kukudelin.top',
};

export function categoryKey(name) {
  return String(name).replaceAll('/', '-');
}

export function absoluteUrl(pathname) {
  return new URL(pathname, site.url).toString();
}
