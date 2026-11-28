'use strict';

const visitSync = (() => {
 const scope = location.pathname.replace(/index\.html$/, '');
 const settingsKey = 'meishi:' + scope + ':visit-sync-settings';
 const panel = $('visitSync');
 const status = $('visitSyncStatus');
 const conflictList = $('visitSyncConflicts');
 const resolution = $('visitSyncConflict');
 const settingsForm = $('visitSyncForm');
 const urlInput = $('visitSyncUrl');
 const keyInput = $('visitSyncKey');
 const login = $('visitSyncLogin');
 const logout = $('visitSyncLogout');
 const synchronize = $('visitSyncNow');
 const synchronizeCards = $('cardSyncNow');
 let connection;
 let sdk;
 let busy = false;
 let conflictContext;

 function readSaved(key) {
  try {return JSON.parse(localStorage.getItem(key) || 'null')} catch {return null}
 }

 function configuration(url, key) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/u.test(url) || !/^sb_publishable_[\w-]+$/u.test(key)) return null;
  return {url:new URL(url).origin,key};
 }

 function setBusy(value) {
  busy = value;
  for (const field of panel.querySelectorAll('input,button,select')) field.disabled = busy;
  setEditorBusy(busy);
 }

 function loadSdk() {
  if (sdk) return sdk;
  sdk = new Promise((resolve,reject) => {
   const script = document.createElement('script');
   script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2';
   script.crossOrigin = 'anonymous';
   script.onload = () => {
    if (typeof window.supabase?.createClient === 'function') resolve(window.supabase);
    else reject(new Error('同期用ライブラリを読み込めませんでした。'));
   };
   script.onerror = () => {
    script.remove();
    reject(new Error('同期用ライブラリに接続できませんでした。'));
   };
   document.head.append(script);
  }).catch(error => {
   sdk = null;
   throw error;
  });
  return sdk;
 }

 async function client() {
  const saved = readSaved(settingsKey);
  const settings = configuration(saved?.url || '',saved?.key || '');
  if (!settings) throw new Error('プロジェクトURLと公開用キーを保存してください。');
  if (connection?.key === settings.key && connection.url === settings.url) return connection;
  const library = await loadSdk();
  if (connection) await connection.api.auth.stopAutoRefresh();
  const api = library.createClient(settings.url,settings.key,{auth:{flowType:'pkce'}});
  connection = {...settings,api};
  return connection;
 }

 async function run(operation) {
  if (busy || currentScreen === 'locked') return;
  setBusy(true);
  status.textContent = '';
  try {
   await operation();
  } catch (error) {
   const detail = error?.message || '不明なエラー';
   status.textContent = '同期操作を完了できませんでした。' + detail;
  } finally {
   setBusy(false);
  }
 }

 function showConflicts(conflicts, context) {
  conflictContext = conflicts.length ? context : undefined;
  conflictList.replaceChildren(...conflicts.map(record => node('li',
   [record.date,record.time,record.company,record.person].filter(Boolean).join(' '))));
  conflictList.hidden = $('visitSyncResolution').hidden = !conflicts.length;
  resolution.value = '';
 }

 function planMerge(local, remote, baseline, choice = '') {
  const pushes = [], pulls = [], conflicts = [];
  const next = new Map(baseline);
  for (const [id, current] of remote) {
   const device = local.get(id);
   const previous = baseline.get(id);
   if (!device) {
    if (!previous) pulls.push(current.record);
    next.set(id,current.signature);
   } else if (device.signature === current.signature) {
    next.set(id,current.signature);
   } else if (current.signature === previous || (device.signature !== previous && choice === 'local')) {
    pushes.push({record:device.record,revision:current.revision});
    next.set(id,device.signature);
   } else if (device.signature === previous || choice === 'cloud') {
    pulls.push(current.record);
    next.set(id,current.signature);
   } else {
    conflicts.push(device.record);
   }
  }
  for (const [id, device] of local) {
   if (remote.has(id)) continue;
   pushes.push({record:device.record,revision:''});
   next.set(id,device.signature);
  }
  return {pushes,pulls,conflicts,next};
 }

 function cardFields(record) {
  const {image,...fields} = validatedCards({format:'meishi-1',cards:[{...record,image:''}]})[0];
  return {...fields,familyName:fields.familyName || '',givenName:fields.givenName || ''};
 }

 async function signed(record, isCard) {
  const canonical = isCard ? cardFields(record) : visitApp.validateBackup([record])[0];
  const {version,...content} = canonical;
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(content)));
  const signature = Array.from(new Uint8Array(bytes),value => value.toString(16).padStart(2,'0')).join('');
  return {record:canonical,signature};
 }

 async function readRemote(api, owner, tableName, isCard) {
  const remote = new Map();
  const pageSize = 100;
  let cursor = '';
  while (true) {
   let request = api.from(tableName).select('id,revision,record').eq('owner_id',owner).order('id').limit(pageSize);
   if (cursor) request = request.gt('id',cursor);
   const {data,error} = await request;
   if (isCard && (error?.code === 'PGRST205' || error?.code === '42P01')) {
    throw new Error('Supabaseで名刺用の初期設定SQL（card-sync.sql）を実行してください。');
   }
   if (error) throw error;
   if (!data.length) return remote;
   for (const row of data) {
    if (row.id !== row.record?.id) throw new Error('クラウド側の記録IDが一致しません。');
    remote.set(row.id,{...await signed(row.record,isCard),revision:row.revision});
   }
   cursor = data.at(-1).id;
   if (data.length < pageSize) return remote;
  }
 }

 async function saveRemote(api, owner, tableName, changes) {
  const additions = changes.filter(change => !change.revision);
  for (let index = 0; index < additions.length; index += 50) {
   const rows = additions.slice(index,index+50).map(({record}) => ({owner_id:owner,id:record.id,record}));
   const {error} = await api.from(tableName).insert(rows);
   if (error) throw error;
  }
  for (const {record,revision} of changes.filter(change => change.revision)) {
   const {data,error} = await api.from(tableName).update({record,revision:crypto.randomUUID()})
    .eq('owner_id',owner).eq('id',record.id).eq('revision',revision).select('id');
   if (error) throw error;
   if (data.length !== 1) throw new Error('別の端末で更新されました。もう一度同期してください。');
  }
 }

 async function sync(isCard = false) {
  const label = isCard ? '名刺の文字情報' : '訪問記録';
  const kind = isCard ? 'card' : 'visit';
  const historyKey = 'meishi:' + scope + ':' + kind + '-sync-history';
  const tableName = isCard ? 'meishi_cards' : 'meishi_visits';
  const {api,url} = await client();
  const {data,error} = await api.auth.getUser();
  if (error || !data?.user) throw new Error('Googleでログインしてください。');
  const user = data.user;
  const syncId = url + ':' + user.id;
  const context = kind + ':' + syncId;
  const history = readSaved(historyKey);
  if (history?.id !== syncId && !confirm((user.email || 'ログイン中のユーザー') +
       'のSupabaseへ、この端末の' + label + 'を同期しますか？')) return;
  const lock = appLock, key = appKey;
  const state = await storage.read(isCard);
  if (state.lock?.id !== lock?.id) {
   enterLocked(state.lock);
   return;
  }
  const baseline = new Map(history?.id === syncId ? history.records : []);
  const records = await storage.unpack(isCard ? state.entries : state.visits,key,kind);
  const remote = await readRemote(api,user.id,tableName,isCard);
  const eligible = isCard ? records.filter(record => remote.has(record.id) || baseline.has(record.id) ||
   editorKeys.some(key => key !== 'date' && record[key]?.trim())) : records;
  const local = new Map(await Promise.all(eligible.map(async record => [record.id,await signed(record,isCard)])));
  const choice = conflictContext === context ? resolution.value : '';
  const pending = planMerge(local,remote,baseline);
  if (choice && pending.conflicts.length && !confirm('競合 ' + pending.conflicts.length + '件に、選んだ側の内容を反映しますか？')) {
   return;
  }
  const changes = choice ? planMerge(local,remote,baseline,choice) : pending;
  const latest = await storage.read(false);
  if (latest.revision !== state.revision) throw new Error('別の画面で端末の記録が更新されました。もう一度同期してください。');
  await saveRemote(api,user.id,tableName,changes.pushes);
  if (changes.pulls.length) {
   const found = new Map(records.map(record => [record.id,record]));
   const packed = await Promise.all(changes.pulls.map(record => {
    const previous = found.get(record.id);
    const next = isCard ? {...previous,...record,image:previous?.image || ''} :
     {...record,version:record.version === previous?.version ? crypto.randomUUID() : record.version};
    return storage.pack(next,key,kind);
   }));
   await storage.write(lock,(cards,visits) => {
    const store = isCard ? cards : visits;
    for (const value of packed) store.put(value);
   }, {revision:state.revision,lock});
   if (isCard) {
    const updatedIds = new Set(changes.pulls.map(record => record.id));
    for (let index = pageHistory.length-1; index >= 0; index--) {
     if (updatedIds.has(pageHistory[index].draft?.id)) pageHistory.splice(index,1);
    }
    await refresh();
   } else await visitApp.refresh();
  }
  localStorage.setItem(historyKey,JSON.stringify({id:syncId,records:[...changes.next]}));
  showConflicts(changes.conflicts,context);
  status.textContent = label + '：送信 ' + changes.pushes.length + '件 · 受信 ' + changes.pulls.length +
   '件 · 競合を保留 ' + changes.conflicts.length + '件';
 }

 if (panel) {
  const saved = readSaved(settingsKey);
  urlInput.value = saved?.url || '';
  keyInput.value = saved?.key || '';
  settingsForm.onsubmit = event => {
   event.preventDefault();
   const settings = configuration(urlInput.value.trim(),keyInput.value.trim());
   if (!settings) {
    status.textContent = 'SupabaseのプロジェクトURLと sb_publishable_ で始まる公開用キーを入力してください。';
    return;
   }
   localStorage.setItem(settingsKey,JSON.stringify(settings));
   showConflicts([]);
   status.textContent = '接続設定を保存しました。Googleでログインしてください。';
  };
  login.onclick = () => run(async () => {
   const {api} = await client();
   const redirectTo = new URL(scope,location.origin).href;
   const {error} = await api.auth.signInWithOAuth({provider:'google',options:{redirectTo}});
   if (error) throw error;
  });
  logout.onclick = () => run(async () => {
   const {api} = await client();
   const {error} = await api.auth.signOut({scope:'local'});
   if (error) throw error;
   showConflicts([]);
   status.textContent = 'ログアウトしました。';
  });
  synchronize.onclick = () => run(sync);
  synchronizeCards.onclick = () => run(() => sync(true));
  if (saved && new URLSearchParams(location.search).has('code')) {
   status.textContent = 'Googleログインを確認しています。';
   client().then(async ({api}) => {
    const {data,error} = await api.auth.getSession();
    status.textContent = error || !data.session ? 'ログインを確認できませんでした。もう一度お試しください。' :
     'ログインしました。同期する項目のボタンを押してください。';
   }).catch(error => {status.textContent = error.message});
  }
 }

 return {planMerge,clear() {showConflicts([]); status.textContent = ''}};
})();
