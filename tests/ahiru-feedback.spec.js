import {test,expect} from './fixtures.js';
async function start(page,difficulty='fresh'){
    await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));await page.goto('/');
    await page.waitForFunction(()=>window.game?.uiController.acquisitionAssist.container&&window.game.cardManager.allCards.length&&window.game.scoreManager.rankTable.length);
    if(difficulty==='pro')await page.click('.difficulty-btn[data-difficulty="pro"]');
    await page.click('#start-game');await page.waitForFunction(()=>window.game.uiController.ahiruAdvice.lastAdvice&&window.game.uiController.acquisitionAssist.context);
}
const decision=page=>page.evaluate(()=>{const ui=window.game.uiController;return {status:ui.ahiruAdvice.lastAdvice,ranking:ui.acquisitionAssist.context?.advice,presentedAt:ui.acquisitionAssist.context?.presentedAt};});
for(const difficulty of ['fresh','pro']){
    test(`${difficulty}: 取得・解除は顔・色・文面・順位と5秒期限を変えない`,async({page})=>{
        await start(page,difficulty);const before=await decision(page);
        await page.locator('#training-cards .card').nth(0).click();expect(await decision(page)).toEqual(before);
        await page.locator('#training-cards .card').nth(1).click();expect(await decision(page)).toEqual(before);
        await page.locator('#training-cards .card').nth(0).click();expect(await decision(page)).toEqual(before);
        await page.clock.runFor(5000);await expect(page.locator('.acquisition-recommended')).toHaveCount(2);
    });
    test(`${difficulty}: 削除予定を助言へ反映せず、整理枠と判断を再開後も保つ`,async({page})=>{
        await start(page,difficulty);
        await page.evaluate(()=>{const g=window.game,s=g.gameState;s.turn=5;s.phase='meeting';s.tokens.organize=2;s.meetingContext=null;g.uiController.showMeetingPhase();});
        await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.forecast.observation.turn)).toBe(6);
        const before=await decision(page);expect(before.status.deletion.checked).toBeGreaterThan(1);
        await page.locator('#deck-cards .card').nth(0).click();expect(await decision(page)).toEqual(before);
        const owned=await page.evaluate(()=>window.game.gameState.getOwnedCards().map(c=>c.cardNo));
        await page.reload();await page.waitForFunction(()=>window.game?.uiController.ahiruAdvice.lastAdvice);
        await expect(page.locator('#meeting-area')).toBeVisible();await expect(page.locator('#max-delete')).toHaveText('2');
        expect((await decision(page)).status).toEqual(before.status);
        expect(await page.evaluate(()=>window.game.gameState.getOwnedCards().map(c=>c.cardNo))).toEqual(owned);
    });
    test(`${difficulty}: 補正が後から到着しても、選択途中と再開後の判断を差し替えない`,async({page})=>{
        let release;const gate=new Promise(resolve=>release=resolve);
        await page.route(`**/${difficulty}-projection-calibration.json*`,async route=>{await gate;await route.continue();});
        try{
            await start(page,difficulty);const before=await decision(page);
            expect(before.status.forecast.calibrated).toBe(false);
            await page.locator('#training-cards .card').first().click();release();
            await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.modelStatus)).toBe('ready');
            expect(await decision(page)).toEqual(before);
            await page.reload();await page.waitForFunction(()=>window.game?.uiController.ahiruAdvice.lastAdvice&&window.game.uiController.acquisitionAssist.context);
            const after=await decision(page);expect(after.status).toEqual(before.status);expect(after.ranking).toEqual(before.ranking);
        }finally{release();}
    });
}
test('PRO: 発想の新候補と合法なリフレッシュだけで新しい判断を作り、初回発想も1枚選択に保つ',async({page})=>{
    await start(page,'pro');
    await page.evaluate(()=>{const g=window.game;g.gameState.tokens.inspiration=2;g.uiController.startInspirationTrainingFlow();});
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.forecast.observation.allowSkip)).toBe(true);
    const first=await page.evaluate(()=>window.game.gameState.adviceScenes.acquisition.key);
    await page.locator('#btn-training-refresh').click();
    await expect.poll(()=>page.evaluate(()=>window.game.gameState.adviceScenes.acquisition.key)).not.toBe(first);
    await expect(page.locator('#training-cards .skip-option')).toHaveCount(1);
    await page.locator('#training-cards .card').first().click();await expect(page.locator('#confirm-training')).toBeEnabled();
    const refreshed=await page.evaluate(()=>window.game.gameState.adviceScenes.acquisition.key);
    await page.locator('#confirm-training').click();
    await expect.poll(()=>page.evaluate(()=>window.game.gameState.adviceScenes.acquisition.key)).not.toBe(refreshed);
    expect(await page.evaluate(()=>window.game.uiController.inspirationRemaining)).toBe(1);
    await expect(page.locator('#confirm-training')).toBeDisabled();
    await page.clock.runFor(4999);await expect(page.locator('.acquisition-recommended')).toHaveCount(0);
    await page.clock.runFor(1);await expect(page.locator('.acquisition-recommended')).toHaveCount(1);
});

for(const title of ['デッキ内訳','スケジュール一覧','⚙️ 設定','結果履歴'])test(`安全領域: ${title}の本文をスクロールしても×を押せて、通知はヘッダー下で読める`,async({page},info)=>{
    await start(page);
    for(const top of [0,47,59,62]){
        await page.evaluate(({top,title})=>{
            const root=document.documentElement;for(const [side,value] of Object.entries({top,right:12,bottom:34,left:16}))root.style.setProperty(`--app-safe-${side}`,`${value}px`);
            const ui=window.game.uiController,overlay=ui.createInfoOverlay(title+'・長い画面タイトルの折り返しを確認');
            const content=overlay.querySelector('.info-overlay-content');content.replaceChildren(...Array.from({length:60},(_,i)=>{const p=document.createElement('p');p.textContent=`${i}：確認用の長い本文`;return p;}));
            document.body.append(overlay);ui.showFloatNotification('前回の続きから再開します。デッキと取得候補を復元しました。');
        },{top,title});
        await page.clock.runFor(400);
        const assertBounds=async()=>{
            const b=await page.evaluate(()=>{
                const close=document.querySelector('.info-overlay-close').getBoundingClientRect(),header=document.querySelector('.info-overlay-header').getBoundingClientRect(),toast=document.querySelector('.float-notification').getBoundingClientRect(),content=document.querySelector('.info-overlay-content');
                const x=close.x+close.width/2,y=close.y+close.height/2;
                return {close:{top:close.top,left:close.left,right:close.right,bottom:close.bottom,width:close.width,height:close.height},headerBottom:header.bottom,toast:{top:toast.top,left:toast.left,right:toast.right,bottom:toast.bottom},width:innerWidth,height:innerHeight,hit:document.elementFromPoint(x,y)?.closest('.info-overlay-close')!==null,pointer:getComputedStyle(document.querySelector('.float-notification')).pointerEvents,scroll:content.scrollTop};
            });
            expect(b.close.top).toBeGreaterThanOrEqual(top);expect(b.close.left).toBeGreaterThanOrEqual(16);expect(b.close.right).toBeLessThanOrEqual(b.width-12);expect(b.close.bottom).toBeLessThanOrEqual(b.height-34);
            expect(b.close.width).toBeGreaterThanOrEqual(44);expect(b.close.height).toBeGreaterThanOrEqual(44);expect(b.hit).toBe(true);
            expect(b.toast.top).toBeGreaterThanOrEqual(b.headerBottom);expect(b.toast.left).toBeGreaterThanOrEqual(16);expect(b.toast.right).toBeLessThanOrEqual(b.width-12);expect(b.toast.bottom).toBeLessThanOrEqual(b.height-34);expect(b.pointer).toBe('none');
            return b;
        };
        await assertBounds();
        await page.locator('.info-overlay-content').evaluate(el=>el.scrollTop=el.scrollHeight);
        expect((await assertBounds()).scroll).toBeGreaterThan(0);
        if(top===59&&title==='デッキ内訳')await page.screenshot({path:`solver/local-evaluation/ahiru-feedback-20261106/safe-area-${info.project.name}.png`,animations:'disabled'});
        if(await page.evaluate(()=>navigator.maxTouchPoints>0))await page.locator('.info-overlay-close').tap();else await page.locator('.info-overlay-close').click();
        await expect(page.locator('.info-overlay')).toHaveCount(0);
    }
});
test('縦横回転・文字拡大と通知中の情報画面切替で、安全領域を二重に足さず再計測する',async({page})=>{
    await start(page);
    await page.evaluate(()=>{document.documentElement.style.setProperty('--app-safe-top','59px');document.documentElement.style.fontSize='20px';const ui=window.game.uiController;ui.showFloatNotification('前回の続きから再開します');});
    await page.click('#btn-deck-full');await page.clock.runFor(400);
    const before=await page.locator('.info-overlay-header').boundingBox();
    await page.setViewportSize({width:844,height:390});
    await page.evaluate(()=>{for(const [key,value] of Object.entries({top:0,left:47,right:47,bottom:21}))document.documentElement.style.setProperty(`--app-safe-${key}`,`${value}px`);window.dispatchEvent(new Event('resize'));});
    await page.clock.runFor(100);
    const b=await page.evaluate(()=>{const c=document.querySelector('.info-overlay-close').getBoundingClientRect(),h=document.querySelector('.info-overlay-header').getBoundingClientRect(),t=document.querySelector('.float-notification').getBoundingClientRect();return {top:c.top,left:c.left,right:c.right,header:h.bottom,toast:t.top,width:innerWidth};});
    expect(b.top).toBeLessThan(before.y+59);expect(b.left).toBeGreaterThanOrEqual(47);expect(b.right).toBeLessThanOrEqual(b.width-47);expect(b.toast).toBeGreaterThanOrEqual(b.header);
    await page.locator('.info-overlay-close').click();await page.clock.runFor(80);
    await expect.poll(()=>page.evaluate(()=>{const sticky=document.querySelector('#sticky-header:not(.hidden)'),header=sticky||document.getElementById('full-header');return Math.abs(parseFloat(document.querySelector('.float-notification').style.getPropertyValue('--notification-top'))-Math.max(0,sticky?sticky.offsetHeight:header.getBoundingClientRect().bottom)-8);})).toBeLessThan(.1);
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content','black-translucent');
});
