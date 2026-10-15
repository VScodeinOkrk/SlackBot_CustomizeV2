import { createHmac, randomUUID } from 'node:crypto';
import { Store } from './core.js';

export class GasStore extends Store {
  constructor(url, secret, fetcher = fetch) {
    super(null);
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url || '')) throw new Error('GAS_STATE_URLにGASのウェブアプリURL（/exec）を設定してください');
    if (!secret || secret.length < 32) throw new Error('GAS_STATE_SECRETにGASで生成した共有キーを設定してください');
    this.url = url;
    this.secret = secret;
    this.fetcher = fetcher;
    this.revision = 0;
  }
  async request(action, data = {}) {
    const payload = JSON.stringify({ action, ...data, time: Date.now(), nonce: randomUUID() });
    const signature = createHmac('sha256', this.secret).update(payload).digest('hex');
    const response = await this.fetcher(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, signature }), redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Google保存先へ接続できません: HTTP ' + response.status);
    let result;
    try { result = await response.json(); } catch { throw new Error('GASの公開設定を確認してください（実行ユーザー: 自分、アクセス: 全員）'); }
    if (!result.ok) throw new Error('Google保存先: ' + (result.error || 'unknown'));
    return result;
  }
  async load() {
    const result = await this.request('load');
    this.value = result.state || { events: {}, bookmarks: {} };
    if (!this.value.events || !this.value.bookmarks || !Number.isInteger(result.revision)) throw new Error('Google保存先のデータ形式が不正です');
    this.revision = result.revision;
    this.saved = this.durable();
    return this;
  }
  durable() {
    // 再配送除けの短期イベントIDだけの変更ではSheetsへの書き込みをしない。
    return JSON.stringify({ ...this.value, events: {} });
  }
  async save() {
    const serialized = this.durable();
    if (serialized === this.saved) return;
    const result = await this.request('save', { revision: this.revision, state: JSON.parse(serialized) });
    if (!Number.isInteger(result.revision) || result.revision !== this.revision + 1) throw new Error('Google保存先の更新番号が不正です');
    this.revision = result.revision;
    this.saved = serialized;
  }
}
