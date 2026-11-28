'use strict';

const visitRadar = (() => {
 const directions = [
  ['↑','北'],['↗','北東'],['→','東'],['↘','南東'],
  ['↓','南'],['↙','南西'],['←','西'],['↖','北西'],
 ];
 const radians = degrees => degrees * Math.PI / 180;
 const degrees = radians => radians * 180 / Math.PI;
 const earthKm = 6371.0088;

 function parsePoint(value) {
  const coordinates = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*[,、]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)$/iu;
  const text = value.trim().normalize('NFKC');
  const pairs = [text];
  if (text.startsWith('https://')) {
   try {
    const url = new URL(text);
    if (/^(?:(?:www|maps)\.)?google\.(?:com|co\.jp)$/u.test(url.hostname)) {
     pairs.push(url.searchParams.get('query'),url.searchParams.get('q'),url.searchParams.get('ll'));
     const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?:!|$)/u.exec(decodeURIComponent(url.pathname));
     if (pin) pairs.push(pin[1] + ',' + pin[2]);
    }
   } catch {
    return null;
   }
  }
  for (const pair of pairs) {
   const parts = coordinates.exec(pair?.trim() || '');
   if (!parts) continue;
   const point = visitCsv.coordinates(Number(parts[1]),Number(parts[2]));
   if (point) return point;
  }
  return null;
 }

 function pointText(point) {
  return point ? point.latitude + ', ' + point.longitude : '';
 }

 function relativePosition(origin, target) {
  if (!origin || !target) return null;
  const start = radians(origin.latitude);
  const end = radians(target.latitude);
  const longitude = radians(((target.longitude - origin.longitude + 540) % 360) - 180);
  const haversine = Math.sin((end-start)/2)**2 + Math.cos(start)*Math.cos(end)*Math.sin(longitude/2)**2;
  const km = 2 * earthKm * Math.asin(Math.sqrt(Math.min(1, Math.max(0,haversine))));
  if (km < 0.001) return {km:0,bearing:0,arrow:'•',direction:'同地点'};
  const y = Math.sin(longitude) * Math.cos(end);
  const x = Math.cos(start)*Math.sin(end) - Math.sin(start)*Math.cos(end)*Math.cos(longitude);
  const bearing = (degrees(Math.atan2(y,x)) + 360) % 360;
  const [arrow,direction] = directions[Math.round(bearing/45)%8];
  return {km,bearing,arrow,direction};
 }

 function formatDistance(km) {
  return km.toFixed(km > 0 && km < 1 ? 2 : 1) + ' km';
 }

 function positionText(relative) {
  return relative.arrow + ' ' + relative.direction + ' ' + formatDistance(relative.km);
 }

 function plotPosition(relative, range) {
  const angle = radians(relative.bearing);
  const radius = 40 * relative.km / range;
  return {left:50 + radius*Math.sin(angle),top:50 - radius*Math.cos(angle)};
 }

 function create({todayVisits, openVisit, redraw, locate, active}) {
  const hqKey = 'meishi:' + location.pathname.replace(/index\.html$/,'') + ':radar-headquarters';
  const hqInput = $('radarHeadquarters');
  const hqStatus = $('radarHeadquartersStatus');
  const useHqPosition = $('radarUseHeadquartersPosition');
  const panel = $('visitRadar');
  const toggle = $('showRadar');
  const basis = $('radarBasis');
  const locateButton = $('radarLocate');
  const originStatus = $('radarOriginStatus');
  const plot = $('radarPlot');
  const markers = $('radarMarkers');
  const list = $('radarDestinations');
  const scale = $('radarScale');
  let current = null;
  let currentState = '';
  let generation = 0;

  function headquarters() {
   try {
    const saved = JSON.parse(localStorage.getItem(hqKey));
    return visitCsv.coordinates(saved?.latitude,saved?.longitude);
   } catch {return null}
  }

  function origin() {
   return basis.value === 'current' ? current : headquarters();
  }

  function destination(visit) {
   return visit.destination || visit.location;
  }

  function companyName(visit) {
   const relative = relativePosition(origin(),destination(visit));
   return visit.company + (relative ? '（' + positionText(relative) + '）' : '');
  }

  function dot(done) {
   const marker = node('i','');
   marker.className = 'radar-dot' + (done ? ' radar-dot--done' : '');
   marker.setAttribute('aria-hidden','true');
   return marker;
  }

  function draw() {
   if (panel.hidden) return;
   const point = origin();
   const usingCurrent = basis.value === 'current';
   locateButton.hidden = !usingCurrent;
   locateButton.disabled = currentState === 'loading';
   originStatus.textContent = usingCurrent ?
    (currentState === 'loading' ? '現在地を取得しています…' :
     currentState === 'failed' ? current ? '現在地の更新に失敗しました。前回の位置で表示中です。' : '現在地を取得できませんでした。' :
     current ? '取得時刻 ' + visitCsv.asLocalInput(current.timestamp).slice(11,16) : '現在地を取得してください。') :
    point ? '' : '本社の位置は「設定 → レーダーの本社位置」で登録できます。';
   markers.replaceChildren();
   list.replaceChildren();
   const entries = todayVisits().filter(visit => visitCsv.stage(visit) !== '中止')
    .sort((a,b) => a.time.localeCompare(b.time));
   const positions = entries.map(visit => ({visit, point:destination(visit)}));
   const farthest = positions.reduce((max,item) => {
    item.relative = relativePosition(point,item.point);
    return Math.max(max,item.relative?.km ?? 0);
   },0);
   const range = Math.max(.1,Math.ceil(farthest * 10)/10);
   plot.hidden = !point;
   scale.hidden = !point;
   scale.textContent = '外周 ' + formatDistance(range) + ' · 直線距離';
   if (!entries.length) list.append(node('li','今日の訪問はありません。'));
   for (const item of positions) {
    const {visit,relative} = item;
    const status = visitCsv.stage(visit);
    const done = status === '訪問済み';
    const name = visit.company + (relative ? '（' + positionText(relative) + '）' : '');
    if (relative) {
     const marker = node('button','');
     marker.type = 'button';
     marker.className = 'radar-point';
     const position = plotPosition(relative,range);
     marker.style.left = position.left + '%';
     marker.style.top = position.top + '%';
     marker.title = name + ' · ' + status;
     marker.setAttribute('aria-label',marker.title);
     marker.append(dot(done));
     marker.onclick = () => openVisit(visit.id);
     markers.append(marker);
    }
    const row = node('li','');
    const button = node('button','');
    const text = node('span','');
    text.append(node('strong',visit.time + '　' + name),
     node('small',status + (item.point ? '' : ' · 訪問先の座標未登録')));
    button.type = 'button';
    button.append(dot(done),text);
    button.onclick = () => openVisit(visit.id);
    row.append(button);
    list.append(row);
   }
  }

  async function locateOrigin() {
   if (currentState === 'loading') return;
   const request = generation;
   currentState = 'loading';
   draw();
   const point = await locate();
   if (request !== generation) return;
   if (point) current = point;
   currentState = point ? '' : 'failed';
   if (active('visits')) redraw();
  }

  toggle.onclick = () => {
   panel.hidden = !panel.hidden;
   toggle.setAttribute('aria-expanded',String(!panel.hidden));
   draw();
  };
  basis.onchange = () => {
   redraw();
   if (basis.value === 'current' && !current) return locateOrigin();
  };
  locateButton.onclick = locateOrigin;
  $('radarHeadquartersForm').onsubmit = event => {
   event.preventDefault();
   const value = hqInput.value.trim();
   const point = parsePoint(value);
   if (value && !point) {
    hqStatus.textContent = '本社の緯度・経度を確認してください。';
    return;
   }
   try {
    if (point) localStorage.setItem(hqKey,JSON.stringify(point));
    else localStorage.removeItem(hqKey);
    hqInput.value = pointText(point);
    hqStatus.textContent = point ? '本社位置を保存しました。' : '本社位置を解除しました。';
   } catch {
    hqStatus.textContent = '本社位置を保存できませんでした。';
   }
  };
  useHqPosition.onclick = async () => {
   const request = generation;
   useHqPosition.disabled = true;
   hqStatus.textContent = '現在地を取得しています…';
   const point = await locate();
   if (request !== generation) return;
   useHqPosition.disabled = false;
   if (!active('settings')) return;
   if (point) hqInput.value = pointText(point);
   hqStatus.textContent = point ? '入力した座標を確認して保存してください。' : '現在地を取得できませんでした。';
  };

  return {companyName,draw,renderSettings() {
   hqInput.value = pointText(headquarters());
   hqStatus.textContent = '';
  },clear() {
   generation++;
   current = null;
   currentState = '';
   panel.hidden = true;
   basis.value = 'headquarters';
   toggle.setAttribute('aria-expanded','false');
   useHqPosition.disabled = false;
   originStatus.textContent = hqStatus.textContent = hqInput.value = '';
   markers.replaceChildren();
   list.replaceChildren();
  }};
 }

 return {parsePoint,pointText,relativePosition,plotPosition,create};
})();
