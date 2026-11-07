import {test,expect} from './fixtures.js';
async function startPro(page){
    await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));await page.goto('/');
    await page.click('.difficulty-btn[data-difficulty="pro"]');await page.click('#start-game');await page.waitForSelector('#training-cards .card');
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBeTruthy();
}
async function activate(page,locator){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click();}
const host=page=>page.locator('.ahiru-advice'),face=page=>page.locator('.ahiru-advice__face'),speech=page=>page.locator('.ahiru-advice__speech');
test('PRO取得の助言はパラメータ直下で開閉し、選択やゲーム状態・乱数を変えない',async({page},info)=>{
    await startPro(page);await expect(host(page)).toBeVisible();await expect(face(page)).toHaveAttribute('aria-expanded','false');
    const before=await page.evaluate(()=>JSON.stringify(window.game.gameState));await activate(page,face(page));await expect(speech(page)).toBeVisible();
    const layout=await page.evaluate(()=>{const h=document.querySelector('.ahiru-advice'),b=h.querySelector('button').getBoundingClientRect(),s=h.querySelector('[role=status]').getBoundingClientRect(),p=document.getElementById('full-status-panel').getBoundingClientRect(),a=document.getElementById('confirm-training').getBoundingClientRect();return {afterPanel:h.previousElementSibling.id==='full-status-panel',below:s.top>=p.bottom,touch:b.width>=44&&b.height>=44,inside:s.left>=0&&s.right<=innerWidth,notOverlay:a.top>=s.bottom,characters:Array.from(h.querySelector('[role=status]').textContent).length};});
    expect(layout).toMatchObject({afterPanel:true,below:true,touch:true,inside:true,notOverlay:true});expect(layout.characters).toBeLessThanOrEqual(25);
    await page.evaluate(()=>{for(let i=0;i<10;i++)window.game.uiController.ahiruAdvice.refresh();});
    expect(await page.evaluate(()=>JSON.stringify(window.game.gameState))).toBe(before);await expect(page.locator('#confirm-training')).toBeDisabled();
    await page.screenshot({path:`solver/local-runs/pro-mean125/ahiru-ui-pro-${info.project.name}.png`,fullPage:true});
    await activate(page,face(page));await expect(speech(page)).toBeHidden();
});
test('初回の2枚選択では助言を固定し、行動画面で非表示にする',async({page})=>{
    await startPro(page);await activate(page,face(page));
    await page.locator('#training-cards .card').nth(0).click();await expect(page.locator('#confirm-training')).toBeDisabled();
    await page.locator('#training-cards .card').nth(1).click();await expect(page.locator('#confirm-training')).toBeEnabled();
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.forecast.position)).toBe('before');await expect(speech(page)).toBeVisible();
    await page.evaluate(()=>window.game.uiController.showPhaseArea('action'));await expect(host(page)).toBeHidden();
    await page.evaluate(()=>{window.game.uiController.showPhaseArea('training');window.game.uiController.updateStatusDisplay();});await expect(speech(page)).toBeVisible();
});
test('削除予定の選択でも、画面開始時の保有カードと助言を保つ',async({page})=>{
    await startPro(page);
    await page.evaluate(()=>{const g=window.game,s=g.gameState;s.turn=5;s.phase='meeting';s.player.deck=[];s.player.hand=[];for(const slot of Object.keys(s.player.placed))s.player.placed[slot]=[];
        for(const n of [5,40,45])s.addToDeck({...g.cardManager.allCards.find(c=>Number(c.cardNo)===n),acquiredTurn:0});Object.assign(s.player,{experience:40,enrollment:24,satisfaction:25,accounting:15});s.tokens.organize=1;g.uiController.showMeetingPhase();});
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.deleteMax)).toBe(1);
    const before=await page.evaluate(()=>JSON.stringify(window.game.gameState)),advice=await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice);
    await page.locator('#deck-cards .card').filter({hasText:'経理精算の基本'}).click();
    expect(await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice)).toEqual(advice);
    await activate(page,face(page));await expect(speech(page)).toHaveText(advice.text);
    expect(await page.evaluate(()=>JSON.stringify(window.game.gameState))).toBe(before);
    expect(await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice.forecast.observation.owned.some(c=>String(c.cardNo)==='5'))).toBe(true);
});
test('中断再開で同じ助言を復元し、初期表示は閉じた顔ボタンにする',async({page})=>{
    await startPro(page);const before=await page.evaluate(()=>({text:window.game.uiController.ahiruAdvice.lastAdvice.text,cards:window.game.gameState.currentTrainingCards.map(c=>c.cardNo)}));
    await activate(page,face(page));await page.reload();await page.waitForSelector('#training-cards .card');
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBe(before.text);await expect(face(page)).toHaveAttribute('aria-expanded','false');
    expect(await page.evaluate(()=>window.game.gameState.currentTrainingCards.map(c=>c.cardNo))).toEqual(before.cards);
});


