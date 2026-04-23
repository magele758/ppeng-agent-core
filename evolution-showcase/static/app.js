/**
 * Evolution showcase — 按结果类型分组；来源、原因、沉淀。
 */
(function () {
  const OUTCOME_ORDER = ['success', 'failure', 'no-op', 'skip', 'superseded'];
  const OUTCOME_LABELS = {
    success: '成功',
    failure: '失败',
    'no-op': '未采纳',
    skip: '无改动跳过',
    superseded: '已取代',
    _other: '其他'
  };

  /** 与 build 产物一致；兼容历史/别名，避免进不了分组 */
  function normalizeOutcome(raw) {
    const s = raw == null ? '' : String(raw).trim();
    if (!s) return '_other';
    if (OUTCOME_ORDER.includes(s)) return s;
    const compact = s.toLowerCase().replace(/_/g, '-');
    if (OUTCOME_ORDER.includes(compact)) return compact;
    const aliases = {
      noop: 'no-op',
      'no-op': 'no-op',
      skipped: 'skip',
      supersede: 'superseded',
      replaced: 'superseded'
    };
    if (aliases[compact]) return aliases[compact];
    return '_other';
  }

  /** 组内排序：优先 dateUtc，否则从 id 前缀 YYYY-MM-DD 推断 */
  function itemSortKey(item) {
    const iso = item.dateUtc;
    if (iso) {
      const t = Date.parse(iso);
      if (!Number.isNaN(t)) return t;
    }
    const id = item.id || '';
    const m = id.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) {
      const t = Date.parse(`${m[1]}T23:59:59.999Z`);
      if (!Number.isNaN(t)) return t;
    }
    return 0;
  }

  function sortGroupByDateDesc(items) {
    return items.slice().sort((a, b) => itemSortKey(b) - itemSortKey(a));
  }

  function getSelectedOutcomes() {
    const host = document.getElementById('outcomeFilters');
    if (!host) return new Set([...OUTCOME_ORDER, '_other']);
    const s = new Set();
    for (const cb of host.querySelectorAll('input[type="checkbox"]')) {
      if (cb.checked && cb.dataset.outcome) s.add(cb.dataset.outcome);
    }
    return s;
  }

  function wireOutcomeFilters() {
    const host = document.getElementById('outcomeFilters');
    const allBtn = document.getElementById('filterAll');
    const noneBtn = document.getElementById('filterNone');
    if (!host) return;
    host.innerHTML = '';
    for (const key of [...OUTCOME_ORDER, '_other']) {
      const safeId = `filter-${key.replace(/[^a-z0-9]/gi, '-')}`;
      const lab = document.createElement('label');
      lab.className = 'filter-chip';
      lab.htmlFor = safeId;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = safeId;
      cb.dataset.outcome = key;
      cb.checked = true;
      cb.addEventListener('change', () => renderList());
      const span = document.createElement('span');
      span.textContent = OUTCOME_LABELS[key] || key;
      lab.appendChild(cb);
      lab.appendChild(span);
      host.appendChild(lab);
    }
    if (allBtn) {
      allBtn.onclick = () => {
        host.querySelectorAll('input[type="checkbox"]').forEach((c) => {
          c.checked = true;
        });
        renderList();
      };
    }
    if (noneBtn) {
      noneBtn.onclick = () => {
        host.querySelectorAll('input[type="checkbox"]').forEach((c) => {
          c.checked = false;
        });
        renderList();
      };
    }
  }

  /** @type {{ q: HTMLInputElement | null, groupedRecords: HTMLElement | null, listCount: HTMLElement | null, loadError: HTMLElement | null }} */
  let els = {
    q: null,
    groupedRecords: null,
    listCount: null,
    loadError: null
  };

  function bindEls() {
    els = {
      q: document.getElementById('q'),
      groupedRecords: document.getElementById('groupedRecords'),
      listCount: document.getElementById('listCount'),
      loadError: document.getElementById('loadError')
    };
    return els;
  }

  let rawItems = [];

  function getFilteredItems() {
    let list = [...rawItems];
    const qv = (els.q && els.q.value ? els.q.value : '').trim().toLowerCase();
    if (qv) {
      list = list.filter((i) => (i.title || '').toLowerCase().includes(qv));
    }
    return list;
  }

  function groupByOutcome(items) {
    const map = new Map();
    for (const key of OUTCOME_ORDER) {
      map.set(key, []);
    }
    map.set('_other', []);
    for (const item of items) {
      const k = normalizeOutcome(item.outcome);
      map.get(k).push(item);
    }
    if (map.get('_other').length === 0) {
      map.delete('_other');
    }
    return map;
  }

  /** UTC 日历日 YYYY-MM-DD，无有效日期时返回空串 */
  function utcDayKey(dateUtc) {
    if (!dateUtc || typeof dateUtc !== 'string') return '';
    const d = new Date(dateUtc);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function appendDayDivider(ul, dayKey) {
    const li = document.createElement('li');
    li.className = 'day-divider';
    li.setAttribute('role', 'presentation');
    const time = document.createElement('time');
    if (dayKey) time.dateTime = dayKey;
    time.textContent = dayKey ? dayKey.replace(/-/g, '·') : '日期未知';
    li.appendChild(time);
    ul.appendChild(li);
  }

  function addReasonBlock(container, label, text) {
    if (!text || !String(text).trim()) return;
    const wrap = document.createElement('div');
    wrap.className = 'reason-block';
    const lb = document.createElement('span');
    lb.className = 'reason-label';
    lb.textContent = label;
    const p = document.createElement('p');
    p.className = 'reason-text';
    p.textContent = text;
    wrap.appendChild(lb);
    wrap.appendChild(p);
    container.appendChild(wrap);
  }

  function renderCard(item) {
    const li = document.createElement('li');
    li.className = 'record-item';

    const article = document.createElement('article');
    article.className = 'record-article';

    const row = document.createElement('div');
    row.className = 'record-head';
    if (item.skipTag) {
      const tag = document.createElement('span');
      tag.className = 'skip-tag';
      tag.title = '研究门控标签';
      tag.textContent = item.skipTag;
      row.appendChild(tag);
    }
    const h3 = document.createElement('h3');
    h3.className = 'record-title';
    h3.textContent = item.title || item.id || '（无标题）';
    row.appendChild(h3);

    const sourceP = document.createElement('p');
    sourceP.className = 'record-source';
    if (item.sourceUrl) {
      const a = document.createElement('a');
      a.href = item.sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.sourceUrl;
      sourceP.appendChild(document.createTextNode('来源 · '));
      sourceP.appendChild(a);
    } else {
      sourceP.textContent = '来源 · （无外链）';
    }

    let commitP = null;
    if (item.mergeCommit) {
      commitP = document.createElement('p');
      commitP.className = 'record-commit';
      commitP.appendChild(document.createTextNode('主仓合并提交 · '));
      if (item.commitUrl) {
        const ca = document.createElement('a');
        ca.href = item.commitUrl;
        ca.target = '_blank';
        ca.rel = 'noopener noreferrer';
        ca.title = item.mergeCommit;
        ca.textContent =
          item.mergeCommit.length > 7 ? `${item.mergeCommit.slice(0, 7)}…` : item.mergeCommit;
        commitP.appendChild(ca);
      } else {
        const code = document.createElement('code');
        code.className = 'commit-sha';
        code.textContent = item.mergeCommit;
        commitP.appendChild(code);
        commitP.appendChild(document.createTextNode('（构建未配置 GitHub 仓库，无跳转）'));
      }
    }

    const reasons = document.createElement('div');
    reasons.className = 'record-reasons';
    addReasonBlock(reasons, '为何继续演进（研究）', item.reasonChosen);
    addReasonBlock(reasons, '为何未采纳 / 跳过', item.reasonSkipped);
    addReasonBlock(reasons, '失败原因', item.reasonFailed);

    article.appendChild(row);
    article.appendChild(sourceP);
    if (commitP) article.appendChild(commitP);
    article.appendChild(reasons);

    if (item.summary && String(item.summary).trim()) {
      const dep = document.createElement('div');
      dep.className = 'record-deposit';
      const depositLabel = document.createElement('span');
      depositLabel.className = 'deposit-label';
      depositLabel.textContent = '沉淀 / 落地摘要';
      const depositText = document.createElement('p');
      depositText.className = 'deposit-text';
      depositText.textContent = item.summary;
      dep.appendChild(depositLabel);
      dep.appendChild(depositText);
      article.appendChild(dep);
    }

    li.appendChild(article);
    return li;
  }

  function renderList() {
    if (!els.groupedRecords || !els.listCount) return;
    const selected = getSelectedOutcomes();
    if (selected.size === 0) {
      els.groupedRecords.innerHTML = '';
      els.listCount.textContent = '请至少勾选一种结果类型';
      return;
    }

    const items = getFilteredItems();
    const groups = groupByOutcome(items);
    els.groupedRecords.innerHTML = '';

    const parts = [];
    let total = 0;
    const displayOrder = [...OUTCOME_ORDER, '_other'];

    for (const key of displayOrder) {
      if (!selected.has(key)) continue;
      let groupItems = groups.get(key);
      if (!groupItems || groupItems.length === 0) continue;
      groupItems = sortGroupByDateDesc(groupItems);
      total += groupItems.length;

      const section = document.createElement('section');
      section.className = 'outcome-group';
      section.id = `outcome-${key.replace(/[^a-z0-9-]/gi, '-')}`;

      const h2 = document.createElement('h2');
      h2.className = 'outcome-group-title';
      const label = OUTCOME_LABELS[key] || key;
      h2.textContent = `${label} · ${groupItems.length}`;

      const ul = document.createElement('ul');
      ul.className = 'record-list';
      let prevDay = null;
      for (const item of groupItems) {
        const dk = utcDayKey(item.dateUtc);
        if (dk !== prevDay) {
          appendDayDivider(ul, dk);
          prevDay = dk;
        }
        ul.appendChild(renderCard(item));
      }

      section.appendChild(h2);
      section.appendChild(ul);
      els.groupedRecords.appendChild(section);
      parts.push(`${label} ${groupItems.length}`);
    }

    if (total === 0) {
      els.listCount.textContent = items.length === 0 && rawItems.length > 0 ? '无匹配' : '暂无数据';
    } else {
      els.listCount.textContent = `共 ${total} 条 · ${parts.join('，')}`;
    }
  }

  function showError(msg) {
    const el = els.loadError || document.getElementById('loadError');
    if (el) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      console.error(msg);
    }
  }

  async function init() {
    bindEls();
    if (!els.groupedRecords || !els.listCount) {
      showError(
        '页面缺少 #groupedRecords / #listCount，请与 evolution-showcase/static/index.html 一并部署。'
      );
      return;
    }
    try {
      const res = await fetch('data/evolution.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      rawItems = Array.isArray(data.items) ? data.items : [];

      wireOutcomeFilters();
      if (els.q) els.q.oninput = () => renderList();
      renderList();
      if (els.loadError) els.loadError.hidden = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showError(`无法加载或渲染 data/evolution.json：${msg}`);
    }
  }

  function start() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  start();
})();
