// Высокоуровневые вызовы: авторизация, профиль, игра.
// Контракты восстановлены из APK (см. docs/Разбор-LENTA-APK-6.42.0.md, §8 и §9).

import { GAME_CODE } from './config.mjs';
import { LentaHttp } from './http.mjs';
import { ensureIdentity, loadSession, saveSession } from './session.mjs';

export function createContext({ verbose = false } = {}) {
  const session = ensureIdentity(loadSession());
  return { session, http: new LentaHttp(session, { verbose }) };
}

export function persist(ctx) {
  saveSession(ctx.session);
}

export const auth = {
  // GET auth/session/guest/token → {sessionId} → SessionToken
  async guest(ctx) {
    const data = await ctx.http.get('auth/session/guest/token');
    if (data?.sessionId) {
      ctx.session.sessionToken = data.sessionId;
      persist(ctx);
    }
    return data;
  },

  // POST auth/code/send {phone}
  sendCode(ctx, phone) {
    return ctx.http.post('auth/code/send', { phone });
  },

  // POST auth/code/verify {phone, code}
  // passportToken = jwt.access, SessionToken = token (как в RequestTokenMiddleware)
  async verifyCode(ctx, phone, code) {
    const data = await ctx.http.post('auth/code/verify', { phone, code });
    if (data?.jwt?.access) ctx.session.passportToken = data.jwt.access;
    if (data?.token) ctx.session.sessionToken = data.token;
    ctx.session.phone = phone;
    ctx.session.passportId = data?.passportId ?? null;
    ctx.session.isNewUser = data?.isNewUser ?? null;
    persist(ctx);
    return data;
  },

  // GET auth/passport/token → {accessToken, expiresIn, refreshToken}
  async passport(ctx) {
    const data = await ctx.http.get('auth/passport/token');
    if (data?.accessToken) {
      ctx.session.passportToken = data.accessToken;
      persist(ctx);
    }
    return data;
  },

  // Локальный выход (на сервере приложение использует DELETE users/sessions)
  logout(ctx) {
    ctx.session.passportToken = null;
    ctx.session.sessionToken = null;
    ctx.session.phone = null;
    ctx.session.passportId = null;
    ctx.session.isNewUser = null;
    persist(ctx);
  },
};

export const users = {
  profile: (ctx) => ctx.http.get('users/profile'),
  coupons: (ctx) => ctx.http.get('users/coupons'),
  loyalty: (ctx) => ctx.http.get('users/loyalty/profile'),
};

export const game = {
  // POST game/start {"gameCode":"lenta_hb", "refCode": <опционально>} → {"urlGameStart": "..."}
  start(ctx, refCode) {
    const body = { gameCode: GAME_CODE };
    if (refCode) body.refCode = refCode;
    return ctx.http.post('game/start', body);
  },
};

// Приведение телефона к формату приложения: "79" + 9 цифр = 79XXXXXXXXX.
// Вход: "+7 999 123-45-67", "9991234567", "89991234567", "79991234567".
export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/\D+/g, '');
  if (/^79\d{9}$/.test(digits)) return digits; // уже 79XXXXXXXXX
  if (/^89\d{9}$/.test(digits)) return '7' + digits.slice(1); // 89XXXXXXXXX → 79XXXXXXXXX
  if (/^9\d{9}$/.test(digits)) return '7' + digits; // 9XXXXXXXXX → 79XXXXXXXXX
  return null;
}
