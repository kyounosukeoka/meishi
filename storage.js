'use strict';

const storage = (() => {
 const encoder = new TextEncoder();
 const decoder = new TextDecoder();
 const random = size => crypto.getRandomValues(new Uint8Array(size));
 const rounds = 600000;
 let db;

 function open() {
  return new Promise((resolve, reject) => {
   const scope = location.pathname.replace(/index\.html$/, '');
   const request = indexedDB.open('meishi-techo:' + scope, 2);
   request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('cards')) {
     database.createObjectStore('cards', {keyPath: 'id'});
    }
    database.createObjectStore('preferences');
   };
   request.onblocked = () => {
    message('開いている名刺手帖の画面をすべて閉じてから、この画面を開き直してください。');
   };
   request.onerror = () => reject(request.error);
   request.onsuccess = () => {
    db = request.result;
    db.onversionchange = () => db.close();
    resolve();
   };
  });
 }

 function read() {
  return new Promise((resolve, reject) => {
   const transaction = db.transaction(['cards', 'preferences']);
   const cards = transaction.objectStore('cards').getAll();
   const prefs = transaction.objectStore('preferences').get('current');
   transaction.oncomplete = () => resolve({
    entries: cards.result,
    lock: prefs.result?.lock || null,
    revision: prefs.result?.revision || 0,
   });
   transaction.onabort = () => reject(transaction.error);
  });
 }

 function write(lock, action, replacement) {
  return new Promise((resolve, reject) => {
   const transaction = db.transaction(['cards', 'preferences'], 'readwrite');
   const prefs = transaction.objectStore('preferences');
   const cards = transaction.objectStore('cards');
   let conflict = false;
   transaction.oncomplete = resolve;
   transaction.onabort = () => reject(conflict
    ? new Error('別の画面でデータが更新されました。アプリを開き直してください。')
    : transaction.error);
   const request = prefs.get('current');
   request.onsuccess = () => {
    const current = request.result || {lock: null, revision: 0};
    if (current.lock?.id !== lock?.id || (replacement && current.revision !== replacement.revision)) {
     conflict = true;
     transaction.abort();
     return;
    }
    action(cards);
    prefs.put({
     lock: replacement ? replacement.lock : current.lock,
     revision: current.revision + 1,
    }, 'current');
   };
  });
 }

 async function derive(password, salt) {
  const raw = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
   {name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256'},
   raw, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']
  );
 }

 async function seal(key, payload, context) {
  const iv = random(12);
  const bytes = encoder.encode(JSON.stringify(payload));
  const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(context)}, key, bytes);
  return {iv, data};
 }

 async function unseal(key, payload, context) {
  const bytes = await crypto.subtle.decrypt(
   {name: 'AES-GCM', iv: payload.iv, additionalData: encoder.encode(context)}, key, payload.data
  );
  return JSON.parse(decoder.decode(bytes));
 }

 async function makeLock(password) {
  const salt = random(16);
  const key = await derive(password, salt);
  const id = crypto.randomUUID();
  const check = await seal(key, 'meishi-lock', id);
  return {key, lock: {id, salt, check}};
 }

 async function unlock(lock, password) {
  const key = await derive(password, lock.salt);
  if (await unseal(key, lock.check, lock.id) !== 'meishi-lock') throw new Error();
  return key;
 }

 async function pack(card, key) {
  if (!key) return card;
  return {id: card.id, sealed: await seal(key, card, 'card:' + card.id)};
 }

 async function unpack(entries, key) {
  if (!key) return entries;
  const cards = [];
  for (const entry of entries) {
   cards.push(await unseal(key, entry.sealed, 'card:' + entry.id));
  }
  return cards;
 }

 function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 16384) {
   chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  }
  return btoa(chunks.join(''));
 }

 function fromBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
 }

 async function backup(payload, password) {
  const salt = random(16);
  const key = await derive(password, salt);
  const sealed = await seal(key, payload, 'meishi-backup-1');
  return {
   format: 'meishi-backup-1',
   salt: toBase64(salt),
   iv: toBase64(sealed.iv),
   data: toBase64(sealed.data),
  };
 }

 async function restore(payload, password) {
  if (typeof payload.salt !== 'string' || typeof payload.iv !== 'string' || typeof payload.data !== 'string') {
   throw new Error();
  }
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error();
  const key = await derive(password, salt);
  return unseal(key, {iv, data: fromBase64(payload.data)}, 'meishi-backup-1');
 }

 return {open, read, write, makeLock, unlock, pack, unpack, backup, restore};
})();
