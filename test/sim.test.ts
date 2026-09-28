// Headless checks: Line 1 alone, then Line 1 exporting into a stub Line 2.
declare const process: { exit(n: number): void };
declare const console: { log(...a: unknown[]): void };

function seeded(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
// The test tech changes any empty drum right away, so long runs keep going.
function tech(p: Plant) { for (const l of p.lines) for (const s of l.st) { const c = s.def.consumable; if (c && s.level < c.perCycle && !(s.fault > 0)) l.changeConsumable(s); } }
function run(p: Plant, hours: number, withTech = true) { for (let i = 0; i < hours * 7200; i++) { p.step(0.5); if (withTech) tech(p); } }
let fails = 0;
function check(name: string, ok: boolean, info = '') { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; }

{
  const p = new Plant([LINE1]); p.rand = seeded(1); run(p, 4);
  const l = p.lines[0];
  check('line 1 produces packs', l.good > 300, `good=${l.good}`);
  check('rework loops do not deadlock', l.jph() > 70, `jph=${l.jph().toFixed(1)}`);
  check('tech drum changes keep the line running', l.byId.glue.level > 0 && l.byId.glue.plannedT > 0);
}
{
  const p = new Plant([LINE1]); p.rand = seeded(4); p.randomFaults = false; run(p, 3, false);
  const g = p.lines[0].byId.glue;
  check('empty drum stops glue until a tech changes it', g.level === 0 && g.state === 'starved', `state=${g.state}`);
}
{
  const p = new Plant([LINE1]); p.rand = seeded(2); p.randomFaults = false; run(p, 1);
  const l = p.lines[0];
  l.fault(l.byId.top, 420, false); run(p, 1);
  check('open-time expiry sends packs back to glue', p.logs.some(e => /open time exceeded/.test(e.msg)));
}
{
  const L1 = JSON.parse(JSON.stringify(LINE1)) as LineDef;
  L1.stations.find(s => s.id === 'pack').out = { export: 'l1-l2' };
  const L2: LineDef = {
    id: 'line2', short: 'L2', name: 'Line 2: Stub', unitNames: { P: 'Pack' }, finalPrefix: 'P', idealCycle: 30,
    components: {}, lanes: [{ name: 'Stub', note: '' }],
    stations: [
      { id: 'in', lane: 0, name: 'Receive', ct: 20, out: { to: 'out' } },
      { id: 'out', lane: 0, name: 'Ship', ct: 30, out: { ship: true } },
    ],
  };
  const p = new Plant([L1, L2], [{ id: 'l1-l2', label: 'Transfer', fromLine: 'line1', toLine: 'line2', toStation: 'in', capacity: 8 }]);
  p.rand = seeded(3); run(p, 3);
  const [a, b] = p.lines;
  check('packs transfer from L1 to L2', b.good > 200, `L1 out=${a.good} L2 out=${b.good}`);
  check('L2 never ships more than L1 sent', b.good <= a.good);
  p.lines[1].fault(p.lines[1].byId.in, 1200, false); run(p, 0.25);
  check('a stopped L2 backs up L1 (blocked)', a.byId.pack.blockedT > 60, `blocked=${a.byId.pack.blockedT.toFixed(0)}s`);
}
process.exit(fails ? 1 : 0);
