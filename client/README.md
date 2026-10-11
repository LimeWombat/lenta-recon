# lenta — кастомный CLI-клиент «ЛЕНТЫ»

Вход по SMS в **свой** аккаунт и запуск игры «Лентомания» (`game/start`) из терминала.
Сделан по разбору официального APK — см. `docs/Разбор-LENTA-APK-6.42.0.md`.

## Быстрый старт

Node.js 20+ (проверено на Node 24), без внешних зависимостей:

```sh
cd client

# 1. Гостевая сессия (можно без аккаунта)
node lenta.mjs guest

# 2. Вход по SMS — на твой номер придёт код
node lenta.mjs login
#    или сразу с номером:
node lenta.mjs login +7-999-123-45-67

# 3. Проверка входа
node lenta.mjs me

# 4. Запуск игры: получаем URL и (по желанию) открываем в браузере
node lenta.mjs game --open
```

## Команды

| Команда | Что делает |
|---|---|
| `lenta status` | показывает, что лежит в локальной сессии (токены замаскированы) |
| `lenta guest` | `GET /v1/auth/session/guest/token` |
| `lenta login [телефон]` | `auth/code/send` → `auth/code/verify`, сохраняет токены |
| `lenta me` | `GET /v1/users/profile` |
| `lenta coupons` | `GET /v1/users/coupons` (там же офферы игры) |
| `lenta game [refCode] [--open]` | `POST /v1/game/start` → `urlGameStart` |
| `lenta raw GET users/segments/story` | произвольный запрос к `/v1` |
| `lenta logout` | забыть токены локально |
| `--verbose` | печатать каждый HTTP-запрос |

## Что под капотом

- Заголовки и подпись — точно как в приложении: `SessionToken`, `PassportAccessToken`, `DeviceId`
  (`A-<uuid>`), `Client: android_<версия>_6.42.0`, `X-Platform: omniapp`, `X-Retail-Brand: lo`,
  `LocalTime`, `Timestamp` и подпись Qrator (md5 по секрету, URL и времени).
- Токены после логина берём из ответа verify: паспортный (access) — в заголовок `PassportAccessToken`,
  серверный session-токен — в заголовок `SessionToken` (как в `RequestTokenMiddleware` приложения).
- Сессия хранится в `client/.state/session.json` (права 0600). Удалить — `lenta logout` или файл.

## Переменные окружения

| Переменная | Значение по умолчанию | Зачем |
|---|---|---|
| `LENTA_ANDROID_RELEASE` | `14` | версия Android в заголовке `Client` |
| `LENTA_API_BASE` | `https://api.lenta.com/v1` | можно направить на тестовый шлюз |
| `LENTA_STATE_DIR` | `client/.state` | где хранить сессию |
| `LENTA_VERBOSE` | — | то же, что `--verbose` |

## Возможные проблемы

- **`HTTP 403` после входа** — токены устарели: повтори `lenta login`, либо приложение сбросило сессию
  (в APK на 403 висит глобальный разлогин — `Response403Interceptor`).
- **`HTTP 4xx/5xx` с текстом про WAF/челлендж** — сработал Qrator; просто повтори запрос через минуту.
- **Код из SMS не приходит** — приложение почти наверняка умеет чаще (лимиты у «Ленты»), подожди таймаут
  (`timeout` в ответе `auth/code/send`).

## Только личное использование

Клиент разговаривает с продовым API «Ленты» от имени **твоего** аккаунта. Кастомные клиенты могут
нарушать пользовательское соглашение, и аккаунт может быть заблокирован — используй осознанно.
Никакого автоматического «фарма» купонов, массовых аккаунтов и прочей нагрузки — не для этого.

## Игра в браузере

`lenta game --open` получает у API «Ленты» свежую ссылку на игру и открывает её в обычном браузере.
Игра — Unity WebGL «Lenta 6» (хост `lentomania.lenta.com`), у неё отдельный игровой бэкенд;
разбор — в `docs/Разбор-LENTA-APK-6.42.0.md` (§9.6).
