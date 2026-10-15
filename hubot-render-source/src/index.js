import { resolve } from 'node:path';
import { settings, Store } from './core.js';
import { createHubot } from './runtime.js';
import { GasStore } from './gas-store.js';
import { startHealthServer } from './health.js';

const config = settings();
const botToken = process.env.HUBOT_SLACK_TOKEN || process.env.HUBOT_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
const mode = process.env.HUBOT_SLACK_MODE || 'rtm';
const appToken = process.env.HUBOT_SLACK_APP_TOKEN || process.env.SLACK_APP_TOKEN;
if (!botToken?.startsWith('xoxb-')) throw new Error('.envに既存Hubot連携のBot Tokenを設定してください');
if (mode === 'socket' && !appToken?.startsWith('xapp-')) throw new Error('Socket Modeを使う場合だけApp Tokenが必要です');
if (process.env.RENDER && (!process.env.GAS_STATE_URL || !process.env.GAS_STATE_SECRET)) throw new Error('RenderではGAS_STATE_URLとGAS_STATE_SECRETを設定してください');
let robot;
const health = process.env.PORT ? await startHealthServer(process.env.PORT, () => mode === 'rtm' ? robot?.adapter.socket.connected === true : !!robot) : null;
const store = await (process.env.GAS_STATE_URL ? new GasStore(process.env.GAS_STATE_URL, process.env.GAS_STATE_SECRET) : new Store(resolve(process.env.DATA_DIR || 'data', 'state.json'))).load();
robot = await createHubot({ config, store });
try {
  await robot.run();
} catch (error) {
  await robot.adapter.close();
  robot.shutdown();
  throw error;
}
console.log(`Hubot ${robot.version} 起動完了（${mode === 'rtm' ? '既存Hubot連携・RTM' : 'Slack Socket Mode'}）`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  health?.close();
  await robot.adapter.close();
  robot.shutdown();
  process.exit(0);
});
