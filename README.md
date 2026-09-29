# EV battery plant simulator

A config-driven production plant simulator with a live dashboard. Two connected
lines run on the same simulated clock:

- **Line 1, battery pack assembly:** module subassembly (cell test, stacking,
  laser busbar weld), component feeders, and pack assembly with adhesive
  dispense, open-time limits, end-of-line test, and rework loops.
- **Line 2, pack finishing and vehicle integration:** HV harness install, BMS
  flash, charge and discharge test, then pack marriage into a chassis, HV and
  coolant connect, coolant fill, and a vehicle function check.

Finished packs leave Line 1 through a transfer buffer into Line 2. If Line 2
stops, the buffer fills and then blocks Line 1, the same way stations inside a
line interact.

## Layout

- `src/engine.ts`: simulation engine (`Station`, `Line`, `Plant`). Fixed-step and
  deterministic when given a seeded `rand`, so runs are reproducible and testable.
- `src/line1.ts`: Line 1 definition as data.
- `src/line2.ts`: Line 2 definition as data, plus `PLANT_LINES` and `PLANT_CONNECTIONS`.
- `src/ui.ts`: dashboard; renders any number of lines from their definitions.
- `test/sim.test.ts`: headless checks for each line and for the connection between them.
- `src/index.html`: page shell; the build inlines the compiled app into it.

Full annotated tree: [Directory Tree](Directory%20Tree/Directory%20Tree)

## Build

Requires Node.js (18 or newer). From the project folder:

    npm install       # one time, installs TypeScript locally
    npm run build     # compiles, runs tests, writes dist/index.html

Open `dist/index.html` in a browser to run the simulator.

## Adding another line

1. Create `src/lineN.ts` with a `LineDef`. Its first station has no `src`, so it
   pulls from its queue, which the upstream line fills.
2. Point the upstream line's last station at it with `out: { export: '<connection id>' }`.
3. Add it to `PLANT_LINES` and add a connection to `PLANT_CONNECTIONS`:

       { id: 'l2-l3', label: 'Transfer, Line 2 to Line 3', fromLine: 'line2',
         toLine: 'line3', toStation: '<first station id>', capacity: 8 }

   These lists live in the last line file, since each file can only use lines
   defined before it.
4. Add the new file to `files` in both tsconfig files, after the line it depends on.

A line whose export is not connected ships its output, so any line can still run
and be tested on its own.

## Station behaviours

Stations are composed from optional behaviours rather than special-cased code:
`src` (creates parts), `needs` (consumes components), `introduce` (adds a defect,
optionally with drift over time), `inspect` (detects a defect, then rework or
scrap), `startTimer` / `checkTimer` (open-time limits), `consumable` (drums,
totes; an empty one stops the station until a tech changes it), and `service`
(planned maintenance that resets drift, such as cleaning laser optics).

## Note

Generic demonstration model inspired by battery pack assembly and vehicle
integration. Cycle times, defect rates and layout are invented for illustration.
