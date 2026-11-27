'use strict';

const visitApp = (() => {
 const planForm = $('visitPlanForm');
 const afterForm = $('visitAfterForm');
 const planKeys = ['date', 'time', 'company', 'person', 'place', 'purpose'];
 const afterKeys = ['note', 'followUpDate', 'followUpTask'];
 const dateFormat = /^\d{4}-\d{2}-\d{2}$/u;
 const timeFormat = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
 const displayTime = new Intl.DateTimeFormat('ja-JP', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
 let visits = [];
 let day = '';
 let lastToday = '';
 let activeId = '';
 let planId = '';
 let planVersion = '';
 let afterVersion = '';
 let linkedIds = new Set();
 let busy = false;
 let session = 0;
 let timer;
 let writeQueue = Promise.resolve();
 const locating = new Set();

 const today = () => localDate(new Date());
 const readFields = (form, names) => Object.fromEntries(names.map(key => [key, form.elements.namedItem(key).value.trim()]));
 const fillFields = (form, names, values) => {
  for (const key of names) form.elements.namedItem(key).value = values[key] || '';
 };
 const scheduledAt = visit => new Date(visit.date + 'T' + visit.time).getTime();
 const lookup = id => visits.find(visit => visit.id === id);
 const fold = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
 const showSchedule = visit => visit.date + ' ' + visit.time;

 function visitStage(visit) {
  if (visit.endedAt) return '訪問済み';
  if (visit.startedAt) return '訪問中';
  return '予定';
 }

 function focusVisit(dayVisits, now) {
  const inProgress = dayVisits.find(visit => visit.startedAt && !visit.endedAt);
  if (inProgress) return inProgress;
  const upcoming = dayVisits.filter(visit => !visit.startedAt);
  return upcoming.findLast(visit => scheduledAt(visit) <= now) || upcoming[0];
 }

 function renderHub() {
  const dateNow = today();
  if (!day || day === lastToday) day = dateNow;
  lastToday = dateNow;
  $('visitDay').value = day;
  const daily = visits.filter(visit => visit.date === day).sort((a, b) => a.time.localeCompare(b.time) || a.company.localeCompare(b.company, 'ja'));
  const openVisits = visits.filter(visit => visit.date !== day && visit.startedAt && !visit.endedAt);
  const now = Date.now();
  const featured = day === today() ? focusVisit(daily, now) : null;
  const hero = $('visitHero');
  hero.replaceChildren();
  hero.hidden = !featured;
  if (featured) {
   const status = featured.startedAt ? '訪問中' : scheduledAt(featured) <= now ? '訪問予定時刻になりました' : '次の訪問';
   hero.append(node('p', status + ' · ' + featured.time), node('h3', featured.company),
    node('p', [featured.place, featured.person].filter(Boolean).join(' · ')), node('p', featured.purpose));
   const button = node('button', featured.startedAt ? '訪問記録を開く' : '訪問開始');
   button.type = 'button';
   button.className = 'primary visit-primary';
   button.disabled = busy;
   button.onclick = () => featured.startedAt ? openRecord(featured.id) : startVisit(featured);
   hero.append(button);
  }
  const list = $('visitList');
  list.replaceChildren();
  if (!daily.length) list.append(node('p', day === today() ? '今日の訪問予定はありません。' : 'この日の訪問予定はありません。'));
  if (daily.length) list.append(visitList(daily));
  if (openVisits.length) {
   list.append(node('h3', 'ほかの日の訪問中の記録'), visitList(openVisits, true));
  }
 }

 function visitList(entries, includeDate = false) {
  const list = node('ul', '');
  list.className = 'visit-list';
  for (const visit of entries) {
   const row = node('li', '');
   const button = node('button', '');
   button.type = 'button';
   button.disabled = busy;
   button.append(node('strong', (includeDate ? showSchedule(visit) : visit.time) + '　' + visit.company),
    node('small', visitStage(visit) + (visit.endedAt && visit.followUpDate ? ' · 対応期限 ' + visit.followUpDate : '')));
   if (visit.purpose) button.append(node('small', visit.purpose));
   button.onclick = () => openRecord(visit.id);
   row.append(button);
   list.append(row);
  }
  return list;
 }

 function renderSummary(visit) {
  const summary = $('visitSummary');
  summary.replaceChildren();
  $('visitRecordTitle').textContent = visit.endedAt ? '訪問後の記録' : visit.startedAt ? '訪問中' : '訪問予定';
  summary.append(node('p', '予定　' + showSchedule(visit)), node('h3', visit.company));
  if (visit.person) summary.append(node('p', '担当者　' + visit.person));
  if (visit.place) summary.append(node('p', '訪問場所　' + visit.place));
  summary.append(node('p', '訪問内容　' + visit.purpose));
  if (visit.startedAt) summary.append(node('p', '開始　' + displayTime.format(new Date(visit.startedAt))));
  if (visit.endedAt) summary.append(node('p', '終了　' + displayTime.format(new Date(visit.endedAt))));
  const status = $('visitStatus');
  if (visit.location) {
   status.textContent = '開始時の位置情報を記録済み';
   const link = node('a', '地図で見る');
   link.href = mapSearch + encodeURIComponent(visit.location.latitude + ',' + visit.location.longitude);
   status.append('　', link);
  } else {
   status.textContent = locating.has(visit.id) ? '開始時の位置情報を取得中…' :
    visit.startedAt ? '開始時刻を記録済み · 位置情報なし' : '';
  }
 }

 function updateRecord() {
  const visit = lookup(activeId);
  if (!visit) return;
  renderSummary(visit);
  $('visitRecordingActions').hidden = Boolean(visit.startedAt);
  $('startVisit').hidden = Boolean(visit.startedAt) || visit.date !== today();
  $('endVisit').hidden = !visit.startedAt || Boolean(visit.endedAt);
  for (const id of ['editVisitPlan', 'deleteVisit', 'startVisit', 'endVisit']) $(id).disabled = busy;
  afterForm.querySelector('[type="submit"]').disabled = busy;
  afterForm.hidden = !visit.endedAt;
 }

 function linkedNames() {
  const cards = rows.filter(card => linkedIds.has(card.id));
  const unavailable = linkedIds.size - cards.length;
  const names = cards.map(card => [card.person, card.company].filter(Boolean).join(' · ') || '氏名未入力');
  if (unavailable) names.push('参照できない名刺 ' + unavailable + '件');
  $('visitLinkedNames').textContent = names.length ? names.join('、') : '紐付けた名刺はありません。';
 }

 function renderCardPicker() {
  const list = $('visitCardChoices');
  list.replaceChildren();
  linkedNames();
  const term = fold($('visitCardSearch').value);
  const company = fold(lookup(activeId)?.company);
  function companyMatch(card) {
   return Boolean(company) && fold(card.company) === company;
  }
  const matches = rows.filter(card => !term || fold(card.company).includes(term) || fold(card.person).includes(term))
   .sort((a, b) => Number(linkedIds.has(b.id)) - Number(linkedIds.has(a.id)) ||
    Number(companyMatch(b)) - Number(companyMatch(a)) ||
    (a.company || '').localeCompare(b.company || '', 'ja') || (a.person || '').localeCompare(b.person || '', 'ja'));
  if (!matches.length) list.append(node('p', rows.length ? '該当する名刺はありません。' : '名刺一覧に登録された名刺がありません。'));
  for (const card of matches) {
   const label = node('label', '');
   const input = document.createElement('input');
   input.type = 'checkbox';
   input.checked = linkedIds.has(card.id);
   input.onchange = () => {
    if (input.checked) linkedIds.add(card.id);
    else linkedIds.delete(card.id);
    linkedNames();
   };
   label.append(input, node('span', [card.person || '氏名未入力', card.company].filter(Boolean).join(' · ')));
   list.append(label);
  }
 }

 function openRecord(id) {
  const visit = lookup(id);
  if (!visit || busy) return;
  show('visitRecord');
  activeId = id;
  afterVersion = visit.version;
  fillFields(afterForm, afterKeys, visit);
  linkedIds = new Set(visit.cardIds);
  $('visitCardSearch').value = '';
  $('visitCardPicker').open = false;
  updateRecord();
  renderCardPicker();
  message('');
 }

 function openPlan(visit) {
  if (busy) return;
  show('visitPlan');
  planId = visit?.id || '';
  planVersion = visit?.version || '';
  $('visitPlanTitle').textContent = visit ? '訪問予定を編集' : '訪問予定を登録';
  fillFields(planForm, planKeys, visit || {date: day});
  message('');
 }

 async function refresh() {
  const currentSession = session;
  const key = appKey;
  const lock = appLock;
  const state = await storage.read(false);
  if (currentSession !== session || lock?.id !== appLock?.id) return;
  if (state.lock?.id !== lock?.id) {
   enterLocked(state.lock);
   return;
  }
  const latest = await storage.unpack(state.visits, key, 'visit');
  if (currentSession !== session || lock?.id !== appLock?.id) return;
  visits = latest;
  if (currentScreen === 'visits') renderHub();
 }

 function updateVisit(id, expectedVersion, transform, updateVersion = true) {
  const currentSession = session;
  const operation = async () => {
   if (currentSession !== session || currentScreen === 'locked') return false;
   const lock = appLock;
   const key = appKey;
   const state = await storage.read(false);
   if (currentSession !== session || lock?.id !== appLock?.id) return false;
   if (state.lock?.id !== lock?.id) {
    enterLocked(state.lock);
    throw new Error('ロック設定が更新されました。');
   }
   const entry = state.visits.find(item => item.id === id);
   const [old] = await storage.unpack(entry ? [entry] : [], key, 'visit');
   if (expectedVersion && old?.version !== expectedVersion) {
    throw new Error('別の画面で訪問記録が更新されました。訪問一覧を開き直してください。');
   }
   const next = transform(old);
   if (next === undefined) return false;
   const visit = next && {...next, id, version: updateVersion ? crypto.randomUUID() : old.version};
   const packed = visit && await storage.pack(visit, key, 'visit');
   if (currentSession !== session || lock?.id !== appLock?.id) return false;
   await storage.write(lock, (_, store) => {
    if (packed) store.put(packed);
    else store.delete(id);
   }, {revision: state.revision, lock: state.lock});
   if (currentSession !== session || lock?.id !== appLock?.id) return false;
   visits = visits.filter(item => item.id !== id);
   if (visit) visits.push(visit);
   return true;
  };
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
 }

 function rerenderActions() {
  updateNavigation();
  planForm.querySelector('[type="submit"]').disabled = busy;
  $('addVisit').disabled = busy;
  if (currentScreen === 'visits') renderHub();
  if (currentScreen === 'visitRecord') updateRecord();
 }

 async function runAction(action) {
  if (busy) return false;
  busy = true;
  rerenderActions();
  message('');
  try {
   return await action();
  } catch (error) {
   message(error?.message || '訪問記録を保存できませんでした。');
   return false;
  } finally {
   busy = false;
   rerenderActions();
  }
 }

 function currentLocation() {
  return new Promise(resolve => {
   if (!navigator.geolocation) return resolve(null);
   try {
    navigator.geolocation.getCurrentPosition(position => {
     const {latitude, longitude, accuracy} = position.coords;
     resolve({latitude, longitude, accuracy, timestamp: new Date(position.timestamp).toISOString()});
    }, () => resolve(null), {timeout: 8000, maximumAge: 0, enableHighAccuracy: true});
   } catch {
    resolve(null);
   }
  });
 }

 async function startVisit(visit) {
  if (!visit || busy || visit.startedAt || visit.date !== today()) return;
  const startedAt = new Date().toISOString();
  locating.add(visit.id);
  const locationRequest = currentLocation();
  const saved = await runAction(() => updateVisit(visit.id, visit.version, old =>
   old && !old.startedAt ? {...old, startedAt, location: null} : undefined));
  if (!saved) {
   locating.delete(visit.id);
   return;
  }
  openRecord(visit.id);
  const location = await locationRequest;
  locating.delete(visit.id);
  if (location) {
   try {
    await updateVisit(visit.id, null, old => old?.startedAt === startedAt ? {...old, location} : undefined, false);
   } catch {
    // A timestamp already exists even when recording the position fails.
   }
  }
  if (currentScreen === 'visitRecord' && activeId === visit.id) updateRecord();
 }

 $('visitsTab').onclick = () => {
  day ||= today();
  show('visits');
  message('');
  refresh().catch(() => message('訪問記録を読み込めませんでした。'));
 };
 $('todayVisits').onclick = () => {
  day = today();
  renderHub();
 };
 $('visitDay').onchange = () => {
  day = $('visitDay').value || today();
  renderHub();
 };
 $('addVisit').onclick = () => openPlan();

 planForm.onsubmit = async event => {
  event.preventDefault();
  const values = readFields(planForm, planKeys);
  if (!dateFormat.test(values.date) || !timeFormat.test(values.time) || !values.company || !values.place || !values.purpose) {
   message('訪問日、予定時刻、会社名、訪問場所、訪問内容を入力してください。');
   return;
  }
  const editing = Boolean(planId);
  const id = planId || crypto.randomUUID();
  const saved = await runAction(() => updateVisit(id, planVersion, old => {
   if (old?.startedAt) throw new Error('開始済みの訪問予定は変更できません。');
   const base = old || {startedAt:'', endedAt:'', location:null, note:'', followUpDate:'', followUpTask:'', cardIds:[]};
   return {...base, ...values};
  }));
  if (saved) {
   day = values.date;
   goBack();
   if (editing && currentScreen === 'visitRecord') updateRecord();
   message('訪問予定を保存しました。');
  }
 };

 $('editVisitPlan').onclick = () => {
  const visit = lookup(activeId);
  if (visit && !visit.startedAt) openPlan(visit);
 };
 $('deleteVisit').onclick = async () => {
  const visit = lookup(activeId);
  if (!visit || visit.startedAt || busy || !confirm('この訪問予定を削除しますか？')) return;
  if (await runAction(() => updateVisit(visit.id, visit.version, () => null))) {
   goBack();
   message('訪問予定を削除しました。');
  }
 };
 $('startVisit').onclick = () => startVisit(lookup(activeId));
 $('endVisit').onclick = async () => {
  const visit = lookup(activeId);
  if (!visit?.startedAt || visit.endedAt || busy) return;
  const endedAt = new Date().toISOString();
  if (await runAction(() => updateVisit(visit.id, visit.version, old => ({...old, endedAt})))) {
   afterVersion = lookup(visit.id).version;
   updateRecord();
   renderCardPicker();
   message('訪問終了を記録しました。');
  }
 };
 $('visitCardSearch').oninput = renderCardPicker;
 afterForm.onsubmit = async event => {
  event.preventDefault();
  const visit = lookup(activeId);
  if (!visit?.endedAt || busy) return;
  const values = readFields(afterForm, afterKeys);
  if (Boolean(values.followUpDate) !== Boolean(values.followUpTask)) {
   message('次にすることを登録する場合は、期限と内容を両方入力してください。');
   return;
  }
  const cardIds = [...linkedIds];
  if (await runAction(() => updateVisit(visit.id, afterVersion, old => ({...old, ...values, cardIds})))) {
   afterVersion = lookup(visit.id).version;
   message('訪問後の内容を保存しました。');
  }
 };

 function stopTimer() {
  clearTimeout(timer);
  timer = undefined;
 }
 function tick() {
  if (currentScreen !== 'visits') return;
  renderHub();
  timer = setTimeout(tick, 60000 - Date.now() % 60000);
 }
 document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentScreen === 'visits') {
   stopTimer();
   tick();
  }
 });

 function render(screen) {
  stopTimer();
  if (screen === 'visits') {
   day ||= today();
   tick();
  }
 }

 function snapshot(state) {
  if (state.screen === 'visitPlan') {
   state.visitPlan = {id: planId, version: planVersion, fields: readFields(planForm, planKeys)};
  } else if (state.screen === 'visitRecord') {
   state.visitRecord = {id: activeId, version: afterVersion, fields: readFields(afterForm, afterKeys),
    cardIds: [...linkedIds], picker: $('visitCardPicker').open, query: $('visitCardSearch').value};
  }
 }

 function restoreScreen(state) {
  if (state.visitPlan) {
   const plan = state.visitPlan;
   planId = plan.id;
   planVersion = plan.version;
   fillFields(planForm, planKeys, plan.fields);
   $('visitPlanTitle').textContent = planId ? '訪問予定を編集' : '訪問予定を登録';
  }
  if (state.visitRecord) {
   const record = state.visitRecord;
   activeId = record.id;
   afterVersion = record.version;
   fillFields(afterForm, afterKeys, record.fields);
   linkedIds = new Set(record.cardIds);
   $('visitCardSearch').value = record.query;
   $('visitCardPicker').open = record.picker;
   updateRecord();
   renderCardPicker();
  }
 }

 function clear() {
  session++;
  stopTimer();
  visits = [];
  day = lastToday = activeId = planId = planVersion = afterVersion = '';
  locating.clear();
  linkedIds.clear();
  planForm.reset();
  afterForm.reset();
  $('visitCardSearch').value = '';
  for (const id of ['visitHero','visitList','visitSummary','visitStatus','visitLinkedNames','visitCardChoices']) $(id).replaceChildren();
 }

 function validateBackup(records) {
  if (records === undefined) return [];
  if (!Array.isArray(records)) throw new Error();
  const dateTime = value => typeof value === 'string' && (value === '' || Number.isFinite(Date.parse(value)));
  const finiteIn = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  return records.map(record => {
   if (!record || typeof record.id !== 'string' || !record.id || typeof record.version !== 'string' || !record.version ||
       ![...planKeys, ...afterKeys].every(key => typeof record[key] === 'string') ||
       !dateFormat.test(record.date) || !timeFormat.test(record.time) ||
       (record.followUpDate && !dateFormat.test(record.followUpDate)) ||
       !dateTime(record.startedAt) || !dateTime(record.endedAt) || (record.endedAt && !record.startedAt) ||
       !Array.isArray(record.cardIds) || !record.cardIds.every(id => typeof id === 'string')) throw new Error();
   const location = record.location;
   if (location !== null && (!location || !finiteIn(location.latitude,-90,90) ||
       !finiteIn(location.longitude,-180,180) || !finiteIn(location.accuracy,0,Infinity) ||
       !dateTime(location.timestamp) || !location.timestamp)) throw new Error();
   return {id:record.id,version:record.version,...Object.fromEntries([...planKeys,...afterKeys].map(key=>[key,record[key]])),
    startedAt:record.startedAt,endedAt:record.endedAt,
    location:location && {latitude:location.latitude,longitude:location.longitude,accuracy:location.accuracy,timestamp:location.timestamp},
    cardIds:[...new Set(record.cardIds)]};
  });
 }

 return {render, snapshot, restoreScreen, validateBackup, clear, isBusy:()=>busy};
})();
