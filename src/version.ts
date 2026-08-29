/**
 * Единственный источник правды о версии YawaChatHub.
 * Держите это число в синхроне с файлом VERSION в корне репозитория —
 * При локальной сборке используется 3.0.0. GitHub Actions передаёт
 * VITE_APP_VERSION и автоматически увеличивает patch-версию релиза.
 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION?.trim() || "3.2.0";
export const APP_TAG = `v${APP_VERSION}`;
export const APP_NAME = "YawaChatHub";
export const APP_CHANNEL = "portable x64";
