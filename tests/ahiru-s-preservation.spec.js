import {test,expect} from './fixtures.js';
for(const difficulty of ['pro','fresh'])test(`${difficulty.toUpperCase()}は現在Sなら注意表示とし、空配置で残り3ターンもSを保てる`,async({page})=>{
    await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));await page.goto('/');
    if(difficulty==='pro')await page.click('.difficulty-btn[data-difficulty="pro"]');
    await page.click('#start-game');await page.waitForSelector('#training-cards .card');
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBeTruthy();
    await page.evaluate(difficulty=>{
        const g=window.game,s=g.gameState;s.turn=5;s.phase='training';s.pendingAction=null;
        s.player.deck=[];s.player.hand=[];for(const slot of s.slotIds)s.player.placed[slot]=[];
        s.tokens={passion:0,fatigue:0,inspiration:0,organize:0};
        const no=difficulty==='pro'?45:44;s.addToDeck({...g.cardManager.allCards.find(c=>Number(c.cardNo)===no),acquiredTurn:0});
        Object.assign(s.player,difficulty==='pro'?{experience:50,enrollment:40,satisfaction:25,accounting:15}:{experience:20,enrollment:15,satisfaction:15,accounting:15});
        g.uiController.showTrainingPhase();
    },difficulty);
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.ahiruAdvice.lastAdvice?.reason)).toBe('current-s-protect');
    await expect(page.locator('.ahiru-advice')).toHaveAttribute('data-tone','yellow');
    await page.clock.runFor(1850);await expect(page.locator('.turn-overlay')).toHaveCount(0);
    const face=page.locator('.ahiru-advice__face');if(await page.evaluate(()=>navigator.maxTouchPoints>0))await face.tap();else await face.click();
    await expect(page.locator('.ahiru-advice__speech')).toContainText('S圏内だよ。経理を守って');
    const proof=await page.evaluate(()=>{
        const g=window.game,s=g.gameState,keys=['experience','enrollment','satisfaction','accounting'];
        const stats=()=>Object.fromEntries(keys.map(k=>[k,s.player[k]])),before=stats(),startScore=g.scoreManager.calculateScore(s).points;
        let acquisitions=0,actions=0;
        for(let step=0;s.phase!=='end'&&step<16;step++){
            if(s.phase==='training'){
                const cards=s.currentTrainingCards||g.cardManager.drawTrainingCards(g.turnManager.getCurrentTurnConfig().training,3);
                if(!cards.length)throw Error('取得候補が必要');s.addToDeck(cards[0]);s.currentTrainingCards=null;acquisitions++;g.turnManager.advancePhase();
            }else if(s.phase==='action'){
                if(s.slotIds.some(slot=>s.player.placed[slot].length))throw Error('空配置ではない');
                g.turnManager.executeActions();actions++;g.turnManager.advancePhase();
            }else if(s.phase==='meeting')g.turnManager.advancePhase();
            else throw Error('不正な進行');
            if(JSON.stringify(stats())!==JSON.stringify(before))throw Error('空配置でパラメータが変わった');
        }
        return {phase:s.phase,acquisitions,actions,startScore,endScore:g.scoreManager.calculateScore(s).points,before,after:stats()};
    });
    expect(proof.phase).toBe('end');expect(proof.acquisitions).toBe(3);expect(proof.actions).toBe(3);expect(proof.endScore).toBe(proof.startScore);expect(proof.after).toEqual(proof.before);expect(proof.endScore).toBeGreaterThanOrEqual(difficulty==='pro'?12:8);
});
