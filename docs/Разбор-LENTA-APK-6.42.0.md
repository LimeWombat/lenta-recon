# «ЛЕНТА» — разбор APK по костям (v6.42.0, Android)

> Документ подготовлен по статическому анализу официального APK-бандла APKMirror.
> Работа выполнялась инструментом **REA** (репозиторий `github.com/morluto/rea`) и декомпилятором **JADX**.
> Всё, что здесь написано, — либо прямая цитата из декомпилированного кода, либо наблюдение с указанием источника.
> Что не проверено вживую — помечено явно.

---

## 0. Паспорт артефакта и инструменты

| Параметр | Значение |
|---|---|
| Файл | `com.icemobile.lenta.prod_6.42.0-2610_1arch_1dpi_2lang_...apkm` (52 МБ) |
| SHA-256 бандла | `abef020823f4e4a5028e4320a2831ad4e896f7861578e07a56b44a156fb3c6e1` |
| Пакет | `com.icemobile.lenta.prod` |
| Версия | 6.42.0 (versionCode 2610) |
| minSdk / targetSdk | 26 (Android 8.0) / 35 |
| `base.apk` SHA-256 | `c99d0852c133bee7fe90b269d377df6df81d4275e80552049f7890ed0d39da48` |
| Классов в APK (REA) | 38 295 |
| Ресурсов | 1 955 |
| REA evidence (манифест/пакет) | `ev_7cfb2dacb29d75aaf4d4979a9dedabefd202f4d51cd55d24448dd76ef9d6bd68` |

**Инструменты, которыми это разобрано:**

- **REA 6.4.0** — MCP/CLI-обвязка для реверса; для Android ей нужен отдельный движок `jadx-headless-mcp 0.7.1`
  (`REA_JADX_MCP_JAR`), который скачивается по инструкции самого REA (`docs/android-analysis.md`; SHA-256 сверен:
  `6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`).
- **JADX 1.5.6** (JDK 22) — полная декомпиляция в `work/jadx_out` (≈38 тыс. `.java`, 298 классов с ошибками
  декомпиляции — это норма для обфусцированных мест).
- Node.js 24 — для будущего клиента.

Команды, которыми получены ключевые факты (воспроизводимо):

```sh
rea inspect-android-package  work/apkm/base.apk
rea search-android-classes   work/apkm/base.apk "Game"
rea inspect-android-class    work/apkm/base.apk org.openapitools.client.apis.AuthApi
rea inspect-android-method   work/apkm/base.apk org.openapitools.client.apis.AuthApi sendAuthCode
```

---

## 1. TL;DR — самое главное

1. **Игра в приложении есть, и она одна** — игровой модуль «Лентомания» (`com.lenta.platform.game`, API-класс
   `LentoManiaGameApi`). Игровой сервер отдаётся приложению как **веб-страница**:
   `POST /v1/game/start` → `{"urlGameStart": "..."}` → приложение открывает этот URL во внутреннем WebView.
   Это **Unity WebGL «Lenta 6»** (студия Pustogames) на `lentomania.lenta.com`; у игры собственный бэкенд
   `lnt-backend.ru` — всё вскрыто и описано в §9.6.
2. **Авторизация — SMS по номеру телефона** через открытый API-шлюз `https://api.lenta.com/v1`
   (`auth/session/guest/token` → `auth/code/send` → `auth/code/verify`).
3. **Все запросы подписываются тривиально**: помимо заголовков-токенов нужен «антибот» Qrator — это
   `md5(секрет + URL пути + unix-время)`. Секрет лежит в коде приложения открытым текстом.
4. **Certificate pinning не используется** — трафик приложения можно перехватывать обычным mitmproxy
   (но при аккуратной настройке, см. §11).
5. Всё API — 33 группы / **153 REST-эндпоинта** / 611 моделей (список: `docs/api-endpoints.txt`).
6. Повторить вход и запуск игры своим клиентом — реально: понадобится ~10 HTTP-запросов и ничего больше.
   Секретных ключей, которые мы бы не нашли, в цепочке «логин → игра» нет.

