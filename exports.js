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

 function csvCell(value) {
  const text = String(value ?? '');
  // Protect spreadsheet users when importing data or notes entered by someone else.
  const control = /^[\t\r\n]/u.test(text);
  const formula = /^[=+\-@]/u.test(text.normalize('NFKC').trimStart());
  return '"' + (control || formula ? "'" : '') + text.replaceAll('"', '""') + '"';
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

 return {columns, width, csv, createFiles};
})();
