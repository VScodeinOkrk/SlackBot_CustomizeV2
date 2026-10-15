import { messages, renderMessage } from './messages.js';
import { createHash, randomInt } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function settings(env = process.env) {
  const allowed = new Set((env.ALLOWED_CHANNEL_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
  if (!allowed.size || [...allowed].some(x => !/^[CG][A-Z0-9]+$/.test(x))) throw new Error('ALLOWED_CHANNEL_IDSにチャンネルIDを指定してください');
  let bookmarkChannel = env.BOOKMARK_CHANNEL_ID || '';
  // 許可チャンネルが1つなら、その中にブックマーク用スレッドを作る。
  if (!bookmarkChannel && !env.BOOKMARK_THREAD_URL && allowed.size === 1) bookmarkChannel = [...allowed][0];
  let bookmarkThread = '';
  if (env.BOOKMARK_THREAD_URL) {
    let link;
    try { link = new URL(env.BOOKMARK_THREAD_URL); } catch { throw new Error('BOOKMARK_THREAD_URLにはSlackの親投稿リンクを指定してください'); }
    const match = link.pathname.match(/^\/archives\/([CG][A-Z0-9]+)\/p(\d{10,})(\d{6})$/);
    if (link.protocol !== 'https:' || !link.hostname.endsWith('.slack.com') || !match) throw new Error('BOOKMARK_THREAD_URLにはSlackの投稿リンクを指定してください');
    if (bookmarkChannel && bookmarkChannel !== match[1]) throw new Error('ブックマーク先チャンネルIDとスレッドのリンクが一致しません');
    bookmarkChannel = match[1];
    bookmarkThread = link.searchParams.get('thread_ts') || match[2] + '.' + match[3];
    if (!/^\d{10,}\.\d{6}$/.test(bookmarkThread)) throw new Error('スレッドの時刻が不正です');
  }
  if (bookmarkChannel && !allowed.has(bookmarkChannel)) throw new Error('ブックマーク先もALLOWED_CHANNEL_IDSに含めてください');
  const zone = env.TIME_ZONE || 'Asia/Tokyo';
  new Intl.DateTimeFormat('ja', { timeZone: zone });
  const wakeTimes = JSON.parse(env.WAKE_TIMES_JSON || '{}');
  if (!wakeTimes || typeof wakeTimes !== 'object' || Array.isArray(wakeTimes)) throw new Error('WAKE_TIMES_JSONはオブジェクトにしてください');
  const wake = env.WAKE_TIME || '07:00';
  for (const t of [wake, ...Object.values(wakeTimes)]) if (typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error('起床時刻はHH:MMで指定してください');
  return { appearanceAdmins: new Set((env.BOT_ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean)), allowed, bookmarkChannel, bookmarkThread, emoji: (env.BOOKMARK_EMOJI || 'bookmark').replaceAll(':', ''), privateBookmarks: env.ALLOW_PRIVATE_BOOKMARKS === 'true', zone, wake, wakeTimes };
}

export function localTime(date, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
export function greeting(date, user, config, catalog = messages) {
  const time = config.wakeTimes[user] || config.wake;
  const [h, m] = time.split(':').map(Number);
  const delta = localTime(date, config.zone).minutes - (h * 60 + m);
  if (delta < 0) return renderMessage('朝の挨拶.予定より早い', { 起床時刻: time, 分: -delta }, catalog);
  const period = delta <= 15 ? '15分以内' : delta <= 60 ? '60分以内' : delta <= 180 ? '180分以内' : '180分より後';
  const comment = renderMessage('朝の挨拶.' + period, {}, catalog);
  return renderMessage('朝の挨拶.通常', { 起床時刻: time, 分: delta, ひとこと: comment }, catalog);
}
export function fortune(date, user, zone, daily = true, catalog = messages) {
  const values = catalog.おみくじ.結果;
  const index = daily ? createHash('sha256').update(`${localTime(date, zone).day}:${user}`).digest().readUInt32BE() % values.length : randomInt(values.length);
  return values[index];
}
export function urls(text = '') {
  return [...new Set((text.match(/https?:\/\/[^\s<>|]+/g) || []).filter(u => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } }))];
}
export const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export class Store {
  constructor(path) { this.path = path; this.value = { events: {}, bookmarks: {} }; }
  async load() {
    try { this.value = JSON.parse(await readFile(this.path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!this.value.events || !this.value.bookmarks) throw new Error('保存データの形式が不正です');
    return this;
  }
  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify(this.value), { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
  }
  prune(now = Date.now()) { for (const [id, t] of Object.entries(this.value.events)) if (now - t > 86400000) delete this.value.events[id]; }
}

export async function playlistVideos(env, fetcher = fetch) {
  const manual = (env.YOUTUBE_VIDEO_URLS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (manual.length) {
    for (const link of manual) { const u = new URL(link); if (u.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'youtu.be'].includes(u.hostname)) throw new Error('動画URLにはYouTubeのHTTPS URLを指定してください'); }
    return manual;
  }
  if (!env.YOUTUBE_API_KEY || !env.YOUTUBE_PLAYLIST_ID) throw new Error('YouTubeプレイリストが未設定です');
  if (env.YOUTUBE_API_KEY.endsWith('.apps.googleusercontent.com')) throw new Error('YOUTUBE_API_KEYにOAuthクライアントIDが入っています。Google Cloudの「認証情報を作成 → APIキー」で発行した値を指定してください');
  let playlistId = env.YOUTUBE_PLAYLIST_ID.trim();
  if (/^https?:/.test(playlistId)) {
    let link;
    try { link = new URL(playlistId); } catch { throw new Error('YouTubeプレイリストのURLが不正です'); }
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(link.hostname) || !link.searchParams.get('list')) throw new Error('list=を含むYouTubeプレイリストのリンクを指定してください');
    playlistId = link.searchParams.get('list');
  }
  const result = [];
  let page = '';
  do {
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    endpoint.search = new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId, key: env.YOUTUBE_API_KEY, ...(page ? { pageToken: page } : {}) });
    const response = await fetcher(endpoint, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`YouTube APIがHTTP ${response.status}を返しました`);
    const body = await response.json();
    for (const item of body.items || []) if (!['Private video', 'Deleted video'].includes(item.snippet?.title) && item.snippet?.resourceId?.videoId) result.push(`https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`);
    page = body.nextPageToken || '';
  } while (page);
  if (!result.length) throw new Error('プレイリストに取得可能な動画がありません');
  return result;
}