---

## 2. Состав APK-бандла

Файл `.apkm` — это zip-контейнер APKMirror со сплитами:

| Файл | Размер | Что внутри |
|---|---|---|
| `base.apk` | 71,7 МБ | 5 dex (≈56 МБ кода), ресурсы, ассеты |
| `split_config.arm64_v8a.apk` | 44,3 МБ | 16 нативных библиотек `lib/arm64-v8a/*.so` |
| `split_config.xxxhdpi.apk` | 3,2 МБ | ресурсы под xxxhdpi |
| `split_config.ru.apk` | 66 КБ | русские строки |
| `split_config.en.apk` | 160 КБ | английские строки |

Нативные библиотеки (важно: **ни Unity, ни Flutter, ни React Native** — игра нативная Kotlin/Java):

```
libTransform.so            libandroidx.graphics.path.so   libbarhopper_v3.so
libbms_fp.so               libcardioDecider.so             libcardioRecognizer.so
libcardioRecognizer_tegra2.so  libimage_processing_util_jni.so  libmaps-mobile.so
libopencv_core.so          libopencv_imgproc.so            libscannative.so
libsentry-android.so       libsentry.so                    libsigner.so
libucs-credential.so
```

Это сканеры (карты/штрихкоды — card.io, ML Kit, OpenCV), карты 2GIS (`libmaps-mobile`), Sentry и
банковские SDK-компоненты (`libsigner`, `libucs-credential`).

Ассеты `base.apk` — модели ML Kit для сканирования и сертификаты Huawei/GMS. Никаких игровых ресурсов
внутри APK нет: игра приходит по сети (§9).

---

## 3. Манифест и компоненты (выжимка)

Разрешения (полный список от REA): интернет, геолокация (FINE/COARSE), камера (`CAMERA`, `CAMERA2`),
микрофон, `POST_NOTIFICATIONS`, `AD_ID`, Wi-Fi, `FOREGROUND_SERVICE`, вибрация, `USE_BIOMETRIC`/`USE_FINGERPRINT`,
`RECEIVE_BOOT_COMPLETED`, FCM (`com.google.android.c2dm...`), `com.huawei.permission.ACCESS_HW_KEYSTORE`,
а также `ru.sberbank.mobile.sberid.BIND_PERSONALIZATION_SERVICE` (SberID).

Ключевые activity:

| Компонент | Назначение |
|---|---|
| `ru.app.main.MainActivity` | главная (singleTask, сплэш `Theme.SplashWithAnimation`) |
| `com.inappstory.sdk.stories.ui.reader.StoriesActivity` | «сторис»-раздел InAppStory |
| `com.inappstory.sdk.game.reader.GameActivity` | **мини-игры InAppStory** (второй игровой контур) |
| `spay.sdk.RedirectActivity`, `spay.sdk.utils.permissions.PermissionsActivity` | платежи SberPay |
| `ru.cloudtips.sdk.ui.activities.tips.PaymentTipsActivity` | «чаевые» CloudTips |
| `sberid.sdk.auth.view.activity.WebViewActivity` | вход через SberID |
| `com.journeyapps.barcodescanner.CaptureActivity`, `io.card.payment.CardIOActivity` | сканеры |

Сервисы: FCM/HMS-пуши (`ru.app.notification.NotificationMessagingService`), AppMetrica/Yandex Metrica,
`socium`-плеер; провайдеры: `FileProvider` (`com.icemobile.lenta.prod.provider`), InAppStory FileProvider,
ML Kit, AGConnect (Huawei).

---

## 4. Технологический стек

| Слой | Технологии |
|---|---|
| Язык/UI | Kotlin, Jetpack Compose, MVI (Store/Middleware/Reducer) |
| DI | Dagger 2 (`ru/app/di/DaggerAppComponent`, компоненты Auth/Catalog/Profile/…) |
| Сеть | Retrofit 2 + OkHttp 3 + kotlinx.serialization; клиент сгенерирован **openapi-generator** (`org.openapitools.client`) |
| Хранилище | Room/SQLCipher-подобное (`com.a65apps.database`), SharedPreferences (`utkonos_prefs`) |
| Аналитика | AppMetrica, Yandex Metrica, Firebase Analytics/Crashlytics, Sentry, Adjust, Snowplow (health-метрики) |
| Фиче-флаги | **GrowthBook** через прокси `growthbook-proxy.lenta.tech`; заголовок `Experiments` |
| Скан/карты/права | ML Kit, OpenCV, card.io, 2GIS (`libmaps-mobile`), Huawei HMS Scan |
| Контент | **InAppStory** (`api.inappstory.ru`) — сторис и игры; `digitaltarget.ru`; CloudTips; SberPay |
| Антибот | **Qrator** (WAF-заголовки) — §6.3 |
| Обфускация | R8/ProGuard; часть Kotlin-классов сохранила имена (`com.lenta.platform.*`), генераторный код — нет |

Забавная деталь: файл настроек приложения до сих пор называется `utkonos_prefs` — наследие «Утконоса».

---

## 5. Карта модулей

```
com.lenta.platform.…            — основной «платформенный» код Ленты
  ├─ netclient/                 — Retrofit-фабрики, интерцепторы, токены (§6)
  ├─ auth/                      — вход: phone → sms → домены/MVI + repository (AuthApi)
  ├─ game/                      — «Лентомания»: GameRepository, GameModule, analytics (§9)
  ├─ main/                      — главный экран, MVI, webview, game-эффекты
  ├─ inappstories/              — интеграция InAppStory (сторис/игры)
  ├─ coupons/ loyalty/ clubs/   — лояльность, купоны, клубы («Лента Бар», Happy)
  ├─ catalog/ cart/ order/ …    — каталог, корзина, заказы
  └─ …
ru.app.…                        — «приложение»: MainActivity, DI-модули, настройки серверов
  ├─ network/                   — NetworkModule (заголовки, сервера), SessionTokenDataSourceImpl
  ├─ monitoring/                — Qrator, 403, breadcrumbs, marketing-key, APM
  └─ config/preference/         — PreferencesImpl (deviceId, appInfo, deliveryType…)
com.a65apps.…                   — код подрядчика A65 (clubs, cardnumberone, database, core)
com.inappstory.sdk.…            — SDK сторис/игр (GameActivity, GameJSInterface)
org.openapitools.client.…       — сгенерированный API-клиент: 33 группы, 611 моделей
```

---

## 6. Сетевой слой

### 6.1. Адреса

| Назначение | URL |
|---|---|
| **API-шлюз (прод, всё основное)** | `https://api.lenta.com/v1` (`ApiGatewayServers`) |
| Сайт/веб-контур | `https://lentochka.lenta.com` (dev/test: `lenta-site-*.dev.lenta.tech`, старый `http://lenta-site.ltech/`) |
| Тест-шлюзы (внутренние сборки) | `https://api-gateway-server-svc-test…/v1` и т.п. |
| Флаги | `https://growthbook-proxy.lenta.tech` |
| Пуши | `https://gw.lenta.tech/communication/notification` |
| APM-трейсы | `https://otel-collector.lenta.tech/v1/traces` |
| Видео/потоки | `https://android-stream.lenta.tech` |
| Stories/игры | `https://api.inappstory.ru/`, `https://api.test.inappstory.com/` |

### 6.2. Заголовки каждого запроса к `/v1`

Собираются тремя интерцепторами (`RequestHeaderInterceptor`, `ApiGatewayAuthInterceptor`,
`ApiGatewayHeaderInterceptor`) + `QratorInterceptor`:

| Заголовок | Значение / источник в приложении |
|---|---|
| `SessionToken` | токен сессии: сначала гостевой (`auth/session/guest/token`), после входа — `token` из `auth/code/verify`. В приложении всегда отправляется, пустой — как `""` |
| `PassportAccessToken` | `jwt.access` из `auth/code/verify` (или `accessToken` из `auth/passport/token`); до входа отсутствует |
| `DeviceId` | `"A-" + UUID`, генерируется один раз и хранится (`PreferencesImpl.getDeviceId`) |
| `Client` | `"android_" + Build.VERSION.RELEASE + "_6.42.0"` (пример: `android_14_6.42.0`) |
| `X-Platform` | `omniapp` |
| `X-Retail-Brand` / `x-retail-brand` | `lo` |
| `LocalTime` | `yyyy-MM-dd'T'HH:mm:ssXXX` (с таймзоной, Locale UK) |
| `AdvertisingId`, `ADID` | рекламные идентификаторы (могут быть пустыми) |
| `x-mob-sgm` | Android ID (16 hex) |
| `Experiments` | CSV-список id экспериментов GrowthBook (`getExperimentsListForBackend()`) |
| `X-Delivery-Mode` | `delivery` \| `pickup` \| `shop` (по умолчанию `delivery`) |
| `X-Device-ID` | = `DeviceId` |
| `X-Device-Brand` / `X-Device-Name` / `X-Device-OS` / `X-Device-OS-Version` | `Build.BRAND` / `Build.MANUFACTURER` / `"Android"` / `Build.VERSION.SDK_INT` |
| `X-Organisation-ID` | `""` |
| `App-Version` | `6.42.0` (только Qrator-цепочка) |
| `Timestamp` | unix-время в **секундах** |
| `Qrator-Token` | см. §6.3 |
| `traceparent` | APM-трейс (`00-<32hex>-<16hex>-01`), добавляется `MonitoringInterceptor` — нашему клиенту не обязателен |
| `Content-Type` | `application/json` |

### 6.3. «Антибот» Qrator

`ru/app/monitoring/QratorInterceptor.java`:

```java
timestamp = String.valueOf(System.currentTimeMillis() / 1000);          // секунды
qrSignature = md5( "80cc45a4e18aa6ed9f8eec9523f6b4ee" + <URL без query> + timestamp );  // hex, нижний регистр
```

Заголовки: `App-Version` (`6.42.0`), `Timestamp` (unix-секунды) и `Qrator-Token` (подпись из строки выше).

`<URL без query>` — полный адрес, например `https://api.lenta.com/v1/game/start`.
Секрет `80cc45a4e18aa6ed9f8eec9523f6b4ee` — публичная константа в коде.
Если WAF отдаёт челлендж (`__qrator/qauth.js`), приложение пишет это в лог «WAF error» — клиенту стоит
просто повторить запрос/подождать (в обычной эксплуатации челлендж почти не срабатывает).

### 6.4. Цепочка интерцепторов (порядок применения)

```
Response403Interceptor → RpcMethodToPathInterceptor → MonitoringInterceptor → QratorInterceptor
→ BreadcrumbsInterceptor → MarketingPartnerKeyInterceptor → ApiGatewayAuthInterceptor
→ ApiGatewayHeaderInterceptor → HttpLogging → RestResponseBodyErrorInterceptor → HealthMetrics
```

- **403 при авторизованной сессии** → глобальный обработчик (`Response403Exception`) = разлогин/перезапрос токена.
- `RpcMethodToPathInterceptor`, `MarketingPartnerKeyInterceptor` — для **легаси-каналов** (`/jrpc`, `/rest`),
  в новом `/v1`-контуре не нужны (в JSON-легаси добавляли `Head.MarketingPartnerKey`).
- Мониторинг отправляет APM-трейсы на `otel-collector.lenta.tech` (Basic-авторизация зашита в коде — нам не нужна).

### 6.5. Два поколения API

| Канал | Пример | Статус |
|---|---|---|
| Новый openapi `/v1` | `POST /v1/auth/code/send` | **основной**, используем его |
| Легаси `/jrpc` | `POST /jrpc` с `method: "OtpBasedAuth"` (`AuthNetInterface`) | ещё живёт в коде (создание/привязка карты лояльности) |
| Легаси `/rest` | jrpc-обёртки | встречается в служебных местах |

---

## 7. API-карта

Сгенерированный клиент `org.openapitools.client.apis` — **33 группы**: Articles, Auth, BonusCards, Cart,
Catalog, Delivery, Feedback, Helpdesk, LentaPay, **LentoManiaGame**, Messages, Order, Pages, PartnerPromos,
Payments, Purchases, PushNotifications, Referral, Reviews, SettingsInApp, Stamps, Stores, Survey,
Users, UsersAddresses, UsersAvatar, UsersClubs, UsersCoupons, UsersEmails, UsersLoyalty, UsersPromotions,
UsersPushtokens, UsersSubscriptions.

Всего **153 эндпоинта** — полный дамп в `docs/api-endpoints.txt` (формат: `Группа МЕТОД("путь")`).
Полезные для клиента:

| Задача | Эндпоинт |
|---|---|
| Гостевая сессия | `GET auth/session/guest/token` |
| Отправить SMS-код | `POST auth/code/send` |
| Проверить код / войти | `POST auth/code/verify` |
| Паспортный токен сессии | `GET auth/passport/token` |
| Профиль | `GET users/profile` |
| Купоны (в т.ч. игровые) | `GET users/coupons` |
| Лояльность | `GET users/loyalty/profile`, `GET users/loyalty/program/status` |
| **Запуск игры** | `POST game/start` |
| Скреп-карты (акции) | `POST users/coupons/scratchcards/code/send` и `.../verify` |

---

## 8. Авторизация — пошагово

### 8.1. Формат телефона

UI-маска — `+7 (9` + 9 цифр, т.е. вводится 9 цифр, а на бэкенд уходит строка
**`"79" + enteredPhone`** = 11 цифр вида `79XXXXXXXXX` (см. `RequestTokenMiddleware`,
`EnterSmsRequestAuthCodeMiddleware`, `PhoneNumberVisualTransformation`).

### 8.2. Гостевой токен

```http
GET https://api.lenta.com/v1/auth/session/guest/token
→ 200 {"sessionId": "<guest session token>"}
```

`sessionId` кладётся в `SessionToken` и используется во всех запросах до входа.
(Приложение умеет ретраить получение гостевого токена — `GetGuestSessionMiddleware`.)

### 8.3. Отправка кода

```http
POST https://api.lenta.com/v1/auth/code/send
{"phone": "79123456789"}                      // опц.: kfpKsid, kfpVn, acceptMarketingCommunications
→ {"sent": true, "timeout": 60, "provider": "...", "isUserNew": false}
```

### 8.4. Проверка кода и получение токенов

```http
POST https://api.lenta.com/v1/auth/code/verify
{"phone": "79123456789", "code": "1234"}      // опц.: kfpKsid, kfpVn, telegramUserId, origin
→ {
    "isB2B": false,
    "isNewUser": false,
    "passportId": "…",
    "jwt": { "access": "…", "refresh": "…" }
  }
```

Из ответа берём новое значение session-токена (поле `token`) и паспортный `jwt.access` — дальше,
как в `RequestTokenMiddleware`:

```kotlin
tokenDataSource.onReceivePassportAccessToken(authTokenResponse.passportToken /* = jwt.access */)
tokenDataSource.updateToken(authTokenResponse.token)   // новый SessionToken
```

### 8.5. Паспортный токен отдельным вызовом (при необходимости)

```http
GET https://api.lenta.com/v1/auth/passport/token
→ объект с полями `accessToken`, `expiresIn`, `refreshToken` (значения опускаем)
```

Также в моделях есть `RefreshPassportTokenRequest`, `auth/session/web/token`-ответы
(`GetAuthSessionWebTokenResponse`, `SyncAuthWebSession*`) — это контур веб/десктоп-сессий Ленты
(в мобильном флоу не используется).

### 8.6. Выход и инвалидация

`SessionTokenDataSourceImpl.invalidateSessionToken()` — чистит `PassportToken`, `SessionToken`, кэши
пользователя и персональных промо, сбрасывает флаг авторизации. На сервере — `DELETE users/sessions`
(«выйти на всех устройствах») и `DELETE users/sessions/{guid}`.

Ошибки: `WrongSmsCodeException` в auth-модуле; серверные ошибки приходят как `{code, errorCode, message}`
(например, `errorCode: "gameBlocked"` для игры).

---

## 9. Игра «Лентомания» — полный флоу

### 9.1. Где вход

Игра привязана к купонам/лояльности: в списке купонов есть офферы-игры (`LentaGameOffer`,
`CouponGameWinOfferTypeDataPromo`), статус лояльности содержит флаги `isBonusGameChoice`,
`isUserInBonusGame`. В БД хранятся офферы игры (`SavedLentaGameOffer`), а на главном экране за их
подгрузку отвечает `ObserveLentaGameOffersMiddleware`. Повторный запуск возможен из диалога ошибки
(`GameErrorDialogFragment` → `GameEffect.Init(code)`).

### 9.2. Запрос на старт игры

`GameRepository.startGame(code)` (`com/lenta/platform/game`) и `LentoManiaGameApi`:

```http
POST https://api.lenta.com/v1/game/start
{"gameCode": "lenta_hb", "refCode": "<код из купона/оффера>"}

→ 200 {"urlGameStart": "<URL игры>"}
```

`gameCode` — жёстко зашитая константа `"lenta_hb"`; `refCode` — контекстный код (может отсутствовать/null).

### 9.3. Что происходит с URL

`GameInitMiddleware` → `GameEffect.Start(url)` → `GameStartMiddleware`:

```java
gameAnalytics.analytics.logEvent("lentagame_ris_webview_opened", …);
router.navigate(new MainCommand.OpenWebView(new WebViewArguments(start.url)));
```

Т.е. игра открывается **обычным внутренним WebView** приложения (`com.lenta.platform.main.webview.WebViewFragment`;
никаких специальных JS-мостов Лента к ней не подключает в этом месте). Аналитика успеха —
`lentagame_ris_webview_success`. Значит, **игровая логика целиком на стороне веб-страницы**.

Живой запрос (11.10.2026) показал URL игры:

```
https://lentomania.lenta.com/   + query-параметры: token_lenta (одноразовый), customer_id, crm_id, partner
```

Это чистая статика на nginx — Unity WebGL-сборка, авторизующаяся одноразовым токеном из query-параметров
(полный разбор — §9.6).

### 9.4. Ошибки

Серверная ошибка с `errorCode == "gameBlocked"` (HTTP 400) → спец. диалог «игра недоступна»;
остальные — снекбар с текстом. Логика — `GameInitMiddleware$invoke$$inlined$flatMapLatest$1`.

### 9.5. Второй игровой контур — InAppStory

Помимо «Лентомании», в приложении живёт полноценный SDK InAppStory с **собственными мини-играми**:

- `com.inappstory.sdk.game.reader.GameActivity` / `GameReaderContentFragment` — WebView-игра SDK;
- JS-мост: `window.Android.gameComplete(...)` и др. (`GameJSInterface`, `GameManager`);
- внешнее API SDK: `IASGames`, `openGameInstance` и события `GameCompleteEventObserver`;
- хост — `api.inappstory.ru`.

Эти игры показываются внутри «сторис»-раздела; к запуску игры через `game/start` они отношения не имеют,
но если захочется играть и в них — точка входа тоже WebView (`https://api.inappstory.ru/`), и её тоже
можно воспроизвести клиентом (сессия InAppStory выдаётся по своему `api key`; разбор — отдельная задача).

### 9.6. Что это за игра: Unity WebGL «Lenta 6» (по живому тесту)

Игра — **HTML5-страница с Unity WebGL-сборкой** (productName `Lenta 6`, productVersion v0.20,
студия **Pustogames**, движок Unity 2022.3.62f2, IL2CPP):

- **Оболочка** (nginx, `https://lentomania.lenta.com`): `index.html` + `style.css` +
  `js/{loader,server,build,copy,deviceType,focusView,resize,metrica,analytics}.js`.
  Загрузчик читает `js/server.json` (флаг debug) и поднимает Unity-канвас, крутя призовые тексты
  («Главный приз от Ленты — 100 000 баллов», призы от Простоквашино® и Snickers®).
- **Сборка** в `Build/` (все `.unityweb` — brotli): `*.loader.js` (114 КБ),
  `*.framework.js.unityweb` (74 КБ → 429 КБ), `*.wasm.unityweb` (8,1 МБ → 36,7 МБ),
  `*.data.unityweb` (16,3 МБ → 27,3 МБ).
- `data.unityweb` — архив `UnityWebData1.0`; внутри — `Il2CppData/Metadata/global-metadata.dat` (10,1 МБ),
  `data.unity3d` (UnityFS-бандл) и служебные файлы.
- В `data.unity3d` найден объект **`WebGLNetworkConfig`** — карта API игры: прод `https://lnt-backend.ru`
  + base path `api/v1`, тест `lenta-back-test.pg7digital.ru`, dev `lenta-six-dev-backend.pg7digital.ru`;
  два секрета хранятся как ACTk `ObscuredString`. Полная таблица — `docs/game-lentomania-api-map.txt`:
  `auth/token/`, `player/save/`, `tasks/`, `tasks/complete/`, `prizes/`, `lotteries/`, `minigame/levels/`,
  `minigame/start-game/`, `minigame/win-game/`, `minigame/loss-game/`, `player/boosts/`, `player/use-boost/`,
  `player/streak-progress/`, `player/get-time-claim/`, `player/claim-reward/`, `server-time/`, `faq/`.
- **Стартовая последовательность игры** (по отладочным строкам сборки): берёт `token_lenta` из query →
  `DataManager: requesting backend token` (`auth/token/`) → `player/save/` (прогресс, уровни, баланс).
- **Карта экранов** (`js/analytics-map.json`): MainScreen, TaskScreen (задания), PrizeScreen (призы/промокоды),
  LotteryScreen (главная/недельная/партнёрская лотереи), GameScreen (уровни, пауза, win/lose), FAQ, настройки,
  экран ошибки соединения.
- В сборке есть **MockBackend** (`mock_backend`) — игра без реального сервера, и отладочные панели
  (`js/network.js` — окно логов сети, `js/logs.js`); мост с хостом: `Data.SetDeviceType(...)` в Unity
  и `Print.postMessage('game')` при выходе — это для WebView-обёртки приложения.
- Античит: **Anti-Cheat Toolkit** (codestage.net; `ObscuredString`/`ObscuredFloat`/`ObscuredByte`).
- Зеркало фронтенда скачано в `work/game/site` (оболочка + `Build/` + распакованные файлы в `unpacked/`).

### 9.7. Итог живого теста (11.10.2026)

- Вход выполнен: гостевая сессия → SMS → `auth/code/verify` → профиль читается (`GET /v1/users/profile`).
- `POST /v1/game/start` → 200, получен рабочий URL игры (можно открывать в обычном браузере).
- Фронтенд игры скачан и разобран без исполнения (Unity-клиент инструментами не запускался — см. §11).

---

## 10. «Рецепт» для кастомного клиента

Минимальная последовательность для входа и запуска игры (то, что реализовано в `client/`):

```
1) GET  /v1/auth/session/guest/token           → sessionId → SessionToken
2) POST /v1/auth/code/send  {phone: "79XXXXXXXXX"}
3) POST /v1/auth/code/verify {phone, code}     → jwt.access → PassportAccessToken
                                                 token      → SessionToken
4) (опц.) GET /v1/auth/passport/token          → accessToken (обновление)
5) GET  /v1/users/profile                      → проверка, что вошли
6) POST /v1/game/start {"gameCode":"lenta_hb"} → urlGameStart → открыть в браузере
```

К каждому запросу добавлять заголовки из §6.2 + подпись Qrator из §6.3.
Ничего больше не требуется: ни подписи тела, ни сертификатных ключей, ни Google Play Integrity
для этого флоу (Play Integrity присутствует в APK только как библиотека — использует его, судя по коду,
оплата/антифрод, а не игра).

---

## 11. Что НЕ проверено (честный список)

- **Запуск Unity-игры в браузере** — проверяется пользователем: платформенная браузерная панель
  не открывает ссылки с токеном в query-параметрах, а сам Unity-клиент инструментами не запускался.
- API игрового бэкенда (`lnt-backend.ru`) напрямую не вызывался — разобран статически из сборки.
- Призовой контур (задания, лотереи, выигрыши) не тестировался.
- Рантайм-поведение приложения (мы его не запускали; анализ чисто статический — REA это explicitly
  фиксирует в Evidence).
- Проверки на стороне сервера, которых нет в APK (антифрод, лимиты, WAF-челленджи).
- Подпись APK не верифицировалась (REA это тоже отмечает: `signature_verification: not_performed`).
- Контур InAppStory-игр разобран обзорно (флоу с `api key` не вскрывали — отдельная задача).

## 12. Риски и рамки

- Кастомный клиент нарушает пользовательское соглашение «Ленты»; **аккаунт может быть заблокирован**.
  Использовать только со своим аккаунтом и в личных целях.
- Qrator-подпись воспроизводится формально (мы просто считаем тот же md5) — это не обход защиты,
  а повторение открытого алгоритма собственного клиента.
- Никаких массовых аккаунтов, автоматического «фарма» купонов и прочей нагрузки на инфраструктуру.

## 13. Приложения

- Полный список эндпоинтов: `docs/api-endpoints.txt` (153 записи).
- Декомпилированные исходники: `work/jadx_out/sources` (обращайтесь к ним как к основному «источнику правды»).
- REA-логи (Evidence): `work/logs/iap.txt`, `work/logs/iap2.txt`.
- Ключевые файлы-доказательства:
  - `com/lenta/platform/netclient/interceptors/ApiGatewayAuthInterceptor.java` — токены;
  - `com/lenta/platform/netclient/RequestHeaderInterceptor.java` — основные заголовки;
  - `com/lenta/platform/netclient/ApiGatewayRetrofitFactory.java` — цепочка и X-Device-*;
  - `ru/app/monitoring/QratorInterceptor.java` — подпись Qrator;
  - `ru/app/config/preference/PreferencesImpl.java` — deviceId/appInfo;
  - `com/lenta/platform/game/repository/GameRepository*.java` — старт игры;
  - `com/lenta/platform/main/game/mvi/*` — MVI-обвязка игры;
  - `org/openapitools/client/apis/AuthApi.java`, `LentoManiaGameApi.java` — контракты API;
  - `com/inappstory/sdk/game/reader/GameJSInterface.java` — JS-мост InAppStory;
  - `ru/app/network/NetworkModule_ProvideNetClientConfigFactory.java` — сборка конфига сети.
- Игра:
  - `docs/game-lentomania-api-map.txt` — карта API игрового бэкенда (из объекта `WebGLNetworkConfig`);
  - `work/game/site` — зеркало фронтенда игры (оболочка + `Build/`);
    `work/game/site/unpacked` — распакованные `.unityweb` и файлы из `data.unity3d`;
  - `work/game/unitypy2.txt` — дамп конфига (UnityPy); `work/game/site/js/analytics-map.json` — карта экранов.
