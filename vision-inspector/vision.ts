// Connects the simulator to the vision inspector (vision-inspector/service.py, Python service).
// The camera on Module check reports each finished module. One inspection runs at a time
// (about 0.7 s each); modules that arrive while the inspector is busy are skipped, like an
// audit camera sampling the line. Results are kept for the dashboard's inspection panel.
const VISION_BASE = 'http://localhost:8091';
const VISION_RETRY_MS = 10000;  // pause after a failed request (inspector not running)
const VISION_KEEP = 20;         // recent results kept for the dashboard
let visionPausedUntil = 0;
let visionBusy = false;

interface VisionResult {
  image: string; truth: string; score: number; verdict: string;
  photo: string; heatmap: string;  // base64 PNGs
}
interface VisionRecord extends VisionResult { station: string; part: string; simTime: number }

const visionLog: VisionRecord[] = [];  // newest first
const visionCounts = { inspected: 0, pass: 0, review: 0, reject: 0, skipped: 0 };

function connectVision(p: Plant) {
  p.onVision = v => {
    if (Date.now() < visionPausedUntil) return;
    if (visionBusy) { visionCounts.skipped++; return; }
    visionBusy = true;
    fetch(VISION_BASE + '/inspect')
      .then(r => { if (!r.ok) throw new Error('inspector returned ' + r.status); return r.json(); })
      .then((res: VisionResult) => { visionBusy = false; visionRecord(p, v, res); })
      .catch(() => { visionBusy = false; visionPausedUntil = Date.now() + VISION_RETRY_MS; });
  };
}

function visionRecord(p: Plant, v: VisionEvent, res: VisionResult) {
  visionLog.unshift({
    image: res.image, truth: res.truth, score: res.score, verdict: res.verdict,
    photo: res.photo, heatmap: res.heatmap, station: v.station, part: v.part, simTime: v.simTime,
  });
  if (visionLog.length > VISION_KEEP) visionLog.pop();
  visionCounts.inspected++;
  if (res.verdict === 'PASS') visionCounts.pass++;
  else if (res.verdict === 'REVIEW') visionCounts.review++;
  else visionCounts.reject++;
  if (res.verdict !== 'PASS') {
    const ln = p.lines.find(l => v.station.indexOf(l.def.short + '-') === 0);
    const kind = res.verdict === 'REJECT' ? 'warn' : '';
    p.log(`Vision ${res.verdict} on ${v.part || 'module'} at ${v.station} (score ${res.score.toFixed(2)})`, kind, ln);
  }
}

// Clears results and totals, so a new shift starts fresh.
function visionReset() {
  visionLog.length = 0;
  visionCounts.inspected = visionCounts.pass = visionCounts.review = visionCounts.reject = visionCounts.skipped = 0;
}
