#!/usr/bin/env node
// Функциональная проверка разбора ответов в widget.html (синергия с
// PollEngine: тот же набор признаков, ФТ-2.1…ФТ-2.6).
//
// Извлекает parseResponse/firstMatch/jsonUnescape/humanNumber прямо из
// native/data/widget.html (без DOM) и прогоняет синтетические ответы.
// Реальные образцы площадок в тесте не используются: состав и признаки
// проверяются на минимальных телах ответов.
//
// Выход: 0 — успех, 1 — есть расхождения.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const widgetPath = join(repoRoot, 'native', 'data', 'widget.html');
const html = readFileSync(widgetPath, 'utf8');

// --- извлечение функций: срез до следующей конструкции верхнего уровня ---
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) fail(`в widget.html нет функции ${name}()`);
  const next = html.slice(start + 1).search(/\n(?:async )?function |\nconst |\nlet |\n\/\*/);
  const end = next < 0 ? html.length : start + 1 + next;
  const src = html.slice(start, end).trim();
  if (!src.endsWith('}')) fail(`обрыв функции ${name}() при извлечении`);
  return src;
}

let failed = 0;
let total = 0;

function fail(message) {
  console.error(`::error::check-widget-parse: ${message}`);
  process.exit(1);
}

function check(ok, what) {
  ++total;
  if (!ok) {
    ++failed;
    console.error(`FAIL: ${what}`);
  }
}

const helpers = ['firstMatch', 'jsonUnescape', 'humanNumber', 'parseResponse']
  .map(extractFunction)
  .join('\n\n');

const sandbox = {};
new Function(
  'globalThis',
  `"use strict";\n${helpers}\nglobalThis.__api = { firstMatch, jsonUnescape, humanNumber, parseResponse };`
)(sandbox);
const { parseResponse, humanNumber, jsonUnescape } = sandbox.__api;

// --- таблица случаев: verdict = live | offline | error ---
const cases = [
  // VK (ФТ-2.2)
  { key: 'vk', body: '{"status":"live","viewers":1234,"title":"Вечерний эфир"}', verdict: 'live', viewers: 1234, needle: 'Вечерний' },
  { key: 'vk', body: '{"is_live":true,"online_count":55,"title":"VK Test"}', verdict: 'live', viewers: 55, needle: 'VK Test' },
  { key: 'vk', body: '{"status":"offline"}', verdict: 'offline' },
  // Twitch (ФТ-2.1)
  { key: 'tw', body: '{"data":{"user":{"stream":{"viewersCount":42,"title":"Стрим"}}}}', verdict: 'live', viewers: 42, needle: 'Стрим' },
  { key: 'tw', body: '{"data":{"user":{"stream":null}}}', verdict: 'offline' },
  { key: 'tw', body: '{"data":{"user":null}}', verdict: 'error' },
  // YouTube (ФТ-2.3): актуальная разметка videoViewCountRenderer, резервные
  // форматы, и videoDetails.viewCount (суммарные просмотры) ≠ зрители.
  { key: 'yt', body: '{"viewCount":{"videoViewCountRenderer":{"viewCount":{"runs":[{"text":"18,719"},{"text":" watching now"}]},"isLive":true,"originalViewCount":"18719"}}}', verdict: 'live', viewers: 18719 },
  { key: 'yt', body: '{"isLive":true,"originalViewCount":"9876"}', verdict: 'live', viewers: 9876 },
  { key: 'yt', body: '{"isLive":true,"viewCount":{"simpleText":"1,234 watching now"},"videoDetails":{"title":"Legacy live"}}', verdict: 'live', viewers: 1234, needle: 'Legacy live' },
  { key: 'yt', body: '{"isLive":true,"shortViewCountText":{"simpleText":"1.2K watching"}}', verdict: 'live', viewers: 1200 },
  { key: 'yt', body: '{"videoDetails":{"title":"Обычное видео","viewCount":"2063652"}}', verdict: 'offline' },
  { key: 'yt', body: '{}', verdict: 'offline' },
  // TikTok (ФТ-2.4): активная комната, а не устаревший roomId.
  { key: 'tt', body: '{"CurrentRoom":{"roomInfo":{"roomId":"12345"},"viewerCount":432},"liveRoom":{"title":"Разбор кода","status":2}}', verdict: 'live', viewers: 432, needle: 'Разбор кода' },
  { key: 'tt', body: '{"roomId":"999"}', verdict: 'live', viewers: 0 },
  { key: 'tt', body: '{"roomId":"999","CurrentRoom":{"roomInfo":null,"roomId":""}}', verdict: 'offline' },
  // Kick (ФТ-2.5)
  { key: 'kc', body: '{"livestream":{"viewer_count":12,"session_title":"Just Chatting"}}', verdict: 'live', viewers: 12, needle: 'Just Chatting' },
  { key: 'kc', body: '{"livestream":null}', verdict: 'offline' },
  { key: 'kc', body: '{"user":{"is_live":false}}', verdict: 'offline' },
  // GoodGame (ФТ-2.6)
  { key: 'gg', body: '{"status":"live","viewers":10,"title":"Стрим по GG"}', verdict: 'live', viewers: 10, needle: 'Стрим по GG' },
  { key: 'gg', body: '{"status":true,"viewers":42,"title":"GG true"}', verdict: 'live', viewers: 42, needle: 'GG true' },
  { key: 'gg', body: '{"status":1,"viewers":7,"title":"GG один"}', verdict: 'live', viewers: 7, needle: 'GG один' },
  { key: 'gg', body: '{"status":false,"viewers":0}', verdict: 'offline' },
  { key: 'gg', body: '{"status":0}', verdict: 'offline' },
  { key: 'gg', body: '{}', verdict: 'error' },
];

