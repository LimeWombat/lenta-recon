// Константы, восстановленные из APK «ЛЕНТА» 6.42.0.
// Источники — в docs/Разбор-LENTA-APK-6.42.0.md (разделы 6 и 9).

export const APP_VERSION = '6.42.0';

// Заголовок Client в приложении = "android_" + Build.VERSION.RELEASE + "_6.42.0".
// Версию Android можно переопределить: LENTA_ANDROID_RELEASE=14
export const ANDROID_RELEASE = process.env.LENTA_ANDROID_RELEASE || '14';

// Прод-шлюз API (ApiGatewayServers: agwProductionUrl)
export const API_BASE = process.env.LENTA_API_BASE || 'https://api.lenta.com/v1';

// Секрет подписи Qrator (QratorInterceptor.java)
export const QRATOR_SECRET = '80cc45a4e18aa6ed9f8eec9523f6b4ee';

// gameCode игры (GameRepository: new StartGameRequest("lenta_hb", refCode))
export const GAME_CODE = 'lenta_hb';

// Косметические заголовки X-Device-*; приложение отправляет реальные Build.*.
export const DEVICE = {
  brand: process.env.LENTA_DEVICE_BRAND || 'samsung',
  name: process.env.LENTA_DEVICE_NAME || 'SM-S918B',
  osVersion: process.env.LENTA_DEVICE_OS_VERSION || '34',
};
