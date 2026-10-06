# Деплой на hoster.ru (панель cp.hoster.ru)

Приложению нужен Node.js ≥ 22.5, поэтому подойдёт **VPS** (виртуальный сервер
с root-доступом). Обычный «виртуальный хостинг» hoster.ru рассчитан на PHP —
Node-приложение там не запустить.

Хватит самого дешёвого тарифа: 1 ядро / 1 ГБ RAM (например, «Start-Cloud Fast»
или VPS KVM) — приложение потребляет ~50 МБ памяти.

---

## Шаг 1. Заказать VPS

1. Зайдите в панель [cp.hoster.ru](https://cp.hoster.ru) → **VPS/VDS** → заказать сервер.
2. ОС: **Ubuntu 24.04** (или 22.04).
3. После активации на почту придут IP-адрес и пароль root.

## Шаг 2. Подключиться и установить Node.js 22

```bash
ssh root@ВАШ_IP

# Node.js 22 LTS из официального репозитория NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git
node -v   # должно показать v22.x
```

## Шаг 3. Загрузить приложение

Вариант А — через git (рекомендуется):

```bash
cd /opt
git clone https://github.com/Roses1s/jet.git budget
cd budget
npm install
```

Вариант Б — без git: загрузите папку проекта (без `node_modules` и `data`)
любым SFTP-клиентом (FileZilla, WinSCP) в `/opt/budget`, затем `npm install`.

Проверка: `npm start` → откройте `http://ВАШ_IP:3000`. Если работает — Ctrl+C
и идём дальше, чтобы приложение жило постоянно.

## Шаг 4. Автозапуск через systemd

```bash
cat > /etc/systemd/system/budget.service <<'EOF'
[Unit]
Description=Семейный бюджет
After=network.target

[Service]
WorkingDirectory=/opt/budget
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now budget
systemctl status budget   # active (running)
```

Теперь приложение переживает перезагрузку сервера и падения процесса.

## Шаг 5 (желательно). Домен и HTTPS

PWA (установка на главный экран телефона) и сервис-воркер **требуют HTTPS** —
по голому `http://IP:3000` приложение работать будет, но «как сайт».

1. В cp.hoster.ru привяжите домен (к VPS обычно дарят домен .ru/.рф):
   А-запись домена → IP вашего VPS.
2. Поставьте nginx как реверс-прокси и получите бесплатный сертификат:

```bash
apt-get install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/budget <<'EOF'
server {
    server_name ВАШ_ДОМЕН.ru;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
EOF

ln -s /etc/nginx/sites-available/budget /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

certbot --nginx -d ВАШ_ДОМЕН.ru   # сертификат + автопродление
```

Готово: `https://ВАШ_ДОМЕН.ru` — открывайте с обоих телефонов,
«Добавить на главный экран» → приложение как нативное.

## Шаг 6. Бэкапы

Все данные — один файл `/opt/budget/data/budget.db`. Раз в день копируем:

```bash
crontab -e
# добавить строку (бэкап в 03:00, хранится 30 копий):
0 3 * * * cp /opt/budget/data/budget.db /root/backup-budget-$(date +\%d).db
```

## Обновление приложения

```bash
cd /opt/budget && git pull && npm install && systemctl restart budget
```

---

### Частые проблемы

| Симптом | Решение |
|---|---|
| `http://IP:3000` не открывается | Проверьте фаервол: `ufw allow 3000` (или в панели cp.hoster.ru) |
| PWA не предлагает установку | Нужен HTTPS — выполните шаг 5 |
| После перезагрузки VPS всё пропало | Убедитесь, что сервис включён: `systemctl enable budget` |
