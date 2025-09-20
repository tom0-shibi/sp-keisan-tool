let skills = [];
let selectedSkills = [];

// CSV読み込み
Papa.parse("skills.csv", {
  download: true,
  header: true,
  complete: (results) => {
    skills = results.data;
    renderTable();
  }
});

// テーブル描画
function renderTable() {
  const tbody = document.getElementById("skillTable");
  tbody.innerHTML = "";

  skills.forEach((skill, index) => {
    const row = document.createElement("tr");

    // スキル名（プルダウン）
    const skillCell = document.createElement("td");
    const select = document.createElement("select");
    skills.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s["スキル名"];
      select.appendChild(opt);
    });
    select.value = skill.id;
    select.onchange = () => updateSP();
    skillCell.appendChild(select);
    row.appendChild(skillCell);

    // SP
    const spCell = document.createElement("td");
    spCell.textContent = skill.SP;
    spCell.className = "text-center";
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
    typeCell.textContent = skill["効果タグ"];
    row.appendChild(typeCell);

    // 説明
    const descCell = document.createElement("td");
    descCell.textContent = skill["説明"];
    row.appendChild(descCell);

    tbody.appendChild(row);
  });
}

// SP計算更新
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
