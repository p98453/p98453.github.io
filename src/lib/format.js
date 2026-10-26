export function homeDate(post) {
  return `${post.year}年${Number(post.month)}月${Number(post.day)}日`;
}

export function writtenOn(post) {
  return `写于 ${post.year} 年 ${Number(post.month)} 月 ${Number(post.day)} 日`;
}

export const SUMMARY_GAP = ' \u2014\u2014 ';
