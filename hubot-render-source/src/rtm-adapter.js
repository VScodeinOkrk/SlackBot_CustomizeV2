import { RTMClient } from '@slack/rtm-api';
import { SlackSocketAdapter } from './slack-adapter.js';

// Slackに追加済みの旧Hubot連携用。App TokenやEvents API設定は不要。
export class SlackRTMAdapter extends SlackSocketAdapter {
  constructor(robot, options = {}) {
    const env = options.env || process.env;
    const token = env.HUBOT_SLACK_TOKEN || env.HUBOT_SLACK_BOT_TOKEN || env.SLACK_BOT_TOKEN;
    const rtm = options.socket || new RTMClient(token, { autoReconnect: true, logLevel: 'error' });
    super(robot, { ...options, socket: rtm, listenSocketEvents: false, env: { ...env, HUBOT_SLACK_BOT_TOKEN: token, HUBOT_SLACK_APP_TOKEN: '', SLACK_APP_TOKEN: '' } });
    this.name = 'slack-rtm';
    // Classic Botで投稿ごとの名前・アイコン変更を有効にする。
    const post = this.client.chat.postMessage.bind(this.client.chat);
    this.client.chat.postMessage = args => post({ ...args, as_user: false });
    for (const type of ['message', 'member_joined_channel', 'member_left_channel', 'reaction_added', 'reaction_removed', 'channel_joined', 'group_joined']) {
      rtm.on(type, event => { this.dispatchRTM({ ...event, type }).catch(error => this.robot.emit('error', error)); });
    }
  }
  async run() {
    await this.prepare();
    let timer;
    let onConnected;
    let onError;
    const connected = new Promise((resolve, reject) => {
      onConnected = resolve;
      onError = reject;
      this.socket.once('connected', onConnected);
      this.socket.once('error', onError);
      timer = setTimeout(() => reject(new Error('Slack RTMの接続がタイムアウトしました')), 30000);
    });
    try {
      await Promise.all([this.socket.start(), connected]);
      this.emit('connected');
      this.robot.emit('connected');
    } finally {
      clearTimeout(timer);
      this.socket.removeListener('connected', onConnected);
      this.socket.removeListener('error', onError);
    }
  }
  async dispatchRTM(raw) {
    let event = raw;
    if (['channel_joined', 'group_joined'].includes(raw.type)) {
      event = { type: 'member_joined_channel', channel: raw.channel?.id || raw.channel, user: this.botId, event_ts: raw.event_ts };
    } else if (raw.type === 'message') {
      if (raw.bot_id || raw.subtype || raw.user === this.botId || !raw.text?.includes(`<@${this.botId}>`)) return;
      event = { ...raw, type: 'app_mention' };
    }
    // RTMはEvents APIのevent_idを持たないため、ある場合だけ時刻から構築する。
    const stamp = event.event_ts || event.ts;
    const id = stamp ? ['rtm', event.type, event.channel || event.item?.channel, event.user, event.reaction || '', stamp].join(':') : undefined;
    await this.dispatch({ ack: async () => {}, body: { event, event_id: id } });
  }
}
