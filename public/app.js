// app.js — вся логика интерфейса семейного бюджета.
// Структура: константы → состояние → API → рендер → обработчики.

'use strict';

// ───────────────────────── Константы ─────────────────────────

// Базовые категории. id хранится в базе, остальное — для отображения.
const CATEGORIES = [
  // расходы
  { id: 'food',      name: 'Еда',          emoji: '🍎', type: 'expense' },
  { id: 'home',      name: 'Жильё',        emoji: '🏠', type: 'expense' },
  { id: 'transport', name: 'Транспорт',    emoji: '🚗', type: 'expense' },
  { id: 'kids',      name: 'Дети',         emoji: '🧸', type: 'expense' },
  { id: 'health',    name: 'Здоровье',     emoji: '💊', type: 'expense' },
  { id: 'fun',       name: 'Развлечения',  emoji: '🎉', type: 'expense' },
  { id: 'subs',      name: 'Подписки',     emoji: '📺', type: 'expense' },
  { id: 'other',     name: 'Другое',       emoji: '📦', type: 'expense' },
  // доходы
  { id: 'salary',       name: 'Зарплата', emoji: '💰', type: 'income' },
  { id: 'gift',         name: 'Подарки',  emoji: '🎁', type: 'income' },
  { id: 'other_income', name: 'Другое',   emoji: '📦', type: 'income' },
];

const OWNERS = {
  me:     { name: 'Мои',   emoji: '👨' },
  wife:   { name: 'Её',    emoji: '👩' },
  shared: { name: 'Общие', emoji: '👨‍👩‍👧' },
};

const catById = (id) => CATEGORIES.find((c) => c.id === id)
  || { id, name: id, emoji: '❓', type: 'expense' };

// ───────────────────────── Состояние ─────────────────────────

// Эмодзи на выбор для целей-копилок
const GOAL_EMOJIS = ['🏖️', '✈️', '🚗', '🏠', '🛟', '💍', '🎁', '🎯'];

const state = {
  user: localStorage.getItem('jet-user') || null, // 'me' | 'wife'
  month: new Date(),                              // просматриваемый месяц
  view: 'dashboard',                              // активная вкладка
  filters: { type: '', owner: '', category: '' }, // фильтры списка операций
  form: { type: 'expense', category: 'food', owner: 'me' }, // состояние формы
  editId: null,                                   // id редактируемой операции (null = новая)
  // Этап 2:
  goalForm: { emoji: '🎯' },                       // форма новой цели
  deposit: { goalId: null, mode: 'add', owner: 'me' }, // форма пополнения
  recForm: { type: 'expense', category: 'home', owner: 'shared' }, // форма правила
};

// ───────────────────────── Утилиты ─────────────────────────

const $ = (sel) => document.querySelector(sel);

/** 15340.5 → "15 340,5 ₽" */
function fmtMoney(n) {
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(n);
  return `${formatted} ₽`;
}

/** Date → "2026-10" */
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Date → "YYYY-MM-DD" (локальная дата, без UTC-сдвига) */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-10-06" → "понедельник, 6 октября" (или «Сегодня»/«Вчера») */
function humanDate(iso) {
  const today = isoDate(new Date());
  const yesterday = isoDate(new Date(Date.now() - 86400000));
  if (iso === today) return 'Сегодня';
  if (iso === yesterday) return 'Вчера';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    weekday: 'short', day: 'numeric', month: 'long',
  });
}

// ───────────────────────── API ─────────────────────────

async function apiGet(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  );
  const res = await fetch(`/api/transactions?${qs}`);
  return res.json();
}

async function apiAdd(tx) {
  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx),
  });
  if (!res.ok) {
    const { errors } = await res.json();
    throw new Error((errors || ['Ошибка сохранения']).join('\n'));
  }
  return res.json();
}

async function apiDelete(id) {
  await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
}

// ───── Этап 2: универсальный помощник для JSON-запросов ─────
async function apiJson(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors || ['Ошибка запроса']).join('\n'));
  return data;
}

// ───────────────────────── Рендер: общее ─────────────────────────

function renderUserChip() {
  const u = OWNERS[state.user] || OWNERS.me;
  $('#user-chip').textContent = `${u.emoji} ${state.user === 'wife' ? 'Жена' : 'Я'}`;
}

function renderMonthLabel() {
  $('#month-label').textContent = state.month.toLocaleDateString('ru-RU', {
    month: 'long', year: 'numeric',
  }).replace(' г.', '');
}

/** Перерисовать активную вкладку с данными текущего месяца */
async function refresh() {
  renderMonthLabel();
  if (state.view === 'dashboard') await renderDashboard();
  else if (state.view === 'transactions') await renderTransactions();
  else if (state.view === 'goals') await renderGoals();
  else if (state.view === 'more') await renderMore();
}

// ───────────────────────── Рендер: дашборд ─────────────────────────

async function renderDashboard() {
  // Операции месяца, лимиты и статистику запрашиваем параллельно
  const [txs, limits, stats] = await Promise.all([
    apiGet({ month: monthKey(state.month) }),
    apiJson('/api/limits'),
    apiJson('/api/stats/monthly?months=6'),
  ]);
  renderTrends(stats);

  // Итоги: доход, расход, баланс
  let income = 0, expense = 0;
  const byOwner = { me: 0, wife: 0, shared: 0 };     // только расходы
  const byCategory = {};                              // только расходы

  for (const t of txs) {
    if (t.type === 'income') income += t.amount;
    else {
      expense += t.amount;
      byOwner[t.owner] += t.amount;
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    }
  }

  const balance = income - expense;
  const balEl = $('#balance-value');
  balEl.textContent = (balance > 0 ? '+' : '') + fmtMoney(balance);
  $('#income-value').textContent = fmtMoney(income);
  $('#expense-value').textContent = fmtMoney(expense);

  // Карточки «я / жена / общие»
  $('#owner-breakdown').innerHTML = Object.entries(OWNERS).map(([key, o]) => `
    <div class="owner-card">
      <div class="emoji">${o.emoji}</div>
      <div class="name">${o.name}</div>
      <div class="sum">${fmtMoney(byOwner[key])}</div>
    </div>
  `).join('');

  // Категории с прогресс-барами.
  // Показываем категории, где есть траты ИЛИ задан лимит (чтобы видеть запас).
  const catIds = new Set([...Object.keys(byCategory), ...Object.keys(limits)]);
  const rows = [...catIds]
    .map((id) => ({ id, sum: byCategory[id] || 0, limit: limits[id] }))
    .sort((a, b) => b.sum - a.sum);

  $('#category-breakdown').innerHTML = rows.length
    ? rows.map(({ id, sum, limit }) => {
        const c = catById(id);
        let pct, barClass = '', note = '';
        if (limit) {
          // Есть лимит: бар показывает «потрачено из лимита»
          pct = Math.min(100, Math.round((sum / limit) * 100));
          if (sum > limit) {
            barClass = 'over';
            note = `<span class="cat-limit-note over">превышен на ${fmtMoney(sum - limit)}</span>`;
          } else {
            if (pct >= 80) barClass = 'warn';
            note = `<span class="cat-limit-note">из ${fmtMoney(limit)} · осталось ${fmtMoney(limit - sum)}</span>`;
          }
        } else {
          // Без лимита: бар — доля от всех расходов месяца
          pct = expense ? Math.round((sum / expense) * 100) : 0;
        }
        return `
          <div class="cat-row">
            <div class="cat-emoji">${c.emoji}</div>
            <div class="cat-info">
              <div class="cat-top"><span>${c.name}</span><span>${fmtMoney(sum)}</span></div>
              <div class="cat-bar-bg"><div class="cat-bar ${barClass}" style="width:${pct}%"></div></div>
              ${note}
            </div>
          </div>`;
      }).join('')
    : '<div class="empty-note">Пока нет расходов в этом месяце.<br>Нажмите «+», чтобы добавить первую операцию.</div>';
}

// ───────────────────── Этап 3: график трендов ─────────────────────

let trendStats = []; // данные последнего рендера — для тапа по колонке

function renderTrends(stats) {
  trendStats = stats;
  const max = Math.max(1, ...stats.flatMap((s) => [s.income, s.expense]));

  $('#trend-chart').innerHTML = stats.map((s, i) => {
    const [y, m] = s.ym.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
    // Высота бара — доля от максимума за период (минимум 2px, чтобы был виден ноль)
    const hInc = Math.round((s.income / max) * 100);
    const hExp = Math.round((s.expense / max) * 100);
    return `
      <button type="button" class="chart-col" data-i="${i}" title="Подробнее">
        <div class="chart-bars">
          <div class="cbar income" style="height:${hInc}%"></div>
          <div class="cbar expense" style="height:${hExp}%"></div>
        </div>
        <div class="chart-label">${label}</div>
      </button>`;
  }).join('');

  $('#trend-info').innerHTML = ''; // сбрасываем подпись при перерисовке
}

/** Тап по колонке графика — показать цифры месяца */
function showTrendInfo(i) {
  const s = trendStats[i];
  if (!s) return;
  const [y, m] = s.ym.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  const bal = s.income - s.expense;
  $('#trend-info').innerHTML =
    `${name}: ↑ ${fmtMoney(s.income)} · ↓ ${fmtMoney(s.expense)} · ` +
    `итог <b class="${bal >= 0 ? 'pos' : 'neg'}">${bal > 0 ? '+' : ''}${fmtMoney(bal)}</b>`;
  document.querySelectorAll('.chart-col').forEach((c) =>
    c.classList.toggle('active', Number(c.dataset.i) === i));
}

// ───────────────────── Этап 3: тёмная тема ─────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // Цвет статус-бара на телефоне под цвет шапки
  document.querySelector('meta[name="theme-color"]').content =
    theme === 'dark' ? '#0f131d' : '#4f6df5';
  const sw = $('#theme-switch');
  if (sw) sw.classList.toggle('on', theme === 'dark');
}

function initTheme() {
  // Сохранённый выбор, иначе — системная настройка
  const saved = localStorage.getItem('jet-theme');
  const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved || system);
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('jet-theme', next);
  applyTheme(next);
}

// ───────────────────────── Этап 2: цели-копилки ─────────────────────────

async function renderGoals() {
  const goals = await apiJson('/api/goals');
  $('#goals-list').innerHTML = goals.length
    ? goals.map((g) => {
        const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
        const done = g.saved >= g.target;
        return `
          <div class="goal-card" data-id="${g.id}">
            <div class="goal-head">
              <div class="goal-emoji">${g.emoji}</div>
              <div class="goal-title">${escapeHtml(g.title)}</div>
              ${done ? '<span class="goal-done-badge">✓ Накоплено!</span>' : ''}
              <button class="goal-delete" title="Удалить цель">✕</button>
            </div>
            <div class="goal-sums">
              <span class="goal-saved">${fmtMoney(g.saved)}</span>
              <span class="goal-target">${pct}% из ${fmtMoney(g.target)}</span>
            </div>
            <div class="goal-bar-bg"><div class="goal-bar ${done ? 'done' : ''}" style="width:${pct}%"></div></div>
            <div class="goal-owners">
              <span>👨 ${fmtMoney(g.byOwner.me)}</span>
              <span>👩 ${fmtMoney(g.byOwner.wife)}</span>
              <span>👨‍👩‍👧 ${fmtMoney(g.byOwner.shared)}</span>
            </div>
            <div class="goal-actions">
              <button class="goal-btn goal-deposit">＋ Пополнить</button>
            </div>
          </div>`;
      }).join('')
    : '<div class="empty-note">Целей пока нет.<br>Создайте первую — отпуск, подушка безопасности, машина…</div>';
}

// ─────────────── Этап 2: вкладка «Ещё» (лимиты + повторяющиеся) ───────────────

async function renderMore() {
  const [limits, recurring] = await Promise.all([
    apiJson('/api/limits'),
    apiJson('/api/recurring'),
  ]);

  // Лимиты: по строке на каждую расходную категорию
  $('#limits-list').innerHTML = CATEGORIES.filter((c) => c.type === 'expense')
    .map((c) => `
      <div class="limit-row">
        <span class="limit-name">${c.emoji} ${c.name}</span>
        <input class="limit-input" type="number" inputmode="numeric" min="0" step="100"
               data-cat="${c.id}" placeholder="—" value="${limits[c.id] ?? ''}">
        <span>₽</span>
      </div>
    `).join('');

  // Этап 3: ссылка экспорта текущего месяца + положение тумблера темы
  const ym = monthKey(new Date());
  $('#export-month').href = `/api/export.csv?month=${ym}`;
  $('#theme-switch').classList.toggle('on', document.documentElement.dataset.theme === 'dark');

  // Повторяющиеся платежи
  $('#recurring-list').innerHTML = recurring.length
    ? recurring.map((r) => {
        const c = catById(r.category);
        const o = OWNERS[r.owner];
        const sign = r.type === 'income' ? '+' : '−';
        return `
          <div class="rec-item ${r.active ? '' : 'off'}" data-id="${r.id}">
            <div class="tx-emoji">${c.emoji}</div>
            <div class="rec-info">
              <div class="rec-title">${escapeHtml(r.title)}</div>
              <div class="rec-meta">каждое ${r.day}-е число · ${c.name} · ${o.emoji} ${o.name}</div>
            </div>
            <div class="rec-amount ${r.type}">${sign} ${fmtMoney(r.amount)}</div>
            <button class="switch ${r.active ? 'on' : ''}" title="Вкл/выкл"></button>
            <button class="tx-delete rec-del" title="Удалить">✕</button>
          </div>`;
      }).join('')
    : '<div class="empty-note">Нет повторяющихся платежей</div>';
}

// ───────────────────────── Рендер: список операций ─────────────────────────

let txCache = []; // операции последнего рендера — для открытия на редактирование

async function renderTransactions() {
  const txs = await apiGet({ month: monthKey(state.month), ...state.filters });
  txCache = txs;
  const list = $('#tx-list');

  if (!txs.length) {
    list.innerHTML = '<div class="empty-note">Операций не найдено</div>';
    return;
  }

  // Группируем по дате
  let html = '';
  let lastDate = null;
  for (const t of txs) {
    if (t.date !== lastDate) {
      html += `<div class="tx-date-header">${humanDate(t.date)}</div>`;
      lastDate = t.date;
    }
    const c = catById(t.category);
    const o = OWNERS[t.owner];
    const sign = t.type === 'income' ? '+' : '−';
    html += `
      <div class="tx-item" data-id="${t.id}" title="Нажмите, чтобы изменить">
        <div class="tx-emoji">${c.emoji}</div>
        <div class="tx-info">
          <div class="tx-name">${t.comment ? escapeHtml(t.comment) : c.name}</div>
          <div class="tx-meta">${c.name} · ${o.emoji} ${o.name}</div>
        </div>
        <div class="tx-amount ${t.type}">${sign} ${fmtMoney(t.amount)}</div>
        <button class="tx-delete" data-id="${t.id}" title="Удалить">✕</button>
      </div>`;
  }
  list.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Заполняем select фильтра категорий один раз
function initCategoryFilter() {
  const sel = $('#filter-category');
  for (const c of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.emoji} ${c.name}${c.type === 'income' ? ' (доход)' : ''}`;
    sel.appendChild(opt);
  }
}

// ───────────────────────── Форма добавления ─────────────────────────

/**
 * Открыть форму операции.
 * Без аргумента — новая операция; с объектом операции — редактирование.
 */
function openModal(tx = null) {
  if (tx) {
    state.editId = tx.id;
    state.form = { type: tx.type, category: tx.category, owner: tx.owner };
    $('#f-amount').value = tx.amount;
    $('#f-comment').value = tx.comment || '';
    $('#f-date').value = tx.date;
  } else {
    // Значения по умолчанию: расход, сегодня, владелец = текущий пользователь
    state.editId = null;
    state.form = { type: 'expense', category: 'food', owner: state.user || 'me' };
    $('#f-amount').value = '';
    $('#f-comment').value = '';
    $('#f-date').value = isoDate(new Date());
  }
  $('.modal-title').textContent = tx ? 'Редактирование' : 'Новая операция';
  $('#tx-submit').textContent = tx ? 'Сохранить' : 'Добавить';
  renderForm();
  $('#modal').classList.remove('hidden');
  setTimeout(() => $('#f-amount').focus(), 250);
}

function closeModal() {
  $('#modal').classList.add('hidden');
}

/** Синхронизировать переключатели и чипы с state.form */
function renderForm() {
  // Тип
  document.querySelectorAll('#seg-type .seg').forEach((b) =>
    b.classList.toggle('active', b.dataset.type === state.form.type));

  // Владелец
  document.querySelectorAll('#seg-owner .seg').forEach((b) =>
    b.classList.toggle('active', b.dataset.owner === state.form.owner));

  // Чипы категорий для выбранного типа
  const cats = CATEGORIES.filter((c) => c.type === state.form.type);
  if (!cats.some((c) => c.id === state.form.category)) state.form.category = cats[0].id;
  $('#f-categories').innerHTML = cats.map((c) => `
    <button type="button" class="chip ${c.id === state.form.category ? 'active' : ''}"
            data-cat="${c.id}">${c.emoji} ${c.name}</button>
  `).join('');
}

async function submitForm(e) {
  e.preventDefault();
  const amount = parseFloat($('#f-amount').value.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) {
    $('#f-amount').focus();
    return;
  }
  const payload = {
    type: state.form.type,
    amount,
    category: state.form.category,
    owner: state.form.owner,
    date: $('#f-date').value,
    comment: $('#f-comment').value,
  };
  try {
    // editId задан — обновляем существующую, иначе создаём новую
    if (state.editId) await apiJson(`/api/transactions/${state.editId}`, 'PUT', payload);
    else await apiAdd(payload);
    closeModal();
    // Переходим на месяц добавленной операции, чтобы её сразу было видно
    const [y, m] = $('#f-date').value.split('-').map(Number);
    state.month = new Date(y, m - 1, 1);
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

// ───────────────── Этап 2: модалки целей и повторяющихся ─────────────────

function openGoalModal() {
  state.goalForm = { emoji: '🎯' };
  $('#g-title').value = '';
  $('#g-target').value = '';
  renderGoalEmojis();
  $('#goal-modal').classList.remove('hidden');
}

function renderGoalEmojis() {
  $('#goal-emojis').innerHTML = GOAL_EMOJIS.map((e) => `
    <button type="button" class="chip emoji-chip ${e === state.goalForm.emoji ? 'active' : ''}"
            data-emoji="${e}">${e}</button>
  `).join('');
}

async function submitGoal(e) {
  e.preventDefault();
  try {
    await apiJson('/api/goals', 'POST', {
      title: $('#g-title').value,
      emoji: state.goalForm.emoji,
      target: parseFloat($('#g-target').value),
    });
    $('#goal-modal').classList.add('hidden');
    refresh();
  } catch (err) { alert(err.message); }
}

function openDepositModal(goalId) {
  state.deposit = { goalId, mode: 'add', owner: state.user || 'me' };
  $('#d-amount').value = '';
  renderDepositForm();
  $('#deposit-modal').classList.remove('hidden');
  setTimeout(() => $('#d-amount').focus(), 250);
}

function renderDepositForm() {
  $('#deposit-title').textContent =
    state.deposit.mode === 'add' ? 'Пополнить копилку' : 'Снять из копилки';
  document.querySelectorAll('#seg-dep .seg').forEach((b) =>
    b.classList.toggle('active', b.dataset.dep === state.deposit.mode));
  document.querySelectorAll('#seg-dep-owner .seg').forEach((b) =>
    b.classList.toggle('active', b.dataset.owner === state.deposit.owner));
}

async function submitDeposit(e) {
  e.preventDefault();
  const amount = parseFloat($('#d-amount').value.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) { $('#d-amount').focus(); return; }
  try {
    await apiJson(`/api/goals/${state.deposit.goalId}/deposits`, 'POST', {
      amount: state.deposit.mode === 'withdraw' ? -amount : amount,
      owner: state.deposit.owner,
    });
    $('#deposit-modal').classList.add('hidden');
    refresh();
  } catch (err) { alert(err.message); }
}

function openRecModal() {
  state.recForm = { type: 'expense', category: 'home', owner: 'shared' };
  $('#r-title').value = '';
  $('#r-amount').value = '';
  $('#r-day').value = 1;
  renderRecForm();
  $('#rec-modal').classList.remove('hidden');
}

function renderRecForm() {
  document.querySelectorAll('#seg-rec-type .seg').forEach((b) =>
    b.classList.toggle('active', b.dataset.type === state.recForm.type));
  document.querySelectorAll('#seg-rec-owner .seg').forEach((b) =>
    b.classList.toggle('active', b.dataset.owner === state.recForm.owner));

  const cats = CATEGORIES.filter((c) => c.type === state.recForm.type);
  if (!cats.some((c) => c.id === state.recForm.category)) state.recForm.category = cats[0].id;
  $('#r-categories').innerHTML = cats.map((c) => `
    <button type="button" class="chip ${c.id === state.recForm.category ? 'active' : ''}"
            data-cat="${c.id}">${c.emoji} ${c.name}</button>
  `).join('');
}

async function submitRec(e) {
  e.preventDefault();
  try {
    await apiJson('/api/recurring', 'POST', {
      title: $('#r-title').value,
      type: state.recForm.type,
      amount: parseFloat($('#r-amount').value.replace(',', '.')),
      category: state.recForm.category,
      owner: state.recForm.owner,
      day: parseInt($('#r-day').value, 10),
    });
    $('#rec-modal').classList.add('hidden');
    refresh();
  } catch (err) { alert(err.message); }
}

/** Собрать значения из инпутов лимитов и сохранить одним запросом */
async function saveLimits() {
  const limits = {};
  document.querySelectorAll('.limit-input').forEach((inp) => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v) && v > 0) limits[inp.dataset.cat] = v;
  });
  const btn = $('#limits-save');
  await apiJson('/api/limits', 'PUT', limits);
  btn.textContent = '✓ Сохранено';
  setTimeout(() => { btn.textContent = 'Сохранить лимиты'; }, 1500);
}

// ───────────────────────── Навигация и события ─────────────────────────

function switchView(view) {
  state.view = view;
  for (const v of ['dashboard', 'transactions', 'goals', 'more']) {
    $(`#view-${v}`).classList.toggle('hidden', v !== view);
  }
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.view === view));
  // «+» (новая операция) уместен только на дашборде и в операциях.
  // Селектор месяца на вкладках «Цели» и «Ещё» тоже не нужен.
  const monthless = view === 'goals' || view === 'more';
  $('#fab').classList.toggle('hidden', monthless);
  $('.month-nav').classList.toggle('hidden', monthless);
  refresh();
}

function selectUser(user) {
  state.user = user;
  localStorage.setItem('jet-user', user);
  $('#user-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderUserChip();
  refresh();
}

function bindEvents() {
  // Выбор пользователя
  document.querySelectorAll('.user-btn').forEach((b) =>
    b.addEventListener('click', () => selectUser(b.dataset.user)));

  // Смена пользователя по чипу в шапке
  $('#user-chip').addEventListener('click', () => {
    $('#app').classList.add('hidden');
    $('#user-screen').classList.remove('hidden');
  });

  // Месяцы
  $('#month-prev').addEventListener('click', () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    refresh();
  });
  $('#month-next').addEventListener('click', () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    refresh();
  });

  // Вкладки
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => switchView(t.dataset.view)));

  // Фильтры
  $('#filter-type').addEventListener('change', (e) => { state.filters.type = e.target.value; refresh(); });
  $('#filter-owner').addEventListener('change', (e) => { state.filters.owner = e.target.value; refresh(); });
  $('#filter-category').addEventListener('change', (e) => { state.filters.category = e.target.value; refresh(); });

  // Список операций: ✕ — удалить, тап по строке — редактировать
  $('#tx-list').addEventListener('click', async (e) => {
    const del = e.target.closest('.tx-delete');
    if (del) {
      if (!confirm('Удалить операцию?')) return;
      await apiDelete(del.dataset.id);
      refresh();
      return;
    }
    const item = e.target.closest('.tx-item');
    if (item) {
      const tx = txCache.find((t) => t.id === Number(item.dataset.id));
      if (tx) openModal(tx);
    }
  });

  // Модалка
  $('#fab').addEventListener('click', () => openModal());
  $('.modal-backdrop').addEventListener('click', closeModal);
  $('#tx-form').addEventListener('submit', submitForm);

  // Переключатели в форме (делегирование)
  $('#seg-type').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) { state.form.type = b.dataset.type; renderForm(); }
  });
  $('#seg-owner').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) { state.form.owner = b.dataset.owner; renderForm(); }
  });
  $('#f-categories').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) { state.form.category = b.dataset.cat; renderForm(); }
  });

  // ───── Этап 2: цели ─────
  $('#goal-add-btn').addEventListener('click', openGoalModal);
  $('#goal-form').addEventListener('submit', submitGoal);
  $('#goal-emojis').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) { state.goalForm.emoji = b.dataset.emoji; renderGoalEmojis(); }
  });

  // Делегирование по карточкам целей: пополнить / удалить
  $('#goals-list').addEventListener('click', async (e) => {
    const card = e.target.closest('.goal-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('.goal-deposit')) openDepositModal(id);
    if (e.target.closest('.goal-delete')) {
      if (!confirm('Удалить цель вместе с историей пополнений?')) return;
      await apiJson(`/api/goals/${id}`, 'DELETE');
      refresh();
    }
  });

  // Форма пополнения/снятия
  $('#deposit-form').addEventListener('submit', submitDeposit);
  $('#seg-dep').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) { state.deposit.mode = b.dataset.dep; renderDepositForm(); }
  });
  $('#seg-dep-owner').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) { state.deposit.owner = b.dataset.owner; renderDepositForm(); }
  });

  // ───── Этап 2: лимиты и повторяющиеся ─────
  $('#limits-save').addEventListener('click', saveLimits);
  $('#rec-add-btn').addEventListener('click', openRecModal);
  $('#rec-form').addEventListener('submit', submitRec);
  $('#seg-rec-type').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) { state.recForm.type = b.dataset.type; renderRecForm(); }
  });
  $('#seg-rec-owner').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) { state.recForm.owner = b.dataset.owner; renderRecForm(); }
  });
  $('#r-categories').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) { state.recForm.category = b.dataset.cat; renderRecForm(); }
  });

  // Список правил: вкл/выкл и удаление (делегирование)
  $('#recurring-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.rec-item');
    if (!item) return;
    const id = item.dataset.id;
    const sw = e.target.closest('.switch');
    if (sw) {
      await apiJson(`/api/recurring/${id}`, 'PATCH', { active: !sw.classList.contains('on') });
      refresh();
    }
    if (e.target.closest('.rec-del')) {
      if (!confirm('Удалить правило? Уже созданные операции останутся.')) return;
      await apiJson(`/api/recurring/${id}`, 'DELETE');
      refresh();
    }
  });

  // Закрытие модалок Этапа 2 по фону (data-close="id модалки")
  document.querySelectorAll('[data-close]').forEach((bd) =>
    bd.addEventListener('click', () => $(`#${bd.dataset.close}`).classList.add('hidden')));

  // ───── Этап 3: график и тема ─────
  $('#trend-chart').addEventListener('click', (e) => {
    const col = e.target.closest('.chart-col');
    if (col) showTrendInfo(Number(col.dataset.i));
  });
  $('#theme-switch').addEventListener('click', toggleTheme);
}

// ───────────────────────── Запуск ─────────────────────────

function init() {
  initTheme(); // тему применяем сразу, до первого рендера
  initCategoryFilter();
  bindEvents();

  // PWA: регистрируем сервис-воркер (офлайн-оболочка + установка на экран)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (state.user) {
    // Пользователь уже выбирал — сразу в приложение
    $('#app').classList.remove('hidden');
    renderUserChip();
    refresh();
  } else {
    $('#user-screen').classList.remove('hidden');
  }
}

init();
