/* ---------- 設定 ---------- */
const CSV_PATH = 'skills.csv';
const CATEGORY_OPTIONS = ['', '継承固有', '緑スキル', '通常スキル', 'シナリオ・特殊'];
const HINT_PERCENT = [0, 10, 20, 30, 35, 40];

let skills = [];            // CSV レコード配列
let skillById = new Map();  // id -> record
let nextRowId = 1;

// suggestion UI state
const suggestionState = new WeakMap();
const suggestionRegistry = [];

/* ---------- ユーティリティ ---------- */
function pad2(n){ return n.toString().padStart(2,'0'); }
function formatDate(ts){
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/* normalizeForSearch: NFKC, lower, カタカナ->ひらがな, 長音符除去, 記号/空白除去 */
function normalizeForSearch(src = ''){
  if(!src) return '';
  let s = src.normalize('NFKC').toLowerCase().trim();
  s = s.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  s = s.replace(/ー/g,'');
  try { s = s.replace(/[\p{P}\p{S}\s]+/gu, ''); }
  catch(e){ s = s.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。・「」『』（）［］｛｝〈〉《》【】〜…\s]+/g,''); }
  return s;
}

/* ---------- CSV parser ---------- */
function parseCSV(text){
  const rows=[];
  let cur='', row=[], inQuotes=false;
  for(let i=0;i<text.length;i++){
    const ch = text[i], next = text[i+1];
    if(ch === '"'){
      if(inQuotes && next === '"'){ cur+='"'; i++; }
      else inQuotes = !inQuotes;
    } else if(ch === ',' && !inQuotes){ row.push(cur); cur=''; }
    else if((ch === '\n' || ch === '\r') && !inQuotes){
      if(ch === '\r' && next === '\n') continue;
      row.push(cur); rows.push(row); row=[]; cur='';
    } else cur += ch;
  }
  if(cur !== '' || row.length>0){ row.push(cur); rows.push(row); }
  return rows.map(r => r.map(c => c.replace(/^"|"$/g,'').trim()));
}

/* ---------- CSV読み込み ---------- */
async function loadCSV(){
  try{
    const resp = await fetch(CSV_PATH, {cache: 'no-store'});
    if(!resp.ok) throw new Error('CSV fetch failed: ' + resp.status);
    const text = await resp.text();
    const parsed = parseCSV(text).filter(r => r.length>0);
    if(parsed.length === 0) return;
    const headers = parsed.shift().map(h=>h.trim());
    skills = parsed.map((rowRaw, idx) => {
      const row = rowRaw.slice();
      if(row.length < headers.length) while(row.length < headers.length) row.push('');
      const obj = {};
      headers.forEach((h,i)=> obj[h] = row[i] !== undefined ? row[i] : '');
      obj.sp = obj.sp ? (parseInt(obj.sp,10) || 0) : 0;
      obj._normName = normalizeForSearch(obj.skill || '');
      obj._readings = (obj.reading || '').split('|').map(s=>normalizeForSearch(s)).filter(Boolean);
      obj._childIds = (obj.child_id || '').toString().split(/[|,]/).map(s=>s.trim()).filter(Boolean);
      return obj;
    });
    skillById = new Map();
    skills.forEach(s => skillById.set(String(s.id), s));
    renderTableInitial();
    return true;
  }catch(err){
    console.error(err);
    alert('skills.csv の読み込みに失敗しました。コンソールを確認してください。');
    return false;
  }
}

/* ---------- 初期描画 ---------- */
function renderTableInitial(){
  const tbody = document.querySelector('#skillTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  addRow();
  updateTotalSP();
}

/* ---------- SP 計算 / 合計 ---------- */
function calcSP(baseSP, hintLv, isKire){
  const hintPct = HINT_PERCENT[hintLv] !== undefined ? HINT_PERCENT[hintLv] : 0;
  const totalPct = hintPct + (isKire ? 10 : 0);
  const val = Math.floor(baseSP * (1 - totalPct / 100));
  return val >= 0 ? val : 0;
}
function updateTotalSP(){
  let total = 0;
  document.querySelectorAll('#skillTable tbody tr').forEach(tr=>{
    const sp = parseInt(tr.querySelector('.sp')?.textContent || '0',10) || 0;
    total += sp;
  });
  const el = document.getElementById('totalSP');
  if(el) el.textContent = String(total);
}

/* ---------- findMatches (skill + reading 部分一致) ---------- */
function findMatches(queryRaw = '', categoryFilter = '', limit = 200){
  const rawTrim = (queryRaw || '').trim();
  const q = normalizeForSearch(rawTrim);
  const hasKana = /[ぁ-んァ-ンー]/.test(rawTrim);
  const filterCategory = (s) => { if(!categoryFilter) return true; return (s.category || '').trim() === categoryFilter; };

  if(!q) return skills.filter(filterCategory).slice(0, limit);

  const results = [];
  for(const s of skills){
    if(!filterCategory(s)) continue;
    const name = s._normName || '';
    const readings = s._readings || [];
    if(name === q){ results.push({s,score:0}); continue; }
    if(readings.some(r=>r===q)){ results.push({s,score:1}); continue; }
    if(hasKana){
      if(readings.some(r=>r.includes(q))){ results.push({s,score:2}); continue; }
      if(name.includes(q)){ results.push({s,score:3}); continue; }
    } else {
      if(name.includes(q)){ results.push({s,score:2}); continue; }
      if(readings.some(r=>r.includes(q))){ results.push({s,score:3}); continue; }
    }
    if((s.skill || '').toLowerCase().includes(rawTrim.toLowerCase())) results.push({s,score:4});
  }
  results.sort((a,b)=> (a.score - b.score) || a.s.skill.localeCompare(b.s.skill));
  return results.map(r=>r.s).slice(0,limit);
}

/* ---------- table duplicates ---------- */
function isSkillAlreadyInTable(skillId){
  if(!skillId) return false;
  return Array.from(document.querySelectorAll('#skillTable tbody tr'))
    .some(r => r.dataset.skillId === String(skillId));
}

/* ---------- addChildrenRecursively ---------- */
function addChildrenRecursively(parentTr, skillObj, visited = new Set()){
  if(!skillObj || !skillObj._childIds || skillObj._childIds.length === 0) return;
  visited.add(String(skillObj.id));
  let insertAfter = parentTr;
  for(const childId of skillObj._childIds){
    if(visited.has(String(childId))) continue;
    const childSkill = skillById.get(String(childId));
    if(!childSkill){ console.warn(`child_id ${childId} が見つかりません`); continue; }
    if(isSkillAlreadyInTable(childSkill.id)){
      const existing = Array.from(document.querySelectorAll('#skillTable tbody tr'))
        .find(r => r.dataset.skillId === String(childSkill.id));
      if(existing) insertAfter = existing;
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

/* ---------- Suggestion UI ---------- */
function createOrGetSuggestionBox(tr){
  let st = suggestionState.get(tr);
  if(st) return st;
  const box = document.createElement('div');
  box.className = 'skill-suggestions';
  Object.assign(box.style,{
    position: 'absolute', zIndex: 9999, background: '#fff',
    border: '1px solid rgba(0,0,0,0.12)', boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
    maxHeight: '260px', overflowY: 'auto', fontSize: '14px', display: 'none'
  });
  document.body.appendChild(box);
  st = { box, items: [], highlightedIndex: -1, attachedTo: tr, hideTimeout: null };
  suggestionState.set(tr, st); suggestionRegistry.push(st);
  return st;
}
function positionSuggestionBox(tr){
  const st = suggestionState.get(tr); if(!st) return;
  const input = tr.querySelector('.skill-input'); const rect = input.getBoundingClientRect();
  st.box.style.minWidth = Math.max(220, rect.width) + 'px';
  st.box.style.left = (rect.left + window.pageXOffset) + 'px';
  st.box.style.top = (rect.bottom + window.pageYOffset + 4) + 'px';
}
function hideSuggestionBox(tr){
  const st = suggestionState.get(tr); if(!st) return;
  st.box.style.display = 'none'; st.items = []; st.highlightedIndex = -1;
}
function highlightSuggestion(tr, idx){
  const st = suggestionState.get(tr); if(!st) return;
  const items = st.items;
  if(st.highlightedIndex >= 0 && st.highlightedIndex < items.length) items[st.highlightedIndex].style.background = '';
  st.highlightedIndex = idx;
  if(idx >= 0 && idx < items.length){
    items[idx].style.background = 'rgba(0,0,0,0.06)';
    const box = st.box, it = items[idx];
    const bRect = box.getBoundingClientRect(), itRect = it.getBoundingClientRect();
    if(itRect.top < bRect.top) box.scrollTop -= (bRect.top - itRect.top);
    if(itRect.bottom > bRect.bottom) box.scrollTop += (itRect.bottom - bRect.bottom);
  }
}
function selectSuggestion(tr, skillObj){
  const catSel = tr.querySelector('.category-select');
  if(catSel && (!catSel.value || catSel.value === '')) {
    if(skillObj.category) catSel.value = skillObj.category;
  }
  setRowFromSkill(tr, skillObj);
  addChildrenRecursively(tr, skillObj, new Set([String(skillObj.id)]));
  hideSuggestionBox(tr);
}
function showSuggestionsForRow(tr, query = ''){
  const st = createOrGetSuggestionBox(tr);
  const selCat = (tr.querySelector('.category-select')?.value || '').trim();
  const matches = findMatches(query, selCat, 200);
  const box = st.box; box.innerHTML = ''; st.items=[]; st.highlightedIndex=-1;
  matches.forEach((s, idx) => {
    const item = document.createElement('div'); item.className = 'skill-suggestion-item';
    item.dataset.skillId = String(s.id); item.textContent = s.skill;
    Object.assign(item.style, { padding:'6px 10px', cursor:'pointer', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' });
    item.addEventListener('mousedown', (e)=>{ e.preventDefault(); selectSuggestion(tr,s); });
    item.addEventListener('mouseover', ()=> highlightSuggestion(tr, idx));
    box.appendChild(item); st.items.push(item);
  });
  if(st.items.length === 0){
    const info = document.createElement('div'); info.style.padding='6px 10px'; info.style.color='#777';
    info.textContent = '候補が見つかりません'; box.appendChild(info);
  }
  positionSuggestionBox(tr); box.style.display = 'block';
}
function handleKeyNavigation(e, tr){
  const st = suggestionState.get(tr);
  if(!st || st.items.length === 0) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); const next = Math.min(st.items.length-1, (st.highlightedIndex+1)||0); highlightSuggestion(tr, next); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); const prev = Math.max(0, (st.highlightedIndex-1)); highlightSuggestion(tr, prev); }
  else if(e.key === 'Enter'){
    if(st.highlightedIndex >=0 && st.highlightedIndex < st.items.length){
      e.preventDefault();
      const si = st.items[st.highlightedIndex]; const sid = si.dataset.skillId; const skillObj = skillById.get(String(sid));
      if(skillObj) selectSuggestion(tr, skillObj);
    }
  } else if(e.key === 'Escape'){ hideSuggestionBox(tr); }
}

/* ---------- setRowFromSkill ---------- */
function setRowFromSkill(tr, skillObj){
  if(!tr || !skillObj) return;
  const input = tr.querySelector('.skill-input');
  const catSel = tr.querySelector('.category-select');
  const hintSel = tr.querySelector('.hint-select');
  const tdSp = tr.querySelector('.sp');
  const tdTags = tr.querySelector('.tags');
  const tdExplain = tr.querySelector('.explain');

  if(input) input.value = skillObj.skill || '';
  tr.dataset.skillId = String(skillObj.id || '');
  if(catSel && skillObj.category) catSel.value = skillObj.category;

  const hintLv = hintSel ? parseInt(hintSel.value,10) || 0 : 0;
  const isKire = document.getElementById('kiremonoHeader')?.checked;
  tdSp.textContent = String(calcSP((skillObj.sp || 0), hintLv, isKire));

  const tagsText = (skillObj.tags || '').replace(/\|/g, '・');
  tdTags.innerHTML = '';
  const tagsDiv = document.createElement('div'); tagsDiv.className = 'tags-clamp'; tagsDiv.textContent = tagsText;
  if(tagsText) tagsDiv.title = tagsText; tdTags.appendChild(tagsDiv);

  const full = String(skillObj.explain || '');
  tdExplain.innerHTML = '';
  const explainDiv = document.createElement('div'); explainDiv.className = 'explain-clamp'; explainDiv.textContent = full;
  if(full) explainDiv.title = full; tdExplain.appendChild(explainDiv);

  updateTotalSP();
}

/* ---------- addRow ---------- */
function addRow(afterTr = null){
  const tbody = document.querySelector('#skillTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.rowId = String(nextRowId++);
  tr.setAttribute('draggable','true');

  // 削除セル
  const tdRemove = document.createElement('td'); tdRemove.className = 'text-center align-middle';
  const btnRemove = document.createElement('button'); btnRemove.type='button'; btnRemove.className='btn btn-sm btn-outline-danger remove-row';
  btnRemove.title = '行を削除'; btnRemove.textContent = '−';
  tdRemove.appendChild(btnRemove); tr.appendChild(tdRemove);

  // 分類
  const tdCategory = document.createElement('td'); tdCategory.className = 'align-middle category';
  const selectCat = document.createElement('select'); selectCat.className = 'form-select category-select';
  CATEGORY_OPTIONS.forEach(opt => { const o = document.createElement('option'); o.value = opt; o.textContent = opt; selectCat.appendChild(o); });
  tdCategory.appendChild(selectCat); tr.appendChild(tdCategory);

  // スキル名入力（内側クリアボタン）
  const tdSkill = document.createElement('td'); tdSkill.className = 'align-middle skill';
  const skillWrapper = document.createElement('div'); skillWrapper.className = 'skill-input-wrapper';
  const inputSkill = document.createElement('input'); inputSkill.type='text'; inputSkill.className='form-control skill-input'; inputSkill.placeholder='スキル名を入力';
  const btnClear = document.createElement('button'); btnClear.type='button'; btnClear.className='btn btn-sm btn-clear-skill'; btnClear.title='スキル名をクリア'; btnClear.innerHTML='✕';
  skillWrapper.appendChild(inputSkill); skillWrapper.appendChild(btnClear); tdSkill.appendChild(skillWrapper); tr.appendChild(tdSkill);

  // SP
  const tdSp = document.createElement('td'); tdSp.className='sp text-center align-middle'; tdSp.textContent='0'; tr.appendChild(tdSp);

  // ヒント
  const tdHint = document.createElement('td'); tdHint.className='align-middle';
  const selectHint = document.createElement('select'); selectHint.className='form-select hint-select';
  for(let i=0;i<=5;i++){ const o = document.createElement('option'); o.value = i; o.textContent = i; selectHint.appendChild(o); }
  tdHint.appendChild(selectHint); tr.appendChild(tdHint);

  // tags
  const tdTags = document.createElement('td'); tdTags.className='tags align-middle'; tdTags.textContent=''; tr.appendChild(tdTags);

  // explain
  const tdExplain = document.createElement('td'); tdExplain.className='explain align-middle'; tdExplain.textContent=''; tr.appendChild(tdExplain);

  // 挿入
  if(afterTr && afterTr.parentNode === tbody) tbody.insertBefore(tr, afterTr.nextSibling);
  else tbody.appendChild(tr);

  /* イベントバインド */
  inputSkill.addEventListener('input', (e)=> showSuggestionsForRow(tr, e.target.value));
  inputSkill.addEventListener('focus', ()=> showSuggestionsForRow(tr, inputSkill.value || ''));
  inputSkill.addEventListener('keydown', (e)=> handleKeyNavigation(e, tr));
  inputSkill.addEventListener('blur', ()=>{
    const st = suggestionState.get(tr); if(!st) return;
    st.hideTimeout = setTimeout(()=> hideSuggestionBox(tr), 150);
  });

  inputSkill.addEventListener('change', ()=>{
    const text = inputSkill.value || '';
    const cat = (selectCat.value || '').trim();
    const matches = findMatches(text, cat, 1);
    if(matches.length > 0){
      const s = matches[0];
      if((!selectCat.value || selectCat.value === '') && s.category) selectCat.value = s.category;
      setRowFromSkill(tr, s);
      addChildrenRecursively(tr, s, new Set([String(s.id)]));
    } else {
      delete tr.dataset.skillId;
      tr.querySelector('.sp').textContent='0';
      tr.querySelector('.tags').innerHTML='';
      tr.querySelector('.explain').innerHTML='';
      updateTotalSP();
    }
    hideSuggestionBox(tr);
  });

  btnClear.addEventListener('click', ()=>{
    inputSkill.value=''; selectCat.value=''; delete tr.dataset.skillId;
    tr.querySelector('.sp').textContent='0'; tr.querySelector('.tags').innerHTML=''; tr.querySelector('.explain').innerHTML='';
    updateTotalSP();
    showSuggestionsForRow(tr, ''); inputSkill.focus();
  });

  selectCat.addEventListener('change', ()=> showSuggestionsForRow(tr, inputSkill.value || ''));

  selectHint.addEventListener('change', ()=>{
    const sid = tr.dataset.skillId; if(sid){ const s = skillById.get(String(sid)); if(s) setRowFromSkill(tr, s); }
  });

  btnRemove.addEventListener('click', ()=>{
    const rows = document.querySelectorAll('#skillTable tbody tr');
    if(rows.length <= 1){
      inputSkill.value=''; selectCat.value=''; selectHint.value = 0; delete tr.dataset.skillId;
      tr.querySelector('.sp').textContent='0'; tr.querySelector('.tags').innerHTML=''; tr.querySelector('.explain').innerHTML='';
      updateTotalSP(); return;
    }
    tr.remove(); updateTotalSP();
  });

  // drag/drop
  tr.addEventListener('dragstart', (e)=> { e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', tr.dataset.rowId); tr.classList.add('dragging'); });
  tr.addEventListener('dragend', ()=> tr.classList.remove('dragging'));
  tr.addEventListener('dragover', (e)=> e.preventDefault());
  tr.addEventListener('drop', (e)=>{
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain'); if(!draggedId) return;
    const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`); if(!dragged || dragged === tr) return;
    tr.parentNode.insertBefore(dragged, tr); updateTotalSP();
  });

  const tbodyEl = document.querySelector('#skillTable tbody');
  if(!tbodyEl._dropBound){
    tbodyEl.addEventListener('dragover',(e)=> e.preventDefault());
    tbodyEl.addEventListener('drop',(e)=>{
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain'); if(!draggedId) return;
      const dragged = document.querySelector(`#skillTable tbody tr[data-row-id="${draggedId}"]`); if(!dragged) return;
      const targetRow = e.target.closest('tr');
      if(targetRow) tbodyEl.insertBefore(dragged, targetRow); else tbodyEl.appendChild(dragged);
      updateTotalSP();
    });
    tbodyEl._dropBound = true;
  }

  return tr;
}

/* -------------------- 保存/読込データ生成と復元 -------------------- */
function getCurrentTableDataForSave(){
  const rows = [];
  document.querySelectorAll('#skillTable tbody tr').forEach(tr=>{
    const category = tr.querySelector('.category-select')?.value || '';
    const skillId = tr.dataset.skillId || '';
    const skillName = tr.querySelector('.skill-input')?.value || '';
    const hintLv = parseInt(tr.querySelector('.hint-select')?.value || '0', 10) || 0;
    const autoAddedBy = tr.dataset.autoAddedBy || '';
    rows.push({ category, skillId, skillName, hintLv, autoAddedBy });
  });
  const kiremono = document.getElementById('kiremonoHeader')?.checked || false;
  return { rows, kiremono };
}

function applyListData(listData){
  const tbody = document.querySelector('#skillTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  nextRowId = 1;
  if(listData.kiremono !== undefined){
    const k = document.getElementById('kiremonoHeader'); if(k) k.checked = !!listData.kiremono;
  }
  (listData.rows || []).forEach(r=>{
    const tr = addRow();
    const catSel = tr.querySelector('.category-select');
    const hintSel = tr.querySelector('.hint-select');
    if(catSel && r.category) catSel.value = r.category;
    if(hintSel && typeof r.hintLv !== 'undefined') hintSel.value = r.hintLv;

    if(r.skillId && skillById.has(String(r.skillId))){
      const s = skillById.get(String(r.skillId));
      setRowFromSkill(tr, s);
    } else if(r.skillName){
      const cand = findMatches(r.skillName, r.category || '', 1);
      if(cand && cand.length>0) setRowFromSkill(tr, cand[0]);
      else {
        tr.querySelector('.skill-input').value = r.skillName;
        delete tr.dataset.skillId;
        tr.querySelector('.sp').textContent = '0';
        tr.querySelector('.tags').innerHTML = '';
        tr.querySelector('.explain').innerHTML = '';
      }
    } else {
      tr.querySelector('.skill-input').value = '';
      delete tr.dataset.skillId;
      tr.querySelector('.sp').textContent = '0';
      tr.querySelector('.tags').innerHTML = '';
      tr.querySelector('.explain').innerHTML = '';
    }
  });
  updateTotalSP();
}

/* -------------------- localStorage スロット管理 -------------------- */
const SLOT_KEY_PREFIX = 'umamusume_slot_';

function loadAllSlots(){
  const arr = [];
  for(let i=0;i<10;i++){
    const raw = localStorage.getItem(SLOT_KEY_PREFIX + i);
    if(!raw) arr.push({ index:i, empty:true });
    else {
      try { const obj = JSON.parse(raw); arr.push({index:i, empty:false, data:obj}); }
      catch(e){ arr.push({index:i, empty:false, data:null, corrupted:true}); }
    }
  }
  return arr;
}

function saveToSlot(index, payload){
  payload.timestamp = Date.now();
  localStorage.setItem(SLOT_KEY_PREFIX + index, JSON.stringify(payload));
}

/* -------------------- スロットモーダル UI -------------------- */
let currentSlotModalMode = null; // 'save' or 'load'
let selectedSlotIndex = null;

function openSlotModal(mode){
  currentSlotModalMode = mode;
  selectedSlotIndex = null;
  const modal = document.getElementById('slotModal');
  const title = document.getElementById('slotModalTitle');
  const grid = document.getElementById('slotGrid');
  const slotEditor = document.getElementById('slotEditor');
  const actionBtn = document.getElementById('slotModalAction');
  document.getElementById('slotModalMessage').textContent = '';

  title.textContent = mode === 'save' ? 'スロットに保存' : 'スロットを読込';
  actionBtn.textContent = mode === 'save' ? '保存' : '閉じる';
  slotEditor.classList.add('hidden');

  grid.innerHTML = '';
  const slots = loadAllSlots();
  slots.forEach(slot => {
    const card = document.createElement('div'); card.className = 'slot-card'; card.dataset.slot = String(slot.index);
    const num = document.createElement('div'); num.className = 'slot-num'; num.textContent = `スロット ${slot.index + 1}`; card.appendChild(num);
    const titleEl = document.createElement('div'); titleEl.className='slot-title';
    if(slot.empty) titleEl.textContent = '(空)'; else titleEl.textContent = slot.data.title || '(無題)'; card.appendChild(titleEl);
    const meta = document.createElement('div'); meta.className='slot-meta';
    meta.textContent = slot.empty ? '—' : (slot.data.timestamp ? formatDate(slot.data.timestamp) : '');
    card.appendChild(meta);
    const preview = document.createElement('div'); preview.className='slot-preview';
    if(slot.empty) preview.textContent = '保存されていません';
    else if(slot.corrupted) preview.textContent = 'データ破損';
    else {
      const rows = slot.data.rows || [];
      const sample = rows.slice(0,3).map(r=> r.skillName || (r.skillId ? (skillById.get(String(r.skillId))?.skill || '') : '') ).filter(Boolean);
      preview.textContent = `${rows.length} 行 — ${sample.join(' / ')}`;
    }
    card.appendChild(preview);

    card.addEventListener('click', (e)=>{
      e.stopPropagation();
      Array.from(grid.children).forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedSlotIndex = slot.index;
      document.getElementById('slotModalMessage').textContent = `スロット ${slot.index+1} を選択しました。`;

      if(mode === 'save'){
        const slotEditor = document.getElementById('slotEditor'); slotEditor.classList.remove('hidden');
        const titleInput = document.getElementById('slotTitleInput');
        titleInput.value = slot.empty ? '' : (slot.data.title || '');
        titleInput.focus();
      } else {
        // load mode: handled by outer click handler bound below
      }
    });

    grid.appendChild(card);
  });

  openModalManaged(document.getElementById('slotModal'));
}

/* open/close slot modal helpers */
function closeSlotModal(){
  const modal = document.getElementById('slotModal');
  document.getElementById('slotGrid').innerHTML = '';
  document.getElementById('slotEditor').classList.add('hidden');
  selectedSlotIndex = null;
  closeModalManaged(modal);
}

function slotModalAction(){
  if(currentSlotModalMode !== 'save'){ closeSlotModal(); return; }
  if(selectedSlotIndex === null){ alert('保存先のスロットを選択してください。'); return; }
  const titleInput = document.getElementById('slotTitleInput');
  const title = titleInput.value || '';
  const payload = getCurrentTableDataForSave();
  payload.title = title || '';
  payload.timestamp = Date.now();
  try{
    saveToSlot(selectedSlotIndex, payload);
    setSlotModalMessage(`スロット ${selectedSlotIndex+1} に保存しました。`);
    closeSlotModal();
  }catch(e){
    console.error(e); alert('保存に失敗しました (localStorage)。');
  }
}

function setSlotModalMessage(msg){
  const el = document.getElementById('slotModalMessage'); if(!el) return;
  el.textContent = msg; setTimeout(()=> { if(el.textContent === msg) el.textContent = ''; }, 2500);
}

function loadSlotByIndex(index){
  const raw = localStorage.getItem(SLOT_KEY_PREFIX + index);
  if(!raw){ alert('選択スロットにデータがありません'); return; }
  try{
    const obj = JSON.parse(raw);
    const ok = confirm(`スロット ${index+1} を読み込みます。現在の一覧は上書きされます。よろしいですか？`);
    if(ok){
      applyListData(obj);
      setSlotModalMessage(`スロット ${index+1} を読み込みました。`);
      closeSlotModal();
    }
  }catch(e){
    alert('データの復元に失敗しました');
  }
}

/* -------------------- 共有（LZ圧縮 + 短縮） -------------------- */
/* LZ compress/decompress (encodedURIComponent) */
const LZ = (function(){
  const f = String.fromCharCode;
  function compressToEncodedURIComponent(input){
    if(input == null) return "";
    const res = _compress(input, 6, function(a){ return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$".charAt(a);});
    return res;
  }
  function decompressFromEncodedURIComponent(input){
    if(input == null) return "";
    if(input == "") return null;
    return _decompress(input.length, 32, function(index){ return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$".indexOf(input.charAt(index)); });
  }
  // _compress / _decompress omitted here for brevity — use full implementation below
  /* full implementations inserted (same as prior complete code) */
  function _compress(uncompressed, bitsPerChar, getCharFromInt) {
    if (uncompressed == null) return "";
    var i, value,
      context_dictionary = {},
      context_dictionaryToCreate = {},
      context_c = "",
      context_wc = "",
      context_w = "",
      context_enlargeIn = 2,
      context_dictSize = 3,
      context_numBits = 2,
      context_data = [],
      context_data_val = 0,
      context_data_position = 0;

    for (i = 0; i < uncompressed.length; i += 1) {
      context_c = uncompressed.charAt(i);
      if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
        context_dictionary[context_c] = context_dictSize++;
        context_dictionaryToCreate[context_c] = true;
      }

      context_wc = context_w + context_c;
      if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
        context_w = context_wc;
      } else {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
          value = context_w.charCodeAt(0);
          for (var j = 0; j < context_numBits; j++) {
            context_data_val = (context_data_val << 1);
            if (context_data_position == bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          var bits = 8;
          while (bits--) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position == bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
          context_enlargeIn--;
          if (context_enlargeIn == 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          delete context_dictionaryToCreate[context_w];
        } else {
          value = context_dictionary[context_w];
          for (var j = 0; j < context_numBits; j++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position == bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        context_dictionary[context_wc] = context_dictSize++;
        context_w = String(context_c);
      }
    }

    if (context_w !== "") {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
        value = context_w.charCodeAt(0);
        for (var j = 0; j < context_numBits; j++) {
          context_data_val = (context_data_val << 1);
          if (context_data_position == bitsPerChar - 1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
        }
        var bits = 8;
        while (bits--) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position == bitsPerChar - 1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (var j = 0; j < context_numBits; j++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position == bitsPerChar - 1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn == 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
    }

    value = 2;
    for (var j = 0; j < context_numBits; j++) {
      context_data_val = (context_data_val << 1) | (value & 1);
      if (context_data_position == bitsPerChar - 1) {
        context_data_position = 0;
        context_data.push(getCharFromInt(context_data_val));
        context_data_val = 0;
      } else {
        context_data_position++;
      }
      value = value >> 1;
    }

    while (true) {
      context_data_val = (context_data_val << 1);
      if (context_data_position == bitsPerChar - 1) {
        context_data.push(getCharFromInt(context_data_val));
        break;
      } else context_data_position++;
    }
    return context_data.join('');
  }

  function _decompress(length, resetValue, getNextValue) {
    var dictionary = [];
    var enlargeIn = 4;
    var dictSize = 4;
    var numBits = 3;
    var entry = "";
    var result = [];
    var i, w, bits, resb, maxpower, power, c;
    var data = { val:getNextValue(0), position:resetValue, index:1 };

    function readBits(n) {
      var bits = 0;
      var maxpower = Math.pow(2, n);
      var power = 1;
      while (power != maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) {
          data.val = getNextValue(data.index++);
          data.position = resetValue;
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      return bits;
    }

    for (i = 0; i < 3; i += 1) dictionary[i] = i;

    bits = 0;
    maxpower = Math.pow(2,2);
    power = 1;
    while (power != maxpower) {
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position == 0) {
        data.val = getNextValue(data.index++);
        data.position = resetValue;
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    var next = bits;
    switch (next) {
      case 0:
        bits = 0;
        maxpower = Math.pow(2,8);
        power = 1;
        while (power != maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position == 0) {
            data.val = getNextValue(data.index++);
            data.position = resetValue;
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        c = f(bits);
        break;
      case 1:
        bits = 0;
        maxpower = Math.pow(2,16);
        power = 1;
        while (power != maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position == 0) {
            data.val = getNextValue(data.index++);
            data.position = resetValue;
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        c = f(bits);
        break;
      case 2:
        return "";
    }
    dictionary[3] = c;
    w = c;
    result.push(c);
    while (true) {
      if (data.index > length) return "";
      bits = 0;
      maxpower = Math.pow(2, numBits);
      power = 1;
      while (power != maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) {
          data.val = getNextValue(data.index++);
          data.position = resetValue;
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      var cc = bits;
      switch (cc) {
        case 0:
          bits = 0;
          maxpower = Math.pow(2,8);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.val = getNextValue(data.index++);
              data.position = resetValue;
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = f(bits);
          cc = dictSize - 1;
          enlargeIn--;
          break;
        case 1:
          bits = 0;
          maxpower = Math.pow(2,16);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.val = getNextValue(data.index++);
              data.position = resetValue;
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = f(bits);
          cc = dictSize - 1;
          enlargeIn--;
          break;
        case 2:
          return result.join('');
      }
      if (enlargeIn == 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
      if (dictionary[cc]) entry = dictionary[cc];
      else {
        if (cc === dictSize) entry = w + w.charAt(0);
        else return null;
      }
      result.push(entry);
      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;
      w = entry;
      if (enlargeIn == 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
    }
  }

  return { compressToEncodedURIComponent, decompressFromEncodedURIComponent };
})();

/* 短縮URL生成 (tinyurl API)。失敗時は長いURLを返す */
async function generateShortUrl(longUrl){
  try{
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
    if(!res.ok) throw new Error('tinyurl failed');
    const text = await res.text();
    if(text && text.startsWith('http')) return text;
    return longUrl;
  }catch(e){
    console.warn('短縮URL生成に失敗:', e);
    return longUrl;
  }
}

/* 共有: 圧縮 + 短縮 + クリップボード */
async function generateShareUrl(){
  const payload = getCurrentTableDataForSave();
  try{
    const json = JSON.stringify(payload);
    const compressed = LZ.compressToEncodedURIComponent(json);
    const rawUrl = window.location.origin + window.location.pathname + '?data=' + compressed;
    const short = await generateShortUrl(rawUrl);
    try{
      if(navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(short);
      else {
        const tmp = document.createElement('textarea');
        tmp.value = short; document.body.appendChild(tmp); tmp.select();
        document.execCommand('copy'); tmp.remove();
      }
    }catch(e){}
    // show modal with short url
    document.getElementById('shareUrlInput').value = short;
    document.getElementById('shareMsg').style.display = 'block';
    openModalManaged(document.getElementById('shareModal'));
  }catch(e){
    console.error(e); alert('共有リンク生成に失敗しました。');
  }
}

/* 受け取った data パラメータがあれば展開して読み込む（共有リンクからの復元） */
function processSharedParamIfAny(){
  const params = new URLSearchParams(window.location.search);
  if(!params.has('data')) return;
  try{
    const enc = params.get('data'); if(!enc) return;
    const decoded = LZ.decompressFromEncodedURIComponent(enc);
    if(!decoded) return;
    const obj = JSON.parse(decoded);
    applyListData(obj);
    alert('共有データを読み込みました。');
    const newUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }catch(e){ console.error('共有データの復元に失敗:', e); }
}

/* -------------------- モーダル制御（アクセシビリティ対応） -------------------- */
/* モーダル開閉時に背景のフォーカス可能要素を一時的に tabbable できなくする（tabindex=-1を入れて復元） */
let _disabledBackground = [];
let _previouslyFocused = null;

function getFocusableElements(root=document.body){
  return Array.from(root.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]'))
    .filter(el => el.offsetParent !== null);
}

function disableBackgroundFocus(modal){
  _disabledBackground = [];
  const allFocusable = getFocusableElements(document.body);
  for(const el of allFocusable){
    if(modal.contains(el)) continue;
    const prevTab = el.getAttribute('tabindex');
    _disabledBackground.push({el, prevTab});
    el.setAttribute('tabindex', '-1');
  }
}

function restoreBackgroundFocus(){
  for(const item of _disabledBackground){
    if(item.prevTab === null) item.el.removeAttribute('tabindex');
    else item.el.setAttribute('tabindex', item.prevTab);
  }
  _disabledBackground = [];
}

function openModalManaged(modal){
  if(!modal) return;
  _previouslyFocused = document.activeElement;
  modal.classList.remove('hidden');
  // disable background focus
  disableBackgroundFocus(modal);
  // focus first focusable inside modal
  const focusables = getFocusableElements(modal);
  if(focusables.length > 0) focusables[0].focus();
}

function closeModalManaged(modal){
  if(!modal) return;
  modal.classList.add('hidden');
  restoreBackgroundFocus();
  try{ if(_previouslyFocused && typeof _previouslyFocused.focus === 'function') _previouslyFocused.focus(); }catch(e){}
}

/* 背景クリックでモーダルを閉じる（モーダル要素直下のクリックで閉じる） */
function attachModalBackgroundClickHandlers(){
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if(e.target === modal){
        // close modal
        closeModalManaged(modal);
      }
    });
    const content = modal.querySelector('.modal-content');
    if(content) content.addEventListener('click', (e)=> e.stopPropagation());
  });
}

/* -------------------- 初期化 -------------------- */
window.addEventListener('DOMContentLoaded', ()=> {
  // 行追加
  document.getElementById('addRowButton')?.addEventListener('click', ()=> {
    const tr = addRow(); tr.querySelector('.skill-input')?.focus();
  });

  // メニュー
  const menuButton = document.getElementById('menuButton'); const menuList = document.getElementById('menuList');
  if(menuButton && menuList){
    menuButton.addEventListener('click', (e)=> { e.stopPropagation(); menuList.classList.toggle('hidden'); });
    document.addEventListener('click', (e)=> { if(!menuList.contains(e.target) && e.target !== menuButton) menuList.classList.add('hidden'); });

    document.getElementById('save')?.addEventListener('click', (e)=> { e.stopPropagation(); menuList.classList.add('hidden'); openSlotModal('save'); });
    document.getElementById('load')?.addEventListener('click', (e)=> { e.stopPropagation(); menuList.classList.add('hidden'); openSlotModal('load'); });
    document.getElementById('share')?.addEventListener('click', (e)=> { e.stopPropagation(); menuList.classList.add('hidden'); generateShareUrl(); });
  }

  document.getElementById('slotModalClose')?.addEventListener('click', ()=> closeSlotModal());
  document.getElementById('slotModalCancel')?.addEventListener('click', ()=> closeSlotModal());
  document.getElementById('slotModalAction')?.addEventListener('click', ()=> slotModalAction());
  document.getElementById('slotGrid')?.addEventListener('click', (e)=>{
    const card = e.target.closest('.slot-card');
    if(!card) return;
    const idx = parseInt(card.dataset.slot, 10);
    if(currentSlotModalMode === 'load'){
      const raw = localStorage.getItem(SLOT_KEY_PREFIX + idx);
      if(!raw){ alert('選択スロットにデータがありません'); return; }
      const ok = confirm(`スロット ${idx+1} を読み込みます。現在の一覧は上書きされます。よろしいですか？`);
      if(ok) loadSlotByIndex(idx);
    }
  });

  document.getElementById('shareModalClose')?.addEventListener('click', ()=> closeModalManaged(document.getElementById('shareModal')));
  document.getElementById('closeShareBtn')?.addEventListener('click', ()=> closeModalManaged(document.getElementById('shareModal')));
  document.getElementById('copyShareBtn')?.addEventListener('click', async ()=>{
    const input = document.getElementById('shareUrlInput');
    try{
      if(navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(input.value);
      else { input.select(); document.execCommand('copy'); }
      const msg = document.getElementById('shareMsg'); msg.style.display = 'block';
      setTimeout(()=> msg.style.display = 'none', 1200);
    }catch(e){ alert('コピーに失敗しました。手動でコピーしてください。'); }
  });

  document.getElementById('slotTitleInput')?.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') slotModalAction();
  });

  attachModalBackgroundClickHandlers();

  const kire = document.getElementById('kiremonoHeader');
  if(kire){
    kire.addEventListener('change', ()=>{
      document.querySelectorAll('#skillTable tbody tr').forEach(tr=>{
        const sid = tr.dataset.skillId;
        if(sid){
          const s = skillById.get(String(sid));
          if(s) setRowFromSkill(tr, s);
        }
      });
      updateTotalSP();
    });
  }

  /* Close slot modal when clicking outside modal content handled by attachModalBackgroundClickHandlers */

  // CSV 読み込み（これが最初の描画を走らせる）
  loadCSV().then(()=> { processSharedParamIfAny(); });
});

/* -------------------- 安全ガード: storage event newValue エラー回避 -------------------- */
window.addEventListener("storage", (e) => {
  try{
    if(!e || typeof e.key === "undefined") return;
    // only handle our keys if needed
    // example: handle external changes if you want
  }catch(err){
    console.warn("storage handler ignored error:", err);
  }
});
