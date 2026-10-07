# EV battery plant simulator

**Demo video:** [Watch the simulator running](EV%20Battery%20Plant%20Demo%20Video/Ev-Battery-Demo-Video.mp4)

A config-driven production plant simulator with a live dashboard, connected to a real-time [SPC monitor](https://github.com/bladesdaniel-bot/spc-monitor) written in Go.

Together they form a closed loop: a hidden process problem starts at a station, the SPC monitor detects the drift from its measurements, and an automated maintenance crew is dispatched to find and fix the root cause, with no human in the loop.

Three connected lines run on the same simulated clock:

- **Line 1, battery pack assembly:** module subassembly (cell test, stacking,
  laser busbar weld), component feeders, and pack assembly with adhesive
  dispense, open-time limits, end-of-line test, and rework loops.
- **Line 2, pack finishing and vehicle integration:** HV harness install, BMS
  flash, charge and discharge test, then pack marriage into a chassis, HV and
  coolant connect, coolant fill, and a vehicle function check.
- **Line 3, final trim and quality audit:** seats, interior trim, wheels and
  tires, and fluid fill, then panel, torque, and final quality audits before
  the vehicle ships.

Each line hands its output to the next through a transfer buffer. If a
downstream line stops, the buffer fills and then blocks the line feeding it,
the same way stations inside a line interact.

## SPC integration and Auto mode

**Measured stations.** The Busbar weld reports weld resistance, which rises as
spatter builds up on the laser optics. Adhesive dispense reports bead width,
which thins as the adhesive drum runs low. Each reading is streamed to the SPC
monitor along with the station's engineering spec limits, so the monitor can
chart the process and calculate Cp and Cpk.

**Auto mode.** The **Auto** button hands the plant to a virtual crew that:

- clears breakdowns within a realistic response time
- changes drums and totes before they run dry
- services stations when their defect risk passes its warning level
- tunes cycle times toward takt, never below 85% of a station's design cycle
- watches the SPC monitor for rule violations, investigates each alert, and
  fixes the real cause, or logs it as a false alarm when nothing is wrong

**Inject drift.** Factories have two kinds of problems. Loud ones, like a
breakdown, stop the line and trigger an alarm immediately. Quiet ones slowly
push a process off target while every part still passes inspection. The
**Inject drift** button creates a quiet one: no fault, no alarm, only a change
in the station's measurements. The only thing that can see it is SPC. With
Auto on, the event log shows the whole story: drift started, SPC alert, crew
investigating, fix applied, and the chart returning to normal.

### Running both together

1. Start the monitor from the spc-monitor folder: `go run ./cmd/spc-monitor`
2. Open `http://localhost:8090` for the SPC dashboard.
3. Build and open this simulator (see Build below), then pick 60× speed.
4. Turn on **Auto**, wait for the weld and glue charts to show "In control",
   then select Busbar weld and click **Inject drift**.

The simulator runs fine on its own too. If the monitor isn't running, readings
are simply skipped and it reconnects automatically once the monitor starts.

### Running all three together

The plant can also run with the AI vision inspector (see Vision inspector below).
Each service runs in its own terminal:

1. **SPC monitor** (port 8090), from the spc-monitor folder: `go run ./cmd/spc-monitor`
2. **Vision inspector** (port 8091), from the `vision-inspector` folder:
   `.venv\Scripts\python.exe service.py`
3. **Simulator:** build and open `dist/Dashboard.html` (see Build below).

Each service is optional. The plant keeps running if either one is down and
reconnects when it comes back.

## Vision inspector

The `vision-inspector` folder adds an AI visual inspection station: a model
that learns what good parts look like and flags anything different, with a
heatmap showing where the defect is.

It uses PatchCore (via anomalib), trained only on good parts, the way real
inspection works when defects are rare. Results on the metal nut category of
the public MVTec AD dataset, trained on CPU in about 20 minutes:

| Metric      | Score |
|-------------|-------|
| Image AUROC | 0.998 |
| Image F1    | 0.989 |
| Pixel AUROC | 0.987 |
| Pixel F1    | 0.840 |

### PASS / REVIEW / REJECT band

A single pass/fail threshold forces a tradeoff between escapes (defects that
ship) and false rejects (good parts scrapped). Instead, the inspector uses a
review band, the way automated inspection is run on real lines: the model makes
the clear calls and routes uncertain parts to a human inspector.

| Verdict (anomaly score)  | Good parts (22) | Defective parts (93) |
|--------------------------|-----------------|----------------------|
| PASS (below 0.35)        | 18              | 0                    |
| REVIEW (0.35 to 0.55)    | 4               | 4                    |
| REJECT (above 0.55)      | 0               | 89                   |

Zero escapes and zero false rejects, with about 7% of parts sent to manual
review. The band was chosen on the same 115 test parts it is scored on, so these
results are optimistic; a real deployment would set the band on a separate batch.

**Validated the deployment path.** Exporting the model to a standalone file
changed its scores: one good part moved from 0.499 to 0.653, which would have
been auto-rejected. The service instead runs the same in-memory pipeline that
produced the results above (`check_pipeline.py` verifies the scores match
exactly), at about 0.7 seconds per part on CPU.

### In the plant

A vision camera on Line 1 **Module check** sends each finished module to the
inspection service (`src/vision.ts`). One inspection runs at a time, and modules
that arrive while it is busy are skipped, like an audit camera sampling the line.
Each module gets a photo that matches its real condition in the simulation:
modules with a weld defect get a defective photo, good modules get a good one.

The dashboard's **Vision inspection** panel shows the latest photo and heatmap,
the score and verdict, whether the AI agreed with the plant, and running totals.
REVIEW and REJECT results also appear in the event log.

The camera reports results but does not route parts, so the simulation stays
deterministic and every test result is unchanged with the inspector connected.

### Running it

Requires Python (tested on 3.14). From the `vision-inspector` folder:

    python -m venv .venv
    .venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    python download.py      # downloads MVTec AD (about 5 GB) into datasets/
    python train.py         # trains the model and prints test scores
    python band_report.py   # PASS / REVIEW / REJECT counts on the test set
    python service.py       # starts the inspection service on port 8091

The dataset is not included in this repo. MVTec AD is licensed for
non-commercial use under CC BY-NC-SA 4.0; see
https://www.mvtec.com/company/research/datasets/mvtec-ad

## Layout

- `src/engine.ts`: simulation engine (`Station`, `Line`, `Plant`). Fixed-step and
  deterministic when given a seeded `rand`, so runs are reproducible and testable.
  Measurements are handed out through an optional `onMeasure` callback, so the
  engine never touches the network.
- `src/line1.ts`: Line 1 definition as data.
- `src/line2.ts`: Line 2 definition as data.
- `src/line3.ts`: Line 3 definition as data, plus `PLANT_LINES` and `PLANT_CONNECTIONS`.
- `src/spc.ts`: SPC monitor connection. Sends readings and spec limits, and
  dispatches the auto crew on SPC alerts.
- `src/vision.ts`: vision inspector connection. Sends camera events to the
  inspection service, one at a time, and keeps results for the dashboard.
- `src/auto.ts`: the auto crew (breakdowns, consumables, service, cycle times).
- `src/ui.ts`: dashboard; renders any number of lines from their definitions.
- `test/sim.test.ts`: headless checks for each line and for the connections between them.
- `src/index.html`: page shell; the build inlines the compiled app into it.
- `vision-inspector/`: Python defect-detection model (PatchCore via anomalib); see Vision inspector above.

Full annotated tree: [Directory Tree](Directory%20Tree/Directory%20Tree)

## Build

Requires Node.js (18 or newer). From the project folder:

    npm install       # one time, installs TypeScript locally
    npm run build     # compiles, runs tests, writes dist/Dashboard.html

Open `dist/Dashboard.html` in a browser to run the simulator.

## Adding another line

1. Create `src/lineN.ts` with a `LineDef`. Its first station has no `src`, so it
   pulls from its queue, which the upstream line fills.
2. Point the upstream line's last station at it with `out: { export: '<connection id>' }`.
3. Add it to `PLANT_LINES` and add a connection to `PLANT_CONNECTIONS`:

       { id: 'l3-l4', label: 'Transfer, Line 3 to Line 4', fromLine: 'line3',
         toLine: 'line4', toStation: '<first station id>', capacity: 8 }

   These lists live in the last line file, since each file can only use lines
   defined before it.
4. Add the new file to `files` in both tsconfig files, after the line it depends on
   and before `spc.ts`, `auto.ts` and `ui.ts`.

A line whose export is not connected ships its output, so any line can still run
and be tested on its own.

## Station behaviours

Stations are composed from optional behaviours rather than special-cased code:
`src` (creates parts), `needs` (consumes components), `introduce` (adds a defect,
optionally with drift over time), `inspect` (detects a defect, then rework or
scrap), `startTimer` / `checkTimer` (open-time limits), `consumable` (drums,
totes; an empty one stops the station until a tech changes it), `service`
(planned maintenance that resets drift, such as cleaning laser optics), and
`measure` (reports a measured value each cycle, with a target, sigma, optional
drift from wear or a low consumable, and spec limits). A `vision` setting adds a
camera that reports each finished part to the vision inspector, with an optional
defect tag it can see.

## Note

Generic demonstration model inspired by battery pack assembly, vehicle
integration, and final assembly. Cycle times, defect rates and layout are
invented for illustration.