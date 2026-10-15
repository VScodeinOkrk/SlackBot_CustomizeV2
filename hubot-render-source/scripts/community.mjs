// Description:
//   入退室・リアクション・ブックマークと、AIを使わないお楽しみコマンド。
// Commands:
//   hubot おはよう - 予定起床時刻に応じて挨拶
//   hubot おみくじ - 毎回抽選
//   hubot 今日の運勢 - 一日固定の運勢
//   hubot これ聴いて - プレイリストからランダム選曲
//   hubot スタンプ数 - スレッドの親投稿の合計
//   hubot 名前変更 名前 - 投稿の表示名を変更（管理者）
//   hubot アイコン変更 :emoji: - 投稿のアイコンを変更（管理者）
//   hubot 表示リセット - 投稿の表示を初期値に戻す（管理者）
import { handlers } from '../src/handlers.js';
import { SlackReactionMessage } from '../src/slack-adapter.js';

export default robot => {
  const { client, config, store, botId } = robot.adapter;
  const handle = handlers({ client, config, store, botId });
  const dispatch = async response => {
    const { message } = response;
    if (!message.slackEvent) return;
    await handle(message.slackEvent, message.slackEventId);
    message.finish();
  };
  robot.respond(/(?:おはよう[！!〜～。\s]*|今日の運勢|運勢|おみくじ|これ聴いて[！!。\s]*|スタンプ数|名前変更(?:\s+[\s\S]*)?|アイコン変更(?:\s+[\s\S]*)?|表示リセット|ヘルプ)$/, dispatch);
  robot.enter(dispatch);
  robot.leave(dispatch);
  robot.listen(message => message instanceof SlackReactionMessage, dispatch);
};
