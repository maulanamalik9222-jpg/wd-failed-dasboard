const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const ALLOWED_STATUSES = new Set([
  "FAILED",
  "DIPROSES",
  "CAIR",
  "REFUND",
  "CANCEL"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function normalizeStatus(value) {
  const s = String(value || "").trim().toUpperCase();
  if (s.includes("FAILED")) return "FAILED";
  if (s.includes("PROCESS") || s.includes("PROSES")) return "DIPROSES";
  if (s.includes("SUCCESS") || s.includes("CAIR")) return "CAIR";
  if (s.includes("REFUND")) return "REFUND";
  if (s.includes("CANCEL")) return "CANCEL";
  return "FAILED";
}

function parseAmount(value) {
  if (value === null || value === undefined) return 0;
  let s = String(value).trim().replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  // Indonesian display commonly uses dots as thousands separators.
  if (s.includes(".") && !s.includes(",")) s = s.replace(/\./g, "");
  else if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeDate(value) {
  const s = String(value || "").trim();
  return s;
}

function splitLine(line) {
  if (line.includes("\t")) return line.split("\t");
  // CSV fallback. Handles basic quoted cells.
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'; i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      out.push(cur.trim()); cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function mapHeaders(headers) {
  const clean = headers.map(h =>
    String(h || "")
      .toLowerCase()
      .replace(/[\s_\-]+/g, " ")
      .trim()
  );

  const find = (...names) => {
    for (const name of names) {
      const i = clean.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };

  return {
    no: find("no", "no."),
    date: find("date", "tanggal"),
    amount: find("amount", "nominal"),
    bankCode: find("bank code", "bankcode"),
    bankName: find("bank name", "bank"),
    bankNo: find("bank no", "bank number", "no rekening", "norek", "account number"),
    accountName: find("account name", "nama rekening", "nama rek"),
    ref: find("ref", "reference"),
    vendorId: find("vendor id", "vendorid"),
    status: find("status"),
    datetime: find("datetime", "date time", "tanggal waktu"),
    balanceRevert: find("balance revert", "balancerevert")
  };
}

function getCell(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function requireAuth(request, env) {
  const expected = env.STAFF_API_KEY;
  if (!expected) return null;
  const given = request.headers.get("x-staff-key") || "";
  if (given !== expected) return new Response("Unauthorized", { status: 401 });
  return null;
}

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,x-staff-key",
    "vary": "Origin"
  };
}

async function api(request, env) {
  const authError = requireAuth(request, env);
  if (authError) return authError;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health" && request.method === "GET") {
    return json({ ok: true, app: env.APP_NAME || "WD Failed Dashboard" });
  }

  if (path === "/api/stats" && request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT
        process_status,
        COUNT(*) AS count,
        COALESCE(SUM(amount),0) AS total
      FROM withdrawals
      GROUP BY process_status
    `).all();

    const stats = {
      FAILED: { count: 0, total: 0 },
      DIPROSES: { count: 0, total: 0 },
      CAIR: { count: 0, total: 0 },
      REFUND: { count: 0, total: 0 },
      CANCEL: { count: 0, total: 0 }
    };

    for (const r of rows.results || []) {
      if (stats[r.process_status]) {
        stats[r.process_status] = {
          count: Number(r.count),
          total: Number(r.total)
        };
      }
    }
    return json(stats);
  }

  if (path === "/api/withdrawals" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim().toUpperCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 300);

    let sql = `
      SELECT * FROM withdrawals
      WHERE 1=1
    `;
    const binds = [];

    if (q) {
      sql += ` AND (
        bank_no LIKE ? OR account_name LIKE ? OR ref LIKE ? OR vendor_id LIKE ?
      )`;
      const like = `%${q}%`;
      binds.push(like, like, like, like);
    }

    if (ALLOWED_STATUSES.has(status)) {
      sql += ` AND process_status = ?`;
      binds.push(status);
    }

    sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`;
    binds.push(limit);

    const result = await env.DB.prepare(sql).bind(...binds).all();
    return json({ rows: result.results || [] });
  }

  if (path === "/api/withdrawals/import" && request.method === "POST") {
    const body = await request.json();
    const text = String(body.text || "").trim();
    if (!text) return json({ error: "Data import kosong." }, 400);

    const lines = text.split(/\r?\n/).filter(x => x.trim() !== "");
    if (lines.length < 2) return json({ error: "Minimal header + 1 data." }, 400);

    const headers = splitLine(lines[0]);
    const map = mapHeaders(headers);

    if (map.bankNo < 0) return json({ error: "Kolom Bank No / No Rekening tidak ditemukan." }, 400);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitLine(lines[i]);
      const bankNo = getCell(cells, map.bankNo);
      if (!bankNo) continue;

      rows.push({
        source_no: getCell(cells, map.no),
        tx_date: normalizeDate(getCell(cells, map.date)),
        amount: parseAmount(getCell(cells, map.amount)),
        bank_code: getCell(cells, map.bankCode),
        bank_name: getCell(cells, map.bankName),
        bank_no: bankNo,
        account_name: getCell(cells, map.accountName),
        ref: getCell(cells, map.ref),
        vendor_id: getCell(cells, map.vendorId),
        source_status: getCell(cells, map.status),
        source_datetime: getCell(cells, map.datetime),
        balance_revert: getCell(cells, map.balanceRevert)
      });
    }

    let inserted = 0, updated = 0;
    for (const r of rows) {
      const processStatus = normalizeStatus(r.source_status);

      if (r.ref) {
        const existing = await env.DB.prepare(
          `SELECT id FROM withdrawals WHERE ref = ?`
        ).bind(r.ref).first();

        if (existing) {
          await env.DB.prepare(`
            UPDATE withdrawals SET
              source_no=?, tx_date=?, amount=?, bank_code=?, bank_name=?,
              bank_no=?, account_name=?, vendor_id=?, source_status=?,
              source_datetime=?, balance_revert=?, updated_at=datetime('now')
            WHERE id=?
          `).bind(
            r.source_no, r.tx_date, r.amount, r.bank_code, r.bank_name,
            r.bank_no, r.account_name, r.vendor_id, r.source_status,
            r.source_datetime, r.balance_revert, existing.id
          ).run();
          updated++;
          continue;
        }
      }

      await env.DB.prepare(`
        INSERT INTO withdrawals (
          source_no, tx_date, amount, bank_code, bank_name, bank_no,
          account_name, ref, vendor_id, source_status, source_datetime,
          balance_revert, process_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        r.source_no, r.tx_date, r.amount, r.bank_code, r.bank_name,
        r.bank_no, r.account_name, r.ref, r.vendor_id, r.source_status,
        r.source_datetime, r.balance_revert, processStatus
      ).run();
      inserted++;
    }

    return json({ ok: true, inserted, updated, skipped: lines.length - 1 - rows.length });
  }

  const match = path.match(/^\/api\/withdrawals\/(\d+)$/);
  if (match && request.method === "PATCH") {
    const id = Number(match[1]);
    const body = await request.json();
    const newStatus = String(body.process_status || "").toUpperCase();
    const staff = String(body.processed_by || "").trim().slice(0, 100);
    const note = String(body.note || "").trim().slice(0, 1000);

    if (!ALLOWED_STATUSES.has(newStatus)) {
      return json({ error: "Status tidak valid." }, 400);
    }
    if (!staff) return json({ error: "Nama staff wajib diisi." }, 400);

    const old = await env.DB.prepare(
      `SELECT * FROM withdrawals WHERE id = ?`
    ).bind(id).first();

    if (!old) return json({ error: "Transaksi tidak ditemukan." }, 404);

    await env.DB.prepare(`
      UPDATE withdrawals
      SET process_status=?, processed_by=?, processed_at=datetime('now'),
          note=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(newStatus, staff, note, id).run();

    await env.DB.prepare(`
      INSERT INTO audit_logs
      (withdrawal_id, action, old_status, new_status, staff, note)
      VALUES (?, 'STATUS_CHANGE', ?, ?, ?, ?)
    `).bind(id, old.process_status, newStatus, staff, note).run();

    return json({ ok: true });
  }

  const auditMatch = path.match(/^\/api\/withdrawals\/(\d+)\/audit$/);
  if (auditMatch && request.method === "GET") {
    const id = Number(auditMatch[1]);
    const result = await env.DB.prepare(`
      SELECT * FROM audit_logs
      WHERE withdrawal_id=?
      ORDER BY id DESC
    `).bind(id).all();
    return json({ rows: result.results || [] });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const response = await api(request, env);
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, {
        status: response.status,
        headers
      });
    }

    return env.ASSETS.fetch(request);
  }
};