test.describe('助言の固定式計算',()=>{
    test.use({testDate:null});
    test('公開状態の複数デッキを短時間で判断し、実状態と乱数を消費しない',async({page},info)=>{
        await page.goto('/');await page.click('.difficulty-btn[data-difficulty="pro"]');await page.click('#start-game');await page.waitForSelector('#training-cards .card');
        await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBeTruthy();
        const timing=await page.evaluate(async()=>{
            const version=window.BUILD_VERSION.slice(1),{createAdvisorObservation}=await import('/js/acquisitionAdvisor.js?v='+version),{recommendProStatus}=await import('/js/ahiruProAdvice.js?v='+version),g=window.game,controller=g.uiController.ahiruAdvice,values=[],before=JSON.stringify(g.gameState);
            for(let repeat=0;repeat<3;repeat++)for(const turn of [0,2,5,7])for(const n of [5,9,15,25]){
                const o=createAdvisorObservation(g.gameState,g.cardManager.allCards.slice(6,9),{rankTable:g.scoreManager.rankTable});
                o.turn=turn;o.pickCount=1;o.stats={experience:turn*6,enrollment:turn*4,satisfaction:turn*3+3,accounting:turn+5};
                o.owned=Array.from({length:n},(_,i)=>g.cardManager.allCards[(i*7+turn)%g.cardManager.allCards.length]);
                const start=performance.now();recommendProStatus(o,{phase:repeat===2?'deletion':'acquisition',deleteMax:2,calibration:controller.calibration,versions:{cardVersion:g.cardManager.dataVersion,rankVersion:g.scoreManager.dataVersion}});values.push(performance.now()-start);
            }
            values.sort((a,b)=>a-b);return {count:values.length,p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1),unchanged:before===JSON.stringify(g.gameState)};
        });
        await info.attach('固定式の計算時間', {body:JSON.stringify(timing),contentType:'application/json'});
        expect(timing.count).toBe(48);expect(timing.unchanged).toBe(true);expect(timing.p95).toBeLessThan(100);expect(timing.max).toBeLessThan(500);
    });
});

test('発想の辞退とイベント・計算機でも公開状態だけで助言を更新する',async({page})=>{
    await startPro(page);
    await page.evaluate(()=>{const g=window.game;g.gameState.turn=7;g.gameState.tokens.inspiration=1;g.uiController.startInspirationTrainingFlow();});
    await page.locator('#training-cards .skip-option').click();
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.forecast.position)).toBe('after');
    expect(await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice.forecast.observation.allowSkip)).toBe(true);
    for(const mode of ['event','calculator']){
        await page.evaluate(mode=>{const g=window.game;g.gameState.calcMode=mode==='calculator';g.gameState.event=mode==='event'?{enabled:true,eventId:'summer-cup-2026-post-obon'}:null;g.uiController.ahiruAdvice.scheduleRefresh();},mode);
        await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.forecast.observation.mode)).toBe(mode);
        expect(await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice.forecast.calibrated)).toBe(false);
        await expect(host(page)).toBeVisible();
    }
});
