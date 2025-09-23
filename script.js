const CSV_PATH = 'skills.csv';
const CATEGORY_OPTIONS = ['', '継承固有', '緑スキル', '通常スキル', 'シナリオ・特殊'];
const HINT_PERCENT = [0, 10, 20, 30, 35, 40]; // 各ヒントLvの元の減少%
const EXPLAIN_TRUNC_LEN = 80; // 今回は CSS clamp に任せるため未使用だが残す

let skills = [];
let nextRowId = 1;

/* CSVパーサ（堅牢） */
function parseCSV(text) {
  const rows = [];
  let cur = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') continue;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.map(r => r.map(c => c.replace(/^"|"$/g, '').trim()));
}

/* CSV読み込み */
async function loadCSV() {
  try {
    const resp = await fetch(CSV_PATH, { cache: 'no-store' });
    if (!resp.ok) throw new Error('CSV fetch failed: ' + resp.status);
    const text = await resp.text();
    const parsed = parseCSV(text).filter(r => r.length > 0);
    if (parsed.length === 0) return;
    const headers = parsed.shift().map(h => h.trim());
    skills = parsed.map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i] !== undefined ? row[i] : '');
      obj.sp = obj.sp ? (parseInt(obj.sp, 10) || 0) : 0;
      return obj;
    });
    renderTableInitial();
  } catch (err) {
    console.error(err);
    alert('skills.csv の読み込みに失敗しました。コンソールを確認してください。');
  }
}

/* 初期描画 */
function renderTableInitial() {
  const tbody = document.querySelector('#skillTable tbody');
  tbody.innerHTML = '';
  addRow();
  updateTotalSP();
}

/* 合計SP更新 */
function updateTotalSP() {
  let total = 0;
  document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
    const sp = parseInt(tr.querySelector('.sp').textContent, 10) || 0;
    total += sp;
  });
  const el = document.getElementById('totalSP');
  if (el) el.textContent = String(total);
}

/* 計算: 切れ者を hint に合算する方式 */
function calcSP(baseSP, hintLv, isKire) {
  const hintPct = HINT_PERCENT[hintLv] !== undefined ? HINT_PERCENT[hintLv] : 0;
  const totalPct = hintPct + (isKire ? 10 : 0);
  const val = Math.floor(baseSP * (1 - totalPct / 100));
  return val >= 0 ? val : 0;
}

/* 行追加 */
function addRow(afterTr = null) {
  const tbody = document.querySelector('#skillTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = String(nextRowId++);
  tr.setAttribute('draggable', 'true');

  // 1) 削除セル（空欄として見えるがボタンあり）
  const tdRemove = document.createElement('td');
  tdRemove.className = 'text-center align-middle';
  const btnRemove = document.createElement('button');
  btnRemove.type = 'button';
  btnRemove.className = 'btn btn-sm btn-outline-danger remove-row';
  btnRemove.textContent = '−';
  btnRemove.title = '行を削除';
  tdRemove.appendChild(btnRemove);
  tr.appendChild(tdRemove);

  // 2) 分類
  const tdCategory = document.createElement('td');
  tdCategory.className = 'align-middle category';
  const selectCat = document.createElement('select');
  selectCat.className = 'form-select category-select';
  CATEGORY_OPTIONS.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt === '' ? '' : opt;
    selectCat.appendChild(o);
  });
  tdCategory.appendChild(selectCat);
  tr.appendChild(tdCategory);

  // 3) スキル名 (input + datalist + clear)
  const tdSkill = document.createElement('td');
  tdSkill.className = 'align-middle skill';
  const skillWrapper = document.createElement('div');
  skillWrapper.className = 'skill-input-wrapper';
  const inputSkill = document.createElement('input');
  inputSkill.type = 'text';
  inputSkill.className = 'form-control skill-input';
  inputSkill.placeholder = 'スキル名を入力';
  const datalistId = `skills-datalist-${tr.dataset.rowId}`;
  const datalist = document.createElement('datalist');
  datalist.id = datalistId;
  inputSkill.setAttribute('list', datalistId);
  const btnClear = document.createElement('button');
  btnClear.type = 'button';
  btnClear.className = 'btn btn-sm btn-clear-skill';
  btnClear.title = 'スキル名をクリア';
  btnClear.innerHTML = '✕';
  skillWrapper.appendChild(inputSkill);
  skillWrapper.appendChild(btnClear);
  tdSkill.appendChild(skillWrapper);
  tdSkill.appendChild(datalist);
  tr.appendChild(tdSkill);

  // 4) SP
  const tdSp = document.createElement('td');
  tdSp.className = 'sp text-center align-middle';
  tdSp.textContent = '0';
  tr.appendChild(tdSp);

  // 5) ヒントLv
  const tdHint = document.createElement('td');
  tdHint.className = 'align-middle';
  const selectHint = document.createElement('select');
  selectHint.className = 'form-select hint-select';
  for (let i = 0; i <= 5; i++) {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = i;
    selectHint.appendChild(o);
  }
  tdHint.appendChild(selectHint);
  tr.appendChild(tdHint);

  // 6) 効果(tags)
  const tdTags = document.createElement('td');
  tdTags.className = 'tags align-middle';
  tdTags.textContent = '';
  tr.appendChild(tdTags);

  // 7) 説明
  const tdExplain = document.createElement('td');
  tdExplain.className = 'explain align-middle';
  tdExplain.textContent = '';
  tr.appendChild(tdExplain);

  // insert
  if (afterTr && afterTr.parentNode === tbody) tbody.insertBefore(tr, afterTr.nextSibling);
  else tbody.appendChild(tr);

  /* 内部関数 */
  function refreshDatalist(filterText = '') {
    const cat = selectCat.value || '';
    const q = (filterText || '').trim().toLowerCase();
    const candidates = skills.filter(s => (cat === '' || (s.category || '') === cat));
    const matches = q === '' ? candidates : candidates.filter(s => (s.skill || '').toLowerCase().includes(q));
    datalist.innerHTML = '';
    matches.forEach(s => {
      const o = document.createElement('option');
      o.value = s.skill;
      datalist.appendChild(o);
    });
  }

  function applySkillByName(name) {
    const q = (name || '').trim();
    if (!q) {
      tdSp.textContent = '0';
      tdTags.innerHTML = '';
      tdExplain.innerHTML = '';
      tdExplain.removeAttribute('title');
      updateTotalSP();
      return;
    }
    let skill = skills.find(s => (s.skill || '').toLowerCase() === q.toLowerCase());
    if (!skill) skill = skills.find(s => (s.skill || '').toLowerCase().includes(q.toLowerCase()));
    if (!skill) {
      tdSp.textContent = '0';
      tdTags.innerHTML = '';
      tdExplain.innerHTML = '';
      tdExplain.removeAttribute('title');
      updateTotalSP();
      return;
    }
    const base = parseInt(skill.sp, 10) || 0;
    const hintLv = parseInt(selectHint.value, 10) || 0;
    const isKire = document.getElementById('kiremonoHeader') && document.getElementById('kiremonoHeader').checked;
    const sp = calcSP(base, hintLv, isKire);
    tdSp.textContent = String(sp);

    // tags: '|' -> '・', put inside tags-clamp div
    const tagsText = (skill.tags || '').replace(/\|/g, '・');
    tdTags.innerHTML = '';
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'tags-clamp';
    tagsDiv.textContent = tagsText;
    if (tagsText) tagsDiv.title = tagsText;
    tdTags.appendChild(tagsDiv);

    // explain: put full text into div.clamp and set title for tooltip
    const full = String(skill.explain || '');
    tdExplain.innerHTML = '';
    const explainDiv = document.createElement('div');
    explainDiv.className = 'explain-clamp';
    explainDiv.textContent = full;
    if (full) explainDiv.title = full;
    tdExplain.appendChild(explainDiv);

    updateTotalSP();
  }

  /* イベントバインド */
  inputSkill.addEventListener('input', (e) => refreshDatalist(e.target.value));
  inputSkill.addEventListener('change', (e) => applySkillByName(e.target.value));
  inputSkill.addEventListener('blur', (e) => applySkillByName(e.target.value));

  btnClear.addEventListener('click', () => {
    inputSkill.value = '';
    refreshDatalist('');
    applySkillByName('');
    inputSkill.focus();
  });

  selectCat.addEventListener('change', () => {
    inputSkill.value = '';
    refreshDatalist('');
    applySkillByName('');
  });

  selectHint.addEventListener('change', () => applySkillByName(inputSkill.value));

  btnRemove.addEventListener('click', () => {
    const rows = document.querySelectorAll('#skillTable tbody tr');
    if (rows.length <= 1) {
      inputSkill.value = '';
      selectCat.value = '';
      selectHint.value = 0;
      applySkillByName('');
      return;
    }
    tr.remove();
    updateTotalSP();
  });

  /* ドラッグ（行全体 draggable） */
  tr.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tr.dataset.rowId);
    tr.classList.add('dragging');
  });
  tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
  tr.addEventListener('dragover', (e) => e.preventDefault());
  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId) return;
    const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`);
    if (!dragged || dragged === tr) return;
    tr.parentNode.insertBefore(dragged, tr);
    updateTotalSP();
  });

  // tbody の drop（行外で離したときの末尾追加）
  const tbodyEl = document.querySelector('#skillTable tbody');
  if (!tbodyEl._dropBound) {
    tbodyEl.addEventListener('dragover', (e) => e.preventDefault());
    tbodyEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId) return;
      const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`);
      if (!dragged) return;
      const targetRow = e.target.closest('tr');
      if (targetRow) tbodyEl.insertBefore(dragged, targetRow);
      else tbodyEl.appendChild(dragged);
      updateTotalSP();
    });
    tbodyEl._dropBound = true;
  }

  // 初期 datalist / 表示
  refreshDatalist('');
  applySkillByName('');
  return tr;
}

/* 初期化 DOMContentLoaded */
window.addEventListener('DOMContentLoaded', () => {
  loadCSV();

  // HTML 側の追加ボタンにバインド
  const addBtn = document.getElementById('addRowButton');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const tr = addRow();
      const input = tr.querySelector('.skill-input');
      if (input) input.focus();
    });
  }

  // ハンバーガーメニュー
  const menuButton = document.getElementById('menuButton');
  const menuList = document.getElementById('menuList');
  if (menuButton && menuList) {
    menuButton.addEventListener('click', () => menuList.classList.toggle('hidden'));
    document.addEventListener('click', (e) => {
      if (!menuList.contains(e.target) && e.target !== menuButton) menuList.classList.add('hidden');
    });
    ['save','load','share'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => alert('実装予定です（準備中）。'));
    });
  }

  // 切れ者ヘッダチェックで全行再計算
  const kire = document.getElementById('kiremonoHeader');
  if (kire) {
    kire.addEventListener('change', () => {
      document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
        const input = tr.querySelector('.skill-input');
        if (input) {
          const ev = new Event('change');
          input.dispatchEvent(ev);
        }
      });
      updateTotalSP();
    });
  }
});