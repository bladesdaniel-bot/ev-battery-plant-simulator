// Line simulator engine: config-driven stations, lines, and a plant that links lines together.
// Deterministic fixed-step simulation (call plant.step(dt) with simulated seconds).

type Dict<T> = Record<string, T>;

interface CompDef { label: string; cap: number }
interface OutDef { to?: string; comp?: string; ship?: boolean; export?: string }
interface IntroduceDef { tag: string; rate: number; wearPerCycle?: number; firstPassOnly?: boolean; warnAt?: number; warnMsg?: string }
interface InspectDef { tag: string; reworkTo?: string; reworkShare: number; reworkMsg?: string; scrapMsg: string }
interface TimerCheckDef { timer: string; limit: number; reworkTo: string; msg: string }
interface ConsumableDef { label: string; capacity: number; perCycle: number; changeTime: number; warnAt: number }
interface ServiceDef { label: string; stop: number; doneMsg: string }
interface MeasureDef { char: string; target: number; sigma: number; wearDrift?: number; lowLevelDrift?: number }

interface StationDef {
  id: string; lane: number; name: string; ct: number; robot?: boolean; role?: string;
  src?: { prefix?: string };          // creates new parts (prefix = tracked unit, none = anonymous component)
  needs?: Dict<number>;               // components consumed per cycle
  per?: number;                       // parts this station must make per finished unit
  out: OutDef;
  introduce?: IntroduceDef;           // may add a defect tag to the part
  inspect?: InspectDef;               // detects a defect tag, then rework or scrap
  startTimer?: string;                // stamps a timer on the part (e.g. adhesive dispensed)
  checkTimer?: TimerCheckDef;         // part must arrive before the timer limit
  consumable?: ConsumableDef;         // e.g. adhesive drum
  service?: ServiceDef;               // e.g. clean laser optics (resets wear)
  measure?: MeasureDef;               // reports a measured value each cycle (for SPC)
}
interface LaneDef { name: string; note: string; feeders?: boolean }
interface LineDef {
  id: string; short: string; name: string; unitNames: Dict<string>; finalPrefix: string; idealCycle: number;
  components: Dict<CompDef>; lanes: LaneDef[]; stations: StationDef[];
}
interface ConnectionDef { id: string; label: string; fromLine: string; toLine: string; toStation: string; capacity: number }

type Route = 'next' | 'scrap' | 'rework' | 'ship' | 'export';
type RunState = 'running' | 'starved' | 'blocked' | 'faulted';
interface Part {
  id?: string; tags: Dict<boolean>; timers: Dict<number>; installed: Dict<boolean>;
  rw?: boolean; route?: Route | null; back?: string; msg?: string;
}
interface LogEntry { t: number; msg: string; kind: string; line?: string }
interface MeasurementEvent { station: string; characteristic: string; value: number; simTime: number }

const QUEUE_CAP = 6, REWORK_CAP = 3;
const DRIFT_RATE = 0.08;   // hidden drift, in sigmas per cycle
const PURGE_STOP = 45;     // seconds for the crew to correct a drifting station with no service action

class Station {
  part: Part = null; prog = 0; state: RunState = 'starved'; reason = 'main';
  fault = 0; planned = false; faultT = 0; plannedT = 0; busy = 0; starvedT = 0; blockedT = 0;
  starvedBy: Dict<number> = {}; done = 0; pass = 0; defects = 0;
  buf: Part[] = []; rwq: Part[] = []; comps: Dict<number> = {}; qcap = QUEUE_CAP;
  wear = 0; warned = false; level = 0; ct: number; ct0: number; per: number; needs: Dict<number>;
  drift = 0; driftRate = 0; // hidden process drift: only visible in measurements
  constructor(public def: StationDef, public line: Line) {
    this.ct = this.ct0 = def.ct; this.per = def.per || 1; this.needs = def.needs || {};
    for (const k in this.needs) this.comps[k] = 0;
    if (def.consumable) this.level = def.consumable.capacity;
  }
  get id() { return this.def.id; }
  get name() { return this.def.name; }
  get effCycle() { return this.ct * this.per; }
  get installKey() { return this.line.def.id + ':' + this.def.id; }
}

class Line {
  st: Station[]; byId: Dict<Station> = {};
  good = 0; fp = 0; scrap = 0; unitScrap = 0; rework = 0; outTimes: number[] = []; counters: Dict<number> = {};
  constructor(public def: LineDef, public plant: Plant) {
    this.st = def.stations.map(d => new Station(d, this));
    this.st.forEach(s => this.byId[s.id] = s);
  }
  unitName(p: Part) { const pre = (p.id || '')[0]; return `${this.def.unitNames[pre] || 'Unit'} ${p.id}`; }
  reasonLabel(s: Station, r: string) {
    if (r === 'main') return null;
    if (r === 'consumable') return s.def.consumable.label.toLowerCase();
    return this.def.components[r].label.toLowerCase();
  }

  fault(s: Station, dur: number, planned: boolean, why?: string) {
    s.fault = dur; s.planned = planned;
    if (planned) this.plant.log(`${s.name}: ${why || 'planned stop'}, ${fmtDur(dur)}`, '', this);
    else this.plant.log(`${s.name} faulted, about ${fmtDur(dur)} to recover`, 'alarm', this);
  }
  clearFault(s: Station) { if (s.fault > 0) { s.fault = 0; this.plant.log(`${s.name} fault cleared by operator`, '', this); } }
  service(s: Station) {
    if (!s.def.service) return;
    s.wear = 0; s.warned = false; s.drift = 0; s.driftRate = 0;
    this.plant.log(s.def.service.doneMsg, '', this);
    this.fault(s, s.def.service.stop, true, s.def.service.label.toLowerCase());
  }
  changeConsumable(s: Station) {
    const c = s.def.consumable; if (!c) return;
    s.level = c.capacity; s.warned = false;
    this.fault(s, c.changeTime, true, `tech changing ${c.label.toLowerCase()}`);
  }
  defectRate(s: Station) { const I = s.def.introduce; return I ? I.rate + s.wear * (I.wearPerCycle || 0) : 0; }

  // Starts a silent process drift. No fault, no alarm: only the station's measurements change.
  injectDrift(s: Station) {
    if (!s.def.measure) return;
    s.driftRate = DRIFT_RATE;
    this.plant.log(`Hidden drift started at ${s.name}. No alarm, only SPC can see it.`, '', this);
  }
  // The crew's fix for a drifting station: its service action if it has one, otherwise a purge stop.
  correctDrift(s: Station) {
    if (s.def.service) { this.service(s); return; }
    s.drift = 0; s.driftRate = 0;
    this.fault(s, PURGE_STOP, true, 'crew purging and recalibrating');
  }

  private canStart(s: Station): string | null {
    const next = s.rwq[0] || (s.def.src ? null : s.buf[0]);
    if (!next && !s.def.src) return 'main';
    if (s.def.consumable && s.level < s.def.consumable.perCycle) return 'consumable';
    if (!(next && next.installed[s.installKey])) for (const k in s.needs) if (s.comps[k] < s.needs[k]) return k;
    return null;
  }
  private start(s: Station) {
    const P = this.plant;
    let p: Part;
    if (s.rwq.length) p = s.rwq.shift();
    else if (s.def.src) {
      const pre = s.def.src.prefix;
      p = { tags: {}, timers: {}, installed: {} };
      if (pre) { this.counters[pre] = (this.counters[pre] || 0) + 1; p.id = pre + this.counters[pre]; }
    } else p = s.buf.shift();
    s.part = p; s.prog = 0;
    const tc = s.def.checkTimer;
    if (tc && p.timers[tc.timer] != null && P.t - p.timers[tc.timer] > tc.limit) {
      s.done++; p.route = 'rework'; p.back = tc.reworkTo;
      p.msg = `${tc.msg} (${fmtDur(P.t - p.timers[tc.timer])} old), sent back to ${this.byId[tc.reworkTo].name}`;
      return;
    }
    if (!p.installed[s.installKey]) {
      for (const k in s.needs) s.comps[k] -= s.needs[k];
      if (Object.keys(s.needs).length) p.installed[s.installKey] = true;
    }
  }
  private decide(s: Station) {
    const P = this.plant, d = s.def, p = s.part;
    s.done++; p.route = 'next';
    const I = d.introduce;
    if (I && !(I.firstPassOnly && p.rw)) {
      if (I.wearPerCycle) s.wear++;
      if (P.rand() < this.defectRate(s)) { p.tags[I.tag] = true; s.defects++; }
      if (I.warnAt && !s.warned && this.defectRate(s) > I.warnAt) { s.warned = true; P.log(I.warnMsg, 'warn', this); }
    }
    const M = d.measure;
    if (M) s.drift += s.driftRate;
    if (M && P.onMeasure) {
      let mean = M.target + s.wear * (M.wearDrift || 0) + s.drift * M.sigma;
      if (M.lowLevelDrift && d.consumable) mean += M.lowLevelDrift * (1 - s.level / d.consumable.capacity);
      const noise = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
      const value = Math.round((mean + noise * M.sigma) * 1000) / 1000;
      P.onMeasure({ station: `${this.def.short}-${d.id}`, characteristic: M.char, value, simTime: P.t });
    }
    const X = d.inspect;
    if (X && p.tags[X.tag]) {
      if (X.reworkTo && P.rand() < X.reworkShare) { p.route = 'rework'; p.back = X.reworkTo; p.msg = X.reworkMsg; }
      else { p.route = 'scrap'; p.msg = X.scrapMsg; }
    }
    if (d.startTimer) p.timers[d.startTimer] = P.t;
    const c = d.consumable;
    if (c) {
      s.level -= c.perCycle;
      if (!s.warned && s.level <= c.capacity * c.warnAt) { s.warned = true; P.log(`${c.label} below ${Math.round(c.warnAt * 100)}%. Plan a change.`, 'warn', this); }
      if (s.level < c.perCycle) P.log(`${c.label} empty. ${s.name} stopped until a tech changes it.`, 'alarm', this);
    }
    if (p.route === 'next') {
      if (d.out.ship) p.route = 'ship';
      else if (d.out.export) p.route = 'export';
      s.pass++;
    }
  }
  private recordOut(p: Part) { this.good++; if (!p.rw) this.fp++; this.outTimes.push(this.plant.t); }
  private move(s: Station): boolean {
    const P = this.plant, p = s.part, d = s.def;
    switch (p.route) {
      case 'scrap':
        this.scrap++; if ((p.id || '')[0] === this.def.finalPrefix) this.unitScrap++;
        P.log(`${this.unitName(p)} scrapped at ${s.name}: ${p.msg}`, 'warn', this); return true;
      case 'ship': this.recordOut(p); return true;
      case 'export': {
        const c = P.connection(d.out.export);
        if (!c) { this.recordOut(p); return true; } // not connected (line run on its own): ship it
        const t = P.station(c.toLine, c.toStation);
        if (t.buf.length >= t.qcap) return false;
        this.recordOut(p); p.route = null; p.rw = false; t.buf.push(p); return true;
      }
      case 'rework': {
        const t = this.byId[p.back];
        if (t.rwq.length >= REWORK_CAP) return false;
        P.log(`${this.unitName(p)} failed ${s.name}: ${p.msg}`, '', this);
        p.rw = true; p.tags = {}; p.route = null; t.rwq.push(p); this.rework++; return true;
      }
      default: {
        const t = this.byId[d.out.to];
        if (d.out.comp) {
          if (t.comps[d.out.comp] >= this.def.components[d.out.comp].cap) return false;
          t.comps[d.out.comp]++; return true;
        }
        if (t.buf.length >= t.qcap) return false;
        p.route = null; t.buf.push(p); return true;
      }
    }
  }
  step(dt: number) {
    const P = this.plant;
    for (let i = this.st.length - 1; i >= 0; i--) {
      const s = this.st[i];
      if (s.fault > 0) {
        s.fault -= dt;
        if (s.planned) s.plannedT += dt; else s.faultT += dt;
        s.state = 'faulted';
        if (s.fault <= 0) { s.fault = 0; P.log(`${s.name} back in auto`, '', this); }
        continue;
      }
      if (s.part && s.part.route) {
        if (this.move(s)) { s.part = null; s.prog = 0; }
        else { s.state = 'blocked'; s.blockedT += dt; continue; }
      }
      if (!s.part) {
        const why = this.canStart(s);
        if (why) { s.state = 'starved'; s.reason = why; s.starvedT += dt; s.starvedBy[why] = (s.starvedBy[why] || 0) + dt; continue; }
        this.start(s);
      }
      s.state = 'running'; s.busy += dt; s.prog += dt;
      if (s.prog >= s.ct && !s.part.route) this.decide(s);
      if (P.randomFaults && P.rand() < dt / 9000) this.fault(s, 60 + P.rand() * 240, false);
    }
    const cut = P.t - 3600;
    while (this.outTimes.length && this.outTimes[0] < cut) this.outTimes.shift();
  }

  // ---- metrics ----
  oee(s: Station) {
    const t = this.plant.t || 1, up = Math.max(0, t - s.faultT - s.plannedT);
    const A = up / t, Pf = up > 0 ? Math.min(1, s.done * s.ct0 / up) : 0;
    let Q = 1;
    if (s.done) {
      if (s.def.inspect) Q = s.pass / s.done;
      else if (s.def.introduce && s.def.introduce.wearPerCycle) Q = Math.max(0, 1 - s.defects / s.done);
    }
    return { A, P: Pf, Q, O: A * Pf * Q };
  }
  jph() { const t = this.plant.t; return t < 600 ? null : this.outTimes.length * 3600 / Math.min(t, 3600); }
  fpy() { const n = this.good + this.unitScrap; return n ? this.fp / n : null; }
  lineOee() { const t = this.plant.t; return t > 60 ? Math.min(1, this.good * this.def.idealCycle / t) : null; }
  wip() { return this.st.reduce((a, s) => a + s.buf.length + s.rwq.length + (s.part && s.part.id ? 1 : 0), 0); }
}

class Plant {
  t = 0; lines: Line[]; byId: Dict<Line> = {}; logs: LogEntry[] = []; logVersion = 0;
  randomFaults = true; targetJPH = 100;
  rand: () => number = Math.random;
  onMeasure: ((m: MeasurementEvent) => void) | null = null; // set by the UI to forward readings to the SPC monitor
  constructor(defs: LineDef[], public connections: ConnectionDef[] = []) {
    this.lines = defs.map(d => new Line(d, this));
    this.lines.forEach(l => this.byId[l.def.id] = l);
    connections.forEach(c => { this.station(c.toLine, c.toStation).qcap = c.capacity; });
  }
  station(line: string, id: string) { return this.byId[line].byId[id]; }
  connection(id: string) { return this.connections.find(c => c.id === id); }
  takt() { return 3600 / this.targetJPH; }
  log(msg: string, kind = '', line?: Line) {
    this.logs.unshift({ t: this.t, msg, kind, line: line ? line.def.short : undefined });
    if (this.logs.length > 80) this.logs.pop();
    this.logVersion++;
  }
  step(dt: number) {
    this.t += dt;
    for (let i = this.lines.length - 1; i >= 0; i--) this.lines[i].step(dt); // downstream first
  }
}

function fmt(t: number) { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return [h, m, s].map(n => String(n).padStart(2, '0')).join(':'); }
function fmtDur(s: number) { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ' ' + (s % 60) + ' s' : ''}` : `${s} s`; }
function pct(x: number) { return (x * 100).toFixed(1) + '%'; }