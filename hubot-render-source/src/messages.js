import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

const file = new URL('../設定/メッセージ.yaml', import.meta.url);
// 使える差し込み項目。誤字は起動時に分かるよう検査する。
const schema = {
  入退室: { 参加: ['ユーザー'], 退出: ['ユーザー'] },
  朝の挨拶: { 予定より早い: ['起床時刻', '分'], 通常: ['起床時刻', '分', 'ひとこと'], '15分以内': [], '60分以内': [], '180分以内': [], '180分より後': [] },
  おみくじ: { 結果: null, おみくじ表示: ['結果'], 今日の運勢表示: ['結果'] },
  音楽: { 選曲成功: ['動画URL'], 取得失敗: [] },
  ブックマーク: { 親投稿: ['絵文字'], 保存通知: ['絵文字', 'URL一覧', '元投稿', '投稿者', '保存した人'], 元投稿リンクの表示: [] },
  スタンプ: { 合計通知: ['合計', '内訳'], 内訳の1項目: ['絵文字', '個数'], スレッド案内: [] },
  表示変更: { 管理者以外: [], 変更完了: [], 名前の入力エラー: [], アイコンの入力エラー: [], 画像URLの入力エラー: [] },
  案内: { ヘルプ: [] },
};
export function parseMessages(source) {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error('設定/メッセージ.yamlの書き方に誤りがあります: ' + doc.errors[0].message);
  const data = doc.toJS({ maxAliasCount: 0 });
  const fail = path => { throw new Error('設定/メッセージ.yamlの「' + path + '」を確認してください。項目名・文章・差し込み項目が不正です。'); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('全体');
  for (const key of Object.keys(data)) if (!Object.hasOwn(schema, key)) fail(key);
  for (const [section, fields] of Object.entries(schema)) {
    const values = data[section];
    if (!values || typeof values !== 'object' || Array.isArray(values)) fail(section);
    for (const key of Object.keys(values)) if (!Object.hasOwn(fields, key)) fail(section + '.' + key);
    for (const [key, tokens] of Object.entries(fields)) {
      const path = section + '.' + key;
      const value = values[key];
      if (tokens === null) {
        if (!Array.isArray(value) || !value.length || value.some(x => typeof x !== 'string' || !x.trim())) fail(path);
      } else if (typeof value !== 'string' || !value.trim() || [...value.matchAll(/\{([^{}]+)\}/g)].some(m => !tokens.includes(m[1]))) fail(path);
    }
  }
  return data;
}
export function loadMessages(path = file) { return parseMessages(readFileSync(path, 'utf8')); }
export const messages = loadMessages();
export function renderMessage(path, values = {}, catalog = messages) {
  const [section, key] = path.split('.');
  const template = catalog[section]?.[key];
  if (typeof template !== 'string') throw new Error('メッセージが見つかりません: ' + path);
  return template.replace(/\{([^{}]+)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error('差し込み項目が足りません: ' + path + ' {' + name + '}');
    return String(values[name]);
  });
}
