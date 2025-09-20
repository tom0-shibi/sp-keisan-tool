let skills = [];

// CSV読み込み
async function loadCSV() {
  const response = await fetch("skills.csv");
  const text = await response.text();
  const rows = text.trim().split("\n").map(r => r.split("\t"));

  const headers = rows.shift().map(h => h.trim());
  skills = rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ? row[i].trim() : "";
    });
    return obj;
  });

  renderTable();
}

// テーブル描画（最初はCSV全件表示ではなく空行1行）
function renderTable() {
  const tbody = document.querySelector("#skillTable tbody");
  tbody.innerHTML = "";
  addRow();
}

// 1行追加
function addRow() {
  const tbody = document.querySelector("#skillTable tbody");
  const tr = document.createElement("tr");

  // スキル名 + 削除ボタン
  const tdSkill = document.createElement("td");
  const container = document.createElement("div");
  container.classList.add("skill-name");

  const inputSkill = document.createElement("input");
  inputSkill.setAttribute("list", "skillList");

  const datalist = document.createElement("datalist");
  datalist.id = "skillList";
  datalist.innerHTML = skills.map(s => `<option value="${s.skill}">`).join("");

  inputSkill.addEventListener("change", () => {
    updateRow(tr, inputSkill.value);
    const tbody = document.querySelector("#skillTable tbody");
    if (tr === tbody.lastChild) addRow();
  });

  const btnDelete = document.createElement("button");
  btnDelete.innerHTML = "🗑️";
  btnDelete.classList.add("delete-btn");
  btnDelete.addEventListener("click", () => {
    const tbody = tr.parentElement;
    if (tbody.rows.length > 1) {
      tr.remove();
      updateTotalSP();
      checkDeleteButtons();
    }
  });

  container.appendChild(inputSkill);
  container.appendChild(btnDelete);
  container.appendChild(datalist);
  tdSkill.appendChild(container);
  tr.appendChild(tdSkill);

  // SP
  const tdSP = document.createElement("td");
  tdSP.classList.add("sp");
  tdSP.textContent = "0";
  tr.appendChild(tdSP);

  // ヒントLv
  const tdHint = document.createElement("td");
  const selectHint = document.createElement("select");
  selectHint.classList.add("hint-level");
  for (let i = 0; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    selectHint.appendChild(opt);
  }
  selectHint.addEventListener("change", () => updateRow(tr, inputSkill.value));
  tdHint.appendChild(selectHint);
  tr.appendChild(tdHint);

  // 分類
  const tdCategory = document.createElement("td");
  tdCategory.classList.add("category");
  tr.appendChild(tdCategory);

  // 説明
  const tdExplain = document.createElement("td");
  tdExplain.classList.add("explain");
  tr.appendChild(tdExplain);

  tbody.appendChild(tr);
  checkDeleteButtons();
}

// 削除ボタン表示制御
function checkDeleteButtons() {
  const tbody = document.querySelector("#skillTable tbody");
  const rows = Array.from(tbody.rows);
  rows.forEach(tr => {
    const btn = tr.querySelector(".delete-btn");
    btn.style.display = rows.length === 1 ? "none" : "inline";
  });
}

// 行更新（SP計算）
function updateRow(tr, skillName) {
  const skill = skills.find(s => s.skill === skillName);
  if (!skill) return;

  const spCell = tr.querySelector(".sp");
  const hintLevel = parseInt(tr.querySelector(".hint-level").value, 10);
  const isKire = document.getElementById("kiremonoHeader").checked;

  let sp = parseInt(skill.sp, 10) || 0;

  const hintRates = [1.0, 0.9, 0.8, 0.7, 0.65, 0.6];
  sp = Math.floor(sp * hintRates[hintLevel]);

  if (isKire) sp = Math.floor(sp * 0.9);

  spCell.textContent = sp;
  tr.querySelector(".category").textContent = skill.category || "";
  tr.querySelector(".explain").textContent = skill.explain || "";

  updateTotalSP();
}

// 合計SP更新
function updateTotalSP() {
  let total = 0;
  document.querySelectorAll("#skillTable tbody tr").forEach(tr => {
    const sp = parseInt(tr.querySelector(".sp").textContent, 10) || 0;
    total += sp;
  });
  document.getElementById("totalSP").textContent = total;
}

// ハンバーガーメニュー開閉
const menuButton = document.getElementById("menuButton");
const menuList = document.getElementById("menuList");
if (menuButton && menuList) {
  menuButton.addEventListener("click", () => menuList.classList.toggle("hidden"));
}

// 切れ者チェック時に再計算
const kireCheck = document.getElementById("kiremonoHeader");
if (kireCheck) {
  kireCheck.addEventListener("change", () => {
    document.querySelectorAll("#skillTable tbody tr").forEach(tr => {
      const inputSkill = tr.querySelector(".skill-name input");
      updateRow(tr, inputSkill.value);
    });
  });
}

window.addEventListener("DOMContentLoaded", loadCSV);
