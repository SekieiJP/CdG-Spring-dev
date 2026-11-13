import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

export async function expectResultImageDownload(page) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '結果を画像で保存' }).click()
    ]);
    expect(download.suggestedFilename()).toMatch(/^cdg-result-\d+\.png$/);
    const bytes = await readFile(await download.path());
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
}
