/**
 * 知识库聊天组件 — 浏览器本地搜索 + Worker API
 * 
 * 架构：
 *   • 向量文件 (embeddings.bin + index.json) 托管在博客静态目录 /kb/
 *   • 首次打开聊天时下载（~16MB），存入 IndexedDB 缓存
 *   • 相似度搜索在浏览器本地执行，零延迟
 *   • 仅 LLM 对话请求发到 Cloudflare Worker
 */

;(function () {
  'use strict';

  // ==================== 配置 ====================
  const CONFIG = {
    // Cloudflare Worker 地址
    workerUrl: 'https://kb-proxy.3224688576.workers.dev',
    // 向量文件路径
    vectorPath: '/kb/embeddings.bin',
    indexPath: '/kb/index.json',
    // 检索数量
    topK: 5,
    // 索引数据库名
    dbName: 'kb-cache',
    // IndexedDB 存储名
    storeName: 'vectors',
  };

  // ==================== DOM 创建 ====================
  function createChatUI() {
    const container = document.createElement('div');
    container.id = 'kb-chat-container';
    container.innerHTML = `
      <button id="kb-chat-trigger" title="知识库问答">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <div id="kb-chat-panel" class="kb-chat-hidden">
        <div id="kb-chat-header">
          <div class="kb-chat-header-left">
            <span class="kb-chat-icon">📚</span>
            <span class="kb-chat-title">知识库问答</span>
            <span id="kb-chat-status" class="kb-chat-status kb-chat-status-ready">就绪</span>
          </div>
          <div class="kb-chat-header-right">
            <button id="kb-chat-clear" title="清空对话">↺</button>
            <button id="kb-chat-close" title="关闭">✕</button>
          </div>
        </div>
        <div id="kb-chat-messages"></div>
        <div id="kb-chat-sources" class="kb-chat-hidden"></div>
        <div id="kb-chat-input-area">
          <textarea id="kb-chat-input" placeholder="问我任何关于博客内容的问题…" rows="1"></textarea>
          <button id="kb-chat-send" title="发送">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // 引用
    return {
      trigger: document.getElementById('kb-chat-trigger'),
      panel: document.getElementById('kb-chat-panel'),
      messages: document.getElementById('kb-chat-messages'),
      sources: document.getElementById('kb-chat-sources'),
      input: document.getElementById('kb-chat-input'),
      send: document.getElementById('kb-chat-send'),
      close: document.getElementById('kb-chat-close'),
      clear: document.getElementById('kb-chat-clear'),
      status: document.getElementById('kb-chat-status'),
    };
  }

  // ==================== IndexedDB 缓存 ====================
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.dbName, 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(CONFIG.storeName);
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCache(key) {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CONFIG.storeName, 'readonly');
      const req = tx.objectStore(CONFIG.storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  }

  async function setCache(key, value) {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CONFIG.storeName, 'readwrite');
      tx.objectStore(CONFIG.storeName).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
    });
  }

  // ==================== 向量加载 ====================
  async function loadVectors(ui, embeddings, indexData) {
    ui.status.textContent = '加载中';
    ui.status.className = 'kb-chat-status kb-chat-status-loading';

    const dim = indexData.dim;
    const count = indexData.records.length;
    const start = performance.now();

    // 1. 尝试从 IndexedDB 缓存加载（失败则跳过，直接下载）
    try {
      const cachedEmbed = await getCache('embeddings');
      const cachedIndex = await getCache('index');
      if (cachedEmbed && cachedIndex) {
        embeddings.buffer = cachedEmbed;
        embeddings.count = cachedIndex.count;
        embeddings.dim = cachedIndex.dim;
        Object.assign(indexData, cachedIndex);
        ui.status.textContent = '就绪(缓存)';
        ui.status.className = 'kb-chat-status kb-chat-status-ready';
        console.log(`[KB] 从缓存加载 ${cachedIndex.count} 条向量 (${(performance.now()-start).toFixed(0)}ms)`);
        return;
      }
    } catch (e) {
      console.warn('[KB] IndexedDB 缓存不可用，将直接下载:', e && e.message);
    }

    // 2. 下载向量文件
    ui.status.textContent = '下载中(15MB)...';
    const resp = await fetch(CONFIG.vectorPath);
    if (!resp.ok) throw new Error(`下载向量失败: ${resp.status}`);
    const buffer = await resp.arrayBuffer();

    embeddings.buffer = buffer;
    embeddings.count = count;
    embeddings.dim = dim;

    // 3. 尝试存入缓存（失败忽略）
    try {
      await setCache('embeddings', buffer);
      await setCache('index', { records: indexData.records, count, dim });
    } catch (e) {
      console.warn('[KB] 缓存写入失败（IndexedDB 不可用），下次仍需下载:', e && e.message);
    }

    ui.status.textContent = '就绪';
    ui.status.className = 'kb-chat-status kb-chat-status-ready';
    console.log(`[KB] 下载+缓存 ${count} 条向量 (${((buffer.byteLength)/1024/1024).toFixed(1)}MB, ${(performance.now()-start).toFixed(0)}ms)`);
  }

  // ==================== 本地相似度搜索 ====================
  function dotProduct(a, offset, b) {
    let sum = 0;
    for (let i = 0; i < b.length; i++) {
      sum += a[offset + i] * b[i];
    }
    return sum;
  }

  function searchSimilar(embeddings, indexData, queryVec, topK) {
    const dim = embeddings.dim;
    const arr = new Float32Array(embeddings.buffer);
    const results = [];

    for (let i = 0; i < indexData.records.length; i++) {
      // embeddings.bin 无头部，纯 Float32LE 序列，每条 dim 个浮点
      const offset = i * dim;
      const sim = dotProduct(arr, offset, queryVec);
      results.push({ idx: i, sim });
    }

    // Top-K
    results.sort((a, b) => b.sim - a.sim);
    const top = results.slice(0, topK);

    return top.map(r => ({
      ...indexData.records[r.idx],
      score: r.sim,
    }));
  }

  // ==================== Worker API ====================
  async function callChatAPI(query, sources) {
    const url = `${CONFIG.workerUrl}/api/chat`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sources }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      throw new Error(`API 错误 ${resp.status}: ${err}`);
    }

    return resp.body.getReader();
  }

  // ==================== 消息渲染 ====================
  function renderMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // 换行
    html = html.replace(/\n/g, '<br>');
    return '<p>' + html + '</p>';
  }

  function addMessage(ui, role, text) {
    const el = document.createElement('div');
    el.className = `kb-chat-msg kb-chat-msg-${role}`;
    if (role === 'assistant') {
      el.innerHTML = renderMarkdown(text);
    } else {
      el.textContent = text;
    }
    ui.messages.appendChild(el);
    ui.messages.scrollTop = ui.messages.scrollHeight;
    return el;
  }

  function addSources(ui, sources) {
    ui.sources.innerHTML = '';
    ui.sources.classList.remove('kb-chat-hidden');

    const title = document.createElement('div');
    title.className = 'kb-chat-sources-title';
    title.textContent = `📖 参考来源 (${sources.length} 篇)`;
    ui.sources.appendChild(title);

    sources.forEach((s, i) => {
      const item = document.createElement('a');
      item.className = 'kb-chat-source-item';
      item.href = s.url || '#';
      item.target = '_blank';
      item.innerHTML = `<span class="kb-chat-source-idx">${i + 1}</span>
        <span class="kb-chat-source-text">
          <strong>${escapeHtml(s.title || '无标题')}</strong>
          ${s.section ? `<br><small>${escapeHtml(s.section)}</small>` : ''}
        </span>`;
      ui.sources.appendChild(item);
    });
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ==================== 流式输出 ====================
  async function* readStream(reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try { yield JSON.parse(data); } catch {}
        }
      }
    }
  }

  // ==================== 主逻辑 ====================
  async function init() {
    const ui = createChatUI();

    // 向量存储
    const embeddings = { buffer: null, count: 0, dim: 0 };
    const indexData = { records: [], dim: 0 };
    let vectorsPromise = null;  // 等待向量加载完成（resolved 或 rejected）
    let vectorsReady = false;    // 向量是否加载成功
    let isProcessing = false;

    // 对话历史
    let history = [];

    // 加载索引元数据
    try {
      const resp = await fetch(CONFIG.indexPath);
      if (resp.ok) {
        const data = await resp.json();
    // 兼容两种格式：{records, dim} 或旧版平面数组
        if (Array.isArray(data)) {
          indexData.records = data;
          indexData.dim = 2560;
        } else {
          indexData.records = data.records || [];
          indexData.dim = data.dim || 2560;
        }
        console.log(`[KB] 索引加载: ${indexData.records.length} 条记录`);
      }
    } catch (e) {
      console.warn('[KB] 索引加载失败:', e);
    }

    // 立即开始加载向量（不等待面板打开）
    ui.status.textContent = '加载向量';
    ui.status.className = 'kb-chat-status kb-chat-status-loading';
    vectorsPromise = loadVectors(ui, embeddings, indexData)
      .then(() => {
        vectorsReady = true;
        console.log('[KB] ✅ 向量就绪, buffer=', embeddings.buffer ? `${(embeddings.buffer.byteLength/1024/1024).toFixed(1)}MB` : 'null');
      })
      .catch((e) => {
        vectorsReady = false;
        console.warn('[KB] 向量加载失败:', e && e.message || e);
        ui.status.textContent = '向量未就绪';
        ui.status.className = 'kb-chat-status kb-chat-status-error';
      });

    // 展开/收起面板
    ui.trigger.addEventListener('click', () => {
      const isOpen = !ui.panel.classList.contains('kb-chat-hidden');
      if (isOpen) {
        ui.panel.classList.add('kb-chat-hidden');
      } else {
        ui.panel.classList.remove('kb-chat-hidden');
        ui.input.focus();
      }
    });

    ui.close.addEventListener('click', () => {
      ui.panel.classList.add('kb-chat-hidden');
    });

    // 清空对话
    ui.clear.addEventListener('click', () => {
      ui.messages.innerHTML = '';
      ui.sources.innerHTML = '';
      ui.sources.classList.add('kb-chat-hidden');
      history = [];
    });

    // 自动调整输入框高度
    ui.input.addEventListener('input', () => {
      ui.input.style.height = 'auto';
      ui.input.style.height = Math.min(ui.input.scrollHeight, 150) + 'px';
    });

    // 发送消息
    async function sendMessage() {
      const text = ui.input.value.trim();
      if (!text || isProcessing) return;

      isProcessing = true;
      ui.input.value = '';
      ui.input.style.height = 'auto';
      ui.send.disabled = true;

      // 显示用户消息
      addMessage(ui, 'user', text);
      history.push({ role: 'user', content: text });

      // 状态
      ui.status.textContent = '检索中';
      ui.status.className = 'kb-chat-status kb-chat-status-loading';

      let sources = [];
      try {
        // 1. 本地相似度搜索（需要先加载向量）
        // 等待向量就绪（init 阶段已开始加载，这里确保完成）
        if (vectorsPromise) {
          ui.status.textContent = '向量加载中…';
          console.log('[KB] ⏳ 等待向量加载完成…');
          try {
            await vectorsPromise;
            console.log('[KB] ✅ 向量加载完成, buffer=', embeddings.buffer ? `${(embeddings.buffer.byteLength/1024/1024).toFixed(1)}MB` : 'null');
          } catch (e) {
            console.warn('[KB] 向量加载失败，将跳过本地搜索:', e && e.message);
          }
        }

        // 本地向量搜索
        if (embeddings.buffer && indexData.records.length > 0) {
          console.log('[KB] 🔍 开始本地向量搜索, records=', indexData.records.length, 'dim=', embeddings.dim);
          try {
            const embResp = await fetch(`${CONFIG.workerUrl}/api/embed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text }),
            });
            
            if (embResp.ok) {
              const queryVec = await embResp.json();
              console.log('[KB] 📐 获取嵌入向量, dim=', Array.isArray(queryVec) ? queryVec.length : '?');
              sources = searchSimilar(embeddings, indexData, queryVec, CONFIG.topK);
              console.log('[KB] 📊 搜索完成, 命中=', sources.length, 'top3 score=', sources.slice(0,3).map(s=>s.score?.toFixed(4)));
            } else {
              console.warn('[KB] ⚠️ embed API 返回错误:', embResp.status);
            }
          } catch (e) {
            console.warn('[KB] embed 请求失败:', e && e.message);
          }
        } else {
          console.warn('[KB] ⚠️ 跳过本地搜索 — buffer=', !!embeddings.buffer, 'records=', indexData.records.length);
        }

        // 2. 显示来源
        if (sources.length > 0) {
          addSources(ui, sources);
        }

        // 3. 调用 LLM
        ui.status.textContent = '回答中';
        const reader = await callChatAPI(text, sources);

        // 4. 流式渲染
        const msgEl = addMessage(ui, 'assistant', '');
        let fullText = '';
        for await (const chunk of readStream(reader)) {
          const delta = chunk.choices?.[0]?.delta?.content || '';
          fullText += delta;
          msgEl.innerHTML = renderMarkdown(fullText);
          ui.messages.scrollTop = ui.messages.scrollHeight;
        }

        history.push({ role: 'assistant', content: fullText });
        ui.status.textContent = '就绪';
        ui.status.className = 'kb-chat-status kb-chat-status-ready';

      } catch (e) {
        console.error('[KB] 错误:', e);
        addMessage(ui, 'assistant', `抱歉，出错了：${e.message}`);
        ui.status.textContent = '错误';
        ui.status.className = 'kb-chat-status kb-chat-status-error';
      }

      isProcessing = false;
      ui.send.disabled = false;
      ui.input.focus();
    }

    ui.send.addEventListener('click', sendMessage);
    ui.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // ==================== 启动 ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
