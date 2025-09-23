const CSV_PATH = 'skills.csv';
const CATEGORY_OPTIONS = ['', '継承固有', '緑スキル', '通常スキル', 'シナリオ・特殊']; // 先頭は未選択
const HINT_RATES = [1.0, 0.9, 0.8, 0.7, 0.65, 0.6];
const EXPLAIN_TRUNC_LEN = 80;

let skills = [];
let nextRowId = 1;

/* ---------- 頑健な CSV パーサ ---------- */
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
      // handle CRLF lightly
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

/* ---------- CSV 読み込み ---------- */
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
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined ? row[i] : '';
      });
      obj.sp = obj.sp ? parseInt(obj.sp, 10) || 0 : 0;
      return obj;
    });
    renderTableInitial();
  } catch (err) {
    console.error(err);
    alert('skills.csv の読み込みに失敗しました。コンソールを確認してください。');
  }
}

/* ---------- テーブル初期描画（最低1行） ---------- */
function renderTableInitial() {
  const tbody = document.querySelector('#skillTable tbody');
  tbody.innerHTML = '';
  addRow(); // 最低1行
  updateTotalSP();
}

/* ---------- 行追加（JS側） ---------- */
function addRow(afterTr = null) {
  const tbody = document.querySelector('#skillTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = String(nextRowId++);
  tr.setAttribute('draggable', 'true');

  // 1) 空欄セル（削除ボタン）
  const tdRemove = document.createElement('td');
  tdRemove.className = 'text-center align-middle';
  const btnRemove = document.createElement('button');
  btnRemove.type = 'button';
  btnRemove.className = 'btn btn-sm btn-outline-danger remove-row';
  btnRemove.textContent = '−';
  btnRemove.title = '行を削除';
  tdRemove.appendChild(btnRemove);
  tr.appendChild(tdRemove);

  // 2) 分類（select）
  const tdCategory = document.createElement('td');
  tdCategory.className = 'align-middle';
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

  // 3) スキル名（input + datalist）
  const tdSkill = document.createElement('td');
  tdSkill.className = 'align-middle';
  const inputSkill = document.createElement('input');
  inputSkill.type = 'text';
  inputSkill.className = 'form-control skill-input';
  inputSkill.placeholder = 'スキル名を入力';
  const datalistId = `skills-datalist-${tr.dataset.rowId}`;
  const datalist = document.createElement('datalist');
  datalist.id = datalistId;
  inputSkill.setAttribute('list', datalistId);
  tdSkill.appendChild(inputSkill);
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

  // 6) 効果 (tags)
  const tdTags = document.createElement('td');
  tdTags.className = 'tags align-middle';
  tdTags.textContent = '';
  tr.appendChild(tdTags);

  // 7) 説明 (truncate + tooltip/title)
  const tdExplain = document.createElement('td');
  tdExplain.className = 'explain align-middle';
  tdExplain.textContent = '';
  tr.appendChild(tdExplain);

  // 挿入
  if (afterTr && afterTr.parentNode === tbody) tbody.insertBefore(tr, afterTr.nextSibling);
  else tbody.appendChild(tr);

  // --- イベントバインド ---
  // datalist をカテゴリ + 部分一致で更新
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

  // スキル名を適用して SP / tags / explain を更新
  function applySkillByName(name) {
    const q = (name || '').trim();
    if (!q) {
      tdSp.textContent = '0';
      tdTags.textContent = '';
      tdExplain.textContent = '';
      tdExplain.removeAttribute('title');
      updateTotalSP();
      return;
    }
    // 完全一致優先 -> 部分一致
    let skill = skills.find(s => (s.skill || '').toLowerCase() === q.toLowerCase());
    if (!skill) skill = skills.find(s => (s.skill || '').toLowerCase().includes(q.toLowerCase()));
    if (!skill) {
      tdSp.textContent = '0';
      tdTags.textContent = '';
      tdExplain.textContent = '';
      tdExplain.removeAttribute('title');
      updateTotalSP();
      return;
    }
    // base sp
    const base = parseInt(skill.sp, 10) || 0;
    const hintLv = parseInt(selectHint.value, 10) || 0;
    let sp = Math.floor(base * (HINT_RATES[hintLv] || 1.0));
    // 切れ者ヘッダ
    const kire = document.getElementById('kiremonoHeader');
    if (kire && kire.checked) sp = Math.floor(sp * 0.9);
    tdSp.textContent = String(sp);
    // 効果: '|' -> '・'
    tdTags.textContent = (skill.tags || '').replace(/\|/g, '・');
    // 説明: 切り詰め & title（ツールチップ）
    const full = String(skill.explain || '');
    tdExplain.textContent = (full.length > EXPLAIN_TRUNC_LEN) ? full.slice(0, EXPLAIN_TRUNC_LEN) + '…' : full;
    if (full) tdExplain.setAttribute('title', full);
    else tdExplain.removeAttribute('title');

    updateTotalSP();
  }

  // イベント: 入力（typing）で datalist を更新（部分一致）
  inputSkill.addEventListener('input', (e) => {
    refreshDatalist(e.target.value);
  });
  // change / blur で確定
  inputSkill.addEventListener('change', (e) => applySkillByName(e.target.value));
  inputSkill.addEventListener('blur', (e) => applySkillByName(e.target.value));

  // カテゴリ変更で datalist を更新（スキル名はクリア）
  selectCat.addEventListener('change', () => {
    inputSkill.value = '';
    refreshDatalist('');
    applySkillByName('');
  });

  // ヒントLv変更で再計算
  selectHint.addEventListener('change', () => applySkillByName(inputSkill.value));

  // 削除ボタン
  btnRemove.addEventListener('click', () => {
    const rows = document.querySelectorAll('#skillTable tbody tr');
    if (rows.length <= 1) {
      // 最低1行は維持 -> クリア
      inputSkill.value = '';
      selectCat.value = '';
      selectHint.value = 0;
      applySkillByName('');
      return;
    }
    tr.remove();
    updateTotalSP();
  });

  // Drag & Drop (シンプルな入れ替え)
  tr.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tr.dataset.rowId);
    tr.classList.add('dragging');
  });
  tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
  tr.addEventListener('dragover', (e) => e.preventDefault());
  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${id}"]`);
    if (!dragged || dragged === tr) return;
    // drop先の前に挿入
    tr.parentNode.insertBefore(dragged, tr);
    updateTotalSP();
  });

  // 初期 datalist
  refreshDatalist('');
  applySkillByName('');

  return tr;
}

/* ---------- 合計SP更新 ---------- */
function updateTotalSP() {
  let total = 0;
  document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
    const sp = parseInt(tr.querySelector('.sp').textContent, 10) || 0;
    total += sp;
  });
  const el = document.getElementById('totalSP');
  if (el) el.textContent = String(total);
}

/* ---------- DOMContentLoaded 初期化 ---------- */
window.addEventListener('DOMContentLoaded', () => {
  loadCSV();

  // 最下部の「行を追加」ボタン（HTMLに記載済み）に処理をバインド
  const addBtn = document.getElementById('addRowButton');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addRow(); // 最後に追加
      // 追加直後はフォーカスをスキル入力に当てる
      const rows = document.querySelectorAll('#skillTable tbody tr');
      const last = rows[rows.length - 1];
      if (last) {
        const input = last.querySelector('.skill-input');
        if (input) input.focus();
      }
    });
  }

  // ハンバーガーメニューの既存処理（あれば）
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

  // 切れ者チェックで全行を再計算
  const kire = document.getElementById('kiremonoHeader');
  if (kire) {
    kire.addEventListener('change', () => {
      document.querySelectorAll('#skillTable tbody tr').forEach(tr => {
        const input = tr.querySelector('.skill-input');
        if (input) {
          // trigger change to recalc
          const ev = new Event('change');
          input.dispatchEvent(ev);
        }
      });
      updateTotalSP();
    });
  }
});