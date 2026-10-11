#!/usr/bin/env node
// Кастомный CLI-клиент «ЛЕНТЫ» (личный аккаунт).
// Команды: status | guest | login | me | coupons | game | raw | logout
// Подробности — client/README.md и docs/Разбор-LENTA-APK-6.42.0.md.

import { execFile } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { auth, createContext, game, normalizePhone, persist, users } from './src/api.mjs';
import { SESSION_FILE } from './src/session.mjs';

const [, , command = 'help', ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));
const verbose = flags.has('--verbose') || process.env.LENTA_VERBOSE === '1';

const ctx = createContext({ verbose });

const print = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const mask = (s) => (s ? `${String(s).slice(0, 6)}…${String(s).slice(-4)}` : null);

async function ask(question) {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const commands = {
  help() {
    console.log(`lenta — CLI-клиент «ЛЕНТЫ» (по мотивам APK 6.42.0)

Использование:
  lenta status                 показать локальную сессию (путь к файлу, токены — маской)
  lenta guest                  получить/обновить гостевую сессию (без аккаунта)
  lenta login [телефон]        вход по SMS (интерактивно; пример: +7 999 123-45-67)
  lenta me                     профиль пользователя (нужен вход)
  lenta coupons                купоны/офферы, включая игровые (нужен вход)
  lenta game [refCode] [--open]
                               POST game/start → вывести URL игры; --open откроет в браузере
  lenta raw GET <path> [json]  произвольный запрос к https://api.lenta.com/v1
  lenta logout                 локально забыть токены

Флаги:
  --verbose                    печатать каждый HTTP-запрос

Ограничения: только личный аккаунт; кастомный клиент может нарушать ToS «Ленты».`);
  },

  status() {
    print({
      sessionFile: SESSION_FILE,
      phone: ctx.session.phone ?? null,
      deviceId: ctx.session.deviceId ?? null,
      sessionToken: mask(ctx.session.sessionToken),
      passportToken: mask(ctx.session.passportToken),
      authorized: Boolean(ctx.session.passportToken),
    });
  },

  async guest() {
    const data = await auth.guest(ctx);
    print({ guest: 'ok', sessionId: mask(data?.sessionId) });
  },

  async login() {
    let phone = args[0] ? normalizePhone(args[0]) : null;
    if (!phone) {
      phone = normalizePhone(await ask('Телефон (например +7 999 123-45-67): '));
    }
    if (!phone) throw new Error('Не удалось разобрать номер. Пример: +7 999 123-45-67');

    if (!ctx.session.sessionToken) await auth.guest(ctx);
    const sent = await auth.sendCode(ctx, phone);
    print({ codeSent: sent });

    const code = await ask('Код из SMS: ');
    if (!code) throw new Error('Пустой код');
    const verified = await auth.verifyCode(ctx, phone, code);
    print({
      login: 'ok',
      isNewUser: verified?.isNewUser ?? null,
      passportId: verified?.passportId ?? null,
    });
  },

  async me() {
    print(await users.profile(ctx));
  },

  async coupons() {
    print(await users.coupons(ctx));
  },

  async game() {
    const refCode = args[0] ?? null;
    const data = await game.start(ctx, refCode);
    print(data);
    const url = data?.urlGameStart;
    if (url) {
      console.log(`\nURL игры: ${url}`);
      if (flags.has('--open')) {
        execFile('open', [url], (err) => {
          if (err) console.error('Не удалось открыть браузер:', err.message);
          else console.log('Открыл в браузере.');
        });
      } else {
        console.log('Подсказка: добавь --open, чтобы сразу открыть в браузере.');
      }
    }
  },

  async raw() {
    const method = (args[0] ?? 'GET').toUpperCase();
    const path = args[1];
    if (!path) throw new Error('Использование: lenta raw <GET|POST|...> <path> [jsonBody]');
    const body = args[2] ? JSON.parse(args[2]) : undefined;
    print(await ctx.http.request(method, path, { body }));
  },

  logout() {
    auth.logout(ctx);
    persist(ctx);
    print({ logout: 'ok' });
  },
};

try {
  const handler = commands[command];
  if (!handler) {
    console.error(`Неизвестная команда: ${command}\n`);
    commands.help();
    process.exitCode = 1;
  } else {
    await handler();
  }
} catch (error) {
  console.error(`Ошибка: ${error.message}`);
  if (error.data && typeof error.data !== 'string') console.error(JSON.stringify(error.data, null, 2));
  process.exitCode = 1;
}
