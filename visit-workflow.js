'use strict';

const visitWorkflow = (() => {
 const fields = [
  ['company', '会社名', ['社名','顧客名','顧客名称','得意先名','得意先名称','取引先名','訪問先','訪問会社名','法人名','企業名']],
  ['person', '担当者名', ['氏名','担当者','先方担当者','顧客担当者']],
  ['place', '訪問場所', ['住所','所在地','郵便番号付き住所','訪問先住所']],
  ['purpose', '訪問目的・用件', ['訪問目的','目的','用件','訪問内容','予定内容']],
  ['time', '訪問時刻', ['時刻','訪問予定時刻','予定時刻','開始時刻','訪問時間']],
 ];
 const normalize = text => String(text || '').normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
 const pageSize = 20;

 function suggestedColumns(header) {
  const normalized = header.map(normalize);
  return Object.fromEntries(fields.map(([key, label, aliases]) => {
   const matches = [label,...aliases].map(candidate => normalized.indexOf(normalize(candidate)));
   return [key, matches.find(index => index >= 0) ?? -1];
  }));
 }

 function extractCustomers(rows, columns) {
  return rows.map(row => {
   const customer = Object.fromEntries(fields.map(([key]) => [key,String(row[columns[key]] || '').trim()]));
   customer.time = visitCsv.time(customer.time.normalize('NFKC'));
   return customer;
  }).filter(customer => customer.company);
 }

 function report(day, visits) {
  const clock = visit => visitCsv.asLocalInput(visit.startedAt).slice(11,16) || visit.time;
  const completed = visits.filter(visit => visitCsv.stage(visit) === '訪問済み')
   .sort((left,right) => clock(left).localeCompare(clock(right)));
  let incomplete = 0;
  const entries = completed.map(visit => {
   const time = visitCsv.asLocalInput(visit.startedAt).slice(11,16);
   const required = [['訪問した人',visit.visitor],['訪問目的・用件',visit.purpose],['結果・得たこと',visit.result]];
   const missing = required.filter(([,value]) => !value?.trim()).map(([label]) => label);
   if (missing.length) incomplete++;
   const lines = [
    '■ ' + (time ? time + ' ' : '') + visit.company + (visit.unplanned ? '（予定外）' : ''),
    ...required.map(([label,value]) => label + '：' + (value?.trim() || '未入力')),
   ];
   if (visit.intentOwner) lines.splice(2,0,'誰の用件か：' + visit.intentOwner);
   if (visit.person) lines.push('面談先：' + visit.person);
   if (visit.checkedItems?.length) lines.push('チェック項目：' + visit.checkedItems.join('、'));
   if (visit.note) lines.push('補足：' + visit.note);
   for (const item of visitCsv.followUps(visit)) lines.push('次の対応：' + item.date + ' ' + item.task);
   return lines.join('\n');
  });
  return {text:entries.length ? [day+' 訪問日報',...entries].join('\n\n') : '',
   count:completed.length,incomplete,unplanned:completed.filter(visit => visit.unplanned).length};
 }

 function customerImport(schedule) {
  const panel = $('customerImport');
  const sourceForm = $('customerFileForm');
  const mapForm = $('customerMapForm');
  const planForm = $('customerPlanForm');
  const mapping = $('customerMapping');
  const status = $('customerStatus');
  const search = $('customerSearch');
  const list = $('customerRows');
  const columns = new Map();
  let rows = [];
  let customers = [];
  let page = 0;
  let generation = 0;
  let busy = false;

  function showPage(matches,pages) {
   $('customerPage').textContent = matches + '件 · ' + (page+1) + '/' + pages + 'ページ · 時刻入力済み ' +
    customers.filter(item => item.time).length + '件';
  }

  function draw() {
   const term = normalize(search.value);
   const matches = customers.filter(item => !term || normalize(item.company).includes(term) || normalize(item.person).includes(term));
   const pages = Math.max(1,Math.ceil(matches.length/pageSize));
   page = Math.min(page,pages-1);
   list.replaceChildren();
   for (const item of matches.slice(page*pageSize,(page+1)*pageSize)) {
    const row = node('tr','');
    const detail = node('td',item.company);
    if (item.person || item.place) detail.append(node('small',[item.person,item.place].filter(Boolean).join(' · ')));
    const cell = node('td','');
    const time = document.createElement('input');
    time.type = 'time';
    time.value = item.time;
    time.setAttribute('aria-label',item.company + 'の訪問時刻');
    time.oninput = () => {item.time = time.value; showPage(matches.length,pages)};
    cell.append(time);
    row.append(detail,cell);
    list.append(row);
   }
   $('customerPrev').disabled = page === 0;
   $('customerNext').disabled = page >= pages-1;
   showPage(matches.length,pages);
  }

  sourceForm.onsubmit = async event => {
   event.preventDefault();
   const file = $('customerFile').files[0];
   if (!file || busy) return;
   const request = ++generation;
   status.textContent = '';
   try {
    const [headers,...entries] = visitCsv.splitRows(await visitCsv.readText(file));
    if (request !== generation) return;
    if (!headers?.some(value => value.trim()) || !entries.some(row => row.some(value => value.trim()))) {
     throw new Error('先頭に列名があり、顧客が1件以上含まれるCSVを選んでください。');
    }
    rows = entries;
    customers = [];
    columns.clear();
    mapping.replaceChildren();
    const suggested = suggestedColumns(headers);
    for (const [key,label] of fields) {
     const field = node('label',label + (key === 'company' ? '（必須）' : '（任意）'));
     const select = document.createElement('select');
     const none = node('option',key === 'company' ? '列を選択' : '取り込まない');
     none.value = '-1';
     select.append(none);
     headers.forEach((header,index) => {
      const option = node('option',index+1 + '列目 · ' + (header.trim() || '列名なし'));
      option.value = index;
      select.append(option);
     });
     select.value = String(key === 'time' ? -1 : suggested[key]);
     columns.set(key,select);
     field.append(select);
     mapping.append(field);
    }
    mapForm.hidden = false;
    planForm.hidden = true;
    status.textContent = '顧客CSVの列を確認してください。';
   } catch (error) {
    if (request === generation) status.textContent = error.message || 'CSVを読み込めませんでした。';
   }
  };
  mapForm.onsubmit = event => {
   event.preventDefault();
   if (busy) return;
   const columnIndices = Object.fromEntries([...columns].map(([key,select]) => [key,Number(select.value)]));
   if (columnIndices.company < 0) {
    status.textContent = '会社名に使う列を選択してください。';
    return;
   }
   customers = extractCustomers(rows,columnIndices);
   status.textContent = customers.length ? customers.length+'件の顧客を読み込みました。' : '会社名のある行が見つかりません。';
   planForm.hidden = !customers.length;
   search.value = '';
   page = 0;
   draw();
  };
  search.oninput = () => {page = 0; draw()};
  $('customerPrev').onclick = () => {page--; draw()};
  $('customerNext').onclick = () => {page++; draw()};
  planForm.onsubmit = async event => {
   event.preventDefault();
   const selected = customers.filter(item => item.time);
   if (busy) return;
   if (!selected.length) {
    status.textContent = '追加する訪問の時刻を入力してください。';
    return;
   }
   const request = generation;
   const submit = planForm.querySelector('[type=submit]');
   submit.disabled = busy = true;
   try {
    const visitor = $('customerVisitor').value.trim();
    const counts = await schedule(selected.map(item => ({...item,visitor})));
    if (request !== generation || !counts) return;
    const completed = new Set(selected);
    customers = customers.filter(item => !completed.has(item));
    draw();
    status.textContent = '予定を' + counts.added + '件追加しました。重複 ' + counts.skipped + '件。';
   } finally {
    submit.disabled = busy = false;
   }
  };

  return {clear() {
   generation++;
   rows = [];
   customers = [];
   sourceForm.reset();
   planForm.reset();
   panel.open = false;
   mapForm.hidden = planForm.hidden = true;
   columns.clear();
   mapping.replaceChildren();
   list.replaceChildren();
   status.textContent = '';
  }};
 }

 return {suggestedColumns,extractCustomers,report,customerImport};
})();
