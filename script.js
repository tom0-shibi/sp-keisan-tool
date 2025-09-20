let skills = [];

// CSV読み込み
async function loadCSV() {
  const response = await fetch("skills.csv");
  const text = await response.text();
  const rows = text.trim().split("\n").map(r => r.split("\t"));

  const headers = rows.shift();
  skills = rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  addRow(); // 最初の1行を追加
}

// 行追加
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
    if (tbody.lastChild === tr) addRow();
  });

  const btnDelete = document.createElement("button");
  btnDelete.innerHTML = "🗑️";
  btnDelete.classList.add("delete-btn");
  btnDelete.addEventListener("click", () => tr.remove());

  container.appendChild(inputSkill);
  container.appendChild(btnDelete);
  container.appendChild(datalist);
  tdSkill.appendChild(container);
  tr.appendChild(tdSkill);

  // SP
  const tdSp = document.createElement("td");
  tdSp.classList.add("sp");
  tr.appendChild(tdSp);

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
}

// 行更新
function updateRow(tr, skillName) {
  const skill = skills.find(s => s.skill === skillName);
  if (!skill) return;

  const spCell = tr.querySelector(".sp");
  const hintLevel = parseInt(tr.querySelector(".hint-level").value, 10);
  const isKire = document.getElementById("kiremonoHeader").checked;

  let sp = parseInt(skill.sp, 10) || 0;

  // ヒント補正
  const hintRate = [1.0, 0.9, 0.8, 0.7, 0.65, 0.6];
  sp = Math.floor(sp * hintRate[hintLevel]);

  // 切れ者 -10%
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
document.getElementById("menuButton").addEventListener("click", () => {
  document.getElementById("menuList").classList.toggle("hidden");
});

// 初期化
window.addEventListener("DOMContentLoaded", loadCSV);
