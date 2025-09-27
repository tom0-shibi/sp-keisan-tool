const CSV_PATH = 'skills.csv';
const CATEGORY_OPTIONS = ['', '継承固有', '緑スキル', '通常スキル', 'シナリオ・特殊'];
const HINT_PERCENT = [0, 10, 20, 30, 35, 40];

let skills = [];            // CSV レコード配列
let skillById = new Map();  // id -> record
let nextRowId = 1;

// suggestion UI state
const suggestionState = new WeakMap();
const suggestionRegistry = [];

/* ---------- ユーティリティ: Unicode 対応 base64 ---------- */
function base64EncodeUnicode(str) {
  // Unicode safe base64
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (_, p1) {
    return String.fromCharCode('0x' + p1);
  }));
}
function base64DecodeUnicode(str) {
  return decodeURIComponent(Array.prototype.map.call(atob(str), function (c) {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
}

/* ---------- 文字列正規化（検索用） ----------
   - NFKC 変換、小文字化
   - カタカナ -> ひらがな（簡易）
   - 長音符（ー）を削除
   - 記号/空白を除去（Unicode property が使えない環境のためフォールバックあり）
------------------------------------------- */
function normalizeForSearch(src = '') {
  if (!src) return '';
  let s = src.normalize('NFKC').toLowerCase().trim();
  // カタカナをひらがなに（U+30A1 - U+30F6 -> -0x60）
  s = s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  s = s.replace(/ー/g, '');
  try {
    s = s.replace(/[\p{P}\p{S}\s]+/gu, '');
  } catch (e) {
    s = s.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。・「」『』（）［］｛｝〈〉《》【】〜…\s]+/g, '');
  }
  return s;
}

/* ---------- CSV parser（ダブルクオート対応） ---------- */
function parseCSV(text) {
  const rows = [];
  let cur = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(cur); cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') continue;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.map(r => r.map(c => c.replace(/^"|"$/g, '').trim()));
}

/* ---------- CSV 読込 ---------- */
async function loadCSV() {
  try {
    const resp = await fetch(CSV_PATH, { cache: 'no-store' });
    if (!resp.ok) throw new Error('CSV fetch failed: ' + resp.status);
    const text = await resp.text();
    const parsed = parseCSV(text).filter(r => r.length > 0);
    if (parsed.length === 0) return;
    const headers = parsed.shift().map(h => h.trim());
    skills = parsed.map((rowRaw, idx) => {
      const row = rowRaw.slice();
      if (row.length < headers.length) {
        while (row.length < headers.length) row.push('');
        console.warn(`CSV: row ${idx + 2} 列不足を補完しました`);
      }
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i] !== undefined ? row[i] : '');
      obj.sp = obj.sp ? (parseInt(obj.sp, 10) || 0) : 0;
      obj._normName = normalizeForSearch(obj.skill || '');
      obj._readings = (obj.reading || '').split('|').map(s => normalizeForSearch(s)).filter(Boolean);
      obj._childIds = (obj.child_id || '').toString().split(/[|,]/).map(s => s.trim()).filter(Boolean);
      return obj;
    });
    skillById = new Map();
    skills.forEach(s => skillById.set(String(s.id), s));
    renderTableInitial();
    return true;
  } catch (err) {
    console.error(err);
    alert('skills.csv の読み込みに失敗しました。コンソールを確認してください。');
    return false;
  }
}

/* ---------- 初期描画（必須） ---------- */
function renderTableInitial() {
  const tbody = document.querySelector('#skillTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  addRow();
  updateTotalSP();
}

/* ---------- SP 計算 / 合計更新 ---------- */
function calcSP(baseSP, hintLv, isKire) {
  const hintPct = HINT_PERCENT[hintLv] !== undefined ? HINT_PERCENT[hintLv] : 0;
  const totalPct = hintPct + (isKire ? 10 : 0);
  const val = Math.floor(baseSP * (1 - totalPct / 100));
  return val >= 0 ? val : 0;
}
function updateTotalSP() {
  let total = 0;
  document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
    const sp = parseInt(tr.querySelector('.sp')?.textContent || '0', 10) || 0;
    total += sp;
  });
  const el = document.getElementById('totalSP');
  if (el) el.textContent = String(total);
}

