const CSV_PATH = 'skills.csv';
const CATEGORY_OPTIONS = ['', '継承固有', '緑スキル', '通常スキル', 'シナリオ・特殊'];
const HINT_PERCENT = [0, 10, 20, 30, 35, 40];

let skills = [];            // CSV レコード配列
let skillById = new Map();  // id -> record
let nextRowId = 1;

/* ---------- 正規化ユーティリティ ----------
   - NFKC 正規化、全角→半角類を吸収
   - 小文字化
   - カタカナ -> ひらがな
   - 句読点/記号/空白を除去（Unicode property が使えない環境向けのフォールバックあり）
--------------------------------------------- */
function normalizeForSearch(src = '') {
  if (!src) return '';
  let s = src.normalize('NFKC').toLowerCase().trim();
  // カタカナ -> ひらがな
  s = s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  // 句読点・記号を削る。環境で Unicode property が使えればそれを利用。
  try {
    s = s.replace(/[\p{P}\p{S}\s]+/gu, ''); // modern browsers
  } catch (e) {
    // フォールバック: 日本語句読点・代表的記号・ASCII記号のみ削る（日本語文字は消さない）
    s = s.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。・「」『』（）［］｛｝〈〉《》【】〜…\s]+/g, '');
  }
  return s;
}

/* ---------- CSV パーサ（堅牢） ---------- */
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
  if (cur !== '' || row.length > 0) {
    row.push(cur); rows.push(row);
  }
  return rows.map(r => r.map(c => c.replace(/^"|"$/g, '').trim()));
}

/* ---------- CSV 読み込み（ヘッダと列ずれの救済を含む） ---------- */
async function loadCSV() {
  try {
    const resp = await fetch(CSV_PATH, { cache: 'no-store' });
    if (!resp.ok) throw new Error('CSV fetch failed: ' + resp.status);
    const text = await resp.text();
    const parsed = parseCSV(text).filter(r => r.length > 0);
    if (parsed.length === 0) return;
    const headers = parsed.shift().map(h => h.trim());
    const idxNote = headers.indexOf('note');
    const idxCategory = headers.indexOf('category');

    skills = parsed.map((rowRaw, rowIndex) => {
      // rowRaw は配列（長さが headers の長さと違う場合がある）
      const row = rowRaw.slice(); // コピー
      // 【重要】もし行がヘッダより 1 列少なく、かつ 'note' がヘッダにあるなら
      // note 欠損と仮定して note の位置に空文字を挿入（category を正しい位置にするため）。
      if (idxNote >= 0 && idxCategory >= 0 && row.length === headers.length - 1) {
        // 試行：note 欠損のため note の位置に空文字を入れる（これで category が正しくマップされる）
        row.splice(idxNote, 0, '');
        console.warn(`CSV: row ${rowIndex + 2} はヘッダより1列少なかったため 'note' を補完しました。`);
      } else if (row.length < headers.length) {
        // それ以外の不足列は末尾に空文字で埋める
        while (row.length < headers.length) row.push('');
        console.warn(`CSV: row ${rowIndex + 2} がヘッダより列数が少なかったため末尾を補完しました。`);
      }

      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i] !== undefined ? row[i] : '');
      obj.sp = obj.sp ? (parseInt(obj.sp, 10) || 0) : 0;
      // 検索用の正規化名
      obj._normName = normalizeForSearch(obj.skill || '');
      // reading を '|' で分割し、各 token を正規化
      obj._readings = (obj.reading || '').split('|').map(s => normalizeForSearch(s)).filter(Boolean);
      // child_id を配列化（'|' or ',' を許容）
      obj._childIds = (obj.child_id || '').toString().split(/[|,]/).map(s => s.trim()).filter(Boolean);
      return obj;
    });

    // id -> record map
    skillById = new Map();
    skills.forEach(s => skillById.set(String(s.id), s));

    renderTableInitial();
  } catch (err) {
    console.error(err);
    alert('skills.csv の読み込みに失敗しました。コンソールを確認してください。');
  }
}

/* ---------- テーブル初期描画 ---------- */
function renderTableInitial() {
  const tbody = document.querySelector('#skillTable tbody');
  tbody.innerHTML = '';
  addRow();
  updateTotalSP();
}

/* ---------- 合計 SP 更新 ---------- */
function updateTotalSP() {
  let total = 0;
  document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
    const sp = parseInt(tr.querySelector('.sp')?.textContent || '0', 10) || 0;
    total += sp;
  });
  const el = document.getElementById('totalSP');
  if (el) el.textContent = String(total);
}

/* ---------- SP 計算 ---------- */
function calcSP(baseSP, hintLv, isKire) {
  const hintPct = HINT_PERCENT[hintLv] !== undefined ? HINT_PERCENT[hintLv] : 0;
  const totalPct = hintPct + (isKire ? 10 : 0);
  const val = Math.floor(baseSP * (1 - totalPct / 100));
  return val >= 0 ? val : 0;
}

/* ---------- テーブル内に既に同スキルがあるか判定 ---------- */
function isSkillAlreadyInTable(skillId) {
  if (!skillId) return false;
  return Array.from(document.querySelectorAll('#skillTable tbody tr'))
    .some(r => r.dataset.skillId === String(skillId));
}

/* ---------- 自動追加された子を再帰的に削除 ---------- */
// function clearAutoChildrenOf(parentRowId) {
//   const rows = Array.from(document.querySelectorAll('#skillTable tbody tr'));
//   rows.forEach(r => {
//     if (r.dataset.autoAddedBy === String(parentRowId)) {
//       clearAutoChildrenOf(r.dataset.rowId);
//       r.remove();
//     }
//   });
// }

/* ---------- 行にスキル情報を反映 ---------- */
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

/* ---------- 入力から skill を探す（優先度付き） ---------- */
function findSkillMatchByInput(inputText, categoryFilter = '') {
  if (!inputText) return null;
  const rawTrim = inputText.trim();
  const q = normalizeForSearch(rawTrim);
  if (!q) return null;

  const filterCategory = (s) => {
    if (!categoryFilter) return true;
    return (s.category || '').trim() === categoryFilter;
  };

  // 1) 名称の完全一致
  let found = skills.find(s => filterCategory(s) && s._normName === q);
  if (found) return found;
  // 2) reading トークンの完全一致
  found = skills.find(s => filterCategory(s) && (s._readings || []).some(r => r === q));
  if (found) return found;
  // 3) 名称の部分一致
  found = skills.find(s => filterCategory(s) && s._normName.includes(q));
  if (found) return found;
  // 4) reading トークンの部分一致
  found = skills.find(s => filterCategory(s) && (s._readings || []).some(r => r.includes(q)));
  if (found) return found;
  // 5) id の直接入力
  found = skills.find(s => String(s.id) === rawTrim);
  if (found) return found;

  return null;
}

/* ---------- 子を再帰的に追加 ---------- */
function addChildrenRecursively(parentTr, skillObj, visited = new Set()) {
  if (!skillObj || !skillObj._childIds || skillObj._childIds.length === 0) return;
  visited.add(String(skillObj.id));
  let insertAfter = parentTr;

  for (const childId of skillObj._childIds) {
    if (visited.has(String(childId))) continue;
    const childSkill = skillById.get(String(childId));
    if (!childSkill) {
      console.warn(`child_id ${childId} が見つかりません（CSV を確認してください）。`);
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
    const newVisited = new Set(visited);
    addChildrenRecursively(childTr, childSkill, newVisited);
  }
}

/* ---------- 行追加（DOM 構築 + イベントバインド） ---------- */
function addRow(afterTr = null) {
  const tbody = document.querySelector('#skillTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = String(nextRowId++);
  tr.setAttribute('draggable', 'true');

  // 削除ボタン
  const tdRemove = document.createElement('td');
  tdRemove.className = 'text-center align-middle';
  const btnRemove = document.createElement('button');
  btnRemove.type = 'button'; btnRemove.className = 'btn btn-sm btn-outline-danger remove-row';
  btnRemove.title = '行を削除'; btnRemove.textContent = '−';
  tdRemove.appendChild(btnRemove);
  tr.appendChild(tdRemove);

  // 分類
  const tdCategory = document.createElement('td');
  tdCategory.className = 'align-middle category';
  const selectCat = document.createElement('select');
  selectCat.className = 'form-select category-select';
  CATEGORY_OPTIONS.forEach(opt => { const o = document.createElement('option'); o.value = opt; o.textContent = opt; selectCat.appendChild(o); });
  tdCategory.appendChild(selectCat);
  tr.appendChild(tdCategory);

  // スキル名入力 + datalist + クリア
  const tdSkill = document.createElement('td');
  tdSkill.className = 'align-middle skill';
  const skillWrapper = document.createElement('div'); skillWrapper.className = 'skill-input-wrapper';
  const inputSkill = document.createElement('input');
  inputSkill.type = 'text'; inputSkill.className = 'form-control skill-input'; inputSkill.placeholder = 'スキル名を入力';
  const datalistId = `skills-datalist-${tr.dataset.rowId}`;
  const datalist = document.createElement('datalist'); datalist.id = datalistId;
  inputSkill.setAttribute('list', datalistId);
  const btnClear = document.createElement('button'); btnClear.type = 'button'; btnClear.className = 'btn btn-sm btn-clear-skill';
  btnClear.title = 'スキル名をクリア'; btnClear.innerHTML = '✕';
  skillWrapper.appendChild(inputSkill); skillWrapper.appendChild(btnClear);
  tdSkill.appendChild(skillWrapper); tdSkill.appendChild(datalist);
  tr.appendChild(tdSkill);

  // SP
  const tdSp = document.createElement('td'); tdSp.className = 'sp text-center align-middle'; tdSp.textContent = '0'; tr.appendChild(tdSp);

  // ヒントLv
  const tdHint = document.createElement('td'); tdHint.className = 'align-middle';
  const selectHint = document.createElement('select'); selectHint.className = 'form-select hint-select';
  for (let i = 0; i <= 5; i++) { const o = document.createElement('option'); o.value = i; o.textContent = i; selectHint.appendChild(o); }
  tdHint.appendChild(selectHint); tr.appendChild(tdHint);

  // tags / explain
  const tdTags = document.createElement('td'); tdTags.className = 'tags align-middle'; tdTags.textContent = ''; tr.appendChild(tdTags);
  const tdExplain = document.createElement('td'); tdExplain.className = 'explain align-middle'; tdExplain.textContent = ''; tr.appendChild(tdExplain);

  // 挿入
  if (afterTr && afterTr.parentNode === tbody) tbody.insertBefore(tr, afterTr.nextSibling);
  else tbody.appendChild(tr);

  /* --- 行単位の datalist 更新 --- */
  function refreshDatalist(filterText = '') {
    const cat = (selectCat.value || '').trim();
    const qNorm = normalizeForSearch(filterText || '');
    const candidates = skills.filter(s => {
      if (cat && ((s.category || '').trim() !== cat)) return false;
      if (!qNorm) return true;
      if ((s._normName || '').includes(qNorm)) return true;
      if ((s._readings || []).some(r => r.includes(qNorm))) return true;
      return false;
    });
    datalist.innerHTML = '';
    candidates.slice(0, 200).forEach(s => { const o = document.createElement('option'); o.value = s.skill; datalist.appendChild(o); });
  }

  /* --- 入力確定時（change / blur） --- */
  function handleInputConfirm() {
    const text = inputSkill.value || '';
    const cat = (selectCat.value || '').trim();
    const found = findSkillMatchByInput(text, cat);
    // 既存の自動追加子を先に削除（親スキルの差し替え時に古い子を残さないため）
    // clearAutoChildrenOf(tr.dataset.rowId);
    if (!found) {
      delete tr.dataset.skillId;
      tdSp.textContent = '0';
      tdTags.innerHTML = '';
      tdExplain.innerHTML = '';
      updateTotalSP();
      return;
    }
    // 見つかったら行に反映
    setRowFromSkill(tr, found);
    // 再帰的に子を追加
    addChildrenRecursively(tr, found, new Set([String(found.id)]));
  }

  // イベントバインド
  inputSkill.addEventListener('input', (e) => refreshDatalist(e.target.value));
  inputSkill.addEventListener('change', handleInputConfirm);
  inputSkill.addEventListener('blur', handleInputConfirm);

  btnClear.addEventListener('click', () => {
    inputSkill.value = ''; delete tr.dataset.skillId; tdSp.textContent = '0'; tdTags.innerHTML = ''; tdExplain.innerHTML = '';
    // clearAutoChildrenOf(tr.dataset.rowId); inputSkill.focus(); updateTotalSP();
  });

  selectCat.addEventListener('change', () => {
    // カテゴリ変更しても input は消さず、カテゴリ内の候補で datalist を更新
    refreshDatalist(inputSkill.value);
  });

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
      tdSp.textContent = '0'; tdTags.innerHTML = ''; tdExplain.innerHTML = '';
      // clearAutoChildrenOf(tr.dataset.rowId); updateTotalSP();
      return;
    }
    // clearAutoChildrenOf(tr.dataset.rowId);
    tr.remove();
    updateTotalSP();
  });

  // ドラッグ & ドロップ（既存処理を維持）
  tr.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tr.dataset.rowId); tr.classList.add('dragging'); });
  tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
  tr.addEventListener('dragover', (e) => e.preventDefault());
  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain'); if (!draggedId) return;
    const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`); if (!dragged || dragged === tr) return;
    tr.parentNode.insertBefore(dragged, tr); updateTotalSP();
  });

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

  // 初期 datalist
  refreshDatalist('');
  return tr;
}

/* ---------- 初期化 ---------- */
window.addEventListener('DOMContentLoaded', () => {
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

  // 切れ者チェックで全行再計算
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

  // CSV 読み込みが起点
  loadCSV();
});