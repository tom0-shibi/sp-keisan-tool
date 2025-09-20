let skills = [];

// CSV読み込み
Papa.parse("skills.csv", {
  download: true,
  header: true,
  complete: (results) => {
    skills = results.data;
    addNewRow(); // 初期状態で空行を1つ
  }
});

// 行追加
function addNewRow() {
  const tbody = document.getElementById("skillTable");
  const row = document.createElement("tr");

  // スキル名（入力＋サジェスト）
  const skillCell = document.createElement("td");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "border p-1 w-full";
  input.setAttribute("list", "skillList");
  input.onchange = () => {
    const skill = skills.find(s => s["スキル名"] === input.value);
    if (skill) {
      row.cells[1].textContent = skill.SP;
      row.cells[3].textContent = skill["効果タグ"];
      row.cells[4].textContent = skill["説明"];
      updateSP();
      ensureLastRow();
    }
  };
  skillCell.appendChild(input);
  row.appendChild(skillCell);

  // SP
  const spCell = document.createElement("td");
  spCell.className = "border text-center";
  row.appendChild(spCell);

  // ヒントLv
  const hintCell = document.createElement("td");
  const hintSelect = document.createElement("select");
  for (let i = 0; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    hintSelect.appendChild(opt);
  }
  hintSelect.onchange = () => updateSP();
  hintCell.appendChild(hintSelect);
  row.appendChild(hintCell);

  // 分類
  const typeCell = document.createElement("td");
  typeCell.className = "border";
  row.appendChild(typeCell);

  // 説明
  const descCell = document.createElement("td");
  descCell.className = "border";
  row.appendChild(descCell);

  tbody.appendChild(row);
}

// 常に最後に空行が1つ残るようにする
function ensureLastRow() {
  const tbody = document.getElementById("skillTable");
  const lastRow = tbody.lastElementChild;
  if (lastRow) {
    const input = lastRow.cells[0].querySelector("input");
    if (input && input.value) {
      addNewRow();
    }
  }
}

// SP計算
function updateSP() {
  let total = 0;
  const cut = document.getElementById("cutSkill").checked;

  document.querySelectorAll("#skillTable tr").forEach(row => {
    const sp = parseInt(row.cells[1].textContent) || 0;
    const hintLv = parseInt(row.cells[2].querySelector("select").value);
    let calc = sp;

    // ヒントLv割引
    const discount = [0, 0.1, 0.2, 0.3, 0.35, 0.4][hintLv];
    calc = Math.round(sp * (1 - discount));

    // 切れ者補正
    if (cut) calc = Math.round(calc * 0.9);

    total += calc;
  });

  document.getElementById("totalSP").textContent = total;
}

// ハンバーガーメニュー制御
document.getElementById("menuButton").addEventListener("click", () => {
  document.getElementById("menuDropdown").classList.toggle("hidden");
});

// 保存・読込・共有（ダミー）
function saveSlot() {
  alert("保存機能はこれから実装します");
}
function loadSlot() {
  alert("読込機能はこれから実装します");
}
function shareScreen() {
  alert("共有機能はこれから実装します");
}
