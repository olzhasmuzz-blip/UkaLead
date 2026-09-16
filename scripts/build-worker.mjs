import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, 'dist', name), 'utf8');
const assets = {
  index: read('index.html'),
  styles: read('styles.css'),
  app: read('app.js'),
  favicon: read('favicon.svg')
};

const worker = String.raw`const assets = {
  "/": { body: __INDEX__, type: "text/html; charset=utf-8" },
  "/index.html": { body: __INDEX__, type: "text/html; charset=utf-8" },
  "/styles.css": { body: __STYLES__, type: "text/css; charset=utf-8" },
  "/app.js": { body: __APP__, type: "application/javascript; charset=utf-8" },
  "/favicon.svg": { body: __FAVICON__, type: "image/svg+xml" }
};

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors }
  });
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function decodeHtml(value) {
  return stripTags(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function first(chunk, pattern) {
  const match = chunk.match(pattern);
  return match ? decodeHtml(match[1]) : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;
  if (digits.length === 10 && digits[0] === '7') return '+' + digits;
  return digits;
}

function normalizeEmail(value) {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function extractEmail(html) {
  const raw = String(html || '');
  const candidates = [];
  for (const match of raw.matchAll(/mailto:([^"' <>?]+)/ig)) {
    try { candidates.push(normalizeEmail(decodeURIComponent(match[1]))); } catch { candidates.push(normalizeEmail(match[1])); }
  }
  for (const match of raw.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)) candidates.push(normalizeEmail(match[0]));
  return candidates.find(email => email && !/(?:2gis|yandex|yandex-team|google|gstatic|example)\./i.test(email)) || '';
}

function extractWhatsApp(html) {
  const match = String(html || '').match(/(?:wa\.me\/|whatsapp[^\d+]*)(\+?\d[\d\s()\-]{8,16})/i);
  return normalizePhone(match ? match[1] : '');
}

function decodeJsonString(value) {
  try { return JSON.parse('"' + value + '"'); } catch { return String(value || '').replace(/\\n/g, ' ').replace(/\\"/g, '"').trim(); }
}

function parseReviews(html) {
  const pattern = /"source":null,"text":"((?:\\.|[^"\\])*)"/g;
  const reviews = [];
  let match;
  while ((match = pattern.exec(html)) && reviews.length < 24) {
    const before = html.slice(Math.max(0, match.index - 1400), match.index);
    const ratingMatch = before.match(/"rating":\s*([1-5](?:\.\d+)?)/);
    const text = decodeJsonString(match[1]).replace(/\s+/g, ' ').trim();
    if (text.length >= 12) reviews.push({ text, rating: ratingMatch ? Number(ratingMatch[1]) : null });
  }
  return reviews;
}

function reviewAnalytics(reviews, declaredCount, declaredRating) {
  const topics = [
    ['качество', /качеств|аккурат|материал|надёж|прочно/i],
    ['скорость', /быстр|срок|долго|задерж|оператив/i],
    ['сервис', /сервис|клиент|вежлив|отношен|профессион|сотрудник|ответ/i],
    ['цена', /цен|стоим|дорог|дешев|выгод/i],
    ['доставка и монтаж', /достав|монтаж|установ|сборк/i],
    ['дизайн', /дизайн|красив|стиль|внешн|удобн/i]
  ];
  let positive = 0, negative = 0, neutral = 0;
  const topicCounts = Object.fromEntries(topics.map(([name]) => [name, 0]));
  const normalized = reviews.map(review => {
    const text = review.text;
    const explicitPositive = /спасибо|довольн|рекоменд|понрав|качеств|быстр|аккурат|профессион|вежлив|советую|красив/i.test(text);
    const explicitNegative = /не совет|плох|ужас|груб|хам|брак|задерж|долго|игнор|претенз|обман|дорог/i.test(text);
    if ((review.rating && review.rating >= 4) || (review.rating == null && explicitPositive && !explicitNegative)) positive += 1;
    else if ((review.rating && review.rating <= 2) || (review.rating == null && explicitNegative)) negative += 1;
    else neutral += 1;
    topics.forEach(([name, pattern]) => { if (pattern.test(text)) topicCounts[name] += 1; });
    return { text, rating: review.rating };
  });
  const topTopics = Object.entries(topicCounts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }));
  const sufficient = normalized.length >= 3;
  const rated = normalized.filter(item => item.rating);
  const rating = declaredRating || (rated.length ? (rated.reduce((sum, item) => sum + item.rating, 0) / rated.length).toFixed(1) : '');
  let offerAngle = '';
  if (!sufficient) offerAngle = 'отзывов пока мало для уверенного вывода';
  else if (negative > positive && topTopics.some(topic => ['сервис', 'скорость', 'доставка и монтаж'].includes(topic.name))) offerAngle = 'в отзывах есть точки роста в сервисе и скорости — можно предложить автоматизацию обращений и контроля заявок';
  else if (positive >= negative && topTopics.some(topic => ['качество', 'дизайн'].includes(topic.name))) offerAngle = 'клиенты хвалят качество и результат — это можно превратить в кейсы, рекламу и регулярный контент';
  else if (positive >= negative) offerAngle = 'отзывы в основном положительные — есть материал для доверительной рекламы и контента';
  else offerAngle = 'отзывы смешанные — лучше начать с короткого аудита клиентского пути';
  const auditText = sufficient ? 'Проанализировано ' + normalized.length + ' публичных отзывов из ' + (declaredCount || normalized.length) + '. Позитивных: ' + positive + ', нейтральных: ' + neutral + ', негативных: ' + negative + '. ' + offerAngle + '.' : 'В карточке указано ' + (declaredCount || 0) + ' отзывов, но для уверенного аудита удалось прочитать только ' + normalized.length + '.';
  return { sufficient, sampleSize: normalized.length, declaredCount: Number(declaredCount || 0), averageRating: rating, positive, negative, neutral, topTopics, offerAngle, auditText, highlights: normalized.slice(0, 3).map(item => item.text.slice(0, 220)), risks: negative > 0 ? normalized.filter(item => item.rating && item.rating <= 2).slice(0, 2).map(item => item.text.slice(0, 180)) : [] };
}

function extractWebsite(html) {
  const match = html.match(/"url":"(https?:\/\/[^" ]+)","text":"[^"]*","code":"[^"]*","type":"website"/i);
  return match ? match[1].replace(/\\\//g, '/') : '';
}

async function auditWebsite(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try { url = new URL(rawUrl); } catch { return { url: rawUrl, ok: false, issues: ['Ссылка на сайт выглядит некорректно.'], summary: 'Сайт не удалось проверить.' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { url: rawUrl, ok: false, issues: ['Сайт использует неподдерживаемый протокол.'], summary: 'Сайт не удалось проверить.' };
  const started = Date.now();
  try {
    const response = await fetch(url.toString(), { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; UkaLead audit/1.0)' } });
    const html = await response.text();
    const text = decodeHtml(html).slice(0, 120000);
    const hasForm = /<form\b/i.test(html);
    const hasWhatsApp = /whatsapp|wa\.me|api\.whatsapp/i.test(html);
    const hasPhone = /(?:tel:|phone|телефон|\+7\s?\(?7)/i.test(html);
    const hasCta = /заказать|рассчитать|записаться|записат|связаться|купить|получить|оставить заявку/i.test(text);
    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    const issues = [];
    if (!response.ok) issues.push('Сайт отвечает с ошибкой ' + response.status + '.');
    if (url.protocol !== 'https:') issues.push('Нет HTTPS — это снижает доверие и может мешать заявкам.');
    if (!hasForm && !hasWhatsApp) issues.push('Не найден быстрый путь оставить заявку или написать в WhatsApp.');
    if (!hasCta) issues.push('Не найден явный призыв к действию.');
    if (!hasViewport) issues.push('Не найден мобильный viewport — стоит проверить отображение на телефоне.');
    const strengths = [hasForm ? 'есть форма' : '', hasWhatsApp ? 'есть WhatsApp' : '', hasPhone ? 'есть телефон' : '', hasCta ? 'есть призыв к действию' : ''].filter(Boolean);
    const summary = issues.length ? issues.join(' ') : 'Критичных технических пробелов в первом проходе не найдено.';
    return { url: url.toString(), ok: response.ok, status: response.status, title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ? decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) : '', responseMs: Date.now() - started, hasForm, hasWhatsApp, hasPhone, hasCta, hasViewport, strengths, issues, summary, offerAngle: issues.length ? 'можно начать с короткого аудита сайта и убрать ' + issues[0].toLowerCase() : 'можно усилить текущий сайт контентом и тестом новых офферов' };
  } catch (error) {
    return { url: rawUrl, ok: false, responseMs: Date.now() - started, issues: ['Сайт не ответил на проверку.'], summary: 'Сайт не удалось проверить: ' + String(error?.message || error) };
  }
}

async function enrichReviews(item) {
  try {
    const response = await fetch(item.source, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; UkaLead/1.0; +https://2gis.kz)', 'accept-language': 'ru-RU,ru;q=0.9' } });
    if (!response.ok) return item;
    const html = await response.text();
    const website = extractWebsite(html);
    const email = extractEmail(html);
    const whatsapp = extractWhatsApp(html);
    const [reviews, websiteAudit] = await Promise.all([Promise.resolve(parseReviews(html)), auditWebsite(website)]);
    return { ...item, website, email, whatsapp, websiteAudit, reviewAnalytics: reviewAnalytics(reviews, item.reviewCount, item.rating) };
  } catch { return { ...item, reviewAnalytics: reviewAnalytics([], item.reviewCount, item.rating) }; }
}

async function parseSearchPage(html, limit) {
  const firmPattern = /<a[^>]+href=["']\/ust-kamenogorsk\/firm\/(\d+)["'][^>]*>/gi;
  const matches = Array.from(html.matchAll(firmPattern));
  const result = [];
  const seen = new Set();
  for (let index = 0; index < matches.length && result.length < limit; index += 1) {
    const id = matches[index][1];
    if (seen.has(id)) continue;
    seen.add(id);
    const start = matches[index].index;
    const end = matches[index + 1]?.index || html.length;
    const chunk = html.slice(start, end);
    const readable = decodeHtml(chunk);
    const name = first(chunk, /<span[^>]*class=["'][^"']*?_lvwrwt[^"']*["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i) || first(chunk, /<h\d[^>]*>([\s\S]*?)<\/h\d>/i) || 'Компания 2ГИС';
    const category = first(chunk, /<div[^>]*class=["'][^"']*?_4cxmw7[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || first(chunk, /<a[^>]+href=["'][^"']*\/search\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i) || 'Организация';
    const address = first(chunk, /<span[^>]*class=["'][^"']*?_3yxk2u[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || 'Усть-Каменогорск';
    const rating = first(chunk, /<div[^>]*class=["'][^"']*?_y10azs[^"']*["'][^>]*>([\d.,]+)<\/div>/i) || (readable.match(/(?:Рейтинг|rating)\s*([0-5][.,]\d)/i) || [])[1] || '';
    const reviewCount = first(chunk, /<div[^>]*class=["'][^"']*?_jspzdm[^"']*["'][^>]*>([\d\s]+)\s*(?:оцен|отзыв)/i).replace(/\s/g, '') || '';
    const contactMatch = readable.match(/(?:phone(?:=|%3D)|tel:)(\+?\d[\d\s()\-]{8,16})/i);
    const phone = normalizePhone(contactMatch ? contactMatch[1] : '');
    const score = Math.min(95, 58 + (address ? 8 : 0) + (category ? 6 : 0) + (rating ? Math.min(10, Math.round(Number(String(rating).replace(',', '.')) * 2)) : 0) + (reviewCount ? Math.min(8, Math.round(Number(reviewCount) / 20)) : 0) + (phone ? 6 : 0));
    result.push({ id, name, category, address, rating: String(rating).replace(',', '.'), reviewCount, phone, email: extractEmail(chunk), whatsapp: extractWhatsApp(chunk), source: 'https://2gis.kz/ust-kamenogorsk/firm/' + id, sourceType: '2gis', score });
  }
  return Promise.all(result.slice(0, 20).map(enrichReviews)).then(enriched => enriched.concat(result.slice(20)));
}

function allowedMapHost(hostname) {
  return /(^|\.)2gis\.kz$/i.test(hostname) || /(^|\.)yandex\.(ru|kz)$/i.test(hostname) || /(^|\.)google\.(com|kz)$/i.test(hostname) || /(^|\.)maps\.google\.com$/i.test(hostname);
}

async function enrichMapItem(item) {
  try {
    const response = await fetch(item.source, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; UkaLead maps parser/1.0)', 'accept-language': 'ru-RU,ru;q=0.9' } });
    if (!response.ok) return item;
    const html = await response.text();
    return { ...item, phone: item.phone || normalizePhone((decodeHtml(html).match(/(?:tel:|phone|телефон)\s*[:=]?\s*(\+?\d[\d\s()\-]{8,16})/i) || [])[1]), email: item.email || extractEmail(html), whatsapp: item.whatsapp || extractWhatsApp(html) };
  } catch { return item; }
}

function parseYandexPage(html, target, limit) {
  const markers = Array.from(html.matchAll(/<div role="presentation" class="search-snippet-view__body _type_business"[^>]*data-id="([^"]+)"[^>]*>/gi));
  const result = [];
  const seen = new Set();
  for (let index = 0; index < markers.length && result.length < limit; index += 1) {
    const id = markers[index][1];
    if (seen.has(id)) continue;
    seen.add(id);
    const start = markers[index].index;
    const end = markers[index + 1]?.index || html.length;
    const chunk = html.slice(start, end);
    const name = first(chunk, /search-business-snippet-view__title">([\s\S]*?)<\/div>/i) || first(chunk, /aria-label="([^"]+)"/i) || 'Компания Яндекс Карт';
    const category = first(chunk, /search-business-snippet-view__category"[^>]*>([\s\S]*?)<\/a>/i) || 'Организация';
    const address = first(chunk, /search-business-snippet-view__address"[^>]*>([\s\S]*?)<\/div>/i) || 'Усть-Каменогорск';
    const href = first(chunk, /href="(\/maps\/org\/[^"#]+)"/i);
    const source = href ? new URL(href, target).toString() : target.toString();
    const readable = decodeHtml(chunk);
    const rating = (chunk.match(/"ratingValue"\s*:\s*([0-5](?:\.\d+)?)/i) || [])[1] || '';
    const reviewCount = (chunk.match(/"reviewCount"\s*:\s*(\d+)/i) || [])[1] || '';
    const phone = normalizePhone((readable.match(/(?:tel:|phone|телефон)\s*[:=]?\s*(\+?\d[\d\s()\-]{8,16})/i) || [])[1]);
    const score = Math.min(92, 56 + (address ? 8 : 0) + (category ? 6 : 0) + (rating ? Math.min(10, Math.round(Number(rating) * 2)) : 0) + (reviewCount ? Math.min(8, Math.round(Number(reviewCount) / 20)) : 0) + (phone ? 6 : 0));
    result.push({ id, name, category, address, rating, reviewCount, phone, email: extractEmail(chunk), whatsapp: extractWhatsApp(chunk), source, sourceType: 'yandex', score });
  }
  return Promise.all(result.slice(0, 20).map(enrichMapItem)).then(enriched => enriched.concat(result.slice(20)));
}

function parseGooglePage(html, target, limit) {
  const markers = Array.from(html.matchAll(/<a[^>]+href="(\/maps\/place\/[^"?]+)[^>]*>/gi));
  const result = [];
  const seen = new Set();
  for (let index = 0; index < markers.length && result.length < limit; index += 1) {
    const href = markers[index][1];
    const id = href;
    if (seen.has(id)) continue;
    seen.add(id);
    const start = markers[index].index;
    const end = markers[index + 1]?.index || html.length;
    const chunk = html.slice(start, end);
    const name = first(chunk, /aria-label="([^"]+)"/i) || decodeURIComponent(href.split('/').pop() || '').replace(/[+_-]+/g, ' ') || 'Компания Google Maps';
    const readable = decodeHtml(chunk);
    const address = first(chunk, /(?:address|formatted_address)"\s*:\s*"([^"]+)"/i) || 'Усть-Каменогорск';
    const phone = normalizePhone((readable.match(/(?:tel:|phone|телефон)\s*[:=]?\s*(\+?\d[\d\s()\-]{8,16})/i) || [])[1]);
    result.push({ id, name, category: 'Организация', address, rating: '', reviewCount: '', phone, email: extractEmail(chunk), whatsapp: extractWhatsApp(chunk), source: new URL(href, target).toString(), sourceType: 'google', score: Math.min(84, 62 + (address ? 8 : 0) + (phone ? 6 : 0)) });
  }
  return Promise.all(result.slice(0, 20).map(enrichMapItem)).then(enriched => enriched.concat(result.slice(20)));
}

async function parseMapPage(html, target, limit) {
  if (/(^|\.)yandex\.(ru|kz)$/i.test(target.hostname)) return parseYandexPage(html, target, limit);
  if (/(^|\.)google\.(com|kz)$/i.test(target.hostname) || /(^|\.)maps\.google\.com$/i.test(target.hostname)) return parseGooglePage(html, target, limit);
  return parseSearchPage(html, limit);
}

async function parse2gis(request) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Нужен JSON с полем url.' }, 400); }
  const rawUrl = String(input?.url || '').trim();
  if (!rawUrl) return json({ error: 'Вставь публичную ссылку на поиск карт.' }, 400);
  let target;
  try { target = new URL(rawUrl); } catch { return json({ error: 'Ссылка выглядит некорректно.' }, 400); }
  if (target.protocol !== 'https:' || !allowedMapHost(target.hostname)) return json({ error: 'Разрешены публичные страницы 2ГИС, Яндекс Карт и Google Maps.' }, 400);
  const limit = Math.min(50, Math.max(1, Number(input?.limit || 20)));
  try {
    const response = await fetch(target.toString(), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; UkaLead/1.0; +https://2gis.kz)', 'accept-language': 'ru-RU,ru;q=0.9' } });
    if (!response.ok) return json({ error: 'Источник вернул HTTP ' + response.status + '.' }, 502);
    const html = await response.text();
    const leads = await parseMapPage(html, target, limit);
    return json({ source: target.toString(), count: leads.length, leads });
  } catch (error) {
    return json({ error: 'Не удалось прочитать источник карт: ' + String(error?.message || error) }, 502);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/parse-2gis') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'Используй POST.' }, 405);
      return parse2gis(request);
    }
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    const asset = assets[url.pathname] || assets['/'];
    return new Response(asset.body, { headers: { 'content-type': asset.type, 'cache-control': url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/styles.css' ? 'no-store' : 'public, max-age=300' } });
  }
};
`;

const output = worker
  .replaceAll('__INDEX__', JSON.stringify(assets.index))
  .replace('__STYLES__', JSON.stringify(assets.styles))
  .replace('__APP__', JSON.stringify(assets.app))
  .replace('__FAVICON__', JSON.stringify(assets.favicon));
fs.mkdirSync(path.join(root, 'dist', 'server'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'server', 'index.js'), output);
console.log('Generated dist/server/index.js');

