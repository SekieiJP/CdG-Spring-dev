/** 公開時は同じモジュールを同じURLで参照し、設定レジストリの二重読込みを防ぐ。 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
const version = process.argv[2];
if (!/^v\d{8}-\d{4}$/.test(version || '')) throw new Error('例: node scripts/set-build-version.mjs v20260815-0051');
const suffix = version.slice(1);
for (const dir of ['game/js', 'tests/unit']) {
    for (const name of await readdir(dir)) {
        if (!/\.(js|mjs)$/.test(name)) continue;
        const path = `${dir}/${name}`;
        let source = await readFile(path, 'utf8');
        source = source.replace(/(from\s+['"])(\.[^'"]+\.js)(?:\?v=\d{8}-\d{4})?(['"])/g, `$1$2?v=${suffix}$3`);
        source = source.replace(/(import\s+['"])(\.[^'"]+\.js)(?:\?v=\d{8}-\d{4})?(['"])/g, `$1$2?v=${suffix}$3`);
        source = source.replace(/const CACHE_BUSTER = '[^']+';/, `const CACHE_BUSTER = '${version}';`);
        await writeFile(path, source);
    }
}
for (const name of await readdir('game')) {
    if (!name.endsWith('.html') && name !== 'manifest.webmanifest') continue;
    const path = `game/${name}`;
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replace(/\?v=\d{8}-\d{4}/g, `?v=${suffix}`));
}
const gas = await readFile('gas/scoreReceiver.gs', 'utf8');
await writeFile('gas/scoreReceiver.gs', gas.replace(/var CURRENT_BUILD_VERSION = '[^']+';/, `var CURRENT_BUILD_VERSION = '${version}';`));
