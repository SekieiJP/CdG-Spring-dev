/**
 * E2Eフルプレイスルーテスト
 * - FRESHモードで8ターン（初回研修 → ターン0〜7）を完走
 * - ゲーム終了時に実際のGAS Web Appへスコアが送信されることを検証
 * - 送信ペイロードに必須フィールドが含まれていることを確認
 * - セーブ/ロードを経ても startedAt が保持され正常送信されることを確認
 */
import { test, expect } from '@playwright/test';

/**
 * 指定ターン（fromTurn）から8ターン目まで進めるヘルパー。
 * 各ターン: アクション確定 → 会議確定（ターン7以外）→ 研修1枚選択・確定（次ターン分）
 * ターン7アクション後は会議・研修なしで結果画面へ。
 * GASリクエスト監視はターン7のアクション直前にセットして返す。
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} fromTurn - ループを開始するターン番号 (0〜7)
 * @returns {Promise<import('@playwright/test').Request>} capturedRequest - GAS POSTリクエスト
 */
async function playTurnsToEnd(page, fromTurn) {
    let scoreRequestPromise = null;

    for (let turn = fromTurn; turn < 8; turn++) {
        // ── アクションフェーズ ──
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 15000 });

        if (turn === 7) {
            // 最終ターン: アクション直前にGASリクエスト監視をセット
            scoreRequestPromise = page.waitForRequest(
                req => req.url().includes('script.google.com') && req.method() === 'POST',
                { timeout: 30000 }
            );
        }

        // カード未配置で確定（確認ダイアログが出るが自動承認）
        await page.click('#confirm-action');

        if (turn === 7) {
            // ターン7: delete=0のため会議フェーズなし → 結果画面へ直行
            break;
        }

        // ── 会議フェーズ (turn 0〜6) ──
        await page.waitForSelector('#meeting-area:not(.hidden)', { timeout: 15000 });
        // カード削除なしで次のターンへ（確認ダイアログが出るが自動承認）
        await page.click('#confirm-meeting');

        // ── 次ターン研修 (ターン1〜7) ──
        // ターンオーバーレイが消えるのを待つ（自動消去まで最大3秒）
        await page.waitForSelector('.turn-overlay', { state: 'detached', timeout: 5000 }).catch(() => {});
        await page.waitForSelector('#training-area:not(.hidden)', { timeout: 15000 });
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const trainingCards = page.locator('#training-cards .card');
        await trainingCards.nth(0).click();
        await page.waitForSelector('#confirm-training:not([disabled])', { timeout: 5000 });
        await page.click('#confirm-training');
    }

    return scoreRequestPromise;
}

/**
 * GASへのスコア送信完了をログメッセージで待機する。
 * submitScore は fire-and-forget のため、fetchレスポンスが戻るまで時間がかかる。
 * @param {import('@playwright/test').Page} page
 */
async function waitForScoreLog(page) {
    await page.waitForFunction(
        () => {
            const text = document.getElementById('log-messages')?.textContent ?? '';
            return text.includes('📤 スコアを送信しました') || text.includes('⚠️ スコア送信に失敗しました');
        },
        { timeout: 20000 }
    );
}

/**
 * GAS POSTペイロードの必須フィールドを検証する共通アサーション。
 */
function assertScorePayload(capturedPayload, expectedDifficulty = 'fresh') {
    expect(capturedPayload).not.toBeNull();

    // 日時フィールド
    expect(capturedPayload.startedAt).toBeTruthy();
    expect(capturedPayload.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(capturedPayload.completedAt).toBeTruthy();
    expect(capturedPayload.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // ビルド・難易度
    expect(capturedPayload.buildVersion).toBeTruthy();
    expect(capturedPayload.difficulty).toBe(expectedDifficulty);

    // スコア数値フィールド
    expect(typeof capturedPayload.experience).toBe('number');
    expect(typeof capturedPayload.enrollment).toBe('number');
    expect(typeof capturedPayload.satisfaction).toBe('number');
    expect(typeof capturedPayload.accounting).toBe('number');
    expect(typeof capturedPayload.displayScore).toBe('number');
    expect(typeof capturedPayload.points).toBe('number');
    expect(typeof capturedPayload.withdrawal).toBe('number');
    expect(typeof capturedPayload.mobilization).toBe('number');
    expect(typeof capturedPayload.enrollmentDiff).toBe('number');

    // ランク
    expect(capturedPayload.grade).toBeTruthy();

    // 最終デッキ（配列、1枚以上、全て文字列）
    expect(Array.isArray(capturedPayload.finalDeck)).toBe(true);
    expect(capturedPayload.finalDeck.length).toBeGreaterThan(0);
    capturedPayload.finalDeck.forEach(name => {
        expect(typeof name).toBe('string');
    });
}

test.describe('8ターン完走 + スコア送信', () => {
    // 8ターン分のアニメーション時間 + GAS応答時間を考慮して十分なタイムアウトを設定
    test.setTimeout(120000);

    test('FRESHモードで8ターン完走し、GASへスコアが実際に送信される', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());

        // ゲーム開始（FRESH難易度）
        await page.goto('/');
        await page.click('#start-game');

        // ── 初回研修: Rカード4枚から2枚を選択 ──
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const initialCards = page.locator('#training-cards .card');
        await initialCards.nth(0).click();
        await initialCards.nth(1).click();
        await page.waitForSelector('#confirm-training:not([disabled])', { timeout: 5000 });
        await page.click('#confirm-training');

        // ターン0〜7を完走しGASリクエストを捕捉
        const scoreRequestPromise = await playTurnsToEnd(page, 0);

        // ── 結果画面の確認 ──
        await page.waitForSelector('#result-area:not(.hidden)', { timeout: 20000 });

        // ── GASへの実POSTリクエストが送信されたことを確認 ──
        const scoreRequest = await scoreRequestPromise;
        const capturedPayload = JSON.parse(scoreRequest.postData());
        assertScorePayload(capturedPayload);

        // ── ログに送信結果が出るまで待機してから確認 ──
        // （submitScore は fire-and-forget のため、GASレスポンスが戻るまで時間がかかる）
        await waitForScoreLog(page);
        const logText = await page.locator('#log-messages').textContent();
        expect(logText).toContain('📤 スコアを送信しました');
    });

    test('ターン0完了後にページをリロードしてもstartedAtが保持され、GASへスコアが送信される', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());

        // ゲーム開始（FRESH難易度）
        await page.goto('/');
        await page.click('#start-game');

        // ── 初回研修: Rカード4枚から2枚を選択 ──
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const initialCards = page.locator('#training-cards .card');
        await initialCards.nth(0).click();
        await initialCards.nth(1).click();
        await page.waitForSelector('#confirm-training:not([disabled])', { timeout: 5000 });
        await page.click('#confirm-training');

        // ── ターン0: アクション確定 ──
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 15000 });
        await page.click('#confirm-action');

        // ── ターン0: 会議確定 ──
        await page.waitForSelector('#meeting-area:not(.hidden)', { timeout: 15000 });

        // リロード前に startedAt を記録
        const startedAtBeforeReload = await page.evaluate(() => window.game.gameState.startedAt);
        expect(startedAtBeforeReload).toBeTruthy();
        expect(startedAtBeforeReload).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        await page.click('#confirm-meeting');

        // ターン1の研修フェーズが表示されるまで待つ
        // （showTrainingPhase内でsaveGameStateが呼ばれ、startedAtが保存される）
        await page.waitForSelector('.turn-overlay', { state: 'detached', timeout: 5000 }).catch(() => {});
        await page.waitForSelector('#training-area:not(.hidden)', { timeout: 15000 });

        // ── ページリロード（セーブデータからの復元をシミュレート） ──
        await page.reload();

        // ── 復元後の確認 ──
        // ターン1の研修フェーズが復元されることを確認
        await page.waitForSelector('#training-area:not(.hidden)', { timeout: 10000 });

        // startedAt がリロード後も保持されていることを確認
        const startedAtAfterReload = await page.evaluate(() => window.game.gameState.startedAt);
        expect(startedAtAfterReload).toBe(startedAtBeforeReload);

        // ── ターン1の研修を完了させてターン1〜7を完走 ──
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const turn1Cards = page.locator('#training-cards .card');
        await turn1Cards.nth(0).click();
        await page.waitForSelector('#confirm-training:not([disabled])', { timeout: 5000 });
        await page.click('#confirm-training');

        // ターン1のアクションフェーズ以降をヘルパーで完走
        const scoreRequestPromise = await playTurnsToEnd(page, 1);

        // ── 結果画面の確認 ──
        await page.waitForSelector('#result-area:not(.hidden)', { timeout: 20000 });

        // ── GASへの実POSTリクエストが送信されたことを確認 ──
        const scoreRequest = await scoreRequestPromise;
        const capturedPayload = JSON.parse(scoreRequest.postData());
        assertScorePayload(capturedPayload);

        // startedAt がリロード前の値と一致していることを確認（セーブ/ロードで失われていない）
        expect(capturedPayload.startedAt).toBe(startedAtBeforeReload);

        // ── ログに送信結果が出るまで待機してから確認 ──
        await waitForScoreLog(page);
        const logText = await page.locator('#log-messages').textContent();
        expect(logText).toContain('📤 スコアを送信しました');
    });
});
