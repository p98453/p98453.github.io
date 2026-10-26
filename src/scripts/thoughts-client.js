function endpoint(root) {
  return root.dataset.api.replace(/\/$/, '');
}

function showStatus(node, text, kind) {
  node.hidden = false;
  node.dataset.kind = kind;
  node.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

function imageSrc(src, api) {
  if (/^\/api\/thoughts\/[a-z0-9-]+\/assets\/[a-z0-9._-]+(\?v=[a-f0-9]{1,40})?$/.test(src)) return `${api}${src}`;
  if (/^https:\/\/[^\s"'<>]+$/.test(src)) return src;
  return '';
}

function figure(alt, src) {
  const caption = alt.trim() ? `<figcaption>${escapeHtml(alt.trim())}</figcaption>` : '';
  return `<figure class="thought-figure"><img src="${escapeHtml(src).replaceAll('"', '&quot;')}" alt="${escapeHtml(alt).replaceAll('"', '&quot;')}" loading="lazy" decoding="async" />${caption}</figure>`;
}

export function renderMarkdown(source, api = '') {
  const lines = String(source).replaceAll('\r\n', '\n').split('\n');
  let html = '';
  let list = false;
  let gallery = [];
  const closeGallery = () => {
    if (!gallery.length) return;
    const kind = gallery.length > 1 ? ' thought-gallery--pair' : '';
    html += `<div class="thought-gallery${kind}">${gallery.join('')}</div>`;
    gallery = [];
  };
  const closeList = () => {
    closeGallery();
    if (!list) return;
    html += '</ul>';
    list = false;
  };
  for (const line of lines) {
    if (!line.trim()) {
      closeList();
      continue;
    }
    const image = IMAGE_LINE.exec(line.trim());
    if (image) {
      const src = imageSrc(image[2], api);
      if (src) {
        gallery.push(figure(image[1], src));
        continue;
      }
    }
    closeGallery();
    if (line.startsWith('### ')) {
      closeList();
      html += `<h3>${inline(line.slice(4))}</h3>`;
      continue;
    }
    if (line.startsWith('## ')) {
      closeList();
      html += `<h2>${inline(line.slice(3))}</h2>`;
      continue;
    }
    if (line.startsWith('# ')) {
      closeList();
      html += `<h2>${inline(line.slice(2))}</h2>`;
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!list) {
        html += '<ul>';
        list = true;
      }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

function writtenDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!match) return iso || '';
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

function looksLikeToken(value) {
  return /^[A-Za-z0-9_-]{40,}$/.test(value);
}

async function openSession(api) {
  const token = location.hash.replace(/^#/, '').trim();
  if (!looksLikeToken(token)) return true;
  const response = await fetch(`${api}/api/session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) return false;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return true;
}

export function bootGate() {
  const form = document.querySelector('#thought-apply');
  if (!form) return;
  const status = form.querySelector('.form-status');
  const fields = form.querySelector('.apply-fields');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const answer = form.answer.value.trim();
    const email = form.email.value.trim();
    if (answer.length < 2) {
      showStatus(status, '请先写下那个瞬间。', 'error');
      form.answer.focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus(status, '邮箱看起来不对，请再核对一次。', 'error');
      form.email.focus();
      return;
    }
    const button = document.querySelector('button[form="thought-apply"]') || form.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch(`${endpoint(form)}/api/apply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answer,
          email,
          website: form.website.value,
          turnstile: form.querySelector('[name="cf-turnstile-response"]')?.value || '',
        }),
      });
      const result = response.ok ? await response.json().catch(() => ({})) : {};
      if (response.ok && result.status === 'owner') {
        location.href = '/thoughts/list/';
        return;
      }
      if (response.status === 429) showStatus(status, '提交太频繁了，请稍后再试。', 'error');
      else if (response.status === 400 && !email) {
        showStatus(status, '请留下邮箱，结果会寄到那里。', 'error');
        form.email.focus();
      } else if (response.status === 400) showStatus(status, '有一项没有通过检查，请改一改再送出。', 'error');
      else if (!response.ok) showStatus(status, '网络异常，没有送出。请稍后再试。', 'error');
      else {
        showStatus(status, '已收到。如果通过，入口会寄到你的邮箱。', 'ok');
        fields.hidden = true;
        button.hidden = true;
        return;
      }
    } catch {
      showStatus(status, '网络异常，没有送出。请稍后再试。', 'error');
    }
    button.disabled = false;
  });
}

export async function bootList() {
  const root = document.querySelector('[data-thoughts="list"]');
  if (!root) return;
  const api = endpoint(root);
  const status = root.querySelector('.form-status');
  try {
    if (!(await openSession(api))) {
      location.replace('/thoughts/');
      return;
    }
    const response = await fetch(`${api}/api/thoughts`, { credentials: 'include' });
    if (response.status === 401) {
      location.replace('/thoughts/');
      return;
    }
    if (!response.ok) throw new Error('network');
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const list = root.querySelector('#thought-list');
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement('article');
      row.className = 'thought';
      const time = document.createElement('time');
      time.dateTime = item.date;
      time.textContent = writtenDate(item.date);
      const link = document.createElement('a');
      link.href = `/thoughts/view/#${encodeURIComponent(item.slug)}`;
      link.textContent = item.title;
      row.append(time, link);
      list.append(row);
    }
    root.querySelector('.thought-count').textContent = `共 ${items.length} 篇 · 仅本机会话内可见`;
    status.hidden = true;
  } catch {
    showStatus(status, '网络异常，列表没有读出来。', 'error');
  }
  root.querySelector('#lock').addEventListener('click', async () => {
    try {
      await fetch(`${api}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      /* still leave the page */
    }
    location.replace('/thoughts/');
  });
}

export async function bootView() {
  const root = document.querySelector('[data-thoughts="view"]');
  if (!root) return;
  const api = endpoint(root);
  const slug = decodeURIComponent(location.hash.replace(/^#/, '').trim());
  const status = root.querySelector('.form-status');
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    showStatus(status, '没有找到这一篇。', 'error');
    return;
  }
  try {
    if (!(await openSession(api))) {
      location.replace('/thoughts/');
      return;
    }
    const response = await fetch(`${api}/api/thoughts/${encodeURIComponent(slug)}`, { credentials: 'include' });
    if (response.status === 401) {
      location.replace('/thoughts/');
      return;
    }
    if (response.status === 404) {
      showStatus(status, '没有找到这一篇。', 'error');
      return;
    }
    if (!response.ok) throw new Error('network');
    const thought = await response.json();
    root.querySelector('.thought-title').textContent = thought.title;
    const time = root.querySelector('time');
    time.dateTime = thought.date;
    time.textContent = `写于 ${writtenDate(thought.date).replace('年', ' 年 ').replace('月', ' 月 ').replace('日', ' 日')}`;
    root.querySelector('.prose').innerHTML = renderMarkdown(thought.markdown || '', api);
    status.hidden = true;
  } catch {
    showStatus(status, '网络异常，这一篇没有读出来。', 'error');
  }
}
