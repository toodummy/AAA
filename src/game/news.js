// Satirical breaking-news lines. Pure data + pickers.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const LINES = {
  firstCow: ['BREAKING: Local cow achieves low orbit', 'Farmer: "That was my best cow. She had dreams."'],
  cows50: ['Dairy prices soar as 50 cows reported "airborne"', 'Scientists confirm: the cows are not coming home'],
  tier1: ['Weather service: "It\'s just a dust devil, relax"', 'Small twister spotted. Residents told to "walk it off"'],
  tier2: ['Tornado warning issued. Man continues to mow lawn', 'Twister upgraded to "concerning"'],
  tier3: ['Wedge tornado approaching suburbs. Property values plummet', 'Mayor urges calm, is seen fleeing by helicopter'],
  tier4: ['MONSTER STORM enters the city. Insurance companies "out of office"', 'Experts: "We ran out of scale. And experts."'],
  tier5: ['FINGER OF GOD touches down downtown. God denies involvement', 'F5 confirmed. Meteorologist quits live on air'],
  tier6: ['IT IS OFF THE SCALE. ALL HAIL STORMZILLA', 'New category invented: "F6 — good luck everyone"'],
  threat1: ['Police dispatched to "arrest the weather"', 'Officers attempt to issue tornado a citation'],
  threat2: ['National Guard mobilised against "aggressive wind"', 'Governor declares war on meteorology'],
  threat3: ['Army tanks deployed. Tanks immediately airborne', 'General: "We will shoot the wind until it stops"'],
  threat4: ['Air Force scrambled. Pilots asked to "avoid the spinny bit"', 'Experimental freeze drones cleared for use'],
  threat5: ['Bombers inbound. City council votes to bomb own city', 'TOTAL WAR declared on a weather system'],
  boss: ['PROJECT AEGIS activated: 9 billion dollar "tornado killer"', 'Pentagon unveils giant robot. "It was in the budget."'],
  bld_giant_duck: ['National tragedy: Giant Rubber Duck lost to storm', 'The Duck is gone. A nation mourns. Quack.'],
  bld_mega_tower: ['Tallest tower in the state now widest pile in the state', 'Mega Tower relocates to "everywhere"'],
  bld_capitol: ['Capitol destroyed. Approval ratings unchanged', 'Storm achieves what voters could not'],
  bld_cooling_tower: ['Nuclear plant "fine", says man glowing faintly', 'Reactor breached. Storm now technically radioactive'],
  bld_stadium: ['Home team loses stadium, still expected to lose Sunday', 'Stadium roof now retractable in every direction'],
  bld_ferris: ['Ferris wheel finally exciting', 'Carnival ride sets new altitude record'],
  bld_coaster: ['Rollercoaster adds surprise new loop'],
  bld_donut_shop: ['Giant donut seen rolling toward freedom', 'Police morale collapses as donut shop destroyed'],
  bld_church: ['Church steeple "ascends"'],
  bld_mall: ['Mall destroyed. Teenagers have nowhere to stand around', 'Everything must go: storm holds clearance event'],
  bld_hospital: ['Hospital evacuated safely; building has "seen better days"'],
  bld_water_tower: ['Water tower bursts. Town briefly a water park'],
  bld_gas_station: ['Gas station explodes. Prices somehow still rise'],
  bld_fuel_tank: ['Fuel depot ignites. Fire department "not doing that one"'],
  bld_school: ['School cancelled forever, students report mixed feelings'],
  bld_radio_tower: ['Radio tower down. Smooth jazz station finally silenced'],
  bld_cargo_ship: ['Cargo ship now delivering by air'],
  bld_tower_a: ['Another skyscraper "redistributed"', 'Glass tower becomes glass weather'],
  bld_tower_b: ['Financial district experiences "market correction"'],
  bld_hotel: ['Hotel guests check out early. And upward'],
  bld_barn: ['Barn raised. Very high.'],
  bld_wind_turbine: ['Wind turbine generates record power, then becomes wind'],
  bld_crane: ['Crane operator: "I did not sign up for this"'],
  kill_news_heli: ['"We\'re getting a great shot of the— oh no"', 'News chopper becomes the news'],
  kill_news_van: ['Our reporter on the ground is now in the air', 'Field correspondent files final report: "AAAAAA"'],
  kill_tank: ['Tank achieves flight, crew requests wings', 'Army: tanks "not designed for that altitude"'],
  kill_jet: ['Fighter jet swatted like a fly', 'Pilot ejects, lands in different county'],
  kill_bomber: ['Bomber downed by flying cow, sources say', 'Strategic bomber "strategically removed"'],
  kill_sam: ['Missile battery returned to sender'],
  kill_gunship: ['Gunship spins out. "It was already spinning," says pilot'],
  kill_police: ['Officer down. Way, way up, then down'],
  kill_cryo_drone: ['Freeze drone frozen in fear'],
};
export function headlineFor(key) { const l = LINES[key]; return l ? pick(l) : ''; }
const CAST = [
  (G) => `LIVE: Storm has consumed ${G.stats.eaten} objects. Officials "baffled"`,
  (G) => `Damage estimate: $${(G.S.score * 1300).toLocaleString('en-US', { maximumFractionDigits: 0 })}. Storm declines to comment`,
  (G) => `${G.stats.cows} cows missing. Authorities "looking up"`,
  (G) => `Residents advised to hold on to something heavier than a house`,
  (G) => `${G.stats.vehicles} vehicles reported "parked in the sky"`,
  () => 'Weatherman apologises for "light breeze" forecast',
  () => 'Local man insists on finishing barbecue',
  (G) => `Storm combo reaches x${G.stats.maxCombo}. Nobody knows what that means`,
];
export function eventNews(G) { return pick(CAST)(G); }
export function resultHeadline(G) {
  const st = G.stats, S = G.S;
  if (G.won) return pick(['STORM WINS', 'HUMANITY CONCEDES TO WEATHER', 'ROBOT FAILS, WIND PREVAILS', 'ALL HAIL STORMZILLA']);
  if (S.tier === 0) return pick(['LIGHT BREEZE RUFFLES HAIR', 'DUST DEVIL "BARELY AN INCONVENIENCE"', 'CHICKENS MILDLY STARTLED']);
  if (S.tier === 1) return pick(['SMALL TWISTER STEALS LAUNDRY', `${st.cows} COWS STILL MISSING`, 'TWISTER ARRESTED BY LOCAL POLICE']);
  if (S.tier === 2) return pick(['TORNADO STOPPED AT CITY LIMITS', 'SUBURBS "MOSTLY THERE"', 'NATIONAL GUARD DEFEATS WIND']);
  if (S.tier === 3) return pick(['WEDGE TORNADO REPELLED', `${st.buildings} BUILDINGS GONE, CITY SHRUGS`, 'ARMY SAVES DOWNTOWN (BARELY)']);
  if (S.tier === 4) return pick(['MONSTER STORM FINALLY DIES', 'SKYLINE "NEEDS WORK"', 'AIR FORCE CLAIMS VICTORY OVER AIR']);
  return pick(['AEGIS SAVES WHAT IS LEFT', 'F5 FALLS — CITY IS A PARKING LOT', 'GIANT ROBOT WORTH EVERY PENNY']);
}
