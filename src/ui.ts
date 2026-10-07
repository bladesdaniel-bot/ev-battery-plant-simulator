// Dashboard: renders every line in the plant, a station panel, stations table, lost-time Pareto and event log.
const $ = (s: string) => document.querySelector(s) as HTMLElement;
let plant = new Plant(PLANT_LINES, PLANT_CONNECTIONS);
connectSpc(plant);
connectVision(plant);
let running = true, speed = 10, autoOn = false;
let sel = { li: 0, si: plant.lines[0].st.findIndex(s => s.id === 'glue') };
let selShown = '', logShown = -1;

interface CardEls { root: HTMLElement; state: HTMLElement; ct: HTMLElement; bar: HTMLElement; q?: HTMLElement; meter?: HTMLElement; comps: Dict<HTMLElement>; cache: Dict<string> }
let cards: CardEls[][] = [];
let kpiEls: Dict<HTMLElement>[] = [];
let transferEls: { el: HTMLElement; conn: ConnectionDef }[] = [];

function selStation() { return plant.lines[sel.li].st[sel.si]; }
function selLine() { return plant.lines[sel.li]; }
function stateClass(s: Station) { return s.state === 'faulted' && s.planned ? 'planned' : s.state; }
function stateLabel(s: Station) {
  if (s.state === 'faulted') return s.planned ? 'Planned stop' : 'Faulted';
  if (s.state === 'starved') { const r = s.line.reasonLabel(s, s.reason); return r ? `Waiting for ${r}` : 'Starved'; }
  return s.state === 'running' ? 'Running' : 'Blocked';
}
function stateText(s: Station) {
  if (s.state === 'faulted') return `${stateLabel(s)}, ${fmtDur(s.fault)} left`;
  if (s.state === 'running' && s.part && s.part.id) return `Running ${s.part.id}${s.part.rw ? ' (rework)' : ''}`;
  return stateLabel(s);
}
function ctText(s: Station) { return s.per > 1 ? `${s.ct} s ×${s.per}` : `${s.ct} s`; }
function esc(x: string) { return x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Dict<string>)[c]); }

function build() {
  const multi = plant.lines.length > 1;
  $('#plant').innerHTML = plant.lines.map((ln, li) => {
    const conn = plant.connections.find(c => c.toLine === ln.def.id);
    const transfer = conn ? `<div class="transfer" data-conn="${conn.id}"><span class="t-label">${esc(conn.label)}</span><span class="slots" data-f="tq"></span></div>` : '';
    return `${transfer}<section class="line-block" aria-label="${esc(ln.def.name)}">
      <h2 class="line-title">${esc(ln.def.name)}</h2>
      <div class="kpis" data-li="${li}">
        <div class="kpi"><div class="l">Output</div><div class="v" data-k="jph">—</div><div class="s" data-k="jphS"></div></div>
        <div class="kpi"><div class="l">First-pass yield</div><div class="v" data-k="fpy">—</div><div class="s" data-k="fpyS"></div></div>
        <div class="kpi"><div class="l">Line OEE</div><div class="v" data-k="oee">—</div><div class="s">against ${ln.def.idealCycle} s design cycle</div></div>
        <div class="kpi"><div class="l">Work in process</div><div class="v" data-k="wip">0</div><div class="s" data-k="wipS"></div></div>
      </div>
      ${ln.def.lanes.map((lane, lj) => {
        const sts = ln.st.map((s, si) => ({ s, si })).filter(x => x.s.def.lane === lj);
        return `<div class="lane${lane.feeders ? ' feeders' : ''}"><h3>${esc(lane.name)}</h3><p class="lane-note">${esc(lane.note)}</p>
          <div class="stations" style="--n:${sts.length}">${sts.map(({ s, si }) => card(ln, li, s, si)).join('')}</div></div>`;
      }).join('')}
    </section>`;
  }).join('');
  cards = plant.lines.map((): CardEls[] => []);
  document.querySelectorAll<HTMLElement>('.st').forEach(b => {
    const li = +b.dataset.li, si = +b.dataset.si;
    const e: CardEls = { root: b, state: null, ct: null, bar: null, comps: {}, cache: {} };
    b.querySelectorAll<HTMLElement>('[data-f]').forEach(x => {
      const f = x.dataset.f;
      if (f.startsWith('c-')) e.comps[f.slice(2)] = x; else (e as any)[f] = x;
    });
    cards[li][si] = e;
    b.onclick = () => select(li, si);
  });
  kpiEls = plant.lines.map((_, li) => {
    const box = document.querySelector(`.kpis[data-li="${li}"]`), o: Dict<HTMLElement> = {};
    box.querySelectorAll<HTMLElement>('[data-k]').forEach(x => o[x.dataset.k] = x);
    return o;
  });
  transferEls = Array.from(document.querySelectorAll<HTMLElement>('.transfer')).map(el => ({ el, conn: plant.connection(el.dataset.conn) }));
  document.body.classList.toggle('multi', multi);
}
function card(ln: Line, li: number, s: Station, si: number) {
  const d = s.def, comps = ln.def.components;
  let to = '';
  if (d.out.comp) to = `To ${esc(ln.byId[d.out.to].name)}`;
  if (d.out.export) { const c = plant.connection(d.out.export); to = `To ${esc(plant.byId[c.toLine].def.short)}`; }
  return `<button class="st" data-li="${li}" data-si="${si}">
    <span class="st-top"><span class="st-name">${esc(d.name)}</span><span class="st-ct" data-f="ct"></span></span>
    <span class="st-state" data-f="state"></span>
    ${d.src ? '' : `<span class="row">Queue<span class="slots" data-f="q"></span></span>`}
    ${Object.keys(s.needs).map(k => `<span class="row">${esc(comps[k].label)}<span class="slots" data-f="c-${k}"></span></span>`).join('')}
    ${d.consumable ? `<span class="row">${esc(d.consumable.label)}<span class="meter"><i data-f="meter"></i></span></span>` : ''}
    ${to ? `<span class="feeds">${to}</span>` : ''}
    <span class="bar"><i data-f="bar"></i></span>
  </button>`;
}
function put(e: CardEls, key: string, el: HTMLElement, html: string) { if (e.cache[key] !== html) { e.cache[key] = html; el.innerHTML = html; } }
function slotsQ(s: Station) {
  let h = '';
  for (let j = 0; j < s.qcap; j++) { const p = s.buf[j]; h += p ? (p.rw ? '<i class="rw"></i>' : '<i class="on"></i>') : '<i></i>'; }
  return h + s.rwq.map(() => '<i class="rw"></i>').join('');
}
function slotsN(n: number, cap: number) { let h = ''; for (let j = 0; j < cap; j++) h += j < n ? '<i class="on"></i>' : '<i></i>'; return h; }

function updateLine() {
  const T = plant.takt();
  plant.lines.forEach((ln, li) => ln.st.forEach((s, si) => {
    const e = cards[li][si];
    const cls = 'st ' + stateClass(s) + (li === sel.li && si === sel.si ? ' sel' : '') + (s.part && s.part.rw ? ' rw' : '');
    if (e.root.className !== cls) e.root.className = cls;
    put(e, 'state', e.state, stateText(s));
    put(e, 'ct', e.ct, ctText(s));
    e.ct.classList.toggle('over', s.effCycle > T);
    if (e.q) put(e, 'q', e.q, slotsQ(s));
    for (const k in e.comps) put(e, 'c' + k, e.comps[k], slotsN(s.comps[k], ln.def.components[k].cap));
    if (e.meter) { const c = s.def.consumable; e.meter.style.width = (s.level / c.capacity * 100).toFixed(1) + '%'; e.meter.classList.toggle('low', s.level <= c.capacity * c.warnAt); }
    e.bar.style.width = s.part ? Math.min(100, s.prog / s.ct * 100).toFixed(1) + '%' : '0';
  }));
  transferEls.forEach(({ el, conn }) => {
    const t = plant.station(conn.toLine, conn.toStation);
    (el.querySelector('[data-f="tq"]') as HTMLElement).innerHTML = slotsN(t.buf.length, t.qcap);
  });
}

function setKpi(el: HTMLElement, text: string, cls = '') { el.textContent = text; el.className = 'v' + (cls ? ' ' + cls : ''); }
function renderUI() {
  $('#clock').textContent = fmt(plant.t);
  const T = plant.takt();
  plant.lines.forEach((ln, li) => {
    const k = kpiEls[li], unit = (ln.def.unitNames[ln.def.finalPrefix] || 'unit').toLowerCase() + 's';
    const jph = ln.jph();
    if (jph == null) { setKpi(k.jph, '—'); k.jphS.textContent = `${unit}/hr, warming up`; }
    else { const r = jph / plant.targetJPH; setKpi(k.jph, jph.toFixed(0), r >= 1 ? 'ok' : r >= .9 ? 'warn' : 'alarm'); k.jphS.textContent = `${unit}/hr vs ${plant.targetJPH} target`; }
    const f = ln.fpy();
    if (f == null) { setKpi(k.fpy, '—'); k.fpyS.textContent = `no ${unit} yet`; }
    else { setKpi(k.fpy, pct(f), f >= .97 ? '' : f >= .93 ? 'warn' : 'alarm'); k.fpyS.textContent = `${ln.rework} reworks, ${ln.scrap} scrapped units`; }
    const o = ln.lineOee(); setKpi(k.oee, o == null ? '—' : pct(o));
    setKpi(k.wip, String(ln.wip())); k.wipS.textContent = `${ln.good} out, ${ln.scrap} scrapped`;
  });

  const s = selStation(), ln = selLine(), o = ln.oee(s), d = s.def;
  $('#pLine').textContent = ln.def.name;
  $('#pName').textContent = d.name;
  const ps = $('#pState'); ps.textContent = stateText(s); ps.className = 'state ' + stateClass(s);
  $('#pRole').textContent = d.role || '';
  const key = sel.li + ':' + sel.si;
  if (selShown !== key) { ($('#ct') as HTMLInputElement).value = String(s.ct); selShown = key; }
  $('#ctOut').textContent = String(s.ct);
  const effTxt = s.per > 1 ? `${s.effCycle} s per unit (${s.per} parts)` : `${s.effCycle} s`;
  $('#ctNote').textContent = s.effCycle > T ? `${effTxt} is slower than takt (${T.toFixed(1)} s). This station will limit output.` : `${effTxt}, within takt (${T.toFixed(1)} s). Design cycle ${s.ct0} s.`;
  ($('#faultBtn') as HTMLButtonElement).disabled = s.fault > 0;
  ($('#clearBtn') as HTMLButtonElement).disabled = !(s.fault > 0);
  const sb = $('#serviceBtn'); sb.hidden = !d.service; if (d.service) sb.textContent = d.service.label;
  const cb = $('#consumeBtn'); cb.hidden = !d.consumable; if (d.consumable) cb.textContent = `Change ${d.consumable.label.toLowerCase()}`;
  const t = plant.t || 1;
  const rows: [string, string | number][] = [['Availability', pct(o.A)], ['Performance', pct(o.P)], ['Quality', pct(o.Q)], ['OEE', pct(o.O)], ['Cycles completed', s.done], ['Starved', pct(s.starvedT / t)], ['Blocked', pct(s.blockedT / t)]];
  if (d.introduce && d.introduce.wearPerCycle) rows.push(['Cycles since service', s.wear], ['Defect risk per cycle', pct(ln.defectRate(s))]);
  if (d.consumable) rows.push([`${d.consumable.label} left`, pct(s.level / d.consumable.capacity)], ['Cycles until change', s.level]);
  if (d.checkTimer) rows.push(['Open time limit', fmtDur(d.checkTimer.limit)]);
  $('#pStats').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');

  // Every line's stations, grouped under a header row for each line.
  $('#tbody').innerHTML = plant.lines.map((l, li) => `<tr class="grp"><th colspan="4">${esc(l.def.name)}</th></tr>` + l.st.map((x, i) => {
    const on = li === sel.li && i === sel.si;
    return `<tr data-li="${li}" data-i="${i}" aria-selected="${on}" tabindex="0">
    <td>${esc(x.name)}</td><td class="state ${stateClass(x)}">${stateLabel(x)}</td>
    <td class="num${x.effCycle > T ? ' over' : ''}">${x.effCycle} s</td><td class="num">${plant.t > 60 ? pct(l.oee(x).O) : '—'}</td></tr>`;
  }).join('')).join('');
  const multi = plant.lines.length > 1;
  // Root causes are stops that start at a station. Knock-on effects are the starved/blocked time they cause elsewhere.
  type Loss = { k: string; v: number; c: string };
  const causes: Loss[] = [], effects: Loss[] = [];
  plant.lines.forEach(l => l.st.forEach(x => {
    const n = (multi ? l.def.short + ' ' : '') + x.name;
    if (x.faultT > 1) causes.push({ k: `${n}, fault`, v: x.faultT, c: 'faulted' });
    if (x.plannedT > 1) causes.push({ k: `${n}, planned stop`, v: x.plannedT, c: 'planned' });
    if (x.blockedT > 1) effects.push({ k: `${n}, blocked`, v: x.blockedT, c: 'blocked' });
    for (const r in x.starvedBy) if (x.starvedBy[r] > 1) {
      const lbl = l.reasonLabel(x, r);
      if (r === 'consumable') causes.push({ k: `${n}, ${lbl} empty`, v: x.starvedBy[r], c: 'faulted' });
      else effects.push({ k: lbl ? `${n}, waiting for ${lbl}` : `${n}, starved`, v: x.starvedBy[r], c: 'starved' });
    }
  }));
  const keep = (a: Loss[], n: number) => a.sort((p, q) => q.v - p.v).filter(it => plant.t < 900 || it.v > 20).slice(0, n);
  const topC = keep(causes, 5), topE = keep(effects, 3);
  const max = Math.max(1, ...topC.map(it => it.v), ...topE.map(it => it.v));
  const bars = (a: Loss[]) => a.map(it => `<div class="pbar"><span>${esc(it.k)}</span><span class="val">${(it.v / 60).toFixed(1)} min</span><div class="track"><div class="fill ${it.c}" style="width:${(it.v / max * 100).toFixed(1)}%"></div></div></div>`).join('');
  $('#pareto').innerHTML = !topC.length && !topE.length
    ? '<p class="empty">Nothing lost yet. Inject a fault or slow a station to see where time goes.</p>'
    : `<h3 class="psub">Root causes</h3>${topC.length ? bars(topC) : '<p class="empty">No stops yet.</p>'}`
      + (topE.length ? `<h3 class="psub">Knock-on effects</h3>${bars(topE)}` : '');

  if (logShown !== plant.logVersion) {
    $('#log').innerHTML = plant.logs.map(e => `<li class="${e.kind}"><time>${fmt(e.t)}</time><span>${multi && e.line ? `<b class="tag">${e.line}</b> ` : ''}${esc(e.msg)}</span></li>`).join('');
    logShown = plant.logVersion;
  }
  $('#runBtn').textContent = running ? 'Pause' : 'Run';
  const ab = $('#autoBtn'); ab.textContent = autoOn ? 'Auto: on' : 'Auto: off'; ab.setAttribute('aria-pressed', String(autoOn));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === speed)));
}

function select(li: number, si: number) { sel = { li, si }; renderUI(); updateLine(); }
function refresh() { renderUI(); updateLine(); }

$('#tbody').addEventListener('click', e => { const tr = (e.target as HTMLElement).closest('tr'); if (tr && tr.dataset.i) select(+tr.dataset.li, +tr.dataset.i); });
$('#tbody').addEventListener('keydown', e => { const t = e.target as HTMLElement; if ((e.key === 'Enter' || e.key === ' ') && t.dataset.i) { e.preventDefault(); select(+t.dataset.li, +t.dataset.i); } });
$('#runBtn').onclick = () => { running = !running; renderUI(); };
$('#autoBtn').onclick = () => {
  autoOn = !autoOn;
  plant.log(autoOn ? 'Auto crew on: faults, maintenance and cycle times handled automatically' : 'Auto crew off');
  renderUI();
};
$('#driftBtn').onclick = () => {
  const cur = selStation();
  const pool = plant.lines.flatMap(l => l.st).filter(s => s.def.measure && s.driftRate === 0);
  const s = cur.def.measure && cur.driftRate === 0 ? cur : pool[Math.floor(Math.random() * pool.length)];
  if (s) { s.line.injectDrift(s); refresh(); }
};
document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.onclick = () => { speed = +b.dataset.speed; renderUI(); });
($('#randFaults') as HTMLInputElement).onchange = e => { plant.randomFaults = (e.target as HTMLInputElement).checked; plant.log(plant.randomFaults ? 'Random faults on' : 'Random faults off'); };
$('#target').oninput = e => { plant.targetJPH = +(e.target as HTMLInputElement).value; $('#targetOut').textContent = String(plant.targetJPH); $('#taktOut').textContent = `takt ${plant.takt().toFixed(1)} s`; refresh(); };
$('#target').onchange = () => plant.log(`Target changed to ${plant.targetJPH}/hr`);
$('#ct').oninput = e => { selStation().ct = +(e.target as HTMLInputElement).value; refresh(); };
$('#ct').onchange = () => { const s = selStation(); plant.log(`${s.name} cycle time set to ${s.ct} s`, '', s.line); };
$('#faultBtn').onclick = () => { const s = selStation(); s.line.fault(s, 180, false); refresh(); };
$('#clearBtn').onclick = () => { const s = selStation(); s.line.clearFault(s); refresh(); };
$('#serviceBtn').onclick = () => { const s = selStation(); s.line.service(s); refresh(); };
$('#consumeBtn').onclick = () => { const s = selStation(); s.line.changeConsumable(s); refresh(); };
$('#resetBtn').onclick = () => {
  const rf = plant.randomFaults, tj = plant.targetJPH;
  plant = new Plant(PLANT_LINES, PLANT_CONNECTIONS); plant.randomFaults = rf; plant.targetJPH = tj; spcClearSeries(plant); connectSpc(plant); visionReset(); connectVision(plant);
  plant.log(`Shift started. Target ${tj}/hr.`); build(); logShown = -1; selShown = ''; refresh();
};

let last = performance.now(), uiT = 0, lineT = 0;
function frame(now: number) {
  const real = Math.min((now - last) / 1000, 0.25); last = now;
  if (running) { let sim = real * speed; while (sim > 0) { const d = Math.min(0.5, sim); plant.step(d); if (autoOn) autoCrew(plant, d); sim -= d; } }
  lineT += real; if (lineT > 0.1) { lineT = 0; updateLine(); }
  uiT += real; if (uiT > 0.3) { uiT = 0; renderUI(); }
  requestAnimationFrame(frame);
}
plant.log(`Shift started. Target ${plant.targetJPH}/hr.`);
build(); refresh();
requestAnimationFrame(frame);
