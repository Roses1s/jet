// db.js — слой данных: схема SQLite и подготовленные запросы.
// Используем встроенный в Node 22+ модуль node:sqlite — ноль нативных зависимостей.
// Вся работа с базой изолирована здесь, server.js только вызывает функции.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

// Папка data/ создаётся автоматически при первом запуске
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'budget.db'));
db.exec('PRAGMA journal_mode = WAL;'); // быстрее и надёжнее при одновременных запросах

// ───────────────────────── Схема ─────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL CHECK(type IN ('income','expense')),
    amount     REAL NOT NULL CHECK(amount > 0),
    category   TEXT NOT NULL,
    owner      TEXT NOT NULL CHECK(owner IN ('me','wife','shared')),
    date       TEXT NOT NULL,              -- YYYY-MM-DD
    comment    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL            -- unix ms, для сортировки внутри дня
  );
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

  -- Этап 2: лимиты по категориям (одна строка = один лимит)
  CREATE TABLE IF NOT EXISTS limits (
    category TEXT PRIMARY KEY,
    amount   REAL NOT NULL CHECK(amount > 0)
  );

  -- Этап 2: правила повторяющихся платежей
  CREATE TABLE IF NOT EXISTS recurring (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,              -- «Аренда», «Интернет»...
    type         TEXT NOT NULL CHECK(type IN ('income','expense')),
    amount       REAL NOT NULL CHECK(amount > 0),
    category     TEXT NOT NULL,
    owner        TEXT NOT NULL CHECK(owner IN ('me','wife','shared')),
    day          INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31), -- день месяца
    active       INTEGER NOT NULL DEFAULT 1,
    last_applied TEXT                        -- 'YYYY-MM' последнего автосоздания
  );

  -- Этап 2: совместные цели-копилки
  CREATE TABLE IF NOT EXISTS goals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '🎯',
    target     REAL NOT NULL CHECK(target > 0),
    created_at INTEGER NOT NULL
  );

  -- Пополнения/снятия по целям (amount < 0 = снятие), с указанием, кто внёс
  CREATE TABLE IF NOT EXISTS goal_deposits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    amount     REAL NOT NULL,
    owner      TEXT NOT NULL CHECK(owner IN ('me','wife','shared')),
    date       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
db.exec('PRAGMA foreign_keys = ON;'); // чтобы работал ON DELETE CASCADE

// ─────────────────── Подготовленные запросы ───────────────────
const insertStmt = db.prepare(`
  INSERT INTO transactions (type, amount, category, owner, date, comment, created_at)
  VALUES (@type, @amount, @category, @owner, @date, @comment, @created_at)
`);

const deleteStmt = db.prepare(`DELETE FROM transactions WHERE id = ?`);

// ───────────────────────── Публичное API модуля ─────────────────────────

/**
 * Список операций с опциональными фильтрами.
 * @param {object} f  { month: 'YYYY-MM', type, owner, category, limit }
 */
export function listTransactions(f = {}) {
  const where = [];
  const params = {};

  if (f.month)    { where.push(`date LIKE @month`);       params.month = f.month + '%'; }
  if (f.type)     { where.push(`type = @type`);           params.type = f.type; }
  if (f.owner)    { where.push(`owner = @owner`);         params.owner = f.owner; }
  if (f.category) { where.push(`category = @category`);   params.category = f.category; }

  const sql = `
    SELECT * FROM transactions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY date DESC, created_at DESC
    ${f.limit ? 'LIMIT ' + Number(f.limit) : ''}
  `;
  return db.prepare(sql).all(params);
}

/** Добавить операцию. Возвращает созданную запись. */
export function addTransaction(tx) {
  const row = {
    type: tx.type,
    amount: Number(tx.amount),
    category: tx.category,
    owner: tx.owner,
    date: tx.date,
    comment: (tx.comment || '').trim(),
    created_at: Date.now(),
  };
  const info = insertStmt.run(row);
  return { id: info.lastInsertRowid, ...row };
}

/** Удалить операцию по id. Возвращает true, если что-то удалилось. */
export function deleteTransaction(id) {
  return deleteStmt.run(id).changes > 0;
}

/** Обновить операцию. Возвращает обновлённую запись или null, если не найдена. */
export function updateTransaction(id, tx) {
  const info = db.prepare(`
    UPDATE transactions
    SET type = @type, amount = @amount, category = @category,
        owner = @owner, date = @date, comment = @comment
    WHERE id = @id
  `).run({
    id,
    type: tx.type,
    amount: Number(tx.amount),
    category: tx.category,
    owner: tx.owner,
    date: tx.date,
    comment: (tx.comment || '').trim(),
  });
  if (!info.changes) return null;
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
}

// ═════════════════════════ Этап 2: лимиты ═════════════════════════

/** Все лимиты в виде объекта: { food: 30000, transport: 8000, ... } */
export function getLimits() {
  const rows = db.prepare('SELECT category, amount FROM limits').all();
  return Object.fromEntries(rows.map((r) => [r.category, r.amount]));
}

/** Полностью заменить лимиты. amount <= 0 или пусто = лимит снят. */
export function setLimits(obj) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM limits').run();
    const ins = db.prepare('INSERT INTO limits (category, amount) VALUES (?, ?)');
    for (const [cat, amount] of Object.entries(obj)) {
      const n = Number(amount);
      if (Number.isFinite(n) && n > 0) ins.run(cat, n);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getLimits();
}

// ═══════════════════ Этап 2: повторяющиеся платежи ═══════════════════

export function listRecurring() {
  return db.prepare('SELECT * FROM recurring ORDER BY day, id').all();
}

/**
 * Добавить правило. Если день платежа в этом месяце уже прошёл,
 * помечаем текущий месяц как «применённый» — иначе операция
 * мгновенно создастся задним числом, хотя пользователь её уже внёс руками.
 */
export function addRecurring(r) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const scheduledDay = Math.min(r.day, daysInMonth(now.getFullYear(), now.getMonth() + 1));
  const lastApplied = now.getDate() >= scheduledDay ? ym : null;

  const info = db.prepare(`
    INSERT INTO recurring (title, type, amount, category, owner, day, active, last_applied)
    VALUES (@title, @type, @amount, @category, @owner, @day, 1, @last_applied)
  `).run({
    title: r.title.trim(),
    type: r.type,
    amount: Number(r.amount),
    category: r.category,
    owner: r.owner,
    day: Number(r.day),
    last_applied: lastApplied,
  });
  return db.prepare('SELECT * FROM recurring WHERE id = ?').get(info.lastInsertRowid);
}

/** Включить/выключить правило */
export function toggleRecurring(id, active) {
  return db.prepare('UPDATE recurring SET active = ? WHERE id = ?')
    .run(active ? 1 : 0, id).changes > 0;
}

export function deleteRecurring(id) {
  return db.prepare('DELETE FROM recurring WHERE id = ?').run(id).changes > 0;
}

function daysInMonth(year, month1based) {
  return new Date(year, month1based, 0).getDate();
}

/**
 * Автосоздание операций по активным правилам.
 * Проходит все месяцы с last_applied до текущего (дозаполняет пропущенные,
 * если приложение долго не открывали). День 31 в коротком месяце
 * сдвигается на последний день месяца. Вызывается на каждый запрос к API —
 * это дёшево: правил единицы, и почти всегда выходим сразу.
 */
export function applyRecurringPayments() {
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentYm = todayIso.slice(0, 7);
  let created = 0;

  for (const rule of db.prepare('SELECT * FROM recurring WHERE active = 1').all()) {
    // С какого месяца начинать: следующий после last_applied (или текущий)
    let [y, m] = (rule.last_applied || '').split('-').map(Number);
    if (!y) { y = now.getFullYear(); m = now.getMonth() + 1; }
    else { m += 1; if (m > 12) { m = 1; y += 1; } }

    while (`${y}-${String(m).padStart(2, '0')}` <= currentYm) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const day = Math.min(rule.day, daysInMonth(y, m));
      const date = `${ym}-${String(day).padStart(2, '0')}`;
      if (date > todayIso) break; // день платежа ещё не наступил

      insertStmt.run({
        type: rule.type,
        amount: rule.amount,
        category: rule.category,
        owner: rule.owner,
        date,
        comment: `${rule.title} 🔁`,
        created_at: Date.now(),
      });
      db.prepare('UPDATE recurring SET last_applied = ? WHERE id = ?').run(ym, rule.id);
      created++;
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
  }
  return created;
}

// ═════════════════════ Этап 2: цели-копилки ═════════════════════

/** Цели со сводкой: сколько накоплено всего и кем */
export function listGoals() {
  const goals = db.prepare('SELECT * FROM goals ORDER BY created_at').all();
  const sums = db.prepare(`
    SELECT goal_id, owner, SUM(amount) AS total
    FROM goal_deposits GROUP BY goal_id, owner
  `).all();

  return goals.map((g) => {
    const byOwner = { me: 0, wife: 0, shared: 0 };
    for (const s of sums) if (s.goal_id === g.id) byOwner[s.owner] = s.total;
    const saved = byOwner.me + byOwner.wife + byOwner.shared;
    return { ...g, saved, byOwner };
  });
}

export function addGoal(g) {
  const info = db.prepare(`
    INSERT INTO goals (title, emoji, target, created_at) VALUES (?, ?, ?, ?)
  `).run(g.title.trim(), g.emoji || '🎯', Number(g.target), Date.now());
  return { id: info.lastInsertRowid, ...g, saved: 0 };
}

export function deleteGoal(id) {
  return db.prepare('DELETE FROM goals WHERE id = ?').run(id).changes > 0;
}

/** Пополнение (amount > 0) или снятие (amount < 0) */
export function addGoalDeposit(goalId, d) {
  const goal = db.prepare('SELECT id FROM goals WHERE id = ?').get(goalId);
  if (!goal) return null;
  const now = new Date();
  db.prepare(`
    INSERT INTO goal_deposits (goal_id, amount, owner, date, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    goalId,
    Number(d.amount),
    d.owner,
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    Date.now()
  );
  return listGoals().find((g) => g.id === goalId);
}

// ═════════════════════ Этап 3: статистика по месяцам ═════════════════════

/**
 * Доходы/расходы за последние `months` месяцев (включая текущий).
 * Месяцы без операций возвращаются с нулями — график всегда ровный.
 */
export function monthlyStats(months = 6) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;

  const rows = db.prepare(`
    SELECT substr(date, 1, 7) AS ym,
           SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END) AS income,
           SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
    FROM transactions
    WHERE date >= ?
    GROUP BY ym
  `).all(fromIso);

  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = rows.find((x) => x.ym === ym);
    out.push({ ym, income: r?.income || 0, expense: r?.expense || 0 });
  }
  return out;
}
