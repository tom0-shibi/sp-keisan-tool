let skills = [];

// CSVを読み込んでテーブルに表示
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

  console.log(skills); // デバッグ: 正しく読み込まれているか確認
  renderTable();
}

// テーブル描画
function renderTable() {
  const tbody = document.querySelector("#skillTable tbody");
  tbody.innerHTML = ""; // 既存行を削除

  // CSVの行を順に描画
  skills.forEach(skill => {
    const tr = document.createElement("tr");

    // スキル名
    const tdSkill = document.createElement("td");
    tdSkill.textContent = skill.skill || "";
    tr.appendChild(tdSkill);

    // SP
    const tdSP = document.createElement("td");
    tdSP.textContent = skill.sp || "0";
    tr.appendChild(tdSP);

    // ヒントLv（初期は0）
    const tdHint = document.createElement("td");
    tdHint.textContent = "0";
    tr.appendChild(tdHint);

    // 分類
    const tdCategory = document.createElement("td");
    tdCategory.textContent = skill.category || "";
    tr.appendChild(tdCategory);

    // 説明
    const tdExplain = document.createElement("td");
    tdExplain.textContent = skill.explain || "";
    tr.appendChild(tdExplain);

    tbody.appendChild(tr);
  });
}

// DOMロード後に初期化
window.addEventListener("DOMContentLoaded", loadCSV);
