'use strict';

const visitCsv = (() => {
 const columns = [
  ['id','訪問ID'], ['date','訪問日'], ['time','訪問予定時刻'], ['company','訪問会社名'],
  ['person','担当者名'], ['place','訪問場所'], ['purpose','訪問内容'], ['stage','状態'],
  ['startedAt','訪問開始日時'], ['endedAt','訪問終了日時'], ['note','メモ'],
  ['followUpDate','対応期限'], ['followUpTask','次にすること'],
  ['latitude','開始地点の緯度'], ['longitude','開始地点の経度'], ['accuracy','位置精度（m）'],
  ['locationAt','位置取得日時'], ['cardIds','紐付け名刺ID'],
  ['parkedAt','駐車完了日時'], ['parkingLatitude','駐車地点の緯度'], ['parkingLongitude','駐車地点の経度'],
  ['parkingAccuracy','駐車位置精度（m）'], ['parkingLocationAt','駐車位置取得日時'], ['extraFollowUps','追加の対応予定'],
  ['unplanned','予定区分'], ['visitor','訪問した人'], ['intentOwner','誰の用件か'], ['result','結果・得たこと'],
  ['inVisitNote','訪問中のメモ'],
  ['checkedItems','訪問後のチェック項目'],
  ['destinationLatitude','訪問先の緯度'], ['destinationLongitude','訪問先の経度'],
 ];
 const exampleId = '記入例（取り込み対象外）';
 const pad = value => String(value).padStart(2,'0');
 const tokyoOffset = '+09:00';
 const tokyoClock = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo',hourCycle:'h23',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});

 function stage(visit) {
  if (visit.cancelled) return '中止';
  if (visit.endedAt || visit.completed) return '訪問済み';
  return visit.startedAt ? '訪問中' : '予定';
 }

 function date(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/u.exec(value);
  if (!match) return '';
  const normalized = match[1] + '-' + pad(match[2]) + '-' + pad(match[3]);
  const parsed = new Date(normalized + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === normalized ? normalized : '';
 }

 function time(value) {
  const match = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/u.exec(value);
  return match && Number(match[1]) < 24 ? pad(match[1]) + ':' + match[2] : '';
 }

 function timestamp(value, fallbackDate) {
  if (!value) return '';
  const stamp = /^(?:(\d{4}[-/]\d{1,2}[-/]\d{1,2})[T ]+)?(\d{1,2}:[0-5]\d)(?::([0-5]\d)(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/iu.exec(value);
  const day = stamp && (stamp[1] ? date(stamp[1]) : fallbackDate);
  const clock = stamp && time(stamp[2]);
  if (!day || !clock) return '';
  const zone = (stamp[5] || tokyoOffset).toUpperCase();
  const parsed = new Date(day + 'T' + clock + ':' + (stamp[3] || '00') + (stamp[4] || '') + zone);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
 }

 function asLocalInput(value) {
  if (!value) return '';
  const stamp = new Date(value);
  if (!Number.isFinite(stamp.getTime())) return '';
  const parts = Object.fromEntries(tokyoClock.formatToParts(stamp).map(part => [part.type,part.value]));
  return [parts.year,parts.month,parts.day].join('-') + 'T' + [parts.hour,parts.minute,parts.second].join(':');
 }

 function tokyoStamp(value) {
  const local = asLocalInput(value);
  if (!local) return '';
  const milliseconds = String(new Date(value).getUTCMilliseconds()).padStart(3,'0');
  return local + '.' + milliseconds + tokyoOffset;
 }

 function followUps(visit) {
  if (Array.isArray(visit.followUps)) return visit.followUps;
  return visit.followUpDate || visit.followUpTask ? [{date:visit.followUpDate || '',task:visit.followUpTask || ''}] : [];
 }

 function checklist(values) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim())) {
   throw new Error('チェック項目の形式が正しくありません。');
  }
  return [...new Set(values.map(value => value.trim()))];
 }

 function coordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
   Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? {latitude,longitude} : null;
 }

 function rowData(visit) {
  const [first, ...additional] = followUps(visit);
  return {
   ...visit,stage:stage(visit), latitude:visit.location?.latitude ?? '',
   longitude:visit.location?.longitude ?? '', accuracy:visit.location?.accuracy ?? '',
   startedAt:tokyoStamp(visit.startedAt), endedAt:tokyoStamp(visit.endedAt),
   locationAt:tokyoStamp(visit.location?.timestamp), cardIds:JSON.stringify(visit.cardIds || []),
   parkedAt:tokyoStamp(visit.parkedAt), parkingLatitude:visit.parkingLocation?.latitude ?? '',
   parkingLongitude:visit.parkingLocation?.longitude ?? '', parkingAccuracy:visit.parkingLocation?.accuracy ?? '',
   parkingLocationAt:tokyoStamp(visit.parkingLocation?.timestamp),
   followUpDate:first?.date || '', followUpTask:first?.task || '',
   extraFollowUps:additional.length ? JSON.stringify(additional.map(({date,task}) => ({date,task}))) : '',
   unplanned:visit.unplanned ? '予定外' : '予定', visitor:visit.visitor || '',
   intentOwner:visit.intentOwner || '', result:visit.result || '',
   checkedItems:visit.checkedItems?.length ? JSON.stringify(visit.checkedItems) : '',
   destinationLatitude:visit.destination?.latitude ?? '',destinationLongitude:visit.destination?.longitude ?? '',
  };
 }

 function encode(records) {
  const rows = [columns.map(([, label]) => label)];
  for (const visit of records) {
   const fields = rowData(visit);
   rows.push(columns.map(([key]) => fields[key]));
  }
  return '\uFEFF' + rows.map(row => row.map(value => {
   const text = String(value ?? '');
   return output.csvCell(text.startsWith("'") ? "'" + text : text);
  }).join(',')).join('\r\n') + '\r\n';
 }

 function template(day) {
  return encode([{id:exampleId,date:day,time:'09:30',company:'株式会社サンプル',
   person:'山田 太郎',place:'札幌市中央区・本社受付',purpose:'複合機の使用状況を確認'}]);
 }

 function splitRows(text) {
  const rows = [];
  let row = [], cell = '', state = 'start';
  function endCell() {
   row.push(cell);
   cell = '';
   state = 'start';
  }
  for (let i = 0; i < text.length; i++) {
   const char = text[i];
   if (state === 'quoted') {
    if (char !== '"') cell += char;
    else if (text[i + 1] === '"') {cell += '"'; i++}
    else state = 'closed';
    continue;
   }
   if (char === ',') {
    endCell();
   } else if (char === '\r' || char === '\n') {
    endCell();
    rows.push(row);
    row = [];
    if (char === '\r' && text[i+1] === '\n') i++;
   } else if (char === '"' && state === 'start') {
    state = 'quoted';
   } else {
    if (state === 'closed' || char === '"') throw new Error('CSVの「"」の位置を確認してください（' + (rows.length+1) + '行目）。');
    cell += char;
    state = 'plain';
   }
  }
  if (state === 'quoted') throw new Error('CSVの最後に閉じていない「"」があります。');
  if (row.length || state !== 'start') {
   endCell();
   rows.push(row);
  }
  return rows;
 }

 function unescape(value) {
  return value.startsWith("'") && (value[1] === "'" || output.requiresCsvEscape(value.slice(1))) ? value.slice(1) : value;
 }

 function readRecord(values, rowNumber) {
  const row = Object.fromEntries(columns.map(([key], index) => [key, unescape(values[index] || '')]));
  const trimKeys = ['id','date','time','company','person','place','purpose','stage','startedAt','endedAt',
   'followUpDate','latitude','longitude','accuracy','locationAt','cardIds',
   'parkedAt','parkingLatitude','parkingLongitude','parkingAccuracy','parkingLocationAt','extraFollowUps',
   'unplanned','visitor','intentOwner','destinationLatitude','destinationLongitude'];
  for (const key of trimKeys) if (typeof row[key] === 'string') row[key] = row[key].trim();
  function fail(message) {throw new Error(rowNumber + '行目：' + message)}
  const visitDate = date(row.date);
  const visitTime = time(row.time);
  if (!visitDate || !visitTime || !row.company) {
   fail('訪問日・予定時刻・会社名を確認してください。');
  }
  if (!['','予定','予定外'].includes(row.unplanned)) fail('予定区分は「予定」か「予定外」を入力してください。');
  const startedAt = timestamp(row.startedAt, visitDate);
  const endedAt = timestamp(row.endedAt, visitDate);
  if ((row.startedAt && !startedAt) || (row.endedAt && !endedAt) ||
      (endedAt && (!startedAt || endedAt < startedAt))) fail('訪問開始日時・終了日時を確認してください。');
  if (!['','予定','訪問中','訪問済み','中止'].includes(row.stage)) fail('状態は「予定」「訪問中」「訪問済み」「中止」から入力してください。');
  if (((row.stage === '中止' || row.stage === '予定') && startedAt) ||
      (row.stage === '訪問中' && (!startedAt || endedAt))) fail('状態と訪問開始日時・終了日時が一致していません。');
  const followUpDate = row.followUpDate && date(row.followUpDate);
  if (row.followUpDate && !followUpDate) fail('対応期限の日付を確認してください。');
  if (Boolean(followUpDate) !== Boolean(row.followUpTask.trim())) fail('対応期限と次にすることは一緒に入力してください。');
  const reminders = followUpDate ? [{date:followUpDate,task:row.followUpTask}] : [];
  if (row.extraFollowUps) {
   const error = '追加の対応予定は空欄か、出力時の書式を使用してください。';
   let additional;
   try {additional = JSON.parse(row.extraFollowUps)} catch {fail(error)}
   if (!Array.isArray(additional)) fail(error);
   for (const item of additional) {
    if (typeof item?.date !== 'string' || !date(item.date) || typeof item.task !== 'string' || !item.task.trim()) fail(error);
    reminders.push({date:date(item.date), task:item.task});
   }
  }
  function readLocation(lat, lng, precision, recordedAt, label) {
   if (!lat && !lng && !precision && !recordedAt) return null;
   const latitude = Number(lat), longitude = Number(lng), accuracy = Number(precision);
   const at = timestamp(recordedAt,visitDate);
   if (!lat || !lng || !precision || !at ||
       !Number.isFinite(latitude) || Math.abs(latitude)>90 || !Number.isFinite(longitude) || Math.abs(longitude)>180 ||
       !Number.isFinite(accuracy) || accuracy<0) fail(label + 'の緯度・経度・位置精度・位置取得日時を確認してください。');
   return {latitude,longitude,accuracy,timestamp:at};
  }
  const location = readLocation(row.latitude,row.longitude,row.accuracy,row.locationAt,'開始地点');
  if (location && (row.stage === '中止' || row.stage === '予定' || (!startedAt && row.stage !== '訪問済み'))) {
   fail('予定・中止の行に開始地点は指定できません。');
  }
  const parkedAt = timestamp(row.parkedAt,visitDate);
  const parkingLocation = readLocation(row.parkingLatitude,row.parkingLongitude,row.parkingAccuracy,row.parkingLocationAt,'駐車地点');
  if ((row.parkedAt || parkingLocation) && !parkedAt) fail('駐車完了日時を確認してください。');
  let destination = null;
  if (row.destinationLatitude || row.destinationLongitude) {
   const decimal = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/iu;
   destination = coordinates(Number(row.destinationLatitude),Number(row.destinationLongitude));
   if (!destination || !decimal.test(row.destinationLatitude) || !decimal.test(row.destinationLongitude)) {
    fail('訪問先の緯度と経度を両方確認してください。');
   }
  }
  let cardIds = null;
  if (row.cardIds) {
   try {cardIds = JSON.parse(row.cardIds)} catch {fail('紐付け名刺IDは空欄か、出力時の書式を使用してください。')}
   if (!Array.isArray(cardIds) || !cardIds.every(id => typeof id === 'string' && id)) fail('紐付け名刺IDの形式が正しくありません。');
   cardIds = [...new Set(cardIds)];
  }
  let checkedItems = [];
  if (row.checkedItems.trim()) {
   const text = row.checkedItems.trim();
   try {checkedItems = checklist(JSON.parse(text))}
   catch {fail('訪問後のチェック項目は空欄か、出力時の書式を使用してください。')}
  }
  return {id:row.id,date:visitDate,time:visitTime,company:row.company,person:row.person,place:row.place,
   purpose:row.purpose,startedAt,endedAt,parkedAt,parkingLocation,note:row.note,followUps:reminders,
   followUpDate:reminders[0]?.date || '',followUpTask:reminders[0]?.task || '',
   cancelled:row.stage === '中止',completed:row.stage === '訪問済み' || Boolean(endedAt),location,cardIds,
   unplanned:row.unplanned === '予定外', visitor:row.visitor, intentOwner:row.intentOwner, result:row.result,
   inVisitNote:row.inVisitNote,checkedItems,...(destination ? {destination} : {})};
 }

 function parse(text) {
  const [header, ...data] = splitRows(text.replace(/^\uFEFF/u,''));
  const labels = columns.map(([, label]) => label);
  const expected = [18,24,28,29,30].includes(header?.length) ? labels.slice(0,header.length) : labels;
  if (!header || header.length !== expected.length || expected.some(label => !header.includes(label))) {
   throw new Error('訪問CSVの列名を確認してください。「取り込み用ひな形を出力」から取得できます。');
  }
  const indices = labels.map(label => header.indexOf(label));
  const visits = [];
  for (const [index, row] of data.entries()) {
   if (row.every(value => !value.trim())) continue;
   const line = index + 2;
   if (row.length !== header.length) throw new Error(line + '行目：列の数がひな形と一致しません。');
   const values = indices.map(i => row[i]);
   if (values[0].trim() === exampleId) continue;
   const visit = readRecord(values,line);
   visits.push(visit);
  }
  return visits;
 }

 function fingerprint(visit) {
  const data = rowData(visit);
  return JSON.stringify(columns.slice(1).map(([key]) => data[key] ?? ''));
 }

 async function readText(file) {
  const bytes = await file.arrayBuffer();
  let text;
  try {text = new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
  catch {text = new TextDecoder('shift_jis',{fatal:true}).decode(bytes)}
  return text.replace(/^\uFEFF/u,'');
 }

 async function read(file) {return parse(await readText(file))}

 return {stage, date, time, timestamp, asLocalInput, followUps, checklist, coordinates, encode, template, parse, read, fingerprint, readText, splitRows};
})();
