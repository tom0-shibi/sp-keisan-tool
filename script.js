const CSV_PATH = 'skills.csv';
const CATEGORY_OPTIONS = ['', '継承固有', '緑スキル', '通常スキル', 'シナリオ・特殊'];
const HINT_PERCENT = [0, 10, 20, 30, 35, 40];

let skills = [];            // CSV レコード配列
let skillById = new Map();  // id -> record
let nextRowId = 1;

// suggestion UI state
const suggestionState = new WeakMap();
const suggestionRegistry = [];

/* ---------- normalizeForSearch ----------
   - NFKC / lowercase
   - カタカナ -> ひらがな
   - 長音符除去（ー）
   - 記号/空白の除去（Unicode property がなければフォールバック）
------------------------------------------- */
function normalizeForSearch(src = '') {
  if (!src) return '';
  let s = src.normalize('NFKC').toLowerCase().trim();
  s = s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)); // カナ→ひら
  s = s.replace(/ー/g, '');
  try {
    s = s.replace(/[\p{P}\p{S}\s]+/gu, '');
  } catch (e) {
    s = s.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。・「」『』（）［］｛｝〈〉《》【】〜…\s]+/g, '');
  }
  return s;
}

/* ---------- CSV parser ----------
   - シンプルながら堅牢なダブルクオート対応パーサ
------------------------------------------- */
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

/* ---------- loadCSV ----------
   - ヘッダに合わせてオブジェクト化
   - reading を分割して正規化配列を保持
   - child_id を配列化して _childIds に格納
------------------------------------------- */
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
    renderTableInitial(); // 初期描画
  } catch (err) {
    console.error(err);
    alert('skills.csv の読み込みに失敗しました。コンソールを確認してください。');
  }
}

/* ---------- renderTableInitial ----------
   - テーブル tbody をクリアして最初の行を追加
   - ここが無いと loadCSV 後に画面が描画されないことがあるため必須
------------------------------------------- */
function renderTableInitial() {
  const tbody = document.querySelector('#skillTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  addRow(); // 最低1行表示
  updateTotalSP();
}

/* ---------- SP 計算・合計更新 ---------- */
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

/* ---------- findMatches ----------
   - query が空 -> カテゴリで絞った全件（=空入力時の候補）
   - kana が含まれる場合は reading を優先して部分一致
   - スコア順で返す（完全一致優先 etc.）
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

/* ---------- isSkillAlreadyInTable ----------
   - 同一 id のスキルが既にテーブルにあるか判定
------------------------------------------- */
function isSkillAlreadyInTable(skillId) {
  if (!skillId) return false;
  return Array.from(document.querySelectorAll('#skillTable tbody tr'))
    .some(r => r.dataset.skillId === String(skillId));
}

/* ---------- addChildrenRecursively ----------
   - child_id を辿って行を挿入（既にあればスキップ）
   - 循環は visited で防ぐ
   - 自動追加フラグは付けるが、親削除で子を勝手に削除しない（要件）
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
    // 自動追加フラグ（ただし削除は行単位でユーザーが実行する）
    childTr.dataset.autoAddedBy = parentTr.dataset.rowId;
    setRowFromSkill(childTr, childSkill);
    insertAfter = childTr;
    const newVis = new Set(visited);
    addChildrenRecursively(childTr, childSkill, newVis);
  }
}

/* ---------- Suggestion box utilities ----------
   - createOrGetSuggestionBox: body にボックスを一つ作る（row ごとに管理）
   - showSuggestionsForRow: findMatches を用いて box を埋める
   - selectSuggestion: スキルを選択して行に適用
------------------------------------------- */
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
  // カテゴリが空なら選んだスキルのカテゴリをセット
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

/* keyboard nav for suggestions */
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

/* ---------- setRowFromSkill ----------
   - 行にスキル情報を表示（SP, tags, explain, category）
------------------------------------------- */
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

/* ---------- addRow: 行作成 + イベントバインド ----------
   - ここで input の focus 時に空入力でも候補を表示する（カテゴリフィルタあり）
   - クリア（✕）は行単位で、子は残す（要件）
------------------------------------------- */
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

  /* イベント */
  // 入力中 -> 候補更新
  inputSkill.addEventListener('input', (e) => { showSuggestionsForRow(tr, e.target.value); });

  // フォーカス -> 空入力でも候補を表示（カテゴリがあれば絞る）
  inputSkill.addEventListener('focus', () => { showSuggestionsForRow(tr, inputSkill.value || ''); });

  // キーボード操作（上下/Enter/Esc）
  inputSkill.addEventListener('keydown', (e) => handleKeyNavigation(e, tr));

  // blur -> 隠す（短い遅延で mousedown の選択を許す）
  inputSkill.addEventListener('blur', () => {
    const st = suggestionState.get(tr);
    if (!st) return;
    st.hideTimeout = setTimeout(() => hideSuggestionBox(tr), 150);
  });

  // change: 選ばれていれば最優先候補を採用、なければ行のスキル結び付けを解除（カテゴリは維持しない）
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

  // クリアボタン: 行単位のみクリア（スキル＋カテゴリ）
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

  // カテゴリ変更 -> 候補更新（入力は消さない）
  selectCat.addEventListener('change', () => { showSuggestionsForRow(tr, inputSkill.value || ''); });

  // ヒント変化 -> SP 再計算
  selectHint.addEventListener('change', () => {
    const sid = tr.dataset.skillId;
    if (sid) {
      const s = skillById.get(String(sid));
      if (s) setRowFromSkill(tr, s);
    }
  });

  // 削除ボタン: 行単位削除（最後の一行はクリア）
  btnRemove.addEventListener('click', () => {
    const rows = document.querySelectorAll('#skillTable tbody tr');
    if (rows.length <= 1) {
      inputSkill.value = ''; selectCat.value = ''; selectHint.value = 0; delete tr.dataset.skillId;
      tr.querySelector('.sp').textContent = '0'; tr.querySelector('.tags').innerHTML = ''; tr.querySelector('.explain').innerHTML = '';
      updateTotalSP(); return;
    }
    tr.remove(); updateTotalSP();
  });

  // drag/drop: 既存と同様
  tr.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tr.dataset.rowId); tr.classList.add('dragging'); });
  tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
  tr.addEventListener('dragover', (e) => e.preventDefault());
  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain'); if (!draggedId) return;
    const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`); if (!dragged || dragged === tr) return;
    tr.parentNode.insertBefore(dragged, tr); updateTotalSP();
  });

  // tbody の drop（末尾追加等）
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

/* ---------- 初期化 ---------- */
window.addEventListener('DOMContentLoaded', () => {
  // 行追加ボタン
  document.getElementById('addRowButton')?.addEventListener('click', () => {
    const tr = addRow(); tr.querySelector('.skill-input')?.focus();
  });

  // メニュー（そのまま）
  const menuButton = document.getElementById('menuButton'); const menuList = document.getElementById('menuList');
  if (menuButton && menuList) {
    menuButton.addEventListener('click', () => menuList.classList.toggle('hidden'));
    document.addEventListener('click', (e) => { if (!menuList.contains(e.target) && e.target !== menuButton) menuList.classList.add('hidden'); });
    ['save','load','share'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => alert('実装予定です（準備中）。')); });
  }

  // 切れ者チェッック -> 全行再計算
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

  // CSV 読み込み（これが最初の描画を走らせる）
  loadCSV();
});