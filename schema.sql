PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_no TEXT,
  tx_date TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  bank_code TEXT,
  bank_name TEXT,
  bank_no TEXT NOT NULL,
  account_name TEXT,
  ref TEXT,
  vendor_id TEXT,
  source_status TEXT,
  source_datetime TEXT,
  balance_revert TEXT,
  process_status TEXT NOT NULL DEFAULT 'FAILED',
  processed_by TEXT,
  processed_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ref)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_bank_no ON withdrawals(bank_no);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(process_status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_tx_date ON withdrawals(tx_date);
CREATE INDEX IF NOT EXISTS idx_withdrawals_ref ON withdrawals(ref);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  withdrawal_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  staff TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(withdrawal_id) REFERENCES withdrawals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_withdrawal ON audit_logs(withdrawal_id);