/* ---------- 検索ロジック: findMatches ----------
   - 空クエリ -> カテゴリで絞った全件（=空入力で候補）
   - ひらがな/カタカナを含む場合 (hasKana) は reading を優先的に部分一致判定
   - スコア順にソート（完全一致 > reading 完全一致 > reading 部分一致 > name 部分一致 > ...）
------------------------------------------- */
function findMatches(queryRaw = '', categoryFilter = '', limit = 200) {
  const rawTrim = (queryRaw || '').trim();
  const q = normalizeForSearch(rawTrim);
  const hasKana = /[ぁ-んァ-ンー]/.test(rawTrim);
  const filterCategory = (s) => { if (!categoryFilter) return true; return (s.category || '').trim() === categoryFilter; };

  if (!q) return skills.filter(filterCategory).slice(0, limit);

  const results = [];
  for (const s of skills) {
    if (!filterCategory(s)) continue;
    const name = s._normName || '';
    const readings = s._readings || [];
    if (name === q) { results.push({ s, score: 0 }); continue; }
    if (readings.some(r => r === q)) { results.push({ s, score: 1 }); continue; }
    if (hasKana) {
      if (readings.some(r => r.includes(q))) { results.push({ s, score: 2 }); continue; }
      if (name.includes(q)) { results.push({ s, score: 3 }); continue; }
    } else {
      if (name.includes(q)) { results.push({ s, score: 2 }); continue; }
      if (readings.some(r => r.includes(q))) { results.push({ s, score: 3 }); continue; }
    }
    if ((s.skill || '').toLowerCase().includes(rawTrim.toLowerCase())) results.push({ s, score: 4 });
  }
  results.sort((a, b) => (a.score - b.score) || a.s.skill.localeCompare(b.s.skill));
  return results.map(r => r.s).slice(0, limit);
}

/* ---------- テーブル内に既にスキルが存在するか判定 ---------- */
function isSkillAlreadyInTable(skillId) {
  if (!skillId) return false;
  return Array.from(document.querySelectorAll('#skillTable tbody tr'))
    .some(r => r.dataset.skillId === String(skillId));
}

/* ---------- 再帰的に子スキルを追加（親選択時に呼ぶ） ----------
   - 循環を visited で防ぐ
   - 自動追加フラグを dataset.autoAddedBy に付与（だが削除は行単位でユーザに任せる）
------------------------------------------- */
function addChildrenRecursively(parentTr, skillObj, visited = new Set()) {
  if (!skillObj || !skillObj._childIds || skillObj._childIds.length === 0) return;
  visited.add(String(skillObj.id));
  let insertAfter = parentTr;

  for (const childId of skillObj._childIds) {
    if (visited.has(String(childId))) continue;
    const childSkill = skillById.get(String(childId));
    if (!childSkill) {
      console.warn(`child_id ${childId} が見つかりません`);
      continue;
    }
    if (isSkillAlreadyInTable(childSkill.id)) {
      const existing = Array.from(document.querySelectorAll('#skillTable tbody tr'))
        .find(r => r.dataset.skillId === String(childSkill.id));
      if (existing) insertAfter = existing;
      continue;
    }
    const childTr = addRow(insertAfter);
    childTr.dataset.autoAddedBy = parentTr.dataset.rowId;
    setRowFromSkill(childTr, childSkill);
    insertAfter = childTr;
    const newVis = new Set(visited);
    addChildrenRecursively(childTr, childSkill, newVis);
  }
}

