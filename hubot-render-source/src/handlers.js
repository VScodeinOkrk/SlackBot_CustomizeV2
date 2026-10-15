import { messages, renderMessage } from './messages.js';
import { randomInt } from 'node:crypto';
import { appearanceCommand } from './appearance.js';
import { escapeText, fortune, greeting, playlistVideos, urls } from './core.js';

export function handlers({ client, config, store, botId, env = process.env, now = () => new Date(), catalog = messages }) {
  const say = (path, values = {}) => renderMessage(path, values, catalog);
  const post = (channel, text, extra = {}) => client.chat.postMessage({ channel, text, unfurl_links: false, unfurl_media: false, ...store.value.appearance, ...extra });
  let music = { expires: 0, links: [] };
  async function tally(channel, ts) {
    const item = await client.reactions.get({ channel, timestamp: ts, full: true });
    const reactions = item.message?.reactions || [];
    const total = reactions.reduce((sum, r) => sum + r.count, 0);
    const details = reactions.length ? '\n' + reactions.map(r => say('スタンプ.内訳の1項目', { 絵文字: r.name, 個数: r.count })).join(' / ') : '';
    return say('スタンプ.合計通知', { 合計: total, 内訳: details });
  }
  async function bookmark(event) {
    if (!config.bookmarkChannel || event.reaction !== config.emoji) return;
    const key = `${event.item.channel}:${event.item.ts}`;
    if (store.value.bookmarks[key]) return;
    const info = await client.conversations.info({ channel: event.item.channel });
    if (info.channel.is_private && !config.privateBookmarks) return;
    const item = await client.reactions.get({ channel: event.item.channel, timestamp: event.item.ts, full: true });
    const message = item.message;
    const savedThread = config.bookmarkThread || store.value.bookmarkThreads?.[config.bookmarkChannel];
    if (savedThread && event.item.channel === config.bookmarkChannel && (event.item.ts === savedThread || message?.thread_ts === savedThread)) return;
    const links = urls(message?.text);
    if (!links.length || message.bot_id) return;
    const original = await client.chat.getPermalink({ conversation_id: event.item.channel, message_ts: event.item.ts });
    // 明示的な親投稿がなければ、最初の保存時に専用スレッドを作成する。
    let thread = savedThread;
    if (!thread) {
      const parent = await post(config.bookmarkChannel, say('ブックマーク.親投稿', { 絵文字: config.emoji }));
      thread = parent.ts;
      store.value.bookmarkThreads ||= {};
      store.value.bookmarkThreads[config.bookmarkChannel] = thread;
      await store.save();
    }
    // プレビューや元投稿の全文を転載せず、URLと出典だけをまとめる。
    const sent = await post(config.bookmarkChannel, say('ブックマーク.保存通知', { 絵文字: config.emoji, URL一覧: links.map(escapeText).join('\n'), 元投稿: '<' + original.permalink + '|' + escapeText(say('ブックマーク.元投稿リンクの表示')).replaceAll('|', '｜') + '>', 投稿者: '<@' + message.user + '>', 保存した人: '<@' + event.user + '>' }), { thread_ts: thread });
    store.value.bookmarks[key] = sent.ts;
    await store.save();
  }
  async function handle(event) {
    const channel = event.channel || event.item?.channel;
    if (event.type === 'member_joined_channel' && event.user === botId) {
      if (!config.allowed.has(channel)) await client.conversations.leave({ channel });
      return;
    }
    if (!config.allowed.has(channel)) return;
    if (['member_joined_channel', 'member_left_channel'].includes(event.type)) {
      if (event.user !== botId) await post(channel, say(event.type === 'member_joined_channel' ? '入退室.参加' : '入退室.退出', { ユーザー: '<@' + event.user + '>' }));
      return;
    }
    if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
      if (event.item?.type !== 'message' || event.user === botId) return;
      if (event.type === 'reaction_added') await bookmark(event);
      return;
    }
    if (event.type !== 'app_mention' || event.bot_id || event.subtype) return;
    const command = (event.text || '').replace(new RegExp(`<@${botId}>`, 'g'), '').trim();
    const extra = event.thread_ts ? { thread_ts: event.thread_ts } : {};
    if (/^(名前変更|アイコン変更)(?:\s|$)/.test(command) || command === '表示リセット') {
      if (!config.appearanceAdmins?.has(event.user)) {
        await post(channel, say('表示変更.管理者以外'), extra);
        return;
      }
      let next;
      try { next = appearanceCommand(command, store.value.appearance, catalog); }
      catch (error) { await post(channel, error.message, extra); return; }
      const previous = store.value.appearance;
      store.value.appearance = next;
      try { await store.save(); }
      catch (error) { store.value.appearance = previous; throw error; }
      await post(channel, say('表示変更.変更完了'), extra);
      return;
    }
    let text;
    if (/^おはよう[！!〜～。\s]*$/.test(command)) text = greeting(now(), event.user, config, catalog);
    else if (/^(今日の運勢|運勢)$/.test(command)) text = say('おみくじ.今日の運勢表示', { 結果: fortune(now(), event.user, config.zone, true, catalog) });
    else if (/^おみくじ$/.test(command)) text = say('おみくじ.おみくじ表示', { 結果: fortune(now(), event.user, config.zone, false, catalog) });
    else if (/^これ聴いて[！!。\s]*$/.test(command)) {
      try {
        if (Date.now() >= music.expires) music = { links: await playlistVideos(env), expires: Date.now() + 3600000 };
        text = say('音楽.選曲成功', { 動画URL: music.links[randomInt(music.links.length)] });
        extra.unfurl_links = true;
        extra.unfurl_media = true;
      } catch (error) { console.error('音楽取得:', error.message); text = say('音楽.取得失敗'); }
    } else if (/^スタンプ数$/.test(command)) {
      text = event.thread_ts ? await tally(channel, event.thread_ts) : say('スタンプ.スレッド案内');
    } else text = say('案内.ヘルプ');
    await post(channel, text, extra);
  }
  // イベントを直列処理して重複集約や保存ファイルの競合を防ぐ。
  let queue = Promise.resolve();
  return function enqueue(event, id) {
    const task = queue.then(async () => {
      if (id && store.value.events[id]) return;
      await handle(event);
      if (id) { store.prune(); store.value.events[id] = Date.now(); await store.save(); }
    });
    queue = task.catch(() => {});
    return task;
  };
}
