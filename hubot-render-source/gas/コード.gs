// このファイルをGoogle Apps Scriptの「コード.gs」に貼り付けます。
// 1. setupStorage を一度実行 → 権限を許可
// 2. プロジェクト設定 → スクリプトプロパティのSTATE_SECRETをRenderに設定
// 3. ウェブアプリとしてデプロイ（自分として実行・全員アクセス）
// 4. RenderのURLをスクリプトプロパティRENDER_URLに設定
// 5. installKeepAlive を実行（5分おきのアクセスを登録）

function setupStorage() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('STATE_SECRET')) props.setProperty('STATE_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('STATE_SHEET_ID')) {
    const book = SpreadsheetApp.create('Hubot 保存データ');
    book.getSheets()[0].setName('state0');
    book.insertSheet('state1');
    props.setProperty('STATE_SHEET_ID', book.getId());
  }
  console.log('準備完了。プロジェクト設定のスクリプトプロパティを確認してください。');
}

function doGet() { return json_({ ok: true, service: 'hubot-storage' }); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  let lock;
  try {
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('STATE_SECRET');
    if (!secret || !e || !e.postData || e.postData.contents.length > 2500000) return json_({ ok: false, error: 'unauthorized' });
    const envelope = JSON.parse(e.postData.contents);
    if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') return json_({ ok: false, error: 'unauthorized' });
    const signed = Utilities.computeHmacSha256Signature(envelope.payload, secret, Utilities.Charset.UTF_8).map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
    if (!same_(signed, envelope.signature)) return json_({ ok: false, error: 'unauthorized' });
    const request = JSON.parse(envelope.payload);
    if (!Number.isFinite(request.time) || Math.abs(Date.now() - request.time) > 300000 || !/^[a-f0-9-]{36}$/.test(request.nonce || '')) return json_({ ok: false, error: 'expired' });
    lock = LockService.getScriptLock();
    lock.waitLock(15000);
    const cache = CacheService.getScriptCache();
    if (cache.get(request.nonce)) return json_({ ok: false, error: 'replay' });
    cache.put(request.nonce, '1', 600);
    const book = SpreadsheetApp.openById(props.getProperty('STATE_SHEET_ID'));
    const meta = JSON.parse(props.getProperty('STATE_META') || '{"revision":0,"slot":0}');
    if (request.action === 'load') {
      const sheet = book.getSheetByName('state' + meta.slot);
      const content = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(row => meta.encoded ? JSON.parse(row[0])[0] : row[0]).join('') : '';
      return json_({ ok: true, revision: meta.revision, state: content ? JSON.parse(content) : { events: {}, bookmarks: {} } });
    }
    if (request.action !== 'save') return json_({ ok: false, error: 'unknown_action' });
    if (request.revision !== meta.revision) return json_({ ok: false, error: 'conflict: 別プロセスが更新しました。PC側を停止し、Renderを再起動してください' });
    const state = request.state;
    if (!state || !state.events || !state.bookmarks || Array.isArray(state.events) || Array.isArray(state.bookmarks)) return json_({ ok: false, error: 'invalid_state' });
    const content = JSON.stringify(state);
    if (content.length > 2000000) return json_({ ok: false, error: 'state_too_large' });
    const slot = meta.slot === 0 ? 1 : 0;
    const target = book.getSheetByName('state' + slot);
    const rows = [];
    // 各チャンクを[で始めるJSON文字列にして、セル先頭の=などを数式扱いさせない。
    for (let i = 0; i < content.length; i += 18000) rows.push([JSON.stringify([content.slice(i, i + 18000)])]);
    target.clearContents();
    target.getRange(1, 1, rows.length, 1).setValues(rows);
    SpreadsheetApp.flush();
    // 一時シートを完全に書いてからポインターを切り替える。
    // 読み込み用にはエンコード済みチャンクを復元する。
    props.setProperty('STATE_META', JSON.stringify({ revision: meta.revision + 1, slot: slot, encoded: true }));
    return json_({ ok: true, revision: meta.revision + 1 });
  } catch (error) {
    console.error('保存処理に失敗しました。Google側の権限・実行履歴を確認してください。');
    return json_({ ok: false, error: 'storage_error' });
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
function same_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function keepAlive() {
  const url = PropertiesService.getScriptProperties().getProperty('RENDER_URL');
  if (!/^https:\/\/[a-z0-9-]+\.onrender\.com\/?$/.test(url || '')) throw new Error('スクリプトプロパティRENDER_URLにRenderのURLを設定してください');
  const result = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/healthz', { muteHttpExceptions: true, followRedirects: true });
  if (result.getResponseCode() !== 200) throw new Error('Hubotは接続準備中、または接続が切れています。Renderログを確認してください。');
}
function installKeepAlive() {
  const url = PropertiesService.getScriptProperties().getProperty('RENDER_URL');
  if (!/^https:\/\/[a-z0-9-]+\.onrender\.com\/?$/.test(url || '')) throw new Error('先にRENDER_URLを設定してください');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'keepAlive').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('keepAlive').timeBased().everyMinutes(5).create();
  console.log('5分おきの定期アクセスを設定しました。');
}
function stopKeepAlive() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'keepAlive').forEach(t => ScriptApp.deleteTrigger(t));
}
