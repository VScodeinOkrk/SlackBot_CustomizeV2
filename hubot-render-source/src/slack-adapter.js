import { Adapter, Message, TextMessage, EnterMessage, LeaveMessage, User } from 'hubot';
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';

const supported = new Set(['app_mention', 'member_joined_channel', 'member_left_channel', 'reaction_added', 'reaction_removed']);
export class SlackReactionMessage extends Message {}

// HubotのAdapter APIでSlackイベントを標準メッセージに変換する。
export class SlackSocketAdapter extends Adapter {
  constructor(robot, { config, store, env = process.env, client, socket, listenSocketEvents = true } = {}) {
    super(robot);
    this.name = 'slack-socket';
    this.config = config;
    this.store = store;
    this.appToken = env.HUBOT_SLACK_APP_TOKEN || env.SLACK_APP_TOKEN;
    this.client = client || new WebClient(env.HUBOT_SLACK_BOT_TOKEN || env.SLACK_BOT_TOKEN);
    this.socket = socket || new SocketModeClient({ appToken: env.HUBOT_SLACK_APP_TOKEN || env.SLACK_APP_TOKEN });
    this.onSlackEvent = payload => { this.dispatch(payload).catch(error => this.robot.emit('error', error)); };
    if (listenSocketEvents) this.socket.on('slack_event', this.onSlackEvent);
    this.socket.on('error', error => this.robot.emit('error', error));
  }
  async prepare() {
    if (this.botId) return;
    const auth = await this.client.auth.test();
    this.botId = auth.user_id;
    if (!this.botId) throw new Error('Slack認証でBotのユーザーIDを取得できませんでした');
    // xappトークンに含まれるアプリIDと、Botの所属アプリを照合する。
    const appId = this.appToken?.match(/^xapp-\d+-(A[A-Z0-9]+)-/)?.[1];
    if (appId && auth.bot_id && this.client.bots?.info) {
      let bot;
      try { bot = (await this.client.bots.info({ bot: auth.bot_id })).bot; }
      catch (error) {
        if (error.data?.error !== 'missing_scope') throw error;
        this.robot.logger.warn('アプリ照合は権限不足で省略しました。2つのトークンは同じSlackアプリから取得してください。');
      }
      if (bot?.app_id && bot.app_id !== appId) throw new Error('Bot TokenとApp Tokenが別々のSlackアプリのものです。同じアプリのOAuth & PermissionsでBot Tokenを取得し直してください。');
    }
    let cursor;
    do {
      const page = await this.client.users.conversations({ types: 'public_channel,private_channel', exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}) });
      for (const channel of page.channels || []) if (!this.config.allowed.has(channel.id)) {
        try { await this.client.conversations.leave({ channel: channel.id }); }
        catch (error) { this.robot.logger.error({ channel: channel.id, code: error.data?.error || error.code }, 'チャンネルから退出できません'); }
      }
      cursor = page.response_metadata?.next_cursor;
    } while (cursor);
  }
  async dispatch({ ack, body }) {
    // SlackへのACKを先に返し、時間のかかる処理はHubotで実行する。
    await ack();
    const event = body?.event;
    if (!event || !supported.has(event.type) || event.bot_id || event.subtype) return;
    const channel = event.channel || event.item?.channel;
    this.robot.logger.info({ event: event.type, channel, allowed: this.config.allowed.has(channel) }, 'Slackイベントを受信');
    if (!this.config.allowed.has(channel) && !(event.type === 'member_joined_channel' && event.user === this.botId)) return;
    if (!event.user) return;
    const user = new User(event.user, { room: channel });
    let message;
    if (event.type === 'app_mention') {
      if (event.user === this.botId) return;
      const command = (event.text || '').replaceAll(`<@${this.botId}>`, '').trim();
      message = new TextMessage(user, `${this.robot.name} ${command}`, event.ts);
    } else if (event.type === 'member_joined_channel') message = new EnterMessage(user);
    else if (event.type === 'member_left_channel') message = new LeaveMessage(user);
    else message = new SlackReactionMessage(user);
    message.slackEvent = event;
    message.slackEventId = body.event_id;
    await this.receive(message);
  }
  async run() {
    await this.prepare();
    await this.socket.start();
    this.emit('connected');
    this.robot.emit('connected');
  }
  async send(envelope, ...strings) {
    if (!this.config.allowed.has(envelope.room)) return;
    for (const text of strings) await this.client.chat.postMessage({
      channel: envelope.room, text: String(text), unfurl_links: false, unfurl_media: false,
      ...this.store.value.appearance,
      ...(envelope.message?.slackEvent?.thread_ts ? { thread_ts: envelope.message.slackEvent.thread_ts } : {}),
    });
  }
  async reply(envelope, ...strings) { return this.send(envelope, ...strings); }
  close() {
    if (!this.closing) this.closing = (async () => {
      await this.socket.disconnect();
      this.socket.removeAllListeners();
      super.close();
    })();
    return this.closing;
  }
}
