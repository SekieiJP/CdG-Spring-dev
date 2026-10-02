/** コードで管理するSVGをホーム画面用PNGへ書き出す。 */
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';

const source = await readFile(new URL('../game/pwa/icon.svg', import.meta.url), 'utf8');
const destination = new URL('../game/pwa/', import.meta.url);
await mkdir(destination, { recursive: true });
const browser = await chromium.launch();
try {
    for (const size of [180, 192, 512]) {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await page.setContent(`<style>html,body{width:100%;height:100%;margin:0}svg{width:100%;height:100%;display:block}</style>${source}`);
        await page.screenshot({ path: new URL(`icon-${size}.png`, destination).pathname });
        await page.close();
    }
} finally { await browser.close(); }