/* ---------- Suggestion UI: box 管理 ---------- */
function createOrGetSuggestionBox(tr) {
  let st = suggestionState.get(tr);
  if (st) return st;
  const box = document.createElement('div');
  box.className = 'skill-suggestions';
  Object.assign(box.style, {
    position: 'absolute', zIndex: 9999, background: '#fff',
    border: '1px solid rgba(0,0,0,0.12)', boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
    maxHeight: '260px', overflowY: 'auto', fontSize: '14px', display: 'none',
  });
  document.body.appendChild(box);
  st = { box, items: [], highlightedIndex: -1, attachedTo: tr, hideTimeout: null };
  suggestionState.set(tr, st);
  suggestionRegistry.push(st);
  return st;
}
function positionSuggestionBox(tr) {
  const st = suggestionState.get(tr);
  if (!st) return;
  const input = tr.querySelector('.skill-input');
  const rect = input.getBoundingClientRect();
  st.box.style.minWidth = Math.max(220, rect.width) + 'px';
  st.box.style.left = (rect.left + window.pageXOffset) + 'px';
  st.box.style.top = (rect.bottom + window.pageYOffset + 4) + 'px';
}
function hideSuggestionBox(tr) {
  const st = suggestionState.get(tr);
  if (!st) return;
  st.box.style.display = 'none';
  st.items = []; st.highlightedIndex = -1;
}
function highlightSuggestion(tr, idx) {
  const st = suggestionState.get(tr);
  if (!st) return;
  const items = st.items;
  if (st.highlightedIndex >= 0 && st.highlightedIndex < items.length) items[st.highlightedIndex].style.background = '';
  st.highlightedIndex = idx;
  if (idx >= 0 && idx < items.length) {
    items[idx].style.background = 'rgba(0,0,0,0.06)';
    const it = items[idx], box = st.box;
    const bRect = box.getBoundingClientRect(), itRect = it.getBoundingClientRect();
    if (itRect.top < bRect.top) box.scrollTop -= (bRect.top - itRect.top);
    if (itRect.bottom > bRect.bottom) box.scrollTop += (itRect.bottom - bRect.bottom);
  }
}
function selectSuggestion(tr, skillObj) {
  // カテゴリが空なら自動でセット
  const catSel = tr.querySelector('.category-select');
  if (catSel && (!catSel.value || catSel.value === '')) {
    if (skillObj.category) catSel.value = skillObj.category;
  }
  setRowFromSkill(tr, skillObj);
  addChildrenRecursively(tr, skillObj, new Set([String(skillObj.id)]));
  hideSuggestionBox(tr);
}
function showSuggestionsForRow(tr, query = '') {
  const st = createOrGetSuggestionBox(tr);
  const selCat = (tr.querySelector('.category-select')?.value || '').trim();
  const matches = findMatches(query, selCat, 200);
  const box = st.box;
  box.innerHTML = '';
  st.items = []; st.highlightedIndex = -1;
  matches.forEach((s, idx) => {
    const item = document.createElement('div');
    item.className = 'skill-suggestion-item';
    item.dataset.skillId = String(s.id);
    item.textContent = s.skill;
    Object.assign(item.style, { padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
    // mousedown を使って blur 前に選択を確定
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectSuggestion(tr, s); });
    item.addEventListener('mouseover', () => highlightSuggestion(tr, idx));
    box.appendChild(item);
    st.items.push(item);
  });
  if (st.items.length === 0) {
    const info = document.createElement('div');
    info.style.padding = '6px 10px'; info.style.color = '#777';
    info.textContent = '候補が見つかりません';
    box.appendChild(info);
  }
  positionSuggestionBox(tr);
  box.style.display = 'block';
}

/* ---------- キーボードで候補操作 ---------- */
function handleKeyNavigation(e, tr) {
  const st = suggestionState.get(tr);
  if (!st || st.items.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = Math.min(st.items.length - 1, (st.highlightedIndex + 1) || 0);
    highlightSuggestion(tr, next);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = Math.max(0, (st.highlightedIndex - 1));
    highlightSuggestion(tr, prev);
  } else if (e.key === 'Enter') {
    if (st.highlightedIndex >= 0 && st.highlightedIndex < st.items.length) {
      e.preventDefault();
      const si = st.items[st.highlightedIndex];
      const sid = si.dataset.skillId;
      const skillObj = skillById.get(String(sid));
      if (skillObj) selectSuggestion(tr, skillObj);
    }
  } else if (e.key === 'Escape') {
    hideSuggestionBox(tr);
  }
}

/* ---------- 行にスキルを反映 ---------- */
function setRowFromSkill(tr, skillObj) {
  if (!tr || !skillObj) return;
  const input = tr.querySelector('.skill-input');
  const catSel = tr.querySelector('.category-select');
  const hintSel = tr.querySelector('.hint-select');
  const tdSp = tr.querySelector('.sp');
  const tdTags = tr.querySelector('.tags');
  const tdExplain = tr.querySelector('.explain');

  if (input) input.value = skillObj.skill || '';
  tr.dataset.skillId = String(skillObj.id || '');
  if (catSel && skillObj.category) catSel.value = skillObj.category;

  const hintLv = hintSel ? parseInt(hintSel.value, 10) || 0 : 0;
  const isKire = document.getElementById('kiremonoHeader')?.checked;
  tdSp.textContent = String(calcSP((skillObj.sp || 0), hintLv, isKire));

  const tagsText = (skillObj.tags || '').replace(/\|/g, '・');
  tdTags.innerHTML = '';
  const tagsDiv = document.createElement('div');
  tagsDiv.className = 'tags-clamp';
  tagsDiv.textContent = tagsText;
  if (tagsText) tagsDiv.title = tagsText;
  tdTags.appendChild(tagsDiv);

  const full = String(skillObj.explain || '');
  tdExplain.innerHTML = '';
  const explainDiv = document.createElement('div');
  explainDiv.className = 'explain-clamp';
  explainDiv.textContent = full;
  if (full) explainDiv.title = full;
  tdExplain.appendChild(explainDiv);

  updateTotalSP();
}

