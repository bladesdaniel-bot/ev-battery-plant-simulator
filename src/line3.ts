// Line 3: final trim and quality audit. Receives vehicles from Line 2.
const LINE3: LineDef = {
  id: 'line3', short: 'L3', name: 'Line 3: Final trim and quality audit',
  unitNames: { V: 'Vehicle' }, finalPrefix: 'V', idealCycle: 33,
  components: {
    seats: { label: 'Seat sets', cap: 6 },
    trimkit: { label: 'Trim kits', cap: 6 },
    wheels: { label: 'Wheel sets', cap: 6 },
  },
  lanes: [
    { name: 'Final trim', note: 'Vehicles from Line 2 get seats, interior trim, wheels and fluids.' },
    { name: 'Component feeders', note: 'Seat sets, trim kits and wheel sets are sequenced and delivered to their stations.', feeders: true },
    { name: 'Quality audit', note: 'Panels, trim and wheel torque are checked, then a final audit before the vehicle ships.' },
  ],
  stations: [
    { id: 'vreceive', lane: 0, name: 'Vehicle receive', ct: 20, out: { to: 'seats' }, role: 'Takes vehicles from the Line 2 transfer buffer.' },
    { id: 'seats', lane: 0, name: 'Seat install', ct: 30, robot: true, needs: { seats: 1 }, out: { to: 'trim' },
      role: 'Robot loads the seats through the door opening and they are bolted down.' },
    { id: 'trim', lane: 0, name: 'Interior trim', ct: 28, needs: { trimkit: 1 }, out: { to: 'wheels' },
      introduce: { tag: 'trimGap', rate: 0.015, firstPassOnly: true },
      role: 'Fits door panels, carpets and headliner. About 1.5% have a gap or loose clip.' },
    { id: 'wheels', lane: 0, name: 'Wheels and tires', ct: 26, robot: true, needs: { wheels: 1 }, out: { to: 'fluids' },
      introduce: { tag: 'torqueMiss', rate: 0.01, firstPassOnly: true },
      role: 'Mounts wheels and runs the lug nuts down. About 1% miss their torque value.' },
    { id: 'fluids', lane: 0, name: 'Fluid fill', ct: 24, out: { to: 'panel' },
      consumable: { label: 'Fluid tote', capacity: 140, perCycle: 1, changeTime: 180, warnAt: 0.15 },
      role: 'Fills brake and washer fluid. When the tote is empty, the station stops until a tech changes it.' },
    { id: 'fseats', lane: 1, name: 'Seat feed', ct: 25, src: {}, out: { to: 'seats', comp: 'seats' }, role: 'Delivers seat sets to Seat install.' },
    { id: 'ftrim', lane: 1, name: 'Trim kit feed', ct: 25, src: {}, out: { to: 'trim', comp: 'trimkit' }, role: 'Delivers trim kits to Interior trim.' },
    { id: 'fwheels', lane: 1, name: 'Wheel set feed', ct: 25, src: {}, out: { to: 'wheels', comp: 'wheels' }, role: 'Delivers wheel sets to Wheels and tires.' },
    { id: 'panel', lane: 2, name: 'Panel and trim audit', ct: 30, out: { to: 'torque' },
      inspect: { tag: 'trimGap', reworkTo: 'trim', reworkShare: 0.9, reworkMsg: 'trim gap found, sent back to Interior trim', scrapMsg: 'sent to off-line repair' },
      role: 'Checks panel gaps and interior fit. Problems go back to Interior trim.' },
    { id: 'torque', lane: 2, name: 'Torque audit', ct: 26, out: { to: 'audit' },
      inspect: { tag: 'torqueMiss', reworkTo: 'wheels', reworkShare: 1, reworkMsg: 'wheel torque low, sent back to Wheels and tires', scrapMsg: 'sent to off-line repair' },
      role: 'Verifies lug nut torque. Misses go back to Wheels and tires.' },
    { id: 'audit', lane: 2, name: 'Final quality audit', ct: 33, out: { to: 'ship' },
      role: 'Walk-around inspection and paperwork before release.' },
    { id: 'ship', lane: 2, name: 'Ship', ct: 20, out: { ship: true }, role: 'Released vehicles leave the plant.' },
  ],
};

const PLANT_LINES: LineDef[] = [LINE1, LINE2, LINE3];
const PLANT_CONNECTIONS: ConnectionDef[] = [
  { id: 'l1-l2', label: 'Pack transfer, Line 1 to Line 2', fromLine: 'line1', toLine: 'line2', toStation: 'receive', capacity: 8 },
  { id: 'l2-l3', label: 'Vehicle transfer, Line 2 to Line 3', fromLine: 'line2', toLine: 'line3', toStation: 'vreceive', capacity: 6 },
];