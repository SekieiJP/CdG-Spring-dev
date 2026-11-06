import {test,expect} from './fixtures.js';
async function startFresh(page){
    await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));await page.goto('/');await page.click('#start-game');await page.waitForSelector('#training-cards .card');
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBeTruthy();
}
const host=page=>page.locator('.ahiru-advice'),face=page=>page.locator('.ahiru-advice__face');
async function activate(page,node){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await node.tap();else await node.click();}
test('FRESH専用の補正でパラメータ直下に助言を表示し、開閉や計算で状態を変えない',async({page},info)=>{
    await startFresh(page);expect(await page.evaluate(()=>window.game.uiController.ahiruAdvice.calibration.difficulty)).toBe('fresh');
    const before=await page.evaluate(()=>JSON.stringify(window.game.gameState));await activate(page,face(page));
    const layout=await page.evaluate(()=>{const h=document.querySelector('.ahiru-advice'),s=h.querySelector('[role=status]').getBoundingClientRect(),p=document.querySelector('#full-status-panel').getBoundingClientRect(),b=h.querySelector('button').getBoundingClientRect();return {below:s.top>=p.bottom,inside:s.left>=0&&s.right<=innerWidth,tap:b.width>=44&&b.height>=44,chars:Array.from(h.querySelector('[role=status]').textContent).length};});
    expect(layout).toMatchObject({below:true,inside:true,tap:true});expect(layout.chars).toBeLessThanOrEqual(25);
    await page.evaluate(()=>{for(let i=0;i<10;i++)window.game.uiController.ahiruAdvice.refresh();});expect(await page.evaluate(()=>JSON.stringify(window.game.gameState))).toBe(before);
    await page.locator('#training-area').evaluate(area=>area.getAnimations().forEach(animation=>animation.finish()));
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`solver/local-runs/pro-mean125/ahiru-ui-fresh-${info.project.name}.png`,fullPage:false});
    await activate(page,face(page));await expect(page.locator('.ahiru-advice__speech')).toBeHidden();
});
test('FRESHの取得・削除選択では助言を保ち、実際の場面変更だけに追従する',async({page})=>{
    await startFresh(page);await page.locator('#training-cards .card').nth(0).click();await page.locator('#training-cards .card').nth(1).click();
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice.forecast.position)).toBe('before');
    await page.evaluate(()=>{const g=window.game,s=g.gameState;s.turn=5;s.phase='meeting';s.player.deck=[];s.player.hand=[];for(const slot of Object.keys(s.player.placed))s.player.placed[slot]=[];for(const no of [5,44,50])s.addToDeck({...g.cardManager.allCards.find(c=>Number(c.cardNo)===no),acquiredTurn:0});Object.assign(s.player,{experience:20,enrollment:10,satisfaction:15,accounting:15});s.tokens.organize=1;g.uiController.showMeetingPhase();});
    const beforeDeletion=await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice);
    await page.locator('#deck-cards .card').filter({hasText:'経理精算の基本'}).click();
    expect(await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice)).toEqual(beforeDeletion);
    await page.evaluate(()=>{const g=window.game;g.gameState.turn=6;g.gameState.phase='training';g.uiController.showTrainingPhase();});
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.forecast.observation.turn)).toBe(6);
    const text=await page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice.text);await page.reload();await page.waitForSelector('#training-cards .card');
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBe(text);await expect(face(page)).toHaveAttribute('aria-expanded','false');
});

test.describe('FRESH助言の実時間計算',()=>{
    test.use({testDate:null});
    test('複数の公開状態を固定式で短時間に評価する',async({page},info)=>{
        await page.goto('/');await page.click('#start-game');await page.waitForSelector('#training-cards .card');
        await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBeTruthy();
        const timing=await page.evaluate(async()=>{
            const version=window.BUILD_VERSION.slice(1),{createAdvisorObservation}=await import('/js/acquisitionAdvisor.js?v='+version),{recommendFreshStatus}=await import('/js/ahiruFreshAdvice.js?v='+version),g=window.game,c=g.uiController.ahiruAdvice,before=JSON.stringify(g.gameState),values=[];
            for(const phase of ['acquisition','deletion'])for(const turn of [0,2,5,7])for(const size of [5,9,15,25]){
                const o=createAdvisorObservation(g.gameState,g.cardManager.allCards.slice(6,9),{pickCount:turn===0?2:1});o.rankTable=g.scoreManager.rankTable;o.turn=turn;o.stats={experience:turn*4,enrollment:turn*3,satisfaction:turn*2+3,accounting:turn*2+3};o.owned=Array.from({length:size},(_,i)=>g.cardManager.allCards[(i*7+turn)%g.cardManager.allCards.length]);
                const start=performance.now();recommendFreshStatus(o,{phase,deleteMax:2,calibration:c.calibration,versions:{cardVersion:g.cardManager.dataVersion,rankVersion:g.scoreManager.dataVersion}});values.push(performance.now()-start);
            }
            values.sort((a,b)=>a-b);return {count:values.length,p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1),unchanged:before===JSON.stringify(g.gameState)};
        });
        await info.attach('FRESH固定式の計算時間',{body:JSON.stringify(timing),contentType:'application/json'});expect(timing.count).toBe(32);expect(timing.unchanged).toBe(true);expect(timing.p95).toBeLessThan(100);expect(timing.max).toBeLessThan(500);
    });
});

test('助言データの応答が遅れても、表示後の候補カードを上下へ動かさない',async({page})=>{
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/fresh-projection-calibration.json*',async route=>{await gate;await route.continue();});
    try{
        await page.goto('/');await page.click('#start-game');await page.waitForSelector('#training-cards .card');await expect(host(page)).toBeVisible();
        const before=await page.locator('#training-cards .card').evaluateAll(cards=>cards.map(card=>({x:card.getBoundingClientRect().x,y:card.getBoundingClientRect().y})));
        release();await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBeTruthy();
        const after=await page.locator('#training-cards .card').evaluateAll(cards=>cards.map(card=>({x:card.getBoundingClientRect().x,y:card.getBoundingClientRect().y})));
        expect(after).toEqual(before);
    }finally{release();}
});
