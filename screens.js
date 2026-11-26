'use strict';

const exportForm = $('exportForm');
const selectedCards = new Set();
const downloadURLs = new Map();
let exportRevision = 0;

function clearResult(id) {
 if (id === 'exportResult') exportRevision++;
 for (const url of downloadURLs.get(id) || []) URL.revokeObjectURL(url);
 downloadURLs.delete(id);
 $(id).replaceChildren();
}

function showFiles(id, files, title) {
 clearResult(id);
 const result = $(id);
 result.append(node('p', files.length + '件のファイルを作成しました。'));
 if (navigator.canShare?.({files})) {
  const share = node('button', 'メールなどで共有');
  share.type = 'button';
  share.className = 'primary';
  share.onclick = async () => {
   try {
    await navigator.share({files, title});
   } catch (error) {
    if (error.name !== 'AbortError') message('共有できませんでした。ファイルを保存してから添付してください。');
   }
  };
  result.append(share);
 } else if (id === 'exportResult') {
  result.append(node('p', '下のリンクから保存し、メールなどに添付できます。'));
 }
 const urls = [];
 for (const file of files) {
  const url = URL.createObjectURL(file);
  const link = node('a', file.name + ' を保存');
  link.href = url;
  link.download = file.name;
  const line = node('div', '');
  line.append(link);
  result.append(line);
  urls.push(url);
 }
 downloadURLs.set(id, urls);
}

async function busy(form, task, errorMessage) {
 const buttons = Array.from(form.querySelectorAll('button'));
 for (const button of buttons) button.disabled = true;
 try {
  await task();
 } catch {
  message(errorMessage);
 } finally {
  for (const button of buttons) button.disabled = false;
 }
}

function enterLocked(lock) {
 appLock = lock;
 appKey = null;
 rows = [];
 draft = null;
 form.reset();
 $('preview').removeAttribute('src');
 $('actions').replaceChildren();
 $('query').value = '';
 $('list').replaceChildren();
 $('exportList').replaceChildren();
 selectedCards.clear();
 $('exportForm').reset();
 $('backupForm').reset();
 $('restoreForm').reset();
 $('passwordForm').reset();
 $('unlockForm').reset();
 clearResult('exportResult');
 clearResult('backupResult');
 show('locked');
}

async function start() {
 try {
  await storage.open();
  const state = await storage.read();
  if (state.lock) {
   enterLocked(state.lock);
  } else {
   rows = state.entries;
   home();
  }
 } catch {
  message('端末内の保存領域を開けませんでした。');
 }
}

$('unlockForm').onsubmit = event => {
 event.preventDefault();
 busy(event.currentTarget, async () => {
  const state = await storage.read();
  if (state.lock) {
   const key = await storage.unlock(state.lock, $('unlockPassword').value);
   rows = await storage.unpack(state.entries, key);
   appKey = key;
  } else {
   rows = state.entries;
  }
  appLock = state.lock;
  $('unlockForm').reset();
  home();
  message('');
 }, 'パスワードを確認してください。データを開けませんでした。');
};

function drawSettings() {
 $('lockState').textContent = appLock ? '起動時にパスワードを求めます。' : '起動ロックはオフです。';
 $('setLock').textContent = appLock ? '起動パスワードを変更' : '起動ロックを有効にする';
 $('lockActions').hidden = !appLock;
}

$('settingsTab').onclick = () => {
 $('passwordForm').reset();
 $('backupForm').reset();
 $('restoreForm').reset();
 drawSettings();
 show('settings');
 message('');
};

async function changeLock(password) {
 const state = await storage.read();
 if (state.lock?.id !== appLock?.id) throw new Error();
 const next = password ? await storage.makeLock(password) : {key: null, lock: null};
 const cards = await storage.unpack(state.entries, appKey);
 const entries = [];
 for (const card of cards) entries.push(await storage.pack(card, next.key));
 await storage.write(appLock, store => {
  store.clear();
  for (const entry of entries) store.put(entry);
 }, {revision: state.revision, lock: next.lock});
 appKey = next.key;
 appLock = next.lock;
 rows = cards;
 drawSettings();
}

let changingLock = false;
async function updateLock(password) {
 if (changingLock) return;
 changingLock = true;
 const buttons = [...$('passwordForm').querySelectorAll('button'), ...$('lockActions').querySelectorAll('button')];
 for (const button of buttons) button.disabled = true;
 try {
  await changeLock(password);
  $('passwordForm').reset();
  message(password ? '起動ロックを設定しました。' : '起動ロックを解除しました。');
 } catch {
  message('ロック設定を変更できませんでした。アプリを開き直してお試しください。');
 } finally {
  for (const button of buttons) button.disabled = false;
  changingLock = false;
 }
}

$('passwordForm').onsubmit = event => {
 event.preventDefault();
 const password = $('newPassword').value;
 if (password !== $('confirmPassword').value) {
  message('確認用のパスワードが一致していません。');
  return;
 }
 updateLock(password);
};
$('disableLock').onclick = () => {
 if (confirm('起動ロックを解除し、端末内の名刺を暗号化なしで保存しますか？')) updateLock(null);
};
$('lockNow').onclick = () => {
 enterLocked(appLock);
 message('');
};

$('backupForm').onsubmit = event => {
 event.preventDefault();
 const password = $('backupPassword').value;
 if (password !== $('backupConfirm').value) {
  message('確認用のパスワードが一致していません。');
  return;
 }
 clearResult('backupResult');
 busy(event.currentTarget, async () => {
  const cards = await readCards();
  const lockId = appLock?.id;
  const payload = await storage.backup({format: 'meishi-1', cards}, password);
  if (!$('locked').hidden || lockId !== appLock?.id) return;
  const name = 'meishi-backup-' + localDate(new Date()) + '.json';
  showFiles('backupResult', [new File([JSON.stringify(payload)], name, {type: 'application/json'})], '名刺手帖のバックアップ');
  $('backupForm').reset();
  message('暗号化したバックアップを作成しました。');
 }, 'バックアップを作成できませんでした。');
};

function validatedCards(payload) {
 if (payload?.format !== 'meishi-1' || !Array.isArray(payload.cards)) throw new Error();
 return payload.cards.map(card => {
  if (!card || typeof card.id !== 'string' || !card.id || !Number.isFinite(card.created) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(card.date) || typeof card.image !== 'string' ||
      (card.image && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/u.test(card.image)) ||
      !keys.every(key => typeof card[key] === 'string') ||
      nameKeys.some(key => key in card && typeof card[key] !== 'string')) throw new Error();
  return {id: card.id, created: card.created, image: card.image,
   ...Object.fromEntries(keys.map(key => [key, card[key]])),
   ...Object.fromEntries(nameKeys.filter(key => key in card).map(key => [key, card[key]]))};
 });
}

$('restoreForm').onsubmit = event => {
 event.preventDefault();
 const file = $('restore').files[0];
 const password = $('restorePassword').value;
 const lock = appLock;
 const key = appKey;
 busy(event.currentTarget, async () => {
  let parsed = JSON.parse(await file.text());
  if (parsed?.format === 'meishi-backup-1') parsed = await storage.restore(parsed, password);
  const cards = validatedCards(parsed);
  if (!$('locked').hidden || lock?.id !== appLock?.id) return;
  if (!confirm(cards.length + '枚を復元しますか？ 同じIDの名刺はバックアップの内容で更新されます。')) return;
  const entries = [];
  for (const card of cards) entries.push(await storage.pack(card, key));
  if (!$('locked').hidden || lock?.id !== appLock?.id) return;
  await storage.write(lock, store => {
   for (const entry of entries) store.put(entry);
  });
  await refresh();
  $('restoreForm').reset();
  message('復元しました。');
 }, '復元できませんでした。ファイルとパスワードをご確認ください。');
};

function updateSelection() {
 $('exportCount').textContent = selectedCards.size + '枚選択中';
 $('prepareExport').disabled = !selectedCards.size;
 clearResult('exportResult');
}

function renderSelection() {
 const list = $('exportList');
 list.replaceChildren();
 if (!rows.length) list.append(node('p', '登録された名刺がありません。'));
 const ordered = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
 for (const card of ordered) {
  const label = node('label', '');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = selectedCards.has(card.id);
  input.onchange = () => {
   if (input.checked) selectedCards.add(card.id);
   else selectedCards.delete(card.id);
   updateSelection();
  };
  label.append(input, node('span', [card.person || '氏名未入力', card.company, card.date].filter(Boolean).join(' · ')));
  list.append(label);
 }
 updateSelection();
}

function exportOptions() {
 return {
  format: $('exportFormat').value,
  note: $('exportNote').value.trim(),
  katakana: exportForm.elements.namedItem('katakanaWidth').value,
  latin: exportForm.elements.namedItem('latinWidth').value,
  date: localDate(new Date()),
 };
}

function updateWidth() {
 const {format, katakana, latin} = exportOptions();
 $('widthSettings').hidden = format !== 'csv';
 $('widthExample').textContent = '変換例　' + output.width('カタカナ ガイド / ABC', katakana, latin);
 clearResult('exportResult');
}

function showExports(id) {
 selectedCards.clear();
 if (id) selectedCards.add(id);
 else for (const card of rows) selectedCards.add(card.id);
 exportForm.reset();
 show('exports');
 renderSelection();
 updateWidth();
 message('');
}

$('share').onclick = () => showExports();
$('shareCard').onclick = () => showExports(draft.id);
$('exportContact').onclick = () => {
 const file = output.contactFile(draft);
 if (!file) {
  message('氏名や電話番号などを入力して保存すると、アドレスファイルを出力できます。');
  return;
 }
 const url = URL.createObjectURL(file);
 const link = node('a', '');
 link.href = url;
 link.download = file.name;
 document.body.append(link);
 link.click();
 link.remove();
 setTimeout(() => URL.revokeObjectURL(url), 30000);
 message('アドレスファイル（.vcf）を出力しました。');
};
$('selectAll').onclick = () => {
 for (const card of rows) selectedCards.add(card.id);
 renderSelection();
};
$('selectNone').onclick = () => {
 selectedCards.clear();
 renderSelection();
};
$('exportFields').oninput = updateWidth;
let preparing = false;
exportForm.onsubmit = async event => {
 event.preventDefault();
 if (preparing || !selectedCards.size) return;
 const cards = rows.filter(card => selectedCards.has(card.id));
 const options = exportOptions();
 clearResult('exportResult');
 const revision = exportRevision;
 preparing = true;
 $('exportFields').disabled = true;
 try {
  const files = await output.createFiles(cards, options);
  if (!$('exports').hidden && exportRevision === revision) showFiles('exportResult', files, '名刺情報');
 } catch {
  message('ファイルを作成できませんでした。選択した名刺をご確認ください。');
 } finally {
  preparing = false;
  $('exportFields').disabled = false;
 }
};

start();
