// Auto crew: runs the whole plant hands-free when Auto is on.
const AUTO_RESPONSE = 45;   // seconds for the crew to reach a breakdown and get it running
const AUTO_MIN_CT = 0.85;   // stations can be sped up to 85% of their design cycle, no further
const AUTO_TUNE_EVERY = 5;  // seconds between cycle time checks
const autoDispatched = new Set<Station>();
let autoTuneT = 0;

function autoCrew(p: Plant, dt: number) {
  const takt = p.takt();
  autoTuneT += dt;
  const tune = autoTuneT >= AUTO_TUNE_EVERY;
  if (tune) autoTuneT = 0;

  for (const ln of p.lines) for (const s of ln.st) {
    // Breakdowns: dispatch the crew once per fault.
    if (s.fault > 0 && !s.planned) {
      if (!autoDispatched.has(s)) {
        autoDispatched.add(s);
        s.fault = Math.min(s.fault, AUTO_RESPONSE);
        p.log(`Auto crew dispatched to ${s.name}`, '', ln);
      }
      continue;
    }
    autoDispatched.delete(s);
    if (s.fault > 0) continue; // planned stop already in progress

    // Consumables: change before they run dry.
    const c = s.def.consumable;
    if (c && s.level <= c.capacity * c.warnAt) { ln.changeConsumable(s); continue; }

    // Plant warnings (backup trigger): service when defect risk passes its warning level.
    const I = s.def.introduce;
    if (s.def.service && I && I.warnAt && ln.defectRate(s) > I.warnAt) { ln.service(s); continue; }

    if (tune) autoTuneCycle(s, takt, ln);
  }
}

// Speeds up stations slower than takt (within limits) and returns the rest to their design cycle.
function autoTuneCycle(s: Station, takt: number, ln: Line) {
  let want = s.ct0;
  if (s.ct0 * s.per > takt) want = Math.max(Math.ceil(s.ct0 * AUTO_MIN_CT), Math.floor(takt / s.per));
  if (want !== s.ct) {
    s.ct = want;
    ln.plant.log(`Auto: ${s.name} cycle time set to ${want} s`, '', ln);
  }
}