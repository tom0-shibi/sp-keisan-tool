let skills = [];

// CSV読み込み
async function loadCSV() {
  const response = await fetch("skills.csv");
  const text = await response.text();
  const rows = text.trim().split("\n").map(r => r.split("\t"));

  const headers = rows.shift(); // ヘッダー除去
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

  // スキル名（プルダウン + 入力補完）
  const tdSkill = document.createElement("td");
  const selectSkill = document.createElement("select");
  selectSkill.classList.add("skill-name");
  selectSkill.innerHTML = `<option value="">選択してください</option>` + 
    skills.map(s => `<option value="${s.skill}">${s.skill}</option>`).join("");
  selectSkill.addEventListener("change", () => updateRow(tr, selectSkill.value));
  tdSkill.appendChild(selectSkill);
  tr.appendChild(tdSkill);

  // SP
  const tdSp = document.createElement("td");
  tdSp.classList.add("sp");
  tr.appendChild(tdSp);

  // ヒントLv（プルダウン）
  const tdHint = document.createElement("td");
  const selectHint = document.createElement("select");
  selectHint.classList.add("hint-level");
  for (let i = 1; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    selectHint.appendChild(opt);
  }
  selectHint.addEventListener("change", () => updateRow(tr, selectSkill.value));
  tdHint.appendChild(selectHint);
  tr.appendChild(tdHint);

  // 切れ者（チェックボックス）
  const tdKire = document.createElement("td");
  const chkKire = document.createElement("input");
  chkKire.type = "checkbox";
  chkKire.classList.add("kiremono");
  chkKire.addEventListener("change", () => updateRow(tr, selectSkill.value));
  tdKire.appendChild(chkKire);
  tr.appendChild(tdKire);

  // 分類
  const tdCategory = document.createElement("td");
  tdCategory.classList.add("category");
  tr.appendChild(tdCategory);

  // 説明
  const tdExplain = document.createElement("td");
  tdExplain.classList.add("explain");
  tr.appendChild(tdExplain);

  // 削除ボタン
  const tdDelete = document.createElement("td");
  const btnDelete = document.createElement("button");
  btnDelete.innerHTML = "🗑️";
  btnDelete.classList.add("delete-btn");
  btnDelete.addEventListener("click", () => tr.remove());
  tdDelete.appendChild(btnDelete);
  tr.appendChild(tdDelete);

  tbody.appendChild(tr);
}

// 行の更新
function updateRow(tr, skillName) {
  const skill = skills.find(s => s.skill === skillName);
  if (!skill) return;

  const spCell = tr.querySelector(".sp");
  const hintLevel = tr.querySelector(".hint-level").value;
  const isKire = tr.querySelector(".kiremono").checked;

  let sp = parseInt(skill.sp, 10) || 0;

  // ヒントレベル補正（例: Lv1=100%, Lv5=50%）
  const hintRate = [1.0, 0.9, 0.8, 0.7, 0.5];
  sp = Math.floor(sp * hintRate[hintLevel - 1]);

  // 切れ者補正（さらに半分）
  if (isKire) sp = Math.floor(sp * 0.5);

  spCell.textContent = sp;

  tr.querySelector(".category").textContent = skill.category || "";
  tr.querySelector(".explain").textContent = skill.explain || "";
}

// 初期化
document.getElementById("loadCsv").addEventListener("click", loadCSV);
