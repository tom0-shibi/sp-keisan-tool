/* script.js */
let skills = []; // CSVから読み込むスキル配列

// 初期化
document.addEventListener("DOMContentLoaded", init);

function init() {
  // メニューの安全なセットアップ（存在確認してから）
  const menuButton = document.getElementById("menuButton");
  const menuList = document.getElementById("menuList");
  if (menuButton && menuList) {
    menuButton.addEventListener("click", () => menuList.classList.toggle("hidden"));
    // 将来的なメニュー処理用のダミー（何もしない実装）
    document.getElementById("saveBtn")?.addEventListener("click", () => alert("保存（未実装）"));
    document.getElementById("loadBtn")?.addEventListener("click", () => alert("読込（未実装）"));
    document.getElementById("shareBtn")?.addEventListener("click", () => alert("共有（未実装）"));
  }

  // 切れ者ヘッダーチェック
  const kire = document.getElementById("kiremonoHeader");
  if (kire) {
    kire.addEventListener("change", () => {
      // 全行を再計算
      document.querySelectorAll("#skillTable tbody tr").forEach(tr => {
        const input = tr.querySelector(".skill-name input");
        updateRow(tr, input?.value || "");
      });
    });
  }

  loadCSV();
}

// HTMLエスケープ関数
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// CSV読み込み（PapaParse で安全に）
async function loadCSV() {
  try {
    const res = await fetch("skills.csv");
    const text = await res.text();

    // PapaParseでパース。header:true でヘッダをキーにしたオブジェクト配列で取得
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    skills = parsed.data.map(row => {
      // trim 各フィールド
      const out = {};
      Object.keys(row).forEach(k => {
        const key = k.trim();
        out[key] = typeof row[k] === "string" ? row[k].trim() : row[k];
      });
      return out;
    });

    // デバッグ用（確認してください）
    console.log("skills loaded:", skills.length, skills[0]);

    // datalist に一括注入（ページ中に１つだけ）
    const datalist = document.getElementById("skillList");
    if (datalist) {
      // 重複排除して option を作る
      const seen = new Set();
      datalist.innerHTML = skills
        .map(s => (s.skill || ""))
        .filter(v => v && !seen.has(v) && seen.add(v))
        .map(v => `<option value="${escapeHtml(v)}">`)
        .join("");
    }

    // テーブル初期描画（最初は空行1つ）
    renderTable();
  } catch (err) {
    console.error("CSV読み込みエラー:", err);
  }
}

function renderTable() {
  const tbody = document.querySelector("#skillTable tbody");
  tbody.innerHTML = "";
  addRow(); // 最初は空行1つ
}

/* 1行追加 */
function addRow() {
  const tbody = document.querySelector("#skillTable tbody");
  const tr = document.createElement("tr");

  // スキル名セル（input + 削除ボタンを内包）
  const tdSkill = document.createElement("td");
  tdSkill.className = "skill-name";

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "8px";

  const inputSkill = document.createElement("input");
  inputSkill.setAttribute("list", "skillList");
  inputSkill.placeholder = "スキル名を入力または選択";

  // イベント: 入力（datalist選択含む）→ 一致するスキルがあれば反映
  inputSkill.addEventListener("input", (e) => {
    const val = (e.target.value || "").trim();
    if (!val) {
      clearRow(tr);
      return;
    }
    // 完全一致を探す（trimで比較）
    const skill = skills.find(s => (s.skill || "").trim() === val);
    if (skill) {
      updateRow(tr, val);
      // 最後の行に入力したら次行を追加
      if (tr === tbody.lastElementChild) addRow();
    } else {
      // 候補に無い入力は一旦表示はクリアしておく（SP等）
      clearRow(tr);
    }
  });

  // 削除ボタン（1行だけのときは非表示に制御）
  const btnDelete = document.createElement("button");
  btnDelete.type = "button";
  btnDelete.className = "delete-btn";
  btnDelete.title = "行を削除";
  btnDelete.innerText = "🗑️";
  btnDelete.addEventListener("click", () => {
    const rows = tbody.querySelectorAll("tr");
    if (rows.length > 1) {
      tr.remove();
      updateTotalSP();
      checkDeleteButtons();
    }
  });

  wrapper.appendChild(inputSkill);
  wrapper.appendChild(btnDelete);
  tdSkill.appendChild(wrapper);
  tr.appendChild(tdSkill);

  // SP
  const tdSP = document.createElement("td");
  tdSP.className = "sp";
  tdSP.textContent = ""; // 未選択状態は空
  tr.appendChild(tdSP);

  // ヒントLv
  const tdHint = document.createElement("td");
  const selectHint = document.createElement("select");
  selectHint.className = "hint-level";
  // 0〜5
  for (let i = 0; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    selectHint.appendChild(opt);
  }
  // ヒント変更時は現在のスキル名で再計算
  selectHint.addEventListener("change", () => {
    const name = inputSkill.value.trim();
    if (name) updateRow(tr, name);
  });
  tdHint.appendChild(selectHint);
  tr.appendChild(tdHint);

  // 分類
  const tdCategory = document.createElement("td");
  tdCategory.className = "category";
  tr.appendChild(tdCategory);

  // 説明
  const tdExplain = document.createElement("td");
  tdExplain.className = "explain";
  tr.appendChild(tdExplain);

  tbody.appendChild(tr);
  checkDeleteButtons();
}

/* 行をクリア（選択解除時） */
function clearRow(tr) {
  tr.querySelector(".sp").textContent = "";
  tr.querySelector(".category").textContent = "";
  tr.querySelector(".explain").textContent = "";
}

/* 削除ボタンの表示制御（行数が1なら非表示） */
function checkDeleteButtons() {
  const tbody = document.querySelector("#skillTable tbody");
  const rows = Array.from(tbody.rows);
  rows.forEach((tr) => {
    const btn = tr.querySelector(".delete-btn");
    if (!btn) return;
    btn.style.display = rows.length === 1 ? "none" : "inline-block";
  });
}

/* 行更新（スキル名が確定したときに呼ぶ） */
function updateRow(tr, skillName) {
  // トリムして正確に比較（CSV側の余白等を吸収）
  const nameTrim = (skillName || "").trim();
  const skill = skills.find(s => (s.skill || "").trim() === nameTrim);
  if (!skill) {
    // 一致しない場合は何もしない（clearRowは input event 側で処理）
    return;
  }

  // base SP を安全に取得
  const baseSp = parseInt((skill.sp || "").toString().replace(/[^\d\-]/g, ""), 10) || 0;

  // ヒント割引率（0:0%,1:10%,2:20%,3:30%,4:35%,5:40%）
  const discounts = [0, 0.10, 0.20, 0.30, 0.35, 0.40];
  const hintSelect = tr.querySelector(".hint-level");
  const hintLv = parseInt(hintSelect?.value || 0, 10);
  const discount = discounts[hintLv] ?? 0;

  let spAfterHint = Math.round(baseSp * (1 - discount));

  // 切れ者ヘッダー適用（-10%）
  const isKire = document.getElementById("kiremonoHeader")?.checked;
  if (isKire) {
    spAfterHint = Math.round(spAfterHint * 0.9);
  }

  tr.querySelector(".sp").textContent = spAfterHint >= 0 ? String(spAfterHint) : "0";

  // 分類表示：tags を優先、それが無ければ category
  tr.querySelector(".category").textContent = skill.tags || skill.category || "";
  tr.querySelector(".explain").textContent = skill.explain || "";

  updateTotalSP();
}

/* 合計SPを再計算して表示 */
function updateTotalSP() {
  let total = 0;
  document.querySelectorAll("#skillTable tbody tr").forEach(tr => {
    const sp = parseInt(tr.querySelector(".sp").textContent, 10);
    if (!isNaN(sp)) total += sp;
  });
  document.getElementById("totalSP").textContent = total;
}