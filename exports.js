'use strict';

const output = (() => {
 const columns = [
  ['company', '社名'], ['person', '氏名'], ['role', '部署・役職'],
  ['tel', '電話番号（代表）'], ['mobile', '直通・携帯'], ['address', '住所'],
  ['email', 'メールアドレス'], ['date', '受け取った日'], ['memo', 'ひとことメモ'],
 ];
 const exactColumns = new Set(['date', 'tel', 'mobile', 'email']);
 const fullKatakana = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン\u3099\u309A';
 const half = new Map(Array.from(fullKatakana, (char, i) => [char, String.fromCharCode(0xff61 + i)]));
 // Some historical katakana have no half-width encoding and are kept as entered.
 function width(text, katakana, latin) {
  let value = String(text ?? '');
  if (katakana === 'full') {
   value = value.replace(/[\uFF61-\uFF9F]+/gu, run => run.normalize('NFKC'));
  }
  if (katakana === 'half') {
   value = value.replace(/[\u30A1-\u30FA\u30FB\u30FC\u3099-\u309C\u3001\u3002\u300C\u300D]+/gu, run =>
    Array.from(run.normalize('NFC'), char => {
     const parts = Array.from(char.normalize('NFD'), part => half.get(part === '゛' ? '\u3099' : part === '゜' ? '\u309A' : part));
     return parts.every(Boolean) ? parts.join('') : char;
    }).join(''));
  }
  if (latin === 'half') value = value.replace(/[Ａ-Ｚａ-ｚ]/gu, char => char.normalize('NFKC'));
  if (latin === 'full') value = value.replace(/[A-Za-z]/gu, char => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
  return value;
 }

 function requiresCsvEscape(text) {
  // Protect spreadsheet users when importing data or notes entered by someone else.
  return /^[\t\r\n]/u.test(text) || /^[=+\-@]/u.test(text.normalize('NFKC').trimStart());
 }

 function csvCell(value) {
  const text = String(value ?? '');
  return '"' + (requiresCsvEscape(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
 }

 function csv(cards, note, katakana, latin) {
  const labels = columns.map(([, label]) => label);
  if (note) labels.push('共有注釈');
  const table = [labels, ...cards.map(card => {
   const values = columns.map(([key]) => exactColumns.has(key) ? card[key] : width(card[key], katakana, latin));
   if (note) values.push(width(note, katakana, latin));
   return values;
  })];
  return '\uFEFF' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
 }

 function wrap(context, value, maxWidth) {
  const lines = [];
  for (const paragraph of value.split(/\r\n|\r|\n/u)) {
   let line = '';
   for (const char of paragraph) {
    if (line && context.measureText(line + char).width > maxWidth) {
     lines.push(line);
     line = '';
    }
    line += char;
   }
   lines.push(line);
  }
  return lines;
 }

 async function renderCard(card, note) {
  const width = 1000;
  const height = 1414;
  const margin = 62;
  const lineHeight = 38;
  const pages = [];
  let canvas, context, y;
  function newPage(continued) {
   canvas = document.createElement('canvas');
   canvas.width = width;
   canvas.height = height;
   context = canvas.getContext('2d');
   context.fillStyle = '#fffdf8';
   context.fillRect(0, 0, width, height);
   context.fillStyle = '#25493e';
   context.fillRect(0, 0, width, 22);
   context.font = 'bold 38px system-ui, sans-serif';
   context.fillText(continued ? '名刺情報（続き）' : '名刺情報', margin, 102);
   y = 163;
   pages.push(canvas);
  }
  function print(value, size, color) {
   context.font = size + 'px system-ui, sans-serif';
   const lines = wrap(context, value, width - margin * 2);
   for (const line of lines) {
    if (y > height - margin) newPage(true);
    context.font = size + 'px system-ui, sans-serif';
    context.fillStyle = color;
    context.fillText(line, margin, y);
    y += lineHeight;
   }
  }

  newPage(false);
  if (card.image) {
   const image = new Image();
   image.src = card.image;
   await image.decode();
   const scale = Math.min((width - margin * 2) / image.width, 410 / image.height);
   context.drawImage(image, margin, y - 24, image.width * scale, image.height * scale);
   y += image.height * scale + 28;
  }
  for (const [key, label] of columns) {
   if (card[key]) print(label + '　' + card[key], 26, '#253e36');
  }
  if (note) {
   y += 20;
   print('共有注釈', 27, '#25493e');
   print(note, 26, '#253e36');
  }
  return pages;
 }

 function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => {
   canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error());
   }, type, 0.88);
  });
 }

 // Each page draws an embedded JPEG so the recipient does not need a Japanese font.
 function pdf(images) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let position = 0;
  function add(data) {
   const bytes = typeof data === 'string' ? encoder.encode(data) : data;
   parts.push(bytes);
   position += bytes.length;
  }
  function object(id, contents) {
   offsets[id] = position;
   add(id + ' 0 obj\n');
   for (const content of contents) add(content);
   add('\nendobj\n');
  }
  add('%PDF-1.4\n');
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  const kids = images.map((_, i) => (3 + i * 3) + ' 0 R').join(' ');
  object(2, ['<< /Type /Pages /Kids [ ' + kids + ' ] /Count ' + images.length + ' >>']);
  for (const [i, img] of images.entries()) {
   const page = 3 + i * 3;
   const drawing = 'q 595 0 0 842 0 0 cm /Picture Do Q\n';
   object(page, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]' +
    ' /Resources << /XObject << /Picture ' + (page + 1) + ' 0 R >> >> /Contents ' + (page + 2) + ' 0 R >>']);
   object(page + 1, ['<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.data.length + ' >>\nstream\n',
    img.data, '\nendstream']);
   object(page + 2, ['<< /Length ' + drawing.length + ' >>\nstream\n' + drawing + 'endstream']);
  }
  const xref = position;
  add('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) add(String(offset).padStart(10, '0') + ' 00000 n \n');
  add('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, {type: 'application/pdf'});
 }

 async function createFiles(cards, options) {
  const {format, note, katakana, latin} = options;
  const name = 'meishi-' + options.date;
  if (format === 'csv') {
   return [new File([csv(cards, note, katakana, latin)], name + '.csv', {type: 'text/csv;charset=utf-8'})];
  }
  const images = [];
  const files = [];
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  for (const [i, card] of cards.entries()) {
   const pages = await renderCard(card, note);
   for (const [j, canvas] of pages.entries()) {
    const blob = await canvasBlob(canvas, type);
    if (format === 'pdf') {
     images.push({width: canvas.width, height: canvas.height, data: new Uint8Array(await blob.arrayBuffer())});
    } else {
     const suffix = '-' + (i + 1) + (pages.length > 1 ? '-' + (j + 1) : '');
     files.push(new File([blob], name + suffix + '.' + format, {type}));
    }
    canvas.width = 1;
    canvas.height = 1;
   }
  }
  return format === 'pdf' ? [new File([pdf(images)], name + '.pdf', {type: 'application/pdf'})] : files;
 }

 function escapeContactText(value) {
  return value.replaceAll('\\', '\\\\').replace(/\r\n?|\n/gu, '\\n')
   .replaceAll(';', '\\;').replaceAll(',', '\\,');
 }

 function foldContactLine(line, encoder) {
  let head = '';
  let bytes = 0;
  for (const character of line) {
   const size = encoder.encode(character).length;
   if (bytes + size > 75) {
    head += '\r\n ';
    bytes = 1;
   }
   head += character;
   bytes += size;
  }
  return head;
 }

 function nameParts(card) {
  const person = String(card.person ?? '').trim();
  if (typeof card.familyName === 'string' || typeof card.givenName === 'string') {
   const familyName = String(card.familyName ?? '').trim();
   const givenName = String(card.givenName ?? '').trim();
   return {familyName, givenName, unparsedName: familyName || givenName ? '' : person};
  }

  // Older cards stored only the display name. Keep the existing Japanese-name convention.
  const parts = person.split(/\s+/u);
  const japaneseName = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(person);
  if (japaneseName && parts.length === 2) {
   return {familyName: parts[0], givenName: parts[1], unparsedName: ''};
  }
  return {familyName: '', givenName: '', unparsedName: person};
 }

 function contactFile(card) {
  const {person, company, role, tel, mobile, address, email} = Object.fromEntries(
   ['person', 'company', 'role', 'tel', 'mobile', 'address', 'email']
    .map(key => [key, String(card[key] ?? '').trim()])
  );
  const name = person || company || tel || mobile || email || address || role;
  if (!name) return null;

  const {familyName, givenName, unparsedName} = nameParts(card);
  const escape = escapeContactText;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + escape(name),
   'N:' + [familyName, givenName || unparsedName, '', '', ''].map(escape).join(';')];
  if (company) lines.push('ORG:' + escape(company));
  if (role) lines.push('TITLE:' + escape(role));
  if (tel) lines.push('TEL;TYPE=WORK,VOICE:' + escape(tel.normalize('NFKC')));
  if (mobile) {
   const number = mobile.normalize('NFKC');
   const digits = number.replace(/\D/gu, '');
   const type = /^(?:0|81)(?:60|70|80|90)\d{8}$/u.test(digits) ? 'CELL' : 'WORK,VOICE';
   lines.push('TEL;TYPE=' + type + ':' + escape(number));
  }
  if (email) lines.push('EMAIL;TYPE=INTERNET,WORK:' + escape(email));
  if (address) {
   const postal = address.match(/^〒?\s*([\d０-９]{3})[\s‐‑‒–—―−－-]*([\d０-９]{4})(?![\d０-９])\s*/u);
   const code = postal ? (postal[1] + '-' + postal[2]).normalize('NFKC') : '';
   const street = postal ? address.slice(postal[0].length) : address;
   lines.push('ADR;TYPE=WORK:' + ['', '', street, '', '', code, ''].map(escape).join(';'));
  }
  lines.push('END:VCARD');
  const encoder = new TextEncoder();
  const content = lines.map(line => foldContactLine(line, encoder)).join('\r\n') + '\r\n';
  const safeName = Array.from((person || company || '名刺手帖').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/gu, '_'))
   .slice(0, 60).join('').replace(/[. ]+$/u, '');
  return new File([content], (safeName || '名刺手帖') + '.vcf', {type: 'text/vcard;charset=utf-8'});
 }

 return {columns, width, csv, csvCell, requiresCsvEscape, createFiles, contactFile, nameParts};
})();
