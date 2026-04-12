/* ===== ヘルパー関数 ===== */

/**
 * スプレッドシートインジェクション対策
 * 先頭が危険文字の場合、シングルクォートをプレフィックスする
 */
function sanitizeForSheet(val) {
    if (typeof val !== 'string') return val;
    if (/^[=+\-@\t\r]/.test(val)) {
        return "'" + val;
    }
    return val;
}

/**
 * ペイロードのバリデーション
 * 不正な場合はエラーメッセージ文字列を返し、正常なら null を返す
 */
function validatePayload(data) {
    // 数値・範囲チェックヘルパー
    function isNumInRange(v, min, max) {
        return typeof v === 'number' && isFinite(v) && v >= min && v <= max;
    }

    // experience, enrollment, satisfaction, accounting: 数値 0〜200
    var scoreFields = ['experience', 'enrollment', 'satisfaction', 'accounting'];
    for (var i = 0; i < scoreFields.length; i++) {
        if (!isNumInRange(data[scoreFields[i]], 0, 200)) {
            return 'invalid field: ' + scoreFields[i];
        }
    }

    // displayScore: 数値 0〜10
    if (!isNumInRange(data.displayScore, 0, 10)) {
        return 'invalid field: displayScore';
    }

    // points: 数値 -50〜50
    if (!isNumInRange(data.points, -50, 50)) {
        return 'invalid field: points';
    }

    // grade: 文字列、10文字以内
    if (typeof data.grade !== 'string' || data.grade.length > 10) {
        return 'invalid field: grade';
    }

    // difficulty: 'fresh' または 'pro' のみ
    if (data.difficulty !== 'fresh' && data.difficulty !== 'pro') {
        return 'invalid field: difficulty';
    }

    // withdrawal, mobilization, enrollmentDiff: 数値 -100〜200
    var statFields = ['withdrawal', 'mobilization', 'enrollmentDiff'];
    for (var j = 0; j < statFields.length; j++) {
        if (!isNumInRange(data[statFields[j]], -100, 200)) {
            return 'invalid field: ' + statFields[j];
        }
    }

    // finalDeck, discardedCards: 配列、各要素は文字列で50文字以内、配列長は30以内
    var arrayFields = ['finalDeck', 'discardedCards'];
    for (var k = 0; k < arrayFields.length; k++) {
        var arr = data[arrayFields[k]];
        if (arr != null) {
            if (!Array.isArray(arr) || arr.length > 30) {
                return 'invalid field: ' + arrayFields[k];
            }
            for (var m = 0; m < arr.length; m++) {
                if (typeof arr[m] !== 'string' || arr[m].length > 50) {
                    return 'invalid field: ' + arrayFields[k] + '[' + m + ']';
                }
            }
        }
    }

    return null; // バリデーション成功
}

/* ===== メインハンドラ ===== */

function doPost(e) {
    try {
        // M1: ペイロードサイズ制限
        if (e.postData.contents.length > 5000) {
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'payload too large' }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        var data = JSON.parse(e.postData.contents);

        // M1: 型・範囲チェック
        var validationError = validatePayload(data);
        if (validationError) {
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: validationError }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        // デバッグログ: 受信データの概要を記録
        console.log('[scoreReceiver] received: difficulty=' + data.difficulty
            + ', grade=' + data.grade
            + ', displayScore=' + data.displayScore
            + ', buildVersion=' + (data.buildVersion || '')
            + ', startedAt=' + (data.startedAt || ''));

        // M2: レート制限（重複送信検出）
        var cache = CacheService.getScriptCache();
        var rawKey = String(data.startedAt || '') + String(data.completedAt || '') + String(data.displayScore);
        var hashKey = 'rl_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,
            rawKey, Utilities.Charset.UTF_8)
            .map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); })
            .join('');
        if (cache.get(hashKey)) {
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'duplicate request' }))
                .setMimeType(ContentService.MimeType.JSON);
        }
        cache.put(hashKey, '1', 60);

        // スプレッドシート書き込み
        try {
            var ss = SpreadsheetApp.getActiveSpreadsheet();
            var sheet = ss.getSheetByName('スコア記録') || ss.insertSheet('スコア記録');

            if (sheet.getLastRow() === 0) {
                sheet.appendRow([
                    '受信日時', 'ゲーム開始日時', 'ゲーム完了日時', 'ビルドバージョン',
                    '難易度', '体験', '入塾', '満足', '経理',
                    '総合スコア', 'ランク', '目標ポイント',
                    '退塾数', '動員合計', '入退差', '最終デッキ', '削除カード'
                ]);
            }

            // M1: サニタイズしてから書き込み
            sheet.appendRow([
                new Date(),
                sanitizeForSheet(data.startedAt || ''),
                sanitizeForSheet(data.completedAt || ''),
                sanitizeForSheet(data.buildVersion || ''),
                sanitizeForSheet(data.difficulty || ''),
                data.experience, data.enrollment, data.satisfaction, data.accounting,
                data.displayScore,
                sanitizeForSheet(data.grade),
                data.points,
                data.withdrawal, data.mobilization, data.enrollmentDiff,
                sanitizeForSheet((data.finalDeck || []).join(', ')),
                sanitizeForSheet((data.discardedCards || []).join(', '))
            ]);

            console.log('[scoreReceiver] sheet write success');
        } catch (sheetErr) {
            console.error('[scoreReceiver] sheet write error:', sheetErr);
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'sheet write failed' }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        // M9: エラーメッセージ抑制（GASログにのみ記録）
        console.error(err);
        return ContentService.createTextOutput(JSON.stringify({ status: 'error' }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function doGet(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Score receiver is running' }))
        .setMimeType(ContentService.MimeType.JSON);
}
