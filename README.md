# STORMZILLA — You Are the Tornado

A 3D destruction roguelite. Start as a dust devil, eat chickens, grow to F6 and swallow a city while the army throws everything it has at you.

Plain JavaScript and Three.js, built with Vite, shipped on desktop with Electron. Every model and sound is procedural code, so the game ships no third-party art or audio files.

## Run it

```bash
npm install
npm run dev            # http://127.0.0.1:5190
npm test               # 150+ tests incl. playtest bots that check pacing, danger and run length
npm run desktop        # build + open in Electron
npm run package:win    # Windows build -> release/STORMZILLA-win32-x64/STORMZILLA.exe
```

Dev URL flags: `?play=classic` starts a run immediately, `?auto` turns on the autopilot, `?seed=7` fixes the seed.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD / arrows, or the storm follows the cursor | Left stick |
| Dash (dodges everything) | Space / right mouse | A |
| Fling orbiting debris at the cursor | Hold left mouse / Shift | RT / RB |
| SUPERCELL ultimate | Q | Y |
| Pause | Esc | Start |

## Layout

- `src/game`: headless simulation (world gen, storm, enemies, AEGIS boss, upgrades). No DOM, so the tests run in Node.
- `src/render`: renderer (instanced world, funnel shader, particles, post FX) and the procedural models.
- `src/audio`: Web Audio synth (adaptive score and all sound effects).
- `src/ui`: HTML/CSS HUD, menus, level-up cards, results newspaper.
- `electron/`: desktop shell and the Steam bridge (steamworks.js: overlay, achievements).
- `steam/`: SteamPipe build scripts and store-page copy. `promo/`: capsule art and screenshots.

## Publishing on Steam

1. Create a Steamworks partner account, pay the app fee and finish the tax and bank forms.
2. Create the app and note its **App ID** and **Depot ID**.
3. Put the App ID in `steam/app_build.vdf` and in `electron/main.cjs` (`STEAM_APP_ID`, currently 480 = Valve's test app), and the Depot ID in both `.vdf` files.
4. In Steamworks, add achievements whose API names are the uppercase ids in `src/game/defs.js` (`ACHIEVEMENTS`), e.g. `FIRST_TOUCH`, `MOO`, `F6`, `AEGIS`.
5. Run `npm run package:win`, then `steam\upload.bat <your_steam_login>` (needs the Steamworks SDK's steamcmd).
6. Upload the images in `promo/`, use the copy in `steam/STORE_PAGE.md`, and fill in the AI-content disclosure.
