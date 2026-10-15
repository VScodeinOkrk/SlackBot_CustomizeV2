import { messages, renderMessage } from './messages.js';
// Slackの投稿時の表示だけを変更する。Botプロフィール自体は変更しない。
export function appearanceCommand(command, current = {}, catalog = messages) {
  if (command === '表示リセット') return {};
  const name = command.match(/^名前変更(?:\s+([\s\S]+))?$/);
  if (name) {
    const value = (name[1] || '').trim();
    if (!value || [...value].length > 80 || /[<>@\r\n\u0000-\u001f]/.test(value)) throw new Error(renderMessage('表示変更.名前の入力エラー', {}, catalog));
    return { ...current, username: value };
  }
  const icon = command.match(/^アイコン変更(?:\s+([\s\S]+))?$/);
  if (icon) {
    // Slackは貼り付けたURLを <URL|ラベル> に変換することがある。
    const value = (icon[1] || '').trim().replace(/^<([^|>]+)(?:\|[^>]+)?>$/, '$1');
    const { icon_emoji, icon_url, ...rest } = current;
    if (/^:[a-zA-Z0-9_+\-]+:$/.test(value)) return { ...rest, icon_emoji: value };
    let url;
    try { url = new URL(value); } catch { throw new Error(renderMessage('表示変更.アイコンの入力エラー', {}, catalog)); }
    if (url.protocol !== 'https:' || url.username || url.password || value.length > 2048) throw new Error(renderMessage('表示変更.画像URLの入力エラー', {}, catalog));
    return { ...rest, icon_url: url.href };
  }
  return null;
}
