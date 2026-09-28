# EV battery plant simulator

A config-driven production line simulator with a live dashboard. Line 1 models
battery pack assembly: module subassembly, component feeders (bottom plates,
side covers, top plates), adhesive dispense with open-time limits, and
end-of-line test with rework loops.

## Layout

- `src/engine.ts`: simulation engine (`Station`, `Line`, `Plant`). Fixed-step and
  deterministic when given a seeded `rand`, so runs are reproducible and testable.
- `src/line1.ts`: Line 1 definition as data, plus `PLANT_LINES` and `PLANT_CONNECTIONS`.
- `src/ui.ts`: dashboard; renders any number of lines from their definitions.
- `test/sim.test.ts`: headless checks, including a stub Line 2 fed by Line 1.
- `src/index.html`: page shell; the build inlines the compiled app into it.

## Build

Requires Node.js (18 or newer). From the project folder:

    npm install       # one time, installs TypeScript locally
    npm run build     # compiles, runs tests, writes dist/index.html

Open `dist/index.html` in a browser to run the simulator.

## Adding Line 2

1. Create `src/line2.ts` with a `LineDef` (same shape as Line 1). Its first station
   has no `src`, so it pulls from its queue, which Line 1 fills.
2. In Line 1, change Pack out to `out: { export: 'l1-l2' }`.
3. Register it:

       const PLANT_LINES = [LINE1, LINE2];
       const PLANT_CONNECTIONS = [{ id: 'l1-l2', label: 'Pack transfer to Line 2',
         fromLine: 'line1', toLine: 'line2', toStation: '<first station id>', capacity: 8 }];

4. Add `src/line2.ts` to `files` in both tsconfig files, after `line1.ts`.

A stopped Line 2 fills the transfer buffer and then blocks Line 1's Pack out,
the same way stations inside a line interact.

## Station behaviours

Stations are composed from optional behaviours rather than special-cased code:
`src` (creates parts), `needs` (consumes components), `introduce` (adds a defect,
optionally with tool wear), `inspect` (detects a defect, then rework or scrap),
`startTimer` / `checkTimer` (open-time limits), `consumable` (drums, reels; an
empty one stops the station until a tech changes it), and `service` (planned
maintenance that resets wear).

## Note

Generic demonstration model inspired by battery pack assembly. Cycle times,
defect rates and layout are invented for illustration.
