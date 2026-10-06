# Деплой на Cloud.ru Evolution

> ⚠️ **ВАЖНО (октябрь 2026):** программа бесплатных виртуальных машин
> (free tier VM 2vCPU/4ГБ) в Cloud.ru **закрыта** — страница документации
> удалена, в free tier остались только Object Storage, Container Apps и
> Managed BI. Минимальная платная ВМ стоит ~562 ₽/мес, что дороже обычных
> VPS (150–250 ₽/мес у других провайдеров). Инструкция ниже технически
> применима к платной ВМ Cloud.ru, но по цене это невыгодно —
> см. раздел «Деплой» в README про альтернативы.

Что получится: приложение работает 24/7 на ВМ Cloud.ru,
открывается с обоих телефонов по HTTPS, ставится на главный экран как PWA.

---

## Шаг 1. Создать бесплатную ВМ

1. Зайдите в консоль [console.cloud.ru](https://console.cloud.ru).
2. Меню (⋮⋮⋮ слева сверху) → **Инфраструктура → Виртуальные машины** →
   **Создать виртуальную машину**.
3. Вам покажут платную конфигурацию — ищите ниже кнопку
   **«Получить ВМ бесплатно»** (free tier) и жмите её.
4. Заполните:
   - **Название**: `budget`
   - **Образ**: вкладка «Публичные» → **Ubuntu 24.04** (или 22.04)
   - **Сетевой интерфейс**: тип **Публичный IP** → **Арендовать новый**
     (это та самая платная часть, спишется с бонусов)
   - **Логин**: `budget`
   - **Метод аутентификации**: *Публичный ключ* → кнопка
     **«Сгенерировать ключ»** — приватный ключ (файл вида `budget.pem`)
     скачается на компьютер. **Сохраните его** — без него на сервер не попасть.
     Галочку «Пароль» тоже можно включить — пригодится для веб-консоли.
5. Нажмите **Создать**. Через минуту ВМ появится со статусом «Запущена».
6. Скопируйте её **публичный IP** (далее в командах он называется `ВАШ_IP`).

## Шаг 2. Открыть порты (группа безопасности)

По умолчанию входящие соединения закрыты.

1. **Сети → Группы безопасности** → **Создать** (название `budget`,
   та же зона доступности, что у ВМ).
2. Добавьте **входящие** правила (источник везде `0.0.0.0/0`, протокол TCP):

   | Порт | Зачем |
   |---|---|
   | 22  | SSH-доступ |
   | 80  | HTTP (нужен для выпуска сертификата) |
   | 443 | HTTPS — основной доступ к приложению |

3. Исходящий трафик: разрешить любой (`0.0.0.0/0`).
4. Откройте вашу ВМ → сетевой интерфейс → назначьте группу `budget`.

## Шаг 3. Подключиться по SSH

С компьютера (Windows 10/11 — прямо в PowerShell, macOS/Linux — терминал):

```bash
# один раз ограничиваем права на ключ (Linux/macOS):
chmod 600 ~/Downloads/budget.pem

ssh -i ~/Downloads/budget.pem budget@ВАШ_IP
```

Увидели приглашение `budget@budget:~$` — вы на сервере.

## Шаг 4. Установить Node.js 22 и запустить приложение

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs git nginx
node -v    # должно быть v22.x

# Приложение
sudo mkdir -p /opt/budget && sudo chown $USER /opt/budget
git clone https://github.com/Roses1s/jet.git /opt/budget
cd /opt/budget
npm install
```

Быстрая проверка: `npm start`, затем в другом окне `curl localhost:3000` —
должен вернуться HTML. Останавливаем (Ctrl+C) и настраиваем автозапуск.

## Шаг 5. Автозапуск (systemd)

```bash
sudo tee /etc/systemd/system/budget.service > /dev/null <<EOF
[Unit]
Description=Семейный бюджет
After=network.target

[Service]
User=$USER
WorkingDirectory=/opt/budget
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now budget
systemctl status budget    # active (running) — зелёным
```

## Шаг 6. HTTPS без покупки домена (sslip.io)

PWA требует HTTPS. Домен покупать не обязательно — сервис **sslip.io**
бесплатно превращает IP в имя: если ваш IP `85.12.34.56`, то адрес будет
`budget.85-12-34-56.sslip.io` (точки IP меняются на дефисы!).

```bash
# nginx — реверс-прокси перед приложением
sudo tee /etc/nginx/sites-available/budget > /dev/null <<'EOF'
server {
    listen 80;
    server_name budget.85-12-34-56.sslip.io;   # ← подставьте СВОЙ IP через дефисы
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/budget /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Бесплатный сертификат Let's Encrypt
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d budget.85-12-34-56.sslip.io   # ← снова свой IP
```

Готово: **`https://budget.85-12-34-56.sslip.io`** — открывайте с телефонов.

> Если certbot ругнётся на лимит сертификатов sslip.io (бывает — домен
> общий на всех), варианты: попробовать на следующий день, использовать
> nip.io вместо sslip.io, или купить свой домен .ru (~200 ₽/год) — тогда
> в конфиге и certbot просто укажите его.

## Шаг 7. Установить на телефоны

1. Откройте `https://budget.ваш-адрес.sslip.io` в Chrome (Android) или
   Safari (iPhone).
2. Меню браузера → **«Добавить на главный экран» / «На экран "Домой"»**.
3. На экране появится иконка «Бюджет» — приложение открывается на весь
   экран, без адресной строки. То же самое — на телефоне жены.

## Шаг 8. Бэкапы (вся база — один файл)

```bash
crontab -e
# бэкап каждый день в 03:00, хранится месяц (по копии на число):
0 3 * * * cp /opt/budget/data/budget.db /home/budget/backup-$(date +\%d).db
```

Иногда скачивайте копию себе на компьютер:

```bash
scp -i budget.pem budget@ВАШ_IP:/opt/budget/data/budget.db ./budget-backup.db
```

## Обновление приложения

```bash
ssh -i budget.pem budget@ВАШ_IP
cd /opt/budget && git pull && npm install && sudo systemctl restart budget
```

---

## Частые проблемы

| Симптом | Решение |
|---|---|
| SSH не подключается | Проверьте, что в группе безопасности открыт порт 22 и она назначена ВМ |
| `curl localhost:3000` работает, а сайт снаружи нет | Порты 80/443 не открыты в группе безопасности |
| certbot: ошибка валидации | Порт 80 закрыт, либо в `server_name` опечатка в IP-через-дефисы |
| Бонусы кончились, IP списывает деньги | ~147 ₽/мес; дешевле только перенос сервера домой (Termux + Tailscale — спросите инструкцию) |
