'use strict';

const visitApp = (() => {
 const planForm = $('visitPlanForm');
 const afterForm = $('visitAfterForm');
 const liveMemo = $('visitLiveMemoText');
 const savedMemo = $('visitSavedMemo');
 const savedMemoText = $('visitSavedMemoText');
 const memoDrafts = new Map();
 const defaultChecks = ['担当者不在','使用度聞き取り','カウンター用紙回収','見積書お渡し'];
 const checksKey = 'meishi:' + location.pathname.replace(/index\.html$/,'') + ':visit-checklist';
 const checkOptions = $('visitCheckOptions');
 const checkSettingsList = $('visitCheckSettingsList');
 const checkName = $('visitCheckName');
 const checkStatus = $('visitCheckSettingsStatus');
 const destinationInput = $('visitDestinationInput');
 const destinationSettings = $('visitDestinationSettings');
 const planKeys = ['date', 'time', 'company', 'person', 'place', 'purpose'];
 const visitContextKeys = ['visitor','intentOwner'];
 const afterKeys = ['note','result'];
 const legacyAfterKeys = ['note', 'followUpDate', 'followUpTask'];
 const followUpContainer = $('visitFollowUps');
 const actualKeys = ['startedAt', 'endedAt'];
 const dateFormat = /^\d{4}-\d{2}-\d{2}$/u;
 const timeFormat = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
 const displayTime = new Intl.DateTimeFormat('ja-JP', {timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
 let visits = [];
 let day = '';
 let lastToday = '';
 let activeId = '';
 let planId = '';
 let planVersion = '';
 let planUnplanned = false;
 let afterVersion = '';
 let linkedIds = new Set();
 let busy = false;
 let session = 0;
 let timer;
 let writeQueue = Promise.resolve();
 const locating = new Set();
 const locatingParking = new Set();

 const today = () => visitCsv.asLocalInput(new Date()).slice(0, 10);
 const readFields = (form, names) => Object.fromEntries(names.map(key => [key, form.elements.namedItem(key).value.trim()]));
 const fillFields = (form, names, values) => {
  for (const key of names) form.elements.namedItem(key).value = values[key] || '';
 };
 const scheduledAt = visit => Date.parse(visitCsv.timestamp(visit.time, visit.date));
 const lookup = id => visits.find(visit => visit.id === id);
 const visitStage = visitCsv.stage;
 const fold = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
 const showSchedule = visit => visit.date + ' ' + visit.time;
 const reportText = $('visitReportText');
 const customers = visitWorkflow.customerImport(scheduleCustomers);
 const radar = visitRadar.create({
  todayVisits:() => visits.filter(visit => visit.date === today()),
  openVisit:openRecord,redraw:renderHub,locate:currentLocation,active:screen => currentScreen === screen,
 });

 function focusVisit(dayVisits, now) {
  const inProgress = dayVisits.find(visit => visitStage(visit) === '訪問中');
  if (inProgress) return inProgress;
  const upcoming = dayVisits.filter(visit => visitStage(visit) === '予定');
  return upcoming.findLast(visit => scheduledAt(visit) <= now) || upcoming[0];
 }

 function renderHub() {
  const dateNow = today();
  if (!day || day === lastToday) day = dateNow;
  lastToday = dateNow;
  $('visitDay').value = day;
  const daily = visits.filter(visit => visit.date === day).sort((a, b) => a.time.localeCompare(b.time) || a.company.localeCompare(b.company, 'ja'));
  const openVisits = visits.filter(visit => visit.date !== day && visitStage(visit) === '訪問中');
  const now = Date.now();
  const featured = day === today() ? focusVisit(daily, now) : null;
  const hero = $('visitHero');
  hero.replaceChildren();
  hero.hidden = !featured;
  if (featured) {
   const status = featured.startedAt ? '訪問中' : scheduledAt(featured) <= now ? '訪問予定時刻になりました' : '次の訪問';
   hero.append(node('p', status + ' · ' + featured.time), node('h3', radar.companyName(featured)),
    node('p', [featured.place, featured.person].filter(Boolean).join(' · ')), node('p', featured.purpose));
   const button = node('button', featured.startedAt ? '訪問記録を開く' : '訪問開始');
   button.type = 'button';
   button.className = 'primary visit-primary';
   button.disabled = busy;
   button.onclick = () => featured.startedAt ? openRecord(featured.id) : recordArrival(featured);
   if (featured.startedAt) {
    hero.append(button);
   } else {
    const actions = node('div', '');
    actions.className = 'visit-start-actions';
    const parking = node('button', '');
    parking.type = 'button';
    parking.className = 'visit-primary';
    renderParkingButton(parking, featured);
    parking.onclick = () => recordArrival(featured, true);
    actions.append(button, parking);
    hero.append(actions);
    if (featured.parkedAt) hero.append(parkingSummary(featured));
   }
  }
  const list = $('visitList');
  list.replaceChildren();
  if (!daily.length) list.append(node('p', day === today() ? '今日の訪問予定はありません。' : 'この日の訪問予定はありません。'));
  const planned = daily.filter(visit => !visit.unplanned);
  const unplanned = daily.filter(visit => visit.unplanned);
  if (planned.length) list.append(visitList(planned));
  if (unplanned.length) list.append(node('h3','予定外の訪問'),visitList(unplanned));
  if (openVisits.length) {
   list.append(node('h3', 'ほかの日の訪問中の記録'), visitList(openVisits, true));
  }
  const report = visitWorkflow.report(day,daily);
  reportText.value = report.text;
  $('copyVisitReport').disabled = !report.text;
  $('visitReportStatus').textContent = report.count ?
   '訪問済み ' + report.count + '件（予定外 ' + report.unplanned + '件） · 記録に未入力あり ' + report.incomplete + '件' :
   'この日の訪問済みの記録はまだありません。';
  radar.draw();
 }

 function visitList(entries, includeDate = false) {
  const list = node('ul', '');
  list.className = 'visit-list';
  for (const visit of entries) {
   const row = node('li', '');
   const button = node('button', '');
   button.type = 'button';
   button.disabled = busy;
   const nextDeadline = visitCsv.followUps(visit).map(item => item.date).filter(Boolean).sort()[0];
   button.append(node('strong', (includeDate ? showSchedule(visit) : visit.time) + '　' + radar.companyName(visit)),
    node('small', visitStage(visit) + (visitStage(visit) === '訪問済み' && nextDeadline ? ' · 対応期限 ' + nextDeadline : '')));
   if (visit.purpose) button.append(node('small', visit.purpose));
   button.onclick = () => openRecord(visit.id);
   row.append(button);
   list.append(row);
  }
  return list;
 }

 function renderParkingButton(button, visit) {
  button.textContent = visit.parkedAt ? '駐車記録済み' : '駐車完了';
  button.disabled = busy || Boolean(visit.parkedAt);
 }

 function locationLink(location) {
  const link = node('a', '地図で見る');
  link.href = mapSearch + encodeURIComponent(location.latitude + ',' + location.longitude);
  return link;
 }

 function parkingSummary(visit) {
  const time = displayTime.format(new Date(visit.parkedAt));
  const line = node('p', '駐車完了　' + time);
  if (visit.parkingLocation) line.append('　', locationLink(visit.parkingLocation));
  else line.append(locatingParking.has(visit.id) ? ' · 位置情報を取得中…' : ' · 位置情報なし');
  return line;
 }

 function renderSummary(visit) {
  const summary = $('visitSummary');
  summary.replaceChildren();
  const statusLabel = visitStage(visit);
  $('visitRecordTitle').textContent = statusLabel === '訪問済み' ? '訪問後の記録' :
   statusLabel === '中止' ? '中止した訪問予定' : statusLabel === '予定' ? '訪問予定' : '訪問中';
  summary.append(node('p', (visit.unplanned ? '予定外　' : '予定　') + showSchedule(visit)), node('h3', radar.companyName(visit)));
  if (visit.person) summary.append(node('p', '担当者　' + visit.person));
  if (visit.visitor) summary.append(node('p', '訪問した人　' + visit.visitor));
  if (visit.intentOwner) summary.append(node('p', '誰の用件か　' + visit.intentOwner));
  if (visit.place) summary.append(node('p', '訪問場所　' + visit.place));
  summary.append(node('p', '訪問目的・用件　' + (visit.purpose || '未入力')));
  if (visit.parkedAt) summary.append(parkingSummary(visit));
  if (visit.startedAt) summary.append(node('p', '開始　' + displayTime.format(new Date(visit.startedAt))));
  if (visit.endedAt) summary.append(node('p', '終了　' + displayTime.format(new Date(visit.endedAt))));
  const status = $('visitStatus');
  if (visit.location) {
   status.textContent = '開始時の位置情報を記録済み';
   status.append('　', locationLink(visit.location));
  } else {
   status.textContent = locating.has(visit.id) ? '開始時の位置情報を取得中…' :
    visit.startedAt ? '開始時刻を記録済み · 位置情報なし' : '';
  }
 }

 function updateRecord() {
  const visit = lookup(activeId);
  if (!visit) return;
  renderSummary(visit);
  const state = visitStage(visit);
  const hasActuals = state === '訪問中' || state === '訪問済み';
  $('editVisitPlan').textContent = hasActuals ? '訪問記録を編集' : '予定を編集';
  $('deleteVisit').textContent = hasActuals ? '訪問記録を削除' : '予定を削除';
  $('cancelVisit').hidden = hasActuals;
  $('cancelVisit').textContent = state === '中止' ? '中止を取り消す' : '訪問を中止';
  $('startVisit').hidden = state !== '予定' || visit.date !== today();
  $('parkVisit').hidden = $('startVisit').hidden;
  renderParkingButton($('parkVisit'), visit);
  $('endVisit').hidden = state !== '訪問中';
  $('resumeVisit').hidden = state !== '訪問済み' || !visit.startedAt;
  for (const id of ['editVisitPlan', 'deleteVisit', 'cancelVisit', 'startVisit', 'endVisit', 'resumeVisit']) $(id).disabled = busy;
  $('visitLiveMemo').hidden = state !== '訪問中';
  liveMemo.readOnly = busy;
  savedMemo.hidden = state !== '訪問済み' || !visit.inVisitNote;
  savedMemoText.textContent = savedMemo.hidden ? '' : visit.inVisitNote;
  $('visitCheckFieldset').disabled = busy;
  afterForm.querySelector('[type="submit"]').disabled = busy;
  afterForm.hidden = state !== '訪問済み';
 }

 function loadMemo(visit) {
  liveMemo.value = memoDrafts.get(visit?.id) ?? visit?.inVisitNote ?? '';
  savedMemo.open = false;
 }

 function configuredChecks() {
  try {
   const saved = localStorage.getItem(checksKey);
   return saved === null ? defaultChecks : visitCsv.checklist(JSON.parse(saved));
  } catch {
   return defaultChecks;
  }
 }

 function renderCheckSettings() {
  const items = configuredChecks();
  checkSettingsList.replaceChildren();
  if (!items.length) checkSettingsList.append(node('li','登録されている項目はありません。'));
  for (const item of items) {
   const row = node('li','');
   const remove = node('button','削除');
   remove.type = 'button';
   remove.setAttribute('aria-label',item + 'を削除');
   remove.onclick = () => saveCheckSettings(configuredChecks().filter(value => value !== item),'削除しました。');
   row.append(node('span',item),remove);
   checkSettingsList.append(row);
  }
 }

 function saveCheckSettings(items, message) {
  try {
   localStorage.setItem(checksKey,JSON.stringify(items));
  } catch {
   checkStatus.textContent = 'チェック項目を保存できませんでした。';
   return false;
  }
  renderCheckSettings();
  checkStatus.textContent = message;
  return true;
 }

 $('visitCheckAdd').onsubmit = event => {
  event.preventDefault();
  const name = checkName.value.trim();
  if (!name) {
   checkStatus.textContent = 'チェック項目名を入力してください。';
   return;
  }
  const items = configuredChecks();
  if (items.some(item => fold(item) === fold(name))) {
   checkStatus.textContent = '同じチェック項目がすでにあります。';
   return;
  }
  if (saveCheckSettings([...items,name],'追加しました。')) checkName.value = '';
 };

 function renderVisitChecks(selected = []) {
  const current = new Set(configuredChecks());
  const choices = new Set([...current,...selected]);
  const checked = new Set(selected);
  checkOptions.replaceChildren();
  $('visitCheckFieldset').hidden = !choices.size;
  for (const item of choices) {
   const label = node('label','');
   const input = document.createElement('input');
   input.type = 'checkbox';
   input.value = item;
   input.checked = checked.has(item);
   const text = node('span',item);
   if (!current.has(item)) {
    const previous = node('small','この端末の設定外');
    previous.className = 'hint';
    text.append(previous);
   }
   label.append(input,text);
   checkOptions.append(label);
  }
 }

 function readVisitChecks() {
  return Array.from(checkOptions.querySelectorAll('input:checked'),input => input.value);
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
  const matches = rows.filter(card => !term || fold(card.company).includes(term) || fold(card.person).includes(term))
   .sort((a, b) => b.created - a.created);
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

 function addFollowUp(item = {}) {
  const row = node('div', '');
  row.className = 'follow-up-row';
  const fields = node('div', '');
  fields.className = 'follow-up-fields';
  const date = document.createElement('input');
  date.type = 'date';
  date.value = item.date || '';
  const deadline = node('label', 'いつまでに');
  deadline.append(date);
  const task = document.createElement('input');
  task.type = 'text';
  task.placeholder = '例：見積書を送る';
  task.value = item.task || '';
  const description = node('label', '何をする');
  description.append(task);
  fields.append(deadline, description);
  const remove = node('button', 'この予定を削除');
  remove.type = 'button';
  remove.className = 'follow-up-remove';
  remove.onclick = () => {
   row.remove();
   if (!followUpContainer.children.length) addFollowUp();
  };
  row.append(fields, remove);
  followUpContainer.append(row);
  return task;
 }

 function showFollowUps(items) {
  followUpContainer.replaceChildren();
  if (!items.length) addFollowUp();
  for (const item of items) addFollowUp(item);
 }

 function readFollowUps() {
  return Array.from(followUpContainer.children, row => {
   const [date, task] = row.querySelectorAll('input');
   return {date:date.value, task:task.value};
  });
 }

 function openRecord(id) {
  const visit = lookup(id);
  if (!visit || busy) return;
  show('visitRecord');
  activeId = id;
  afterVersion = visit.version;
  loadMemo(visit);
  fillFields(afterForm, afterKeys, visit);
  renderVisitChecks(visit.checkedItems);
  showFollowUps(visitCsv.followUps(visit));
  linkedIds = new Set(visit.cardIds);
  $('visitCardSearch').value = '';
  $('visitCardPicker').open = false;
  updateRecord();
  renderCardPicker();
  message('');
 }

 function openPlan(visit, unplanned = false) {
  if (busy) return;
  show('visitPlan');
  planId = visit?.id || '';
  planVersion = visit?.version || '';
  planUnplanned = visit?.unplanned === true || unplanned;
  $('visitAlreadyDone').checked = false;
  drawPlanControls(visit);
  fillFields(planForm, [...planKeys,...visitContextKeys], visit || {
   date:unplanned ? today() : day,
   time:unplanned ? visitCsv.asLocalInput(new Date()).slice(11,16) : '',
  });
  fillFields(planForm, actualKeys, {
   startedAt: visitCsv.asLocalInput(visit?.startedAt),
   endedAt: visitCsv.asLocalInput(visit?.endedAt),
  });
  destinationInput.value = visitRadar.pointText(visit?.destination);
  destinationSettings.open = Boolean(visit?.destination);
  updateDestinationMapLink();
  message('');
 }

 function updateDestinationMapLink() {
  const {company,place} = readFields(planForm,['company','place']);
  const query = [company,place].filter(Boolean).join(' ');
  const link = $('visitDestinationMap');
  link.hidden = !query;
  if (query) link.href = mapSearch + encodeURIComponent(query);
 }

 function drawPlanControls(visit) {
  const state = visit && visitStage(visit);
  const hasActuals = state === '訪問中' || state === '訪問済み';
  const alreadyDone = !visit && planUnplanned && $('visitAlreadyDone').checked;
  $('visitPlanTitle').textContent = planUnplanned ? (visit ? '予定外の訪問を編集' : '予定外の訪問を登録') :
   hasActuals ? '訪問記録を編集' : visit ? '訪問予定を編集' : '訪問予定を登録';
  $('saveVisitPlan').textContent = hasActuals ? '変更を保存' : planUnplanned ? '訪問を登録' : '予定を保存';
  $('visitAlreadyDoneLabel').hidden = Boolean(visit) || !planUnplanned;
  $('visitPlanTime').hidden = alreadyDone;
  planForm.elements.namedItem('time').disabled = alreadyDone;
  $('visitActualFields').hidden = !hasActuals && !alreadyDone;
  $('visitEndField').hidden = state !== '訪問済み' && !alreadyDone;
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

 function enqueueWrite(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => {});
  return result;
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
  return enqueueWrite(operation);
 }

 function rerenderActions() {
  updateNavigation();
  planForm.querySelector('[type="submit"]').disabled = busy;
  $('addVisit').disabled = busy;
  $('addUnplanned').disabled = busy;
  $('showRadar').disabled = busy;
  $('useDestinationPosition').disabled = busy;
  $('visitCsvForm').querySelector('[type="submit"]').disabled = busy;
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

 async function recordArrival(visit, parking = false) {
  if (!visit || busy || visitStage(visit) !== '予定' || visit.date !== today()) return;
  if (parking && visit.parkedAt) return;
  const timestamp = new Date().toISOString();
  const timeKey = parking ? 'parkedAt' : 'startedAt';
  const locationKey = parking ? 'parkingLocation' : 'location';
  const pending = parking ? locatingParking : locating;
  const currentSession = session;
  pending.add(visit.id);
  const locationRequest = currentLocation();
  const saved = await runAction(() => updateVisit(visit.id, visit.version, old =>
   old && visitStage(old) === '予定' && !old[timeKey] ? {...old, [timeKey]:timestamp, [locationKey]:null} : undefined));
  if (currentSession !== session) return;
  if (!saved) {
   pending.delete(visit.id);
   return;
  }
  if (parking) {
   if (currentScreen === 'visitRecord' && activeId === visit.id) afterVersion = lookup(visit.id).version;
   message('駐車完了時刻を記録しました。');
  } else {
   openRecord(visit.id);
  }
  const location = await locationRequest;
  if (currentSession !== session) return;
  pending.delete(visit.id);
  if (location) {
   try {
    await updateVisit(visit.id, null, old => old?.[timeKey] === timestamp ? {...old, [locationKey]:location} : undefined, false);
   } catch {
    // A timestamp already exists even when recording the position fails.
   }
  }
  if (currentScreen === 'visits') renderHub();
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
 $('addUnplanned').onclick = () => openPlan(null,true);
 for (const key of ['company','place']) planForm.elements.namedItem(key).oninput = updateDestinationMapLink;
 $('useDestinationPosition').onclick = () => runAction(async () => {
  const point = await currentLocation();
  if (currentScreen !== 'visitPlan') return;
  if (point) destinationInput.value = visitRadar.pointText(visitCsv.coordinates(point.latitude,point.longitude));
  else message('現在地を取得できませんでした。訪問先の座標を入力してください。');
 });
 $('visitAlreadyDone').onchange = () => drawPlanControls(lookup(planId));
 $('copyVisitReport').onclick = async () => {
  if (!reportText.value) return;
  try {
   await navigator.clipboard.writeText(reportText.value);
   message('日報の下書きをコピーしました。');
  } catch {
   reportText.focus();
   reportText.select();
   message('選択した下書きをコピーしてください。');
  }
 };

 planForm.onsubmit = async event => {
  event.preventDefault();
  const values = readFields(planForm, [...planKeys,...visitContextKeys]);
  const existing = lookup(planId);
  const alreadyDone = !existing && planUnplanned && $('visitAlreadyDone').checked;
  if (!visitCsv.date(values.date) || (!alreadyDone && !timeFormat.test(values.time)) || !values.company) {
   message('訪問日、時刻、会社名を入力してください。');
   return;
  }
  const coordinates = destinationInput.value.trim();
  values.destination = visitRadar.parsePoint(coordinates);
  if (coordinates && !values.destination) {
   destinationSettings.open = true;
   message('訪問先の緯度・経度を確認してください。');
   return;
  }
  const id = planId || crypto.randomUUID();
  const state = existing && visitStage(existing);
  const hasActuals = state === '訪問中' || state === '訪問済み' || alreadyDone;
  if (hasActuals) {
   const actual = readFields(planForm, actualKeys);
   for (const key of actualKeys) {
    const stamp = visitCsv.timestamp(actual[key],values.date);
    if (actual[key] && !stamp) {
     message('実績の日時を確認してください。');
     return;
    }
    const matchesOriginal = stamp && Math.floor(Date.parse(stamp)/1000) === Math.floor(Date.parse(existing?.[key])/1000);
    values[key] = matchesOriginal ? existing[key] : stamp;
   }
   if (((state === '訪問中' || alreadyDone) && !values.startedAt) ||
       (values.endedAt && (!values.startedAt || values.endedAt < values.startedAt))) {
    message('開始日時と終了日時を確認してください。');
    return;
   }
   values.completed = state === '訪問済み' || alreadyDone;
  }
  if (alreadyDone) {
   const startedDay = visitCsv.asLocalInput(values.startedAt);
   if (startedDay.slice(0,10) !== values.date) {
    message('訪問日と訪問開始日時の日付を揃えてください。');
    return;
   }
   values.time = startedDay.slice(11,16);
  }
  const saved = await runAction(() => updateVisit(id, planVersion, old => {
   const base = old || {...newVisit(),unplanned:planUnplanned};
   return {...base, ...values};
  }));
  if (saved) {
   day = values.date;
   goBack();
   if (currentScreen === 'visitRecord') {
    afterVersion = lookup(id).version;
    updateRecord();
   }
   if (!existing && lookup(id)?.unplanned && (alreadyDone || values.date === today())) openRecord(id);
   message(hasActuals ? '訪問記録を保存しました。' : '訪問予定を保存しました。');
  }
 };

 function newVisit() {
  return {startedAt:'',endedAt:'',location:null,note:'',result:'',followUpDate:'',followUpTask:'',cardIds:[]};
 }

 function scheduleCustomers(selected) {
  const date = day || today();
  const visitKey = visit => JSON.stringify([visit.date,visit.time,...[visit.company,visit.person,visit.place].map(fold)]);
  return runAction(() => enqueueWrite(async () => {
   const currentSession = session;
   const lock = appLock;
   const key = appKey;
   const state = await storage.read(false);
   if (currentSession !== session || lock?.id !== appLock?.id) return false;
   if (state.lock?.id !== lock?.id) {
    enterLocked(state.lock);
    return false;
   }
   const existing = await storage.unpack(state.visits,key,'visit');
   const keys = new Set(existing.filter(visit => !visit.cancelled).map(visitKey));
   const packed = [];
   for (const item of selected) {
    const candidate = {...newVisit(),...item,date,intentOwner:''};
    const signature = visitKey(candidate);
    if (keys.has(signature)) continue;
    keys.add(signature);
    const record = {...candidate,id:crypto.randomUUID(),version:crypto.randomUUID()};
    packed.push(await storage.pack(record,key,'visit'));
   }
   if (currentSession !== session || lock?.id !== appLock?.id) return false;
   if (packed.length) {
    await storage.write(lock,(_,store) => {for (const value of packed) store.add(value)}, {revision:state.revision,lock});
    await refresh();
   }
   return {added:packed.length,skipped:selected.length-packed.length};
  }));
 }

 $('editVisitPlan').onclick = () => {
  const visit = lookup(activeId);
  if (visit) openPlan(visit);
 };
 $('cancelVisit').onclick = async () => {
  const visit = lookup(activeId);
  if (!visit || busy || !['予定','中止'].includes(visitStage(visit))) return;
  const cancelled = !visit.cancelled;
  if (await runAction(() => updateVisit(visit.id, visit.version, old => ({...old,cancelled})))) {
   afterVersion = lookup(visit.id).version;
   message(cancelled ? '訪問を中止しました。' : '中止を取り消しました。');
  }
 };
 $('deleteVisit').onclick = async () => {
  const visit = lookup(activeId);
  if (!visit || busy || !confirm('この訪問記録を削除しますか？')) return;
  if (await runAction(() => updateVisit(visit.id, visit.version, () => null))) {
   memoDrafts.delete(visit.id);
   for (let i=pageHistory.length-1; i>=0; i--) {
    if (pageHistory[i].visitRecord?.id === visit.id || pageHistory[i].visitPlan?.id === visit.id) pageHistory.splice(i,1);
   }
   if (pageHistory.length) goBack();
   else show('visits');
   message('訪問記録を削除しました。');
  }
 };
 $('startVisit').onclick = () => recordArrival(lookup(activeId));
 $('parkVisit').onclick = () => recordArrival(lookup(activeId), true);
 liveMemo.oninput = () => {
  const visit = lookup(activeId);
  if (visit && visitStage(visit) === '訪問中') memoDrafts.set(visit.id,liveMemo.value);
 };
 $('endVisit').onclick = async () => {
  const visit = lookup(activeId);
  if (!visit || visitStage(visit) !== '訪問中' || busy) return;
  const endedAt = new Date().toISOString();
  if (endedAt < visit.startedAt) {
   message('訪問開始日時を確認してください。開始より前の時刻で終了できません。');
   return;
  }
  const inVisitNote = liveMemo.value;
  if (await runAction(() => updateVisit(visit.id, visit.version, old =>
   old && visitStage(old) === '訪問中' ? {...old,endedAt,inVisitNote} : undefined))) {
   memoDrafts.delete(visit.id);
   afterVersion = lookup(visit.id).version;
   updateRecord();
   renderCardPicker();
   message(inVisitNote ? '訪問終了と訪問中のメモを保存しました。' : '訪問終了を記録しました。');
  }
 };
 $('resumeVisit').onclick = async () => {
  const visit = lookup(activeId);
  if (!visit?.startedAt || visitStage(visit) !== '訪問済み' || busy) return;
  if (await runAction(() => updateVisit(visit.id, visit.version, old => ({...old, endedAt:'', completed:false})))) {
   afterVersion = lookup(visit.id).version;
   loadMemo(lookup(visit.id));
   message('訪問中に戻しました。');
  }
 };
 $('addFollowUp').onclick = () => addFollowUp().focus();
 $('visitCardSearch').oninput = renderCardPicker;
 afterForm.onsubmit = async event => {
  event.preventDefault();
  const visit = lookup(activeId);
  if (!visit || visitStage(visit) !== '訪問済み' || busy) return;
  const values = readFields(afterForm, afterKeys);
  const followUps = readFollowUps().map(({date,task}) => ({date,task:task.trim()})).filter(item => item.date || item.task);
  if (followUps.some(item => !visitCsv.date(item.date) || !item.task)) {
   message('対応予定ごとに、期限と内容を両方入力してください。');
   return;
  }
  const followUpDate = followUps[0]?.date || '';
  const followUpTask = followUps[0]?.task || '';
  const cardIds = [...linkedIds];
  const checkedItems = readVisitChecks();
  if (await runAction(() => updateVisit(visit.id, afterVersion, old =>
   ({...old, ...values, followUps, followUpDate, followUpTask, cardIds,checkedItems})))) {
   const saved = lookup(visit.id);
   afterVersion = saved.version;
   renderVisitChecks(saved.checkedItems);
   message('訪問後の内容を保存しました。');
  }
 };

 function downloadCsv(content, name) {
  const file = new Blob([content], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(file);
  const link = node('a','');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
 }

 $('downloadVisitTemplate').onclick = () => downloadCsv(visitCsv.template(day || today()), '訪問記録_取り込み用ひな形.csv');
 $('exportVisitCsv').onclick = async () => {
  const currentDay = day;
  if (await runAction(async () => {
   await refresh();
   if (currentScreen !== 'visits') return false;
   const daily = visits.filter(visit => visit.date === currentDay).sort((a,b) => a.time.localeCompare(b.time));
   downloadCsv(visitCsv.encode(daily), '訪問記録_' + currentDay + '.csv');
   return true;
  })) message(currentDay + ' の訪問CSVを出力しました。');
 };

 function importVisits(file) {
  const sessionAtStart = session;
  return enqueueWrite(async () => {
   const incoming = await visitCsv.read(file);
   if (!incoming.length) {
    message('取り込める訪問記録がありません。');
    return false;
   }
   const lock = appLock;
   const key = appKey;
   const state = await storage.read(false);
   if (sessionAtStart !== session || lock?.id !== appLock?.id) return false;
   if (state.lock?.id !== lock?.id) {
    enterLocked(state.lock);
    return false;
   }
   const existing = await storage.unpack(state.visits, key, 'visit');
   const sameContent = new Set(existing.map(visitCsv.fingerprint));
   const additions = [];
   let skipped = 0;
   for (const record of incoming) {
    const entry = {...record, cardIds:record.cardIds ?? []};
    const signature = visitCsv.fingerprint(entry);
    if (sameContent.has(signature)) {
     skipped++;
     continue;
    }
    sameContent.add(signature);
    additions.push({...entry,id:crypto.randomUUID(),version:crypto.randomUUID()});
   }
   const counts = '新規追加 ' + additions.length + '件、同じ内容のため省略 ' + skipped + '件';
   if (sessionAtStart !== session || lock?.id !== appLock?.id) return false;
   if (!additions.length) {
    message('追加する訪問記録がありません。' + counts);
    return false;
   }
   if (!confirm(counts + '。既存の訪問記録を残したまま追加しますか？')) return false;
   const packed = [];
   for (const visit of additions) packed.push(await storage.pack(visit, key, 'visit'));
   if (sessionAtStart !== session || lock?.id !== appLock?.id) return false;
   await storage.write(lock, (_, store) => {for (const item of packed) store.add(item)}, {revision:state.revision,lock});
   if (sessionAtStart !== session || lock?.id !== appLock?.id) return false;
   if (!additions.some(visit => visit.date === day)) day = additions.map(visit => visit.date).sort()[0];
   await refresh();
   message('CSVを取り込みました。' + counts);
   return true;
  });
 }

 $('visitCsvForm').onsubmit = async event => {
  event.preventDefault();
  const file = $('visitCsvFile').files[0];
  if (file && await runAction(() => importVisits(file))) $('visitCsvForm').reset();
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
  if (screen === 'settings') {
   renderCheckSettings();
   radar.renderSettings();
  }
 }

 function snapshot(state) {
  if (state.screen === 'visitPlan') {
   state.visitPlan = {id: planId, version: planVersion, unplanned:planUnplanned,
    alreadyDone:$('visitAlreadyDone').checked,fields: readFields(planForm, [...planKeys,...visitContextKeys,...actualKeys]),
    coordinates:destinationInput.value,destinationOpen:destinationSettings.open};
  } else if (state.screen === 'visitRecord') {
   state.visitRecord = {id: activeId, version: afterVersion, fields: readFields(afterForm, afterKeys), followUps: readFollowUps(),
    checkedItems:readVisitChecks(), cardIds: [...linkedIds], picker: $('visitCardPicker').open, query: $('visitCardSearch').value};
  }
 }

 function restoreScreen(state) {
  if (state.visitPlan) {
   const plan = state.visitPlan;
   planId = plan.id;
   planVersion = plan.version;
   planUnplanned = plan.unplanned;
   $('visitAlreadyDone').checked = plan.alreadyDone;
   fillFields(planForm, [...planKeys,...visitContextKeys,...actualKeys], plan.fields);
   destinationInput.value = plan.coordinates;
   destinationSettings.open = plan.destinationOpen;
   updateDestinationMapLink();
   drawPlanControls(lookup(planId));
  }
  if (state.visitRecord) {
   const record = state.visitRecord;
   activeId = record.id;
   afterVersion = record.version;
   loadMemo(lookup(activeId));
   fillFields(afterForm, afterKeys, record.fields);
   renderVisitChecks(record.checkedItems);
   showFollowUps(record.followUps);
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
  locatingParking.clear();
  linkedIds.clear();
  memoDrafts.clear();
  liveMemo.value = '';
  savedMemo.open = false;
  savedMemoText.textContent = '';
  planForm.reset();
  afterForm.reset();
  checkOptions.replaceChildren();
  checkName.value = '';
  checkStatus.textContent = '';
  destinationInput.value = '';
  radar.clear();
  customers.clear();
  reportText.value = '';
  $('visitReport').open = false;
  followUpContainer.replaceChildren();
  $('visitCsvForm').reset();
  $('visitCsvPanel').open = false;
  $('visitCardSearch').value = '';
  for (const id of ['visitHero','visitList','visitSummary','visitStatus','visitLinkedNames','visitCardChoices']) $(id).replaceChildren();
 }

 function validateBackup(records) {
  if (records === undefined) return [];
  if (!Array.isArray(records)) throw new Error();
  const dateTime = value => typeof value === 'string' && (value === '' || Number.isFinite(Date.parse(value)));
  const finiteIn = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  function readLocation(location) {
   if (location === null) return null;
   if (!location || !finiteIn(location.latitude,-90,90) || !finiteIn(location.longitude,-180,180) ||
       !finiteIn(location.accuracy,0,Infinity) || !dateTime(location.timestamp) || !location.timestamp) throw new Error();
   return {latitude:location.latitude,longitude:location.longitude,accuracy:location.accuracy,timestamp:location.timestamp};
  }
  return records.map(record => {
   if (!record || typeof record.id !== 'string' || !record.id || typeof record.version !== 'string' || !record.version ||
       ![...planKeys, ...legacyAfterKeys].every(key => typeof record[key] === 'string') ||
       !dateFormat.test(record.date) || !timeFormat.test(record.time) ||
       (record.followUpDate && !dateFormat.test(record.followUpDate)) ||
       !dateTime(record.startedAt) || !dateTime(record.endedAt) || (record.endedAt && !record.startedAt) ||
       !Array.isArray(record.cardIds) || !record.cardIds.every(id => typeof id === 'string') ||
       (record.completed !== undefined && typeof record.completed !== 'boolean') ||
       (record.cancelled !== undefined && typeof record.cancelled !== 'boolean') ||
       (record.cancelled && (record.startedAt || record.endedAt || record.completed))) throw new Error();
   const parkedAt = record.parkedAt ?? '';
   const parkingLocation = readLocation(record.parkingLocation ?? null);
   if (!dateTime(parkedAt) || (parkingLocation && !parkedAt)) throw new Error();
   const reminders = record.followUps;
   if (reminders !== undefined && (!Array.isArray(reminders) || reminders.some(item =>
    typeof item?.date !== 'string' || !visitCsv.date(item.date) || typeof item.task !== 'string' || !item.task.trim()))) throw new Error();
   const followUps = reminders?.map(({date,task}) => ({date,task}));
   const checkedItems = record.checkedItems === undefined ? [] : visitCsv.checklist(record.checkedItems);
   const destination = visitCsv.coordinates(record.destination?.latitude,record.destination?.longitude);
   if (record.destination != null && !destination) throw new Error();
   if ([...visitContextKeys,'result','inVisitNote'].some(key => record[key] !== undefined && typeof record[key] !== 'string') ||
       (record.unplanned !== undefined && typeof record.unplanned !== 'boolean')) throw new Error();
   return {id:record.id,version:record.version,...Object.fromEntries([...planKeys,...legacyAfterKeys].map(key=>[key,record[key]])),
    startedAt:record.startedAt,endedAt:record.endedAt,completed:record.completed === true,cancelled:record.cancelled === true,
    location:readLocation(record.location),parkedAt,parkingLocation,...(followUps && {followUps}),
    cardIds:[...new Set(record.cardIds)], unplanned:record.unplanned === true,
    visitor:record.visitor || '',intentOwner:record.intentOwner || '',result:record.result || '',
    ...(record.inVisitNote ? {inVisitNote:record.inVisitNote} : {}), ...(checkedItems.length ? {checkedItems} : {}),
    ...(destination ? {destination} : {})};
  });
 }

 return {render, snapshot, restoreScreen, validateBackup, refresh, clear, isBusy:()=>busy};
})();