for (const tc of cases) {
  const r = parseResponse(tc.key, tc.body);
  const verdict = r.error ? 'error' : r.live ? 'live' : 'offline';
  check(verdict === tc.verdict, `[${tc.key}] ${tc.body.slice(0, 60)}…: ${verdict}, ожидалось ${tc.verdict}`);
  if (tc.verdict === 'live') {
    if (tc.viewers !== undefined)
      check(r.viewers === tc.viewers, `[${tc.key}] зрители ${r.viewers}, ожидалось ${tc.viewers}`);
    if (tc.needle)
      check(String(r.title || '').includes(tc.needle), `[${tc.key}] заголовок «${r.title}» без «${tc.needle}»`);
  }
}

// --- humanNumber: «1,234 watching now», «1.2K watching», «1,2 тыс.» ---
const numbers = [
  ['18,719', 18719], ['1 234', 1234], ['1.2K', 1200], ['1,2 тыс.', 1200],
  ['3M', 3000000], ['2,5 млн', 2500000], ['18K', 18000], ['99', 99], ['', -1], ['нет данных', -1],
];
for (const [text, expected] of numbers) {
  const v = humanNumber(text);
  check(v === expected, `humanNumber(${JSON.stringify(text)}) = ${v}, ожидалось ${expected}`);
}

// --- jsonUnescape: базовые последовательности и \uXXXX ---
// Управляющие символы в заголовках заменяются пробелами (виджет показывает
// заголовок одной строкой); в C++ тот же итог даёт matchString().simplified().
const unescapes = [
  ['\\"текст\\"', '"текст"'],
  ['a\\nb', 'a b'],
  ['a\\tb', 'a b'],
  ['a\\rb', 'ab'],
  ['\\\\x', '\\x'],
  ['\\u0041BC', 'ABC'],
  ['\\u0424\\u0422', 'ФТ'],
];
for (const [input, expected] of unescapes) {
  const v = jsonUnescape(input);
  check(v === expected, `jsonUnescape(${JSON.stringify(input)}) = ${JSON.stringify(v)}, ожидалось ${JSON.stringify(expected)}`);
}

console.log(`Widget parse check passed (${total} assertions).`);
if (failed > 0) {
  console.error(`::error::check-widget-parse: ${failed} из ${total} проверок не пройдено`);
  process.exit(1);
}
