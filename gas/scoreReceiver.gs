var CURRENT_BUILD_VERSION = 'v20260814-0003';

/* ===== ヘルパー関数 ===== */

function buildVersionNumber(version) {
    var digits = String(version || '').replace(/\D/g, '');
    if (!digits) return null;
    var num = Number(digits);
    return isFinite(num) ? num : null;
}

function isClientVersionCurrent(clientVersion, currentVersion) {
    var clientNum = buildVersionNumber(clientVersion);
    var currentNum = buildVersionNumber(currentVersion);
    if (clientNum == null || currentNum == null) {
        return clientVersion === currentVersion;
    }
    return clientNum >= currentNum;
}

function logServerError(message, data) {
    var summary = '';
    if (data) {
        summary = ' difficulty=' + (data.difficulty || '')
            + ', mode=' + (data.mode || '')
            + ', grade=' + (data.grade || '')
            + ', displayScore=' + data.displayScore
            + ', points=' + data.points
            + ', buildVersion=' + (data.buildVersion || '')
            + ', startedAt=' + (data.startedAt || '')
            + ', completedAt=' + (data.completedAt || '');
    }
    console.error('[scoreReceiver] ' + message + summary);
}

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

    // displayScore: イベントの上限開放後も受け付ける
    if (!isNumInRange(data.displayScore, -15, 100)) {
        return 'invalid field: displayScore';
    }

    // points: イベントの上限開放後も受け付ける
    if (!isNumInRange(data.points, -15, 100)) {
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

    // mode: 通常・計算機、またはイベント名を含むイベントモード（古いクライアントは未送信を許容）
    if (data.mode != null) {
        var validEventMode = typeof data.mode === 'string'
            && /^イベント:\([^()\r\n]{1,80}\)(\/計算機)?$/.test(data.mode);
        if (data.mode !== '通常' && data.mode !== '計算機' && !validEventMode) {
            return 'invalid field: mode';
        }
    }

    // userUUID: 文字列、40文字以内（任意項目）
    if (data.userUUID != null) {
        if (typeof data.userUUID !== 'string' || data.userUUID.length > 40) {
            return 'invalid field: userUUID';
        }
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
            console.error('[scoreReceiver] payload too large: length=' + e.postData.contents.length);
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'payload too large' }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        var data = JSON.parse(e.postData.contents);

        // M1: 型・範囲チェック
        var validationError = validatePayload(data);
        if (validationError) {
            logServerError('validation error: ' + validationError, data);
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: validationError }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        // デバッグログ: 受信データの概要を記録
        console.log('[scoreReceiver] received: difficulty=' + data.difficulty
            + ', mode=' + (data.mode || '通常')
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
            logServerError('duplicate request', data);
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
                    '利用者UUID',
                    '難易度', 'モード', '体験', '入塾', '満足', '経理',
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
                sanitizeForSheet(data.userUUID || ''),
                sanitizeForSheet(data.difficulty || ''),
                sanitizeForSheet(data.mode || '通常'),
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
            logServerError('sheet write failed', data);
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'sheet write failed' }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        var clientVersion = data.buildVersion || '';
        return ContentService.createTextOutput(JSON.stringify({
            status: 'ok',
            currentVersion: CURRENT_BUILD_VERSION,
            clientVersion: clientVersion,
            versionMatch: isClientVersionCurrent(clientVersion, CURRENT_BUILD_VERSION)
        }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        // M9: エラーメッセージ抑制（GASログにのみ記録）
        console.error('[scoreReceiver] unexpected error:', err);
        return ContentService.createTextOutput(JSON.stringify({ status: 'error' }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function doGet(e) {
    return ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        message: 'Score receiver is running',
        currentVersion: CURRENT_BUILD_VERSION
    }))
        .setMimeType(ContentService.MimeType.JSON);
}
