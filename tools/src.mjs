import { createSim, ST } from '../src/game/sim.js';
import { runBot } from '../tests/bot.js';
// monkeypatch: replicate bot but tally mass sources per storm tier
const orig = createSim;
