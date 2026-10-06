// server.js — Express: REST API + раздача статики из public/.
// Запуск: npm start  →  http://localhost:3000

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listTransactions, addTransaction, deleteTransaction, updateTransaction,
  getLimits, setLimits,
  listRecurring, addRecurring, toggleRecurring, deleteRecurring, applyRecurringPayments,
  listGoals, addGoal, deleteGoal, addGoalDeposit,
  monthlyStats,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ───────────────────────── Валидация ─────────────────────────
const TYPES = ['income', 'expense'];
const OWNERS = ['me', 'wife', 'shared'];

function validate(body) {
  const errors = [];
  if (!TYPES.includes(body.type)) errors.push('Неверный тип операции');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Сумма должна быть больше нуля');
  if (!body.category || typeof body.category !== 'string') errors.push('Укажите категорию');
  if (!OWNERS.includes(body.owner)) errors.push('Укажите, чья это операция');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) errors.push('Неверная дата');
  return errors;
}

// ───────────────────────── Маршруты API ─────────────────────────

// Перед каждым запросом к API проверяем, не пора ли создать
// повторяющиеся платежи (дёшево: правил единицы, обычно выход сразу)
app.use('/api', (req, res, next) => {
  try { applyRecurringPayments(); } catch (e) { console.error('recurring:', e); }
  next();
});

// Список операций: ?month=YYYY-MM&type=&owner=&category=&limit=
app.get('/api/transactions', (req, res) => {
  const { month, type, owner, category, limit } = req.query;
  res.json(listTransactions({ month, type, owner, category, limit }));
});

// Добавить операцию
app.post('/api/transactions', (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  res.status(201).json(addTransaction(req.body));
});

// Обновить операцию (редактирование)
app.put('/api/transactions/:id', (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const updated = updateTransaction(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ errors: ['Операция не найдена'] });
  res.json(updated);
});

// Удалить операцию
app.delete('/api/transactions/:id', (req, res) => {
  const ok = deleteTransaction(Number(req.params.id));
  if (!ok) return res.status(404).json({ errors: ['Операция не найдена'] });
  res.json({ ok: true });
});

// ───── Этап 2: лимиты по категориям ─────

app.get('/api/limits', (req, res) => res.json(getLimits()));

// Полная замена лимитов: { food: 30000, transport: 8000, ... }
app.put('/api/limits', (req, res) => {
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ errors: ['Ожидается объект лимитов'] });
  }
  res.json(setLimits(req.body));
});

// ───── Этап 2: повторяющиеся платежи ─────

app.get('/api/recurring', (req, res) => res.json(listRecurring()));

app.post('/api/recurring', (req, res) => {
  const b = req.body;
  const errors = [];
  if (!b.title || !String(b.title).trim()) errors.push('Укажите название');
  if (!TYPES.includes(b.type)) errors.push('Неверный тип');
  if (!(Number(b.amount) > 0)) errors.push('Сумма должна быть больше нуля');
  if (!b.category) errors.push('Укажите категорию');
  if (!OWNERS.includes(b.owner)) errors.push('Укажите, чей это платёж');
  const day = Number(b.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) errors.push('День месяца: от 1 до 31');
  if (errors.length) return res.status(400).json({ errors });
  res.status(201).json(addRecurring(b));
});

// Включить/выключить правило: { active: true|false }
app.patch('/api/recurring/:id', (req, res) => {
  const ok = toggleRecurring(Number(req.params.id), !!req.body.active);
  if (!ok) return res.status(404).json({ errors: ['Правило не найдено'] });
  res.json({ ok: true });
});

app.delete('/api/recurring/:id', (req, res) => {
  const ok = deleteRecurring(Number(req.params.id));
  if (!ok) return res.status(404).json({ errors: ['Правило не найдено'] });
  res.json({ ok: true });
});

// ───── Этап 2: цели-копилки ─────

app.get('/api/goals', (req, res) => res.json(listGoals()));

app.post('/api/goals', (req, res) => {
  const b = req.body;
  const errors = [];
  if (!b.title || !String(b.title).trim()) errors.push('Укажите название цели');
  if (!(Number(b.target) > 0)) errors.push('Сумма цели должна быть больше нуля');
  if (errors.length) return res.status(400).json({ errors });
  res.status(201).json(addGoal(b));
});

app.delete('/api/goals/:id', (req, res) => {
  const ok = deleteGoal(Number(req.params.id));
  if (!ok) return res.status(404).json({ errors: ['Цель не найдена'] });
  res.json({ ok: true });
});

// Пополнение (amount > 0) или снятие (amount < 0)
app.post('/api/goals/:id/deposits', (req, res) => {
  const amount = Number(req.body.amount);
  const errors = [];
  if (!Number.isFinite(amount) || amount === 0) errors.push('Укажите сумму');
  if (!OWNERS.includes(req.body.owner)) errors.push('Укажите, кто вносит');
  if (errors.length) return res.status(400).json({ errors });
  const goal = addGoalDeposit(Number(req.params.id), { amount, owner: req.body.owner });
  if (!goal) return res.status(404).json({ errors: ['Цель не найдена'] });
  res.status(201).json(goal);
});

// ───── Этап 3: статистика для графиков ─────

// Доходы/расходы помесячно: ?months=6 (по умолчанию 6, максимум 24)
app.get('/api/stats/monthly', (req, res) => {
  const months = Math.min(24, Math.max(2, Number(req.query.months) || 6));
  res.json(monthlyStats(months));
});

// ───── Этап 3: экспорт в CSV ─────

// Русские названия для читаемого CSV (дублируют фронтенд сознательно:
// сервер не должен зависеть от файлов public/)
const CAT_NAMES = {
  food: 'Еда', home: 'Жильё', transport: 'Транспорт', kids: 'Дети',
  health: 'Здоровье', fun: 'Развлечения', subs: 'Подписки', other: 'Другое',
  salary: 'Зарплата', gift: 'Подарки', other_income: 'Другое (доход)',
};
const OWNER_NAMES = { me: 'Мои', wife: 'Её', shared: 'Общие' };
const TYPE_NAMES = { income: 'Доход', expense: 'Расход' };

// Скачивание: /api/export.csv (всё) или /api/export.csv?month=YYYY-MM
app.get('/api/export.csv', (req, res) => {
  const txs = listTransactions({ month: req.query.month });

  // Экранирование поля CSV: кавычки, если внутри есть ; " или перенос строки
  const esc = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = ['Дата;Тип;Сумма;Категория;Владелец;Комментарий'];
  for (const t of txs) {
    lines.push([
      t.date,
      TYPE_NAMES[t.type],
      String(t.amount).replace('.', ','), // десятичная запятая для русского Excel
      CAT_NAMES[t.category] || t.category,
      OWNER_NAMES[t.owner],
      t.comment,
    ].map(esc).join(';'));
  }

  // BOM, чтобы Excel корректно открыл UTF-8; разделитель ; — стандарт для ru-локали
  const csv = '\uFEFF' + lines.join('\r\n');
  const fname = `budget${req.query.month ? '-' + req.query.month : ''}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(csv);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Семейный бюджет запущен: http://localhost:${PORT}`);
});