/* ---------- 行作成 + イベントバインド ---------- */
function addRow(afterTr = null) {
  const tbody = document.querySelector('#skillTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = String(nextRowId++);
  tr.setAttribute('draggable', 'true');

  // 削除セル
  const tdRemove = document.createElement('td');
  tdRemove.className = 'text-center align-middle';
  const btnRemove = document.createElement('button');
  btnRemove.type = 'button';
  btnRemove.className = 'btn btn-sm btn-outline-danger remove-row';
  btnRemove.title = '行を削除';
  btnRemove.textContent = '−';
  tdRemove.appendChild(btnRemove);
  tr.appendChild(tdRemove);

  // 分類
  const tdCategory = document.createElement('td');
  tdCategory.className = 'align-middle category';
  const selectCat = document.createElement('select');
  selectCat.className = 'form-select category-select';
  CATEGORY_OPTIONS.forEach(opt => {
    const o = document.createElement('option'); o.value = opt; o.textContent = opt; selectCat.appendChild(o);
  });
  tdCategory.appendChild(selectCat);
  tr.appendChild(tdCategory);

  // スキル名入力（内側にクリアボタン）
  const tdSkill = document.createElement('td');
  tdSkill.className = 'align-middle skill';
  const skillWrapper = document.createElement('div');
  skillWrapper.className = 'skill-input-wrapper';
  const inputSkill = document.createElement('input');
  inputSkill.type = 'text'; inputSkill.className = 'form-control skill-input'; inputSkill.placeholder = 'スキル名を入力';
  const btnClear = document.createElement('button');
  btnClear.type = 'button'; btnClear.className = 'btn btn-sm btn-clear-skill'; btnClear.title = 'スキル名をクリア'; btnClear.innerHTML = '✕';
  skillWrapper.appendChild(inputSkill); skillWrapper.appendChild(btnClear);
  tdSkill.appendChild(skillWrapper);
  tr.appendChild(tdSkill);

  // SP
  const tdSp = document.createElement('td'); tdSp.className = 'sp text-center align-middle'; tdSp.textContent = '0'; tr.appendChild(tdSp);

  // ヒント
  const tdHint = document.createElement('td'); tdHint.className = 'align-middle';
  const selectHint = document.createElement('select'); selectHint.className = 'form-select hint-select';
  for (let i = 0; i <= 5; i++) { const o = document.createElement('option'); o.value = i; o.textContent = i; selectHint.appendChild(o); }
  tdHint.appendChild(selectHint); tr.appendChild(tdHint);

  // tags
  const tdTags = document.createElement('td'); tdTags.className = 'tags align-middle'; tdTags.textContent = ''; tr.appendChild(tdTags);

  // explain
  const tdExplain = document.createElement('td'); tdExplain.className = 'explain align-middle'; tdExplain.textContent = ''; tr.appendChild(tdExplain);

  // insert
  if (afterTr && afterTr.parentNode === tbody) tbody.insertBefore(tr, afterTr.nextSibling);
  else tbody.appendChild(tr);

  /* イベントバインド */
  inputSkill.addEventListener('input', (e) => { showSuggestionsForRow(tr, e.target.value); });
  inputSkill.addEventListener('focus', () => { showSuggestionsForRow(tr, inputSkill.value || ''); });
  inputSkill.addEventListener('keydown', (e) => handleKeyNavigation(e, tr));
  inputSkill.addEventListener('blur', () => {
    const st = suggestionState.get(tr);
    if (!st) return;
    st.hideTimeout = setTimeout(() => hideSuggestionBox(tr), 150);
  });

  inputSkill.addEventListener('change', () => {
    const text = inputSkill.value || '';
    const cat = (selectCat.value || '').trim();
    const matches = findMatches(text, cat, 1);
    if (matches.length > 0) {
      const s = matches[0];
      if ((!selectCat.value || selectCat.value === '') && s.category) selectCat.value = s.category;
      setRowFromSkill(tr, s);
      addChildrenRecursively(tr, s, new Set([String(s.id)]));
    } else {
      delete tr.dataset.skillId;
      tr.querySelector('.sp').textContent = '0';
      tr.querySelector('.tags').innerHTML = '';
      tr.querySelector('.explain').innerHTML = '';
      updateTotalSP();
    }
    hideSuggestionBox(tr);
  });

  btnClear.addEventListener('click', () => {
    inputSkill.value = '';
    selectCat.value = '';
    delete tr.dataset.skillId;
    tr.querySelector('.sp').textContent = '0';
    tr.querySelector('.tags').innerHTML = '';
    tr.querySelector('.explain').innerHTML = '';
    updateTotalSP();
    showSuggestionsForRow(tr, ''); // 全件候補を表示
    inputSkill.focus();
  });

  selectCat.addEventListener('change', () => { showSuggestionsForRow(tr, inputSkill.value || ''); });

  selectHint.addEventListener('change', () => {
    const sid = tr.dataset.skillId;
    if (sid) {
      const s = skillById.get(String(sid));
      if (s) setRowFromSkill(tr, s);
    }
  });

  btnRemove.addEventListener('click', () => {
    const rows = document.querySelectorAll('#skillTable tbody tr');
    if (rows.length <= 1) {
      inputSkill.value = ''; selectCat.value = ''; selectHint.value = 0; delete tr.dataset.skillId;
      tr.querySelector('.sp').textContent = '0'; tr.querySelector('.tags').innerHTML = ''; tr.querySelector('.explain').innerHTML = '';
      updateTotalSP(); return;
    }
    tr.remove(); updateTotalSP();
  });

  // drag/drop (既存の動作と同様)
  tr.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tr.dataset.rowId); tr.classList.add('dragging'); });
  tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
  tr.addEventListener('dragover', (e) => e.preventDefault());
  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain'); if (!draggedId) return;
    const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`); if (!dragged || dragged === tr) return;
    tr.parentNode.insertBefore(dragged, tr); updateTotalSP();
  });

  // tbody drop
  const tbodyEl = document.querySelector('#skillTable tbody');
  if (!tbodyEl._dropBound) {
    tbodyEl.addEventListener('dragover', (e) => e.preventDefault());
    tbodyEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain'); if (!draggedId) return;
      const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`); if (!dragged) return;
      const targetRow = e.target.closest('tr');
      if (targetRow) tbodyEl.insertBefore(dragged, targetRow); else tbodyEl.appendChild(dragged);
      updateTotalSP();
    });
    tbodyEl._dropBound = true;
  }

  return tr;
}

/* ---------- 保存 / 読込 / 共有 機能 ---------- */

// テーブルから現在の一覧データを抽出
function getCurrentTableDataForSave() {
  const rows = [];
  document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
    const category = tr.querySelector('.category-select')?.value || '';
    const skillId = tr.dataset.skillId || '';
    const skillName = tr.querySelector('.skill-input')?.value || '';
    const hintLv = parseInt(tr.querySelector('.hint-select')?.value || '0', 10) || 0;
    // 保存時には autoAddedBy も保存しておく（復元時に尊重できる）
    const autoAddedBy = tr.dataset.autoAddedBy || '';
    rows.push({ category, skillId, skillName, hintLv, autoAddedBy });
  });
  const kiremono = document.getElementById('kiremonoHeader')?.checked || false;
  return { rows, kiremono };
}

// テーブルに一覧データを適用（上書き）
function applyListData(listData) {
  const tbody = document.querySelector('#skillTable tbody');
  if (!tbody) return;
  // clear existing
  tbody.innerHTML = '';
  nextRowId = 1; // reset row id counter (optional)
  // restore kiremono
  if (listData.kiremono !== undefined) {
    const k = document.getElementById('kiremonoHeader');
    if (k) k.checked = !!listData.kiremono;
  }
  // add rows
  (listData.rows || []).forEach(r => {
    const tr = addRow();
    // If skillId exists and known, use it; otherwise try best-match by name
    let skillObj = null;
    if (r.skillId && skillById.has(String(r.skillId))) {
      skillObj = skillById.get(String(r.skillId));
    } else if (r.skillName) {
      // try exact name first then fuzzy findMatches fallback
      skillObj = skills.find(s => (s.skill || '').toLowerCase() === (r.skillName || '').toLowerCase());
      if (!skillObj) {
        const cand = findMatches(r.skillName, r.category || '', 1);
        if (cand && cand.length > 0) skillObj = cand[0];
      }
    }
    // set category/hint regardless
    const catSel = tr.querySelector('.category-select');
    if (catSel && r.category) catSel.value = r.category;
    const hintSel = tr.querySelector('.hint-select');
    if (hintSel && typeof r.hintLv !== 'undefined') hintSel.value = r.hintLv;

    if (skillObj) {
      setRowFromSkill(tr, skillObj);
      if (skillObj._childIds && skillObj._childIds.length > 0) {
        // replicate behavior: add children when parent restored
        addChildrenRecursively(tr, skillObj, new Set([String(skillObj.id)]));
      }
    } else {
      // skill not found — display name raw
      const input = tr.querySelector('.skill-input');
      if (input && r.skillName) input.value = r.skillName;
      delete tr.dataset.skillId;
      tr.querySelector('.sp').textContent = '0';
      tr.querySelector('.tags').innerHTML = '';
      tr.querySelector('.explain').innerHTML = '';
    }
  });
  updateTotalSP();
}

// 保存: ポップアップでスロット(0-9), タイトル, メモを入力して localStorage に保存
function saveList() {
  const slotStr = prompt('保存するスロット番号を入力してください（0-9）:');
  if (slotStr === null) return;
  const slot = parseInt(slotStr, 10);
  if (isNaN(slot) || slot < 0 || slot > 9) { alert('0〜9 の整数を入力してください。'); return; }

  if (!confirm(`スロット ${slot} に現在の一覧を保存しますか？`)) return;

  const title = prompt('この保存にタイトルを付けてください（任意）:', '') || '';
  if (title === null) return; // cancel
  const memo = prompt('メモ（任意）:', '') || '';
  if (memo === null) return;

  const payload = getCurrentTableDataForSave();
  payload.title = title;
  payload.memo = memo;
  payload.timestamp = Date.now();

  try {
    localStorage.setItem('umamusume_slot_' + slot, JSON.stringify(payload));
    alert(`スロット ${slot} に保存しました。`);
  } catch (e) {
    console.error(e);
    alert('保存に失敗しました（localStorage）。');
  }
}

// 読込: スロット一覧を表示して番号入力で読み込み（上書き）
function loadList() {
  const slots = [];
  for (let i = 0; i < 10; i++) {
    const raw = localStorage.getItem('umamusume_slot_' + i);
    if (raw) {
      try {
        const d = JSON.parse(raw);
        const date = d.timestamp ? new Date(d.timestamp).toLocaleString() : '日時不明';
        slots.push(`${i}: ${d.title || '(無題)'} — ${date}`);
      } catch {
        slots.push(`${i}: <破損データ>`);
      }
    } else {
      slots.push(`${i}: （空）`);
    }
  }
  const listText = slots.join('\n');
  const choice = prompt('読み込むスロットを選んでください（0-9）:\n' + listText);
  if (choice === null) return;
  const slotNum = parseInt(choice, 10);
  if (isNaN(slotNum) || slotNum < 0 || slotNum > 9) { alert('0〜9 の整数を入力してください。'); return; }
  const raw = localStorage.getItem('umamusume_slot_' + slotNum);
  if (!raw) { alert('選択スロットは空です。'); return; }
  if (!confirm(`スロット ${slotNum} を読み込みます。現在の一覧は上書きされます。よろしいですか？`)) return;
  try {
    const d = JSON.parse(raw);
    applyListData(d);
    alert(`スロット ${slotNum} を読み込みました: ${d.title || '(無題)'}`);
  } catch (e) {
    console.error(e);
    alert('読み込みに失敗しました（データ破損の可能性）。');
  }
}

// 共有: 現在の一覧を base64(U) で URL に埋め込んで prompt 表示
function shareList() {
  const payload = getCurrentTableDataForSave();
  try {
    const json = JSON.stringify(payload);
    const encoded = base64EncodeUnicode(json);
    const url = window.location.origin + window.location.pathname + '?data=' + encodeURIComponent(encoded);
    prompt('このリンクをコピーして共有してください:', url);
  } catch (e) {
    console.error(e);
    alert('共有リンクの生成に失敗しました。');
  }
}

// 起動時に URL パラメータ data があれば復元（自動）
function processSharedParamIfAny() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('data')) return;
  try {
    const enc = params.get('data');
    if (!enc) return;
    const decoded = base64DecodeUnicode(decodeURIComponent(enc));
    const obj = JSON.parse(decoded);
    // そのまま適用（上書き）
    applyListData(obj);
    alert('共有データを読み込みました。');
    // remove param from URL (optional) to avoid repeated prompts on reload
    const newUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  } catch (e) {
    console.error('共有データの復元に失敗:', e);
    // do not alert user too aggressively
  }
}

/* ---------- 初期化 ---------- */
window.addEventListener('DOMContentLoaded', () => {
  // 行追加ボタン
  document.getElementById('addRowButton')?.addEventListener('click', () => {
    const tr = addRow(); tr.querySelector('.skill-input')?.focus();
  });

  // ハンバーガーメニュー
  const menuButton = document.getElementById('menuButton');
  const menuList = document.getElementById('menuList');
  if (menuButton && menuList) {
    menuButton.addEventListener('click', () => menuList.classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
      if (!menuList.contains(e.target) && e.target !== menuButton) menuList.classList.add('hidden');
    });
    // 実装：保存/読込/共有
    const elSave = document.getElementById('save');
    const elLoad = document.getElementById('load');
    const elShare = document.getElementById('share');
    if (elSave) elSave.addEventListener('click', () => saveList());
    if (elLoad) elLoad.addEventListener('click', () => loadList());
    if (elShare) elShare.addEventListener('click', () => shareList());
  }

  // 切れ者ヘッダチェックで全行再計算
  const kire = document.getElementById('kiremonoHeader');
  if (kire) {
    kire.addEventListener('change', () => {
      document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
        const sid = tr.dataset.skillId;
        if (sid) {
          const s = skillById.get(String(sid));
          if (s) setRowFromSkill(tr, s);
        }
      });
      updateTotalSP();
    });
  }

  // Outside click: suggestion box を閉じる（クリック先が box でもその box の attached row でもなければ閉じる）
  document.addEventListener('click', (e) => {
    for (const st of suggestionRegistry) {
      if (!st || !st.box) continue;
      const box = st.box;
      const attached = st.attachedTo;
      if (box.contains(e.target)) continue;
      if (attached && attached.contains(e.target)) continue;
      box.style.display = 'none';
    }
  });

  // CSV 読み込みを行い、読み終わったら URL の data をチェックして復元
  loadCSV().then(() => {
    processSharedParamIfAny();
  });
});