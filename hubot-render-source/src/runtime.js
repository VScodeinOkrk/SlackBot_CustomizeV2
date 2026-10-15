import { Robot } from 'hubot';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SlackSocketAdapter } from './slack-adapter.js';
import { SlackRTMAdapter } from './rtm-adapter.js';

export async function createHubot({ config, store, env = process.env, client, socket }) {
  const robot = new Robot(null, false, env.HUBOT_NAME || 'hubot');
  // Hubot 14.1.0のparseVersionはBufferをJSONとして読まないため補う。
  robot.version = createRequire(import.meta.url)('hubot/package.json').version;
  const mode = env.HUBOT_SLACK_MODE || 'rtm';
  if (!['rtm', 'socket'].includes(mode)) throw new Error('HUBOT_SLACK_MODEはrtmまたはsocketを指定してください');
  const SlackAdapter = mode === 'rtm' ? SlackRTMAdapter : SlackSocketAdapter;
  robot.adapter = new SlackAdapter(robot, { config, store, env, client, socket });
  robot.adapterName = robot.adapter.name;
  robot.error(error => robot.logger.error({ code: error.data?.error || error.code || error.name, detail: error.message }, 'Hubotの処理に失敗しました'));
  try {
    await robot.adapter.prepare();
    await robot.load(fileURLToPath(new URL('../scripts/', import.meta.url)));
    return robot;
  } catch (error) {
    await robot.adapter.close();
    robot.shutdown();
    throw error;
  }
}
