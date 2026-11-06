import {test,expect} from './fixtures.js';
for(const difficulty of ['pro','fresh'])test(`${difficulty.toUpperCase()}は補正が止まっても提示時の助言を保ち3秒で通信を打ち切る`,async({page})=>{
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route(`**/${difficulty}-projection-calibration.json*`,async route=>{await gate;await route.fulfill({contentType:'application/json',body:JSON.stringify({difficulty})}).catch(()=>{});});
    try{
        await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));await page.goto('/');if(difficulty==='pro')await page.click('.difficulty-btn[data-difficulty="pro"]');
        await page.click('#start-game');await page.waitForSelector('#training-cards .card');
        await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.modelStatus)).toBe('loading');
        const before=await page.evaluate(()=>JSON.stringify(window.game.gameState));
        const positions=()=>page.locator('#training-cards .card').evaluateAll(cards=>cards.map(c=>({x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y})));
        const initialPositions=await positions();await page.clock.runFor(3000);
        await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.modelStatus)).toBe('failed');
        await expect.poll(()=>page.evaluate(()=>!!window.game.uiController.ahiruAdvice.lastAdvice)).toBe(true);
        const advice=await page.evaluate(()=>{const c=window.game.uiController.ahiruAdvice;return {text:c.lastAdvice.text,calibration:c.calibration,calibrated:c.lastAdvice.forecast.calibrated};});
        expect(advice.calibration).toBeNull();expect(advice.calibrated).toBe(false);expect(Array.from(advice.text).length).toBeLessThanOrEqual(25);expect(advice.text).not.toBe('教室の様子を見ているよ');
        expect(await positions()).toEqual(initialPositions);expect(await page.evaluate(()=>JSON.stringify(window.game.gameState))).toBe(before);
        release();await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.modelStatus)).toBe('failed');
        const button=page.locator('.ahiru-advice__face');if(await page.evaluate(()=>navigator.maxTouchPoints>0))await button.tap();else await button.click();
        await expect(page.locator('.ahiru-advice__speech')).toHaveText(advice.text);
    }finally{release();}
});
