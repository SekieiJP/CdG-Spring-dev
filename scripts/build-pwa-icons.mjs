import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';

const source = (await readFile(new URL('../game/pwa/icon-800.png', import.meta.url))).toString('base64');
const destination = new URL('../game/pwa/', import.meta.url);
await mkdir(destination, { recursive: true });
const browser = await chromium.launch();
try {
    for (const size of [16, 32, 180, 192, 512]) {
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await page.setContent(`<style>html,body{width:100%;height:100%;margin:0}img{width:100%;height:100%;display:block}</style><img src="data:image/png;base64,${source}">`);
        await page.locator('img').evaluate(image => image.decode());
        await page.screenshot({ path: new URL(`icon-${size}.png`, destination).pathname });
        await page.close();
    }
} finally { await browser.close(); }
