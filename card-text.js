'use strict';

function extractCardCandidates(text) {
 const unique = values => [...new Set(values)];
 const lines = text.split(/\r\n?|\n/u).map(line => {
  const original = line.trim();
  const value = original.normalize('NFKC').replace(/[‐‑‒–—―−]/gu, '-');
  return {original, value};
 }).filter(line => line.value);

 const corporate = /(?:株式会社|有限会社|合同会社|合資会社|合名会社|会社|法人|\((?:株|有|同|資|名)\)|\b(?:inc\.?|ltd\.?|llc|corp\.?|co\.,?\s*ltd)\b)/iu;
 const emailPattern = /[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/giu;
 const contactLabel = /(?:\btel\s*[&/／]\s*fax\b|\bfax\b|ファクス|ファックス|\btel(?:ephone)?\b|\bphone\b|\bmobile\b|\be-?mail\b|携帯|直通|代表電話|電話|メール)/iu;
 const roleLine = /(?:部長|課長|係長|主任|代表取締役|取締役|マネージャー|営業部|事業部|営業所|支店|本社|事務所|事業所|本部|支社|センター|カンパニー|オフィス|事業責任者|執行役員|担当|部門|役員|社長|会長|名刺|プロフィール|営業|広報|総務|部署|役職)/u;
 const zipPattern = /^(?:住所\s*[:：]\s*)?(?:〒\s*)?(\d{3})\s*-?\s*(\d{4})(?=\D|$)\s*/u;
 const locality = /(?:北海道|東京都|(?:京都|大阪)府|[一-龯々]{2,4}県|[一-龯々]{1,8}(?:市|区|郡|町|村))/u;
 const locationDetail = /(?:\d+\s*(?:丁目|番地?|号|条|階|F\b)|ビル|マンション|タワー|ハイツ|[一-龯々ぁ-んァ-ヶ][^\d]{0,16}\d+(?:\s*[-—]\s*\d+)+)/iu;
 const urlLine = /(?:https?:\/\/|www\.|\bURL\b)/iu;

 const phonePattern = /(?<![\dA-Za-z@])(?:\+81[ \t-]*(?:\(0\)[ \t-]*)?(?:\(\d{1,4}\)[ \t-]*|\d{1,4}[ \t-]+)\d{1,4}[ \t-]+\d{3,4}|(?:\(0\d{1,4}\)[ \t-]*|0\d{1,4}[ \t-]+)\d{1,4}[ \t-]+\d{3,4}|0\d{1,4}[ \t]*\(\d{1,4}\)[ \t-]*\d{3,4}|\+81[ \t-]*(?:\(0\)[ \t-]*)?\d{9,10}|0\d{9,10})(?!\d)/gu;
 const found = {company: [], person: [], role: [], address: [], email: [], tel: [], mobile: []};
 const occupied = new Set();

 for (const [index, line] of lines.entries()) {
  const value = line.value;
  const emails = (value.match(emailPattern) || []).filter(email => !email.includes('..'));
  found.email.push(...emails);
  if (emails.length || urlLine.test(value) || contactLabel.test(value)) occupied.add(index);
  // Exclude e-mails and URLs, but keep character offsets for the labels before each number.
  const numbersLine = value.replace(/^(?:住所\s*[:：]\s*)?〒\s*\d{3}\s*-?\s*\d{4}/u, zip => ' '.repeat(zip.length))
   .replace(emailPattern, email => ' '.repeat(email.length))
   .replace(/(?:https?:\/\/|www\.)\S+/giu, url => ' '.repeat(url.length));
  let afterLast = 0;
  for (const match of numbersLine.matchAll(phonePattern)) {
   const number = match[0].replace(/^[+ ]*81[ \t-]*\(0\)[ \t-]*/u, '+81-').replace(/[ \t]+/gu, '-');
   const digits = number.replace(/\D/gu, '');
   const international = number.startsWith('+');
   const length = digits.length - (international ? 2 : 0);
   if (length < 10 - Number(international) || length > 11 - Number(international)) continue;
   occupied.add(index);
   const prefix = value.slice(afterLast, match.index);
   const labels = [...prefix.matchAll(new RegExp(contactLabel.source, 'giu'))];
   const previous = lines[index - 1]?.value || '';
   const previousLabel = previous.match(new RegExp('^(?:' + contactLabel.source + ')\\s*[:.：]?$', 'iu'));
   const label = labels.at(-1)?.[0] || (match.index === 0 ? previousLabel?.[0] || '' : '');
   afterLast = match.index + match[0].length;
   if (/fax|ファクス|ファックス/iu.test(label) && !/tel/iu.test(label)) continue;
   const domestic = international ? '0' + digits.slice(2) : digits;
   const mobile = /携帯|直通|mobile/iu.test(label) || /^(?:050|060|070|080|090)\d{8}$/u.test(domestic);
   found[mobile ? 'mobile' : 'tel'].push(number);
  }
  const role = line.original.match(/^(?:担当部署(?:・役職)?|部署(?:・役職)?|役職)\s*[:：]\s*(.+)$/u);
  if (role) {
   found.role.push(role[1].trim());
   occupied.add(index);
   continue;
  }
  const companyLabel = /^(?:社名|会社名)\s*[:：]\s*/u;
  if (companyLabel.test(value) || (corporate.test(value) && !emails.length && !urlLine.test(value) && !contactLabel.test(value))) {
   const company = line.original.replace(companyLabel, '').trim();
   if (company && !/^(?:社名|会社名|会社)$/u.test(company)) found.company.push(company);
   occupied.add(index);
  }
 }

 function addressContinuation(line, isFirstPart, hasPostal) {
  if (!line || corporate.test(line.value) || urlLine.test(line.value) ||
      contactLabel.test(line.value) || zipPattern.test(line.value) || line.value.includes('@')) return false;
  return locality.test(line.value) || locationDetail.test(line.value) ||
   (/^\d/u.test(line.value) && /[-丁目番条号階]/u.test(line.value)) ||
   (isFirstPart && hasPostal && /^.{1,45}\d/u.test(line.value));
 }

 for (const [index, line] of lines.entries()) {
  if (occupied.has(index)) continue;
  const zip = line.value.match(zipPattern);
  const textWithoutLabel = line.value.replace(/^住所\s*[:：]\s*/u, '');
  if (!zip && !/^住所\s*[:：]/u.test(line.value) && !textWithoutLabel.startsWith('〒') &&
      !(locality.test(textWithoutLabel) && (locationDetail.test(textWithoutLabel) ||
       addressContinuation(lines[index + 1], false, false)))) continue;
  const firstPart = zip ? line.value.slice(zip[0].length).trim() : textWithoutLabel.replace(/^〒\s*/u, '');
  const postal = zip ? '〒' + zip[1] + '-' + zip[2] : textWithoutLabel.startsWith('〒') ? '〒' : '';
  const parts = [postal, firstPart].filter(Boolean);
  occupied.add(index);
  // A postal code may be on its own line, followed by the street and building.
  const maxExtra = postal && !firstPart ? 2 : 1;
  for (let offset = 1; offset <= maxExtra; offset++) {
   const next = lines[index + offset];
   if (occupied.has(index + offset) || !addressContinuation(next, !firstPart && offset === 1, Boolean(postal))) break;
   parts.push(next.original);
   occupied.add(index + offset);
  }
  if (parts.length > 1 || (parts.length === 1 && parts[0] !== '〒')) found.address.push(parts.join(' '));
 }

 const labeledNames = [];
 const inferredNames = [];
 const nameLabel = /^(?:氏名|お名前|名前|name)(?:\s*:\s*|\s+)(.+)$/iu;
 for (const [index, line] of lines.entries()) {
  if (occupied.has(index)) continue;
  const labeled = line.value.match(nameLabel);
  if (labeled) {
   const originalName = line.original.replace(/^(?:氏名|お名前|名前|name)(?:\s*[:：]\s*|\s+)/iu, '');
   labeledNames.push(originalName === line.original ? labeled[1] : originalName);
   continue;
  }
  if (roleLine.test(line.value)) continue;
  const japanese = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々ー・\s]{2,16}$/u.test(line.value);
  const latin = /^[\p{Script=Latin}]+(?:[.'’\-][\p{Script=Latin}]+)*\.?(?:\s+[\p{Script=Latin}]+(?:[.'’\-][\p{Script=Latin}]+)*\.?){1,3}$/u.test(line.value);
  if (japanese || latin) inferredNames.push(line.original);
 }
 found.person = [...labeledNames, ...inferredNames.slice(0, 3)];
 for (const key of Object.keys(found)) found[key] = unique(found[key]);
 return found;
}

const ocrFields = [
 ['company', '社名'], ['person', '氏名'], ['role', '部署・役職'], ['address', '住所'],
 ['email', 'メールアドレス'], ['tel', '電話番号（代表・種別不明）'], ['mobile', '直通・携帯'],
];
const ocrInput = $('ocr');
const ocrResults = $('ocrResults');
const ocrStatus = $('ocrStatus');
const ocrOptions = new Map();

for (const [key, label] of ocrFields) {
 const row = node('div', '');
 row.className = 'ocr-row';
 const wrappingLabel = node('label', label);
 const select = document.createElement('select');
 wrappingLabel.append(select);
 const button = node('button', '反映');
 button.type = 'button';
 button.setAttribute('aria-label', label + 'の候補を反映');
 button.onclick = () => {
  if (!select.value) return;
  reflectOcrField(key, select.value);
  ocrStatus.textContent = label + 'を入力欄に反映しました。';
 };
 row.append(wrappingLabel, button);
 $('ocrFields').append(row);
 ocrOptions.set(key, {select, button});
}

function reflectOcrField(key, value) {
 field(key).value = value;
 if (key !== 'person') $('more').open = true;
}

function showOcrCandidates() {
 const hasText = Boolean(ocrInput.value.trim());
 const found = extractCardCandidates(ocrInput.value);
 let count = 0;
 for (const [key, {select, button}] of ocrOptions) {
  const values = found[key];
  const options = values.map(value => new Option(value, value));
  if (!options.length) options.push(new Option('候補なし', ''));
  select.replaceChildren(...options);
  select.disabled = button.disabled = !values.length;
  if (values.length) count++;
 }
 ocrResults.hidden = !hasText;
 $('ocrFill').disabled = !count;
 ocrStatus.textContent = hasText && !count ? '候補が見つかりませんでした。入力欄に直接記入できます。' : '';
}

ocrInput.addEventListener('input', showOcrCandidates);
form.addEventListener('reset', () => queueMicrotask(showOcrCandidates));
$('ocrFill').onclick = () => {
 let filled = 0;
 for (const [key, {select}] of ocrOptions) {
  if (!select.value || field(key).value.trim()) continue;
  reflectOcrField(key, select.value);
  filled++;
 }
 ocrStatus.textContent = filled ? filled + '項目を入力欄に反映しました。' : '候補がある項目にはすでに情報が入力されています。';
};
