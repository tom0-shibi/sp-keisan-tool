const tableBody = document.getElementById("skills-body");
const totalSpEl = document.getElementById("total-sp");
const kiremonoCheckbox = document.getElementById("kiremono");

let skillsData = [];

// ヒントレベル割引率
const hintDiscounts = [0, 0.1, 0.2, 0.3, 0.35, 0.4];

// CSV読み込み
async function loadSkills() {
  const res = await fetch("skills.csv");
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  skillsData = parsed.data;
  addEmptyRow();
}

// 空行追加
function addEmptyRow() {
  const row = document.createElement("tr");

  // スキル名
  const nameCell = document.createElement("td");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "スキル名を入力";
  input.addEventListener("input", (e) => {
    const keyword = e.target.value.trim();
    const found = skillsData.find(s => s.skill.includes(keyword));

    if (found) {
      row.dataset.baseSp = found.sp;
      row.cells[1].textContent = found.sp;
      row.cells[2].textContent = "0"; // 初期ヒントLv
      row.cells[3].textContent = found.tags || found.category;
      row.cells[4].textContent = found.explain;
      updateTotalSp();
    }

    if (row.nextSibling === null && keyword !== "") {
      addEmptyRow();
    }
  });
  nameCell.appendChild(input);
  row.appendChild(nameCell);

  // SP
  row.appendChild(document.createElement("td"));

  // ヒントLv
  const hintCell = document.createElement("td");
  const hintSelect = document.createElement("select");
  for (let i = 0; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    hintSelect.appendChild(opt);
  }
  hintSelect.addEventListener("change", () => {
    updateRowSp(row);
    updateTotalSp();
  });
  hintCell.appendChild(hintSelect);
  row.appendChild(hintCell);

  // 分類
  row.appendChild(document.createElement("td"));
  // 説明
  row.appendChild(document.createElement("td"));

  tableBody.appendChild(row);
}

// 行ごとのSP更新
function updateRowSp(row) {
  const baseSp = parseInt(row.dataset.baseSp || 0);
  const hintLv = parseInt(row.querySelector("select")?.value || 0);
  let sp = baseSp - Math.floor(baseSp * hintDiscounts[hintLv]);
  if (kiremonoCheckbox.checked) {
    sp = Math.floor(sp * 0.9);
  }
  row.cells[1].textContent = sp > 0 ? sp : "";
  return sp;
}

// 総SP更新
function updateTotalSp() {
  let total = 0;
  [...tableBody.rows].forEach(row => {
    total += updateRowSp(row);
  });
  totalSpEl.textContent = total;
}

// メニュー開閉
document.querySelector(".menu-btn").addEventListener("click", () => {
  document.querySelector(".menu").classList.toggle("show");
});

// 切れ者チェック時の再計算
kiremonoCheckbox.addEventListener("change", updateTotalSp);

loadSkills();
