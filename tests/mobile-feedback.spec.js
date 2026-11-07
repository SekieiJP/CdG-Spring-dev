import { test, expect } from './fixtures.js';

async function action(page) {
    await page.goto('/'); await page.click('#start-game');
    await page.locator('#training-cards .card').nth(0).click();
    await page.locator('#training-cards .card').nth(1).click();
    await page.click('#confirm-training');
    await expect(page.locator('#action-area')).toBeVisible();
}

test('背景・数値・ヘッダーのタップは現在の1枚だけを送り、全スキップと説明文を持たない', async ({ page }) => {
    await action(page); await page.clock.pauseAt(new Date('2026-08-20T03:00:10Z'));
    await page.evaluate(() => {
        const g = window.game, s = g.gameState;
        s.player.placed.leader = ['1枚目', '2枚目', '3枚目'].map(cardName => ({cardName, category: '動員', effect: '体験+1。'}));
        const before = {...s.player}; const info = g.turnManager.executeActions();
        window.animationDone = false;
        g.uiController.showStatusAnimation(before, {...s.player}, info).then(() => window.animationDone = true);
    });
    await page.clock.runFor(2000);
    await expect(page.locator('.anim-card-name')).toContainText('1枚目');
    await expect(page.locator('#btn-animation-skip, .animation-skip-hint')).toHaveCount(0);
    await page.mouse.click(2, 2); await page.clock.runFor(1);
    await expect(page.locator('.anim-card-name')).toContainText('2枚目');
    await page.clock.runFor(100); await expect(page.locator('.anim-card-name')).toContainText('2枚目');
    await page.locator('#anim-exp-value').click(); await page.clock.runFor(1);
    await expect(page.locator('.anim-card-name')).toContainText('3枚目');
    await page.locator('#animation-header').click(); await page.clock.runFor(2000);
    expect(await page.evaluate(() => window.animationDone)).toBe(true);
    await page.click('#btn-settings-full'); await expect(page.locator('.info-overlay')).toBeVisible();
});

test('全文が収まるカードのⓘは隠し、短縮・文字切れ・追加解説を再描画後にも判定する', async ({ page }) => {
    await page.setViewportSize({width:390,height:844}); await action(page);
    await page.evaluate(() => {
        const ui = window.game.uiController, hand = document.getElementById('hand-cards');
        hand.replaceChildren(...[
            [{cardName:'全文', effect:'体験+2。'}, {}],
            [{cardName:'長文', effect:'これは長い効果の説明です。'.repeat(20)}, {}],
            [{cardName:'短縮', effect:'体験+2。入塾+2。', topEffect:'体2、入2'}, {shortDescription:true}],
            [{cardName:'解説', effect:'情熱1。'}, {}]
        ].map(([card, options]) => ui.createCardElement({...card, rarity:'N',category:'動員'}, options)));
    });
    const hints = page.locator('#hand-cards .card-detail-hint');
    await expect(hints.nth(0)).toBeHidden();
    for (const i of [1,2,3]) { await expect(hints.nth(i)).toBeVisible(); await expect(hints.nth(i)).toHaveText('ⓘ'); }
    await page.evaluate(() => {
        const effect = document.querySelectorAll('#hand-cards .card-effect')[1];
        effect.style.display = 'block'; effect.style.webkitLineClamp = 'unset';
    });
    await expect(hints.nth(1)).toBeHidden();
});

test('手札は名前・カテゴリとレアリティ・説明を左で縦に並べ、画像を独立した右列に置く', async ({ page }) => {
    await page.setViewportSize({width:390,height:844}); await action(page);
    const card = page.locator('#hand-cards .card').first();
    const bounds = await card.evaluate(el => Object.fromEntries(['card-name','card-meta','card-effect','card-thumbnail'].map(cls => {
        const r=el.querySelector('.'+cls).getBoundingClientRect(); return [cls,{x:r.x,y:r.y,right:r.right}];
    })));
    expect(bounds['card-name'].y).toBeLessThan(bounds['card-meta'].y);
    expect(bounds['card-meta'].y).toBeLessThan(bounds['card-effect'].y);
    expect(bounds['card-thumbnail'].x).toBeGreaterThanOrEqual(bounds['card-effect'].right);
});

test('PWAの上端余白59px・横向き0pxを想定し、追従ヘッダーの情報を保護する', async ({ page }) => {
    await action(page);
    await page.evaluate(() => {
        document.documentElement.style.setProperty('--app-safe-top','59px');
        document.documentElement.style.setProperty('--sticky-safe-gap','4px');
    });
    await page.clock.runFor(400);
    await page.evaluate(()=>{window.scrollTo(0,400); window.dispatchEvent(new Event('scroll'));});
    await expect(page.locator('#sticky-header')).not.toHaveClass(/hidden/);
    await expect.poll(()=>page.locator('#sticky-header .compact-info').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(63);
    const top = await page.locator('#sticky-header .compact-info').evaluate(el=>el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(63);
    expect(await page.evaluate(()=>getComputedStyle(document.body,'::before').height)).toBe('59px');
    await page.evaluate(()=>{document.documentElement.style.setProperty('--app-safe-top','0px');window.dispatchEvent(new Event('resize'));});
    expect(await page.locator('#sticky-header .compact-info').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(top);
});

test('ターン別の取得・配置・取消・削除は再読み込みと次ゲームを跨いでも送信内容を保持する', async ({ page, scoreSubmissions }) => {
    await action(page); await page.locator('#hand-cards .card').first().click();
    await page.locator('#slot-leader .card').click();
    const history = await page.evaluate(() => {
        const g=window.game; g.gameState.turn=2;
        g.gameState.removeFromDeck(g.gameState.player.deck[0]);
        g.uiController.saveGameState(); return g.gameState.turnHistory;
    });
    expect(new Set(history.map(e=>e.type))).toEqual(new Set(['acquire','place','unplace','delete']));
    await page.reload(); await page.waitForFunction(()=>window.game?.gameState.turn===2);
    expect(await page.evaluate(()=>window.game.gameState.turnHistory)).toEqual(history);
    await page.evaluate(()=>{const g=window.game;g.gameState.phase='end';g.uiController.showResultPhase();});
    await expect.poll(()=>scoreSubmissions.length).toBe(1);
    expect(scoreSubmissions[0].turnHistory).toEqual(history);
    await page.click('#restart-game'); await page.click('#start-game');
    expect(scoreSubmissions[0].turnHistory).toEqual(history);
});

test('未選択の推奨は黄色の細い実線で、非推奨には比較評価を表示しない', async ({ page }) => {
    await page.goto('/'); await page.click('#start-game');
    await page.waitForFunction(()=>window.game?.uiController.acquisitionAssist.context);
    await page.clock.fastForward(5100);
    const recommended = page.locator('#training-cards .acquisition-recommended').first();
    await expect(recommended).toHaveCSS('outline-color','rgb(253, 224, 71)');
    await expect(recommended).toHaveCSS('outline-style','solid');
    await expect(recommended).toHaveCSS('outline-width','1px');
    const other=page.locator('#training-cards .card:not(.acquisition-recommended)').first();
    await other.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,button:0,clientX:20,clientY:20});
    await page.clock.fastForward(550);
    await other.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true});
    await expect(page.locator('.effect-tooltip')).toBeVisible();
    await expect(page.locator('.tooltip-assist')).not.toContainText('比較評価');
});
