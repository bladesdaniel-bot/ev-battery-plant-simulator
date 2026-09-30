// Connects the simulator to the SPC monitor (spc-monitor, Go service).
// 1. Forwards every measurement reading to the monitor.
// 2. Sends each measured station's spec limits, so the monitor can calculate capability.
// 3. While Auto is on, watches the monitor for new rule violations and dispatches the auto crew.
// 4. Clears the simulator's own series on the monitor when a new shift starts.
const SPC_BASE = 'http://localhost:8090';
const SPC_RETRY_MS = 10000;  // pause after a failed request (monitor not running)
const SPC_POLL_MS = 3000;    // how often the crew checks the monitor for alerts
const SPC_SPEC_MS = 15000;   // how often specs are re-sent (the monitor forgets them on restart)
const SPC_GRACE = 8;         // readings to ignore after a fix, so the old pattern doesn't re-trigger
let spcPausedUntil = 0;
const spcHandledFrom: Dict<number> = {};

interface SpcSeries { station: string; characteristic: string; count: number }
interface SpcViolation { rule: number; index: number; value: number; description: string }

function connectSpc(p: Plant) {
  p.onMeasure = m => {
    if (Date.now() < spcPausedUntil) return;
    fetch(SPC_BASE + '/measurements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station: m.station, characteristic: m.characteristic, value: m.value }),
    }).catch(() => { spcPausedUntil = Date.now() + SPC_RETRY_MS; });
  };
  spcSendSpecs(p);
}

// Every measured station, with the series name the monitor knows it by (e.g. "L1-weld").
function spcMeasured(p: Plant) {
  const out: { name: string; M: MeasureDef }[] = [];
  for (const ln of p.lines) for (const s of ln.st) {
    if (s.def.measure) out.push({ name: `${ln.def.short}-${s.def.id}`, M: s.def.measure });
  }
  return out;
}

// Sends the spec limits of every measured station that has them.
function spcSendSpecs(p: Plant) {
  if (Date.now() < spcPausedUntil) return;
  for (const { name, M } of spcMeasured(p)) {
    if (M.lsl == null || M.usl == null) continue;
    fetch(SPC_BASE + '/specs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station: name, characteristic: M.char, lsl: M.lsl, usl: M.usl }),
    }).catch(() => { spcPausedUntil = Date.now() + SPC_RETRY_MS; });
  }
}

// Clears only the simulator's own series on the monitor, so a new shift starts with fresh charts.
function spcClearSeries(p: Plant) {
  for (const { name, M } of spcMeasured(p)) {
    delete spcHandledFrom[name + '|' + M.char];
    const q = `station=${encodeURIComponent(name)}&characteristic=${encodeURIComponent(M.char)}`;
    fetch(`${SPC_BASE}/series?${q}`, { method: 'DELETE' }).catch(() => { /* monitor not running */ });
  }
}

async function spcPoll() {
  if (!autoOn || Date.now() < spcPausedUntil) return;
  try {
    const series: SpcSeries[] = await (await fetch(SPC_BASE + '/series')).json();
    for (const sr of series) {
      const s = spcStation(sr.station);
      if (!s) continue;
      const key = sr.station + '|' + sr.characteristic;
      if (spcHandledFrom[key] == null) { spcHandledFrom[key] = sr.count; continue; } // skip history from before we watched
      if (sr.count < spcHandledFrom[key] - SPC_GRACE) spcHandledFrom[key] = 0;      // series was cleared: watch it fresh
      if (s.fault > 0) continue; // crew already busy at this station
      const q = `station=${encodeURIComponent(sr.station)}&characteristic=${encodeURIComponent(sr.characteristic)}`;
      const r = await fetch(`${SPC_BASE}/violations?${q}`);
      if (!r.ok) continue; // still collecting its baseline
      const body: { violations: SpcViolation[] } = await r.json();
      const v = body.violations.find(x => x.index >= spcHandledFrom[key]);
      if (!v) continue;
      spcHandledFrom[key] = sr.count + SPC_GRACE;
      spcDispatch(s, v);
    }
  } catch {
    spcPausedUntil = Date.now() + SPC_RETRY_MS;
  }
}

// Finds the simulator station behind a monitor series name like "L1-weld".
function spcStation(name: string): Station {
  const [short, id] = name.split('-');
  const ln = plant.lines.find(l => l.def.short === short);
  return ln ? ln.byId[id] : null;
}

// The crew investigates the alert and fixes the real cause, if there is one.
function spcDispatch(s: Station, v: SpcViolation) {
  const M = s.def.measure, c = s.def.consumable, ln = s.line;
  plant.log(`SPC alert at ${s.name}, rule ${v.rule}: ${v.description}. Auto crew investigating.`, 'warn', ln);
  const wearShift = M ? s.wear * (M.wearDrift || 0) / M.sigma : 0;
  if (c && s.level < c.capacity * 0.5) ln.changeConsumable(s);
  else if (s.drift > 0.5 || wearShift > 0.5) ln.correctDrift(s);
  else plant.log(`Crew found no assignable cause at ${s.name}. Likely a false alarm.`, '', ln);
}

setInterval(spcPoll, SPC_POLL_MS);
setInterval(() => spcSendSpecs(plant), SPC_SPEC_MS);