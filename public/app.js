const $ = (id) => document.getElementById(id);
const KEY_NAME = "wd_staff_api_key";

let apiKey = localStorage.getItem(KEY_NAME) || "";
let currentRows = [];

function money(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0
  }).format(Number(n || 0));
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("x-staff-key", apiKey);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const r = await fetch(path, {...options, headers});
  if (r.status === 401) {
    localStorage.removeItem(KEY_NAME);
    apiKey = "";
    showLogin();
    throw new Error("API key tidak valid.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request gagal");
  return data;
}

function showLogin() {
  $("loginCard").classList.remove("hidden");
  $("app").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
}

function showApp() {
  $("loginCard").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
}

async function login() {
  const val = $("apiKey").value.trim();
  if (!val) return $("loginMsg").textContent = "API key wajib diisi.";
  apiKey = val;
  try {
    await api("/api/health");
    localStorage.setItem(KEY_NAME, apiKey);
    $("loginMsg").textContent = "";
    showApp();
    await refreshAll();
  } catch (e) {
    $("loginMsg").textContent = e.message;
  }
}

function renderStats(s) {
  const items = [
    ["FAILED","FAILED"],["DIPROSES","DIPROSES"],["CAIR","CAIR"],["REFUND","REFUND"],["CANCEL","CANCEL"]
  ];
  $("stats").innerHTML = items.map(([key,label]) => `
    <div class="stat">
      <div class="label">${label}</div>
      <div class="count">${s[key].count}</div>
      <div class="total">${money(s[key].total)}</div>
    </div>
  `).join("");
}

function renderTable(rows) {
  currentRows = rows;
  if (!rows.length) {
    $("tableWrap").innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8">Tidak ada data.</div>`;
    return;
  }

  $("tableWrap").innerHTML = `
    <table>
      <thead><tr>
        <th>No</th><th>Tanggal</th><th>Bank</th><th>No Rek</th><th>Nama</th>
        <th>Nominal</th><th>Ref</th><th>Status</th><th>Staff</th><th>Aksi</th>
      </tr></thead>
      <tbody>
        ${rows.map((r,i) => `
          <tr>
            <td>${i+1}</td>
            <td>${esc(r.tx_date)}</td>
            <td>${esc(r.bank_name)}<br><small>${esc(r.bank_code)}</small></td>
            <td><b>${esc(r.bank_no)}</b></td>
            <td>${esc(r.account_name)}</td>
            <td class="amount">${money(r.amount)}</td>
            <td>${esc(r.ref)}</td>
            <td><span class="badge ${esc(r.process_status)}">${esc(r.process_status)}</span></td>
            <td>${esc(r.processed_by || "-")}</td>
            <td><button class="action" data-id="${r.id}">Detail</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  $("tableWrap").querySelectorAll("[data-id]").forEach(btn => {
    btn.addEventListener("click", () => openDetail(Number(btn.dataset.id)));
  });
}

async function loadRows() {
  const q = $("search").value.trim();
  const status = $("statusFilter").value;
  const params = new URLSearchParams({limit:"200"});
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const data = await api("/api/withdrawals?" + params.toString());
  renderTable(data.rows);
}

async function loadStats() {
  const data = await api("/api/stats");
  renderStats(data);
}

async function refreshAll() {
  await Promise.all([loadStats(), loadRows()]);
}

async function importData() {
  const text = $("importText").value.trim();
  if (!text) return $("importMsg").textContent = "Paste data terlebih dahulu.";
  $("importBtn").disabled = true;
  $("importMsg").textContent = "Mengimport...";
  try {
    const result = await api("/api/withdrawals/import", {
      method:"POST", body:JSON.stringify({text})
    });
    $("importMsg").textContent = `Selesai. Baru: ${result.inserted}, diperbarui: ${result.updated}, dilewati: ${result.skipped}.`;
    await refreshAll();
  } catch (e) {
    $("importMsg").textContent = e.message;
  } finally {
    $("importBtn").disabled = false;
  }
}

function findRow(id) {
  return currentRows.find(x => Number(x.id) === Number(id));
}

async function openDetail(id) {
  const r = findRow(id);
  if (!r) return;

  $("detail").innerHTML = `
    <h2>Detail WD #${r.id}</h2>
    <p>${esc(r.bank_name)} • ${esc(r.bank_no)}</p>

    <div class="detail-grid">
      ${[
        ["Tanggal",r.tx_date],["Datetime",r.source_datetime],["Nominal",money(r.amount)],
        ["Bank Code",r.bank_code],["Bank",r.bank_name],["No Rek",r.bank_no],
        ["Nama Rekening",r.account_name],["Ref",r.ref],["Vendor ID",r.vendor_id],
        ["Status Sumber",r.source_status],["Balance Revert",r.balance_revert],
        ["Staff Proses",r.processed_by || "-"]
      ].map(([a,b])=>`<div class="detail-item"><small>${esc(a)}</small><b>${esc(b)}</b></div>`).join("")}
    </div>

    <div class="process-box">
      <label>Status proses</label>
      <select id="detailStatus">
        ${["FAILED","DIPROSES","CAIR","REFUND","CANCEL"].map(s=>`
          <option ${s===r.process_status?"selected":""}>${s}</option>
        `).join("")}
      </select>

      <label style="display:block;margin-top:9px">Nama staff</label>
      <input id="detailStaff" placeholder="Nama staff">

      <label style="display:block;margin-top:9px">Catatan</label>
      <textarea id="detailNote" rows="3" placeholder="Catatan proses...">${esc(r.note || "")}</textarea>

      <div class="row gap">
        <button type="button" class="primary" id="saveStatus">Simpan Status</button>
        <button type="button" class="secondary" id="copyData">Copy Data</button>
      </div>
      <div id="detailMsg" class="msg"></div>
    </div>
  `;

  $("detailStaff").value = r.processed_by || localStorage.getItem("wd_staff_name") || "";

  $("saveStatus").onclick = async () => {
    const staff = $("detailStaff").value.trim();
    if (!staff) return $("detailMsg").textContent = "Nama staff wajib diisi.";
    localStorage.setItem("wd_staff_name", staff);

    try {
      await api(`/api/withdrawals/${id}`, {
        method:"PATCH",
        body:JSON.stringify({
          process_status:$("detailStatus").value,
          processed_by:staff,
          note:$("detailNote").value.trim()
        })
      });
      $("detailMsg").textContent = "Status berhasil diperbarui.";
      await refreshAll();
      setTimeout(()=> $("detailDialog").close(), 450);
    } catch(e) {
      $("detailMsg").textContent = e.message;
    }
  };

  $("copyData").onclick = async () => {
    const text = [
      r.bank_name, r.bank_no, r.account_name,
      r.amount, r.ref, r.vendor_id, r.process_status
    ].map(x => x ?? "").join(" | ");
    await navigator.clipboard.writeText(text);
    $("detailMsg").textContent = "Data berhasil dicopy.";
  };

  $("detailDialog").showModal();
}

$("loginBtn").addEventListener("click", login);
$("apiKey").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(KEY_NAME); apiKey = ""; showLogin();
});
$("importBtn").addEventListener("click", importData);
$("clearImportBtn").addEventListener("click", () => {
  $("importText").value = ""; $("importMsg").textContent = "";
});
$("refreshBtn").addEventListener("click", refreshAll);
$("statusFilter").addEventListener("change", loadRows);
let timer;
$("search").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(loadRows, 250);
});

if (apiKey) {
  api("/api/health").then(() => { showApp(); refreshAll(); }).catch(showLogin);
} else {
  showLogin();
}
