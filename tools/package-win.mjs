// Build the web bundle, then package a Windows x64 desktop build into release/STORMZILLA-win32-x64
import { execSync } from 'child_process';
import { packager } from '@electron/packager';
import fs from 'fs';
execSync('npx vite build', { stdio: 'inherit' });
const out = await packager({
  dir: '.', name: 'STORMZILLA', executableName: 'STORMZILLA', platform: 'win32', arch: 'x64', out: 'release', overwrite: true,
  asar: { unpack: '**/node_modules/steamworks.js/**' }, prune: true, icon: fs.existsSync('electron/icon.ico') ? 'electron/icon.ico' : undefined,
  appCopyright: 'STORMZILLA', win32metadata: { CompanyName: 'AgonyGames', ProductName: 'STORMZILLA', FileDescription: 'STORMZILLA' },
  ignore: [/^\/(src|tests|tools|shots|release|docs|promo|\.git|\.vercel|index\.html|vite\.config\.js)($|\/)/, /node_modules\/(three|vite|playwright-core|@fontsource|electron|@electron)($|\/)/],
});
for (const dir of out) { fs.writeFileSync(dir + '/steam_appid.txt', '480'); console.log('packaged ->', dir); }
