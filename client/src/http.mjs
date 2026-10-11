// HTTP-слой клиента: заголовки как в приложении + подпись Qrator.

import { createHash } from 'node:crypto';
import { ANDROID_RELEASE, API_BASE, APP_VERSION, DEVICE, QRATOR_SECRET } from './config.mjs';

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');

// yyyy-MM-dd'T'HH:mm:ssXXX с локальным смещением — формат заголовка LocalTime (RequestHeaderInterceptor).
function localTimeISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export class LentaHttp {
  constructor(session, { verbose = false } = {}) {
    this.session = session;
    this.verbose = verbose;
  }

  buildHeaders(method, url) {
    const s = this.session;
    const timestamp = String(Math.floor(Date.now() / 1000)); // секунды — как в QratorInterceptor
    const headers = {
      Accept: 'application/json',
      Client: `android_${ANDROID_RELEASE}_${APP_VERSION}`,
      'X-Platform': 'omniapp',
      'X-Retail-Brand': 'lo',
      'X-Delivery-Mode': 'delivery',
      DeviceId: s.deviceId || '',
      SessionToken: s.sessionToken || '',
      AdvertisingId: '',
      ADID: '',
      'x-mob-sgm': s.androidId || '',
      LocalTime: localTimeISO(),
      Experiments: '',
      'X-Device-ID': s.deviceId || '',
      'X-Device-Brand': DEVICE.brand,
      'X-Device-Name': DEVICE.name,
      'X-Device-OS': 'Android',
      'X-Device-OS-Version': DEVICE.osVersion,
      'X-Organisation-ID': '',
      'App-Version': APP_VERSION,
      Timestamp: timestamp,
      // QratorInterceptor: md5(секрет + URL без query + unix-время)
      'Qrator-Token': md5(QRATOR_SECRET + url.split('?')[0] + timestamp),
    };
    if (s.passportToken) headers.PassportAccessToken = s.passportToken;
    if (method !== 'GET' && method !== 'HEAD') headers['Content-Type'] = 'application/json';
    return headers;
  }

  async request(method, path, { body } = {}) {
    const url = `${API_BASE}/${String(path).replace(/^\/+/, '')}`;
    const res = await fetch(url, {
      method,
      headers: this.buildHeaders(method, url),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (this.verbose) console.error(`[lenta] ${method} ${url} -> ${res.status}`);
    if (!res.ok) {
      const preview = typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300);
      const err = new Error(`HTTP ${res.status} ${method} ${url}: ${preview}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body = {}) {
    return this.request('POST', path, { body });
  }
}
