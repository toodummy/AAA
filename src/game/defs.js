// STORMZILLA - central data tables. Pure data, no imports. Shared by sim, renderer, models, UI.
// Units: meters, seconds. Y is up. Models have origin at base center and face +Z.

// kind: 'prop'  = ripped up whole when storm tier >= tier, then orbits the funnel
//       'bld'   = building with hp; breaks apart into chunks
//       'crit'  = critter / person, wanders and flees
//       'veh'   = civilian vehicle (parked or driving)
//       'enemy' = hostile unit (stats in ENEMIES)
//       'chunk' = debris piece spawned from buildings
// Fields: [kind, tier, w, h, d, xp, hp]
const P = (kind, tier, w, h, d, xp, hp = 0, extra = {}) => ({ kind, tier, w, h, d, xp, hp, ...extra });

export const PROPS = {
  // ---------- tier 0 : dust devil food ----------
  fence:      P('prop', 0, 2.4, 1.0, 0.2, 1),
  mailbox:    P('prop', 0, 0.4, 1.2, 0.4, 1),
  crate:      P('prop', 0, 1.0, 1.0, 1.0, 1),
  barrel:     P('prop', 0, 0.8, 1.1, 0.8, 1),
  bush:       P('prop', 0, 1.6, 1.2, 1.6, 1),
  haybale:    P('prop', 0, 1.6, 1.3, 1.6, 2),
  pumpkin:    P('prop', 0, 0.7, 0.6, 0.7, 1),
  scarecrow:  P('prop', 0, 1.4, 2.2, 0.4, 2),
  sign:       P('prop', 0, 1.0, 2.2, 0.2, 1),
  trashcan:   P('prop', 0, 0.7, 1.0, 0.7, 1),
  bench:      P('prop', 0, 1.8, 0.9, 0.6, 1),
  hydrant:    P('prop', 0, 0.4, 0.8, 0.4, 2, 0, { fx: 'water' }),
  cone:       P('prop', 0, 0.4, 0.7, 0.4, 1),
  corn:       P('prop', 0, 0.6, 2.0, 0.6, 1),
  rock:       P('prop', 0, 1.2, 0.8, 1.0, 1),
  flamingo:   P('prop', 0, 0.4, 1.1, 0.6, 3),
  gnome:      P('prop', 0, 0.4, 0.7, 0.4, 3),
  chicken:    P('crit', 0, 0.4, 0.6, 0.6, 2, 0, { speed: 5 }),
  person:     P('crit', 0, 0.6, 1.8, 0.4, 3, 0, { speed: 6 }),
  // ---------- tier 1 ----------
  cow:        P('crit', 1, 1.0, 1.6, 2.2, 12, 0, { speed: 4 }),
  sheep:      P('crit', 1, 0.8, 1.1, 1.4, 8, 0, { speed: 4 }),
  pig:        P('crit', 1, 0.7, 0.9, 1.3, 8, 0, { speed: 5 }),
  horse:      P('crit', 1, 0.8, 1.9, 2.3, 12, 0, { speed: 9 }),
  tree_small: P('prop', 1, 3.0, 5.0, 3.0, 8),
  pine:       P('prop', 1, 2.6, 7.0, 2.6, 9),
  car:        P('veh', 1, 1.9, 1.5, 4.3, 14, 0, { speed: 16 }),
  pickup:     P('veh', 1, 2.0, 1.8, 5.0, 16, 0, { speed: 15 }),
  taxi:       P('veh', 1, 1.9, 1.6, 4.3, 16, 0, { speed: 16 }),
  shed:       P('bld', 1, 4.0, 3.0, 4.0, 18, 20),
  outhouse:   P('prop', 1, 1.4, 2.4, 1.4, 12),
  tractor:    P('prop', 1, 2.2, 2.6, 3.8, 18),
  powerpole:  P('prop', 1, 2.4, 8.0, 0.4, 10, 0, { fx: 'spark' }),
  streetlight:P('prop', 1, 0.5, 6.0, 1.6, 8, 0, { fx: 'spark' }),
  busstop:    P('prop', 1, 3.2, 2.6, 1.4, 10),
  boat:       P('prop', 1, 2.2, 1.6, 5.5, 14),
  tent:       P('prop', 1, 3.0, 2.0, 3.4, 8),
  trampoline: P('prop', 1, 3.2, 0.9, 3.2, 10),
  portapotty: P('prop', 1, 1.2, 2.3, 1.2, 12),
  dumpster:   P('prop', 1, 2.0, 1.5, 1.2, 10),
  foodcart:   P('prop', 1, 1.6, 2.2, 2.6, 14),
  // ---------- tier 2 ----------
  tree_big:   P('prop', 2, 7.0, 11.0, 7.0, 60),
  house_a:    P('bld', 2, 10, 7, 9, 120, 120),
  house_b:    P('bld', 2, 12, 8, 10, 140, 140),
  house_c:    P('bld', 2, 9, 9, 9, 130, 130),
  trailer:    P('bld', 2, 4, 3.2, 11, 80, 60),
  barn:       P('bld', 2, 12, 9, 16, 160, 150),
  silo:       P('bld', 2, 5, 14, 5, 110, 100),
  windmill:   P('bld', 2, 5, 13, 5, 110, 90),
  semi:       P('veh', 2, 2.8, 4.0, 14, 90, 0, { speed: 14 }),
  bus:        P('veh', 2, 2.8, 3.3, 11, 90, 0, { speed: 13 }),
  schoolbus:  P('veh', 2, 2.8, 3.2, 10, 90, 0, { speed: 13 }),
  gas_station:P('bld', 2, 16, 6, 12, 220, 140, { fx: 'explode' }),
  water_tower:P('bld', 2, 8, 18, 8, 180, 120, { fx: 'water' }),
  billboard:  P('prop', 2, 12, 9, 1.2, 70),
  container:  P('prop', 2, 2.5, 2.6, 12, 70),
  diner:      P('bld', 2, 14, 5, 9, 150, 130),
  donut_shop: P('bld', 2, 10, 9, 10, 200, 130),   // giant donut on the roof
  playground: P('prop', 2, 7, 3.5, 7, 60),
  yacht:      P('prop', 2, 5, 6, 16, 110),
  small_plane:P('prop', 2, 11, 3, 9, 120),
  // ---------- tier 3 ----------
  store:      P('bld', 3, 26, 9, 20, 700, 500),
  warehouse:  P('bld', 3, 30, 11, 22, 750, 550),
  apartment:  P('bld', 3, 18, 22, 14, 900, 650),
  church:     P('bld', 3, 12, 24, 22, 800, 500),
  factory:    P('bld', 3, 32, 16, 24, 1000, 750),
  fuel_tank:  P('bld', 3, 14, 11, 14, 900, 350, { fx: 'explode' }),
  crane:      P('bld', 3, 8, 44, 30, 800, 450),
  ferris:     P('bld', 3, 32, 36, 6, 1400, 500),
  coaster:    P('bld', 3, 40, 18, 24, 1300, 550),
  wind_turbine:P('bld', 3, 6, 50, 6, 700, 350),
  school:     P('bld', 3, 34, 10, 20, 800, 600),
  mall:       P('bld', 3, 44, 12, 34, 1500, 900),
  airliner:   P('prop', 3, 34, 11, 38, 1200),
  cargo_ship: P('bld', 3, 18, 20, 80, 2500, 1200),
  // ---------- tier 4 ----------
  office:     P('bld', 4, 24, 60, 24, 5000, 3200),
  tower_a:    P('bld', 4, 28, 105, 28, 8000, 5000),
  tower_b:    P('bld', 4, 34, 140, 34, 11000, 6500),
  hotel:      P('bld', 4, 40, 70, 22, 7000, 4200),
  radio_tower:P('bld', 4, 12, 110, 12, 5000, 2200, { fx: 'spark' }),
  stadium:    P('bld', 4, 120, 30, 100, 16000, 8000),
  hospital:   P('bld', 4, 46, 40, 30, 6500, 4500),
  bridge_tower:P('bld', 4, 10, 70, 30, 6000, 3500),
  // ---------- tier 5 ----------
  mega_tower: P('bld', 5, 46, 250, 46, 50000, 26000),
  cooling_tower:P('bld', 5, 64, 85, 64, 40000, 20000, { fx: 'nuke' }),
  capitol:    P('bld', 5, 90, 60, 60, 45000, 22000),
  giant_duck: P('bld', 5, 40, 44, 50, 60000, 16000),  // the legendary giant rubber duck monument
  // ---------- debris chunks (spawned, never placed) ----------
  chunk_plank:   P('chunk', 0, 1.8, 0.2, 0.4, 0),
  chunk_brick:   P('chunk', 0, 1.2, 0.8, 0.8, 0),
  chunk_roof:    P('chunk', 1, 3.0, 0.4, 2.2, 0),
  chunk_wall:    P('chunk', 1, 3.0, 2.4, 0.4, 0),
  chunk_concrete:P('chunk', 2, 4.0, 3.0, 2.0, 0),
  chunk_glass:   P('chunk', 1, 2.6, 3.2, 0.2, 0),
  chunk_steel:   P('chunk', 2, 6.0, 0.6, 0.6, 0),
  chunk_slab:    P('chunk', 3, 9.0, 1.2, 7.0, 0),
  shark:         P('chunk', 1, 1.2, 1.2, 4.0, 0),   // Sharknado ammo
  ice_shard:     P('chunk', 1, 1.0, 3.0, 1.0, 0),
  // ---------- enemies (models only; stats below) ----------
  police:     P('enemy', 1, 1.9, 1.7, 4.4, 30),
  news_van:   P('enemy', 1, 2.2, 3.2, 5.2, 60),
  jeep:       P('enemy', 1, 2.0, 2.0, 4.2, 40),
  apc:        P('enemy', 2, 3.0, 2.8, 6.5, 160),
  tank:       P('enemy', 2, 3.6, 2.6, 7.5, 260),
  sam:        P('enemy', 2, 3.0, 4.2, 8.0, 320),
  news_heli:  P('enemy', 1, 3.0, 3.0, 9.0, 120),
  gunship:    P('enemy', 2, 4.0, 3.6, 12.0, 400),
  jet:        P('enemy', 3, 10, 3.2, 14, 900),
  bomber:     P('enemy', 3, 26, 5, 20, 2200),
  cryo_drone: P('enemy', 2, 5, 1.6, 5, 500),
  boss_core:  P('enemy', 5, 60, 70, 60, 100000),   // AEGIS weather-killer walker: body
  boss_leg:   P('enemy', 4, 10, 40, 10, 0),
  boss_pylon: P('enemy', 3, 8, 30, 8, 3000),       // shield pylons that power the boss
  missile:    P('chunk', 0, 0.5, 0.5, 2.4, 0),
  shell:      P('chunk', 0, 0.4, 0.4, 0.9, 0),
  bomb:       P('chunk', 0, 0.8, 0.8, 1.8, 0),
};
export const PROP_NAMES = Object.keys(PROPS);
PROP_NAMES.forEach((n, i) => { PROPS[n].id = i; PROPS[n].name = n; });

// Storm tiers (Fujita-style). mass = total absorbed xp needed. radius in meters of the funnel base.
export const TIERS = [
  { name: 'F0', title: 'DUST DEVIL',   mass: 0,      radius: 2.6, speed: 15, color: '#d9c8a6' },
  { name: 'F1', title: 'TWISTER',      mass: 100,    radius: 5.0, speed: 18, color: '#c9c2b4' },
  { name: 'F2', title: 'TORNADO',      mass: 800,    radius: 9.5, speed: 22, color: '#a8a8ad' },
  { name: 'F3', title: 'WEDGE',        mass: 12000,  radius: 18,  speed: 27, color: '#8a8c96' },
  { name: 'F4', title: 'MONSTER',      mass: 90000,  radius: 33,  speed: 33, color: '#6c6f7d' },
  { name: 'F5', title: 'FINGER OF GOD',mass: 600000, radius: 58,  speed: 40, color: '#4e5263' },
  { name: 'F6', title: 'STORMZILLA',   mass: 1500000, radius: 95,  speed: 46, color: '#3b3550' },
];

// Enemy stats. dps = damage per hit; range in m; cd = seconds between shots.
// move: 'ground' | 'air' | 'jet' (strafing passes) | 'static'
export const ENEMIES = {
  police:    { hp: 8,   dmg: 1.0, range: 40,  cd: 0.9, speed: 19, move: 'ground', shot: 'bullet', minThreat: 1 },
  news_van:  { hp: 10,   dmg: 0,   range: 50,  cd: 9,   speed: 15, move: 'ground', shot: null,     minThreat: 1 },
  news_heli: { hp: 10,   dmg: 0,   range: 60,  cd: 9,   speed: 22, move: 'air',    shot: null,     minThreat: 1, alt: 34 },
  jeep:      { hp: 24,   dmg: 2.2, range: 60,  cd: 0.5, speed: 21, move: 'ground', shot: 'bullet', minThreat: 2 },
  apc:       { hp: 50,  dmg: 6,   range: 80,  cd: 1.4, speed: 16, move: 'ground', shot: 'shell',  minThreat: 2 },
  tank:      { hp: 100,  dmg: 16,  range: 120, cd: 2.8, speed: 12, move: 'ground', shot: 'shell',  minThreat: 3 },
  gunship:   { hp: 60,  dmg: 9,   range: 110, cd: 1.6, speed: 26, move: 'air',    shot: 'missile',minThreat: 3, alt: 46 },
  sam:       { hp: 90,  dmg: 26,  range: 190, cd: 4.5, speed: 10, move: 'ground', shot: 'missile',minThreat: 4 },
  jet:       { hp: 70,  dmg: 34,  range: 260, cd: 7,   speed: 95, move: 'jet',    shot: 'missile',minThreat: 4, alt: 110 },
  cryo_drone:{ hp: 70,  dmg: 14,  range: 90,  cd: 3.2, speed: 24, move: 'air',    shot: 'cryo',   minThreat: 4, alt: 60 },
  bomber:    { hp: 200, dmg: 120, range: 400, cd: 11,  speed: 70, move: 'jet',    shot: 'bomb',   minThreat: 5, alt: 170 },
  boss_pylon:{ hp: 600, dmg: 0,   range: 0,   cd: 99,  speed: 0,  move: 'static', shot: null,     minThreat: 9 },
  boss_core: { hp: 5000,dmg: 60,  range: 520, cd: 2.2, speed: 9,  move: 'boss',   shot: 'missile',minThreat: 9 },
};

// Roguelite upgrades offered on level-up. max = max rank. Effects are implemented in sim/upgrades.
// icon = emoji used by the UI card (rendered large); rarity: 0 common, 1 rare, 2 epic, 3 mutation
export const UPGRADES = {
  suction:   { name: 'Vacuum Core',      icon: '🌀', max: 5, rarity: 0, desc: ['+18% pull radius', 'Pull radius +18% per rank. Eat from further away.'] },
  speed:     { name: 'Jet Stream',       icon: '💨', max: 5, rarity: 0, desc: ['+9% move speed', 'Move speed +9% per rank.'] },
  hunger:    { name: 'Bottomless',       icon: '🍽️', max: 5, rarity: 0, desc: ['+10% mass from everything', 'Everything you eat is worth +10% per rank.'] },
  armor:     { name: 'Debris Armor',     icon: '🛡️', max: 5, rarity: 0, desc: ['-10% damage taken', 'Orbiting junk blocks shots. Damage taken -10% per rank.'] },
  vitality:  { name: 'Eye of the Storm', icon: '👁️', max: 5, rarity: 0, desc: ['+25 max integrity, heal 30', 'Max integrity +25 per rank and heal 30 now.'] },
  shred:     { name: 'Shredder',         icon: '🪚', max: 5, rarity: 0, desc: ['+25% building damage', 'Tear buildings apart 25% faster per rank.'] },
  cannon:    { name: 'Debris Cannon',    icon: '☄️', max: 5, rarity: 1, desc: ['Fling +1 debris per volley, +20% dmg', 'Flung debris hits harder; each rank adds a projectile.'] },
  lightning: { name: 'Chain Lightning',  icon: '⚡', max: 5, rarity: 1, desc: ['Auto-strikes nearby enemies', 'Lightning strikes the nearest threat every few seconds and chains. More chains per rank.'] },
  hail:      { name: 'Hail Barrage',     icon: '🧊', max: 5, rarity: 1, desc: ['Hail shreds an area ahead', 'Hailstones pound a zone near you. Bigger and faster per rank.'] },
  twins:     { name: 'Sister Twisters',  icon: '🌪️', max: 4, rarity: 1, desc: ['+1 mini tornado that eats for you', 'A satellite twister orbits you, eating small things and hitting enemies.'] },
  magnet:    { name: 'Cow Magnet',       icon: '🐄', max: 3, rarity: 1, desc: ['Animals & people worth x2, pulled from afar', 'Living things fly toward you from far away and are worth double (stacking).'] },
  dash:      { name: 'Downburst',        icon: '🚀', max: 4, rarity: 1, desc: ['Dash recharges 20% faster, hits harder', 'Dash cooldown -20% per rank and dashing through things damages them.'] },
  regen:     { name: 'Warm Front',       icon: '💚', max: 4, rarity: 1, desc: ['Eating heals more', 'Heal 40% more from destruction per rank.'] },
  combo:     { name: 'Chaos Theory',     icon: '🦋', max: 3, rarity: 1, desc: ['Combo decays slower, bigger bonus', 'Combo lasts longer and its bonus cap rises by +2x per rank.'] },
  // mutations (rarity 3) - one-of-a-kind, change the whole storm. max 1, at most 2 per run.
  firenado:  { name: 'FIRENADO',         icon: '🔥', max: 1, rarity: 3, desc: ['Set everything ablaze', 'You are fire. Burning things spread fire to neighbors and burn down by themselves. Enemies near you ignite.'] },
  sharknado: { name: 'SHARKNADO',        icon: '🦈', max: 1, rarity: 3, desc: ['It is raining sharks', 'Sharks circle inside you and launch themselves at every enemy in range. Yes, really.'] },
  blizzard:  { name: 'SNOWNADO',         icon: '❄️', max: 1, rarity: 3, desc: ['Freeze enemies solid', 'Enemies near you slow, freeze and shatter. Frozen buildings break 2x faster.'] },
  thunder:   { name: 'SUPERCELL',        icon: '🌩️', max: 1, rarity: 3, desc: ['Lightning everywhere, all the time', 'Random lightning hammers everything around you. Chain Lightning fires twice as fast.'] },
  magnetar:  { name: 'IRON MAIDEN',      icon: '🧲', max: 1, rarity: 3, desc: ['Vehicles become your armor', 'Every vehicle you eat orbits as heavy armor: blocks shots and crushes what it touches. Missiles get turned around.'] },
  moneynado: { name: 'CASHNADO',         icon: '💸', max: 1, rarity: 3, desc: ['Double Chaos payouts', 'Chaos Points x2 this run. Banks, malls and towers rain cash.'] },
};

// Permanent meta upgrades bought with Chaos Points between runs. cost(rank) = base * mult^rank
export const META = {
  startMass:  { name: 'Head Start',     icon: '🌬️', max: 5, base: 60,  mult: 2.0, desc: 'Start each run with more mass (+15 per rank).' },
  integrity:  { name: 'Thick Skin',     icon: '🧱', max: 5, base: 80,  mult: 2.0, desc: '+12 max integrity per rank.' },
  greed:      { name: 'Gluttony',       icon: '🍔', max: 5, base: 100, mult: 2.1, desc: '+6% mass from everything per rank.' },
  swift:      { name: 'Tailwind',       icon: '🪁', max: 5, base: 80,  mult: 2.0, desc: '+4% move speed per rank.' },
  reroll:     { name: 'Butterfly Wings',icon: '🎲', max: 3, base: 150, mult: 2.5, desc: '+1 upgrade reroll per run per rank.' },
  dashes:     { name: 'Second Wind',    icon: '⏩', max: 2, base: 300, mult: 3.0, desc: '+1 dash charge per rank.' },
  chaos:      { name: 'Insurance Fraud',icon: '🧾', max: 5, base: 120, mult: 2.2, desc: '+10% Chaos Points per rank.' },
  revive:     { name: 'Eye Wall',       icon: '♻️', max: 1, base: 1500,mult: 1,   desc: 'Once per run, reform at 50% integrity instead of dissipating.' },
};

// Selectable storms. Unlock by condition (checked against save.stats / save.wins).
export const STORMS = {
  classic:  { name: 'Twister',   icon: '🌪️', desc: 'The original. Balanced and hungry.', unlock: null, start: {} },
  fire:     { name: 'Firenado',  icon: '🔥', desc: 'Starts with FIRENADO. Fragile: -20% integrity.', unlock: { stat: 'bestTier', gte: 3, text: 'Reach F3' }, start: { firenado: 1 }, hpMul: 0.8 },
  shark:    { name: 'Sharknado', icon: '🦈', desc: 'Starts with SHARKNADO. Slower: -8% speed.', unlock: { stat: 'bestTier', gte: 4, text: 'Reach F4' }, start: { sharknado: 1 }, speedMul: 0.92 },
  snow:     { name: 'Snownado',  icon: '❄️', desc: 'Starts with SNOWNADO and Debris Armor.', unlock: { stat: 'bossKills', gte: 1, text: 'Defeat AEGIS' }, start: { blizzard: 1, armor: 1 } },
  cash:     { name: 'Cashnado',  icon: '💸', desc: 'Starts with CASHNADO. Enemies arrive earlier.', unlock: { stat: 'totalChaos', gte: 5000, text: 'Earn 5,000 Chaos total' }, start: { moneynado: 1 }, threatMul: 1.3 },
};

export const ACHIEVEMENTS = {
  first_touch:  { name: 'Touchdown',            desc: 'Start your first storm.' },
  moo:          { name: 'Holy Cow',             desc: 'Abduct 50 cows in one run.' },
  f3:           { name: 'Getting Serious',      desc: 'Reach F3.' },
  f5:           { name: 'Finger of God',        desc: 'Reach F5.' },
  f6:           { name: 'Off the Scale',        desc: 'Reach F6 and become STORMZILLA.' },
  duck:         { name: 'Duck Season',          desc: 'Destroy the Giant Rubber Duck.' },
  donut:        { name: 'Glazed',               desc: 'Eat 5 donut shops in one run.' },
  aegis:        { name: 'Weather Wins',         desc: 'Defeat Project AEGIS.' },
  combo50:      { name: 'Chaos Theory',         desc: 'Reach a x50 combo.' },
  jet:          { name: 'No-Fly Zone',          desc: 'Swat 10 jets out of the sky in one run.' },
  nuke:         { name: 'Glow Up',              desc: 'Crack the nuclear cooling towers.' },
  mutant:       { name: 'Double Mutation',      desc: 'Hold two mutations at once.' },
  speedrun:     { name: 'Flash Flood',          desc: 'Defeat AEGIS in under 9 minutes.' },
  untouchable:  { name: 'Untouchable',          desc: 'Reach F4 without dropping below 50% integrity.' },
  everything:   { name: 'Clean Plate Club',     desc: 'Destroy 90% of the map in one run.' },
  ferris:       { name: 'Wheel of Misfortune',  desc: 'Throw the ferris wheel at something.' },
};

export const WORLD = {
  radius: 1250,          // playable radius; beyond is a wall of mountains / storm front
  start: [0, 1040],      // x, z spawn (farmland, south)
  bossSpawn: [-640, -560],
};
