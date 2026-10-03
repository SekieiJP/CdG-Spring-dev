var CURRENT_BUILD_VERSION = 'v20260815-0054';

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

/** 塾アイテムの構造化データを、スプレッドシート一セル用に整形する。 */
function formatSchoolItemsForSheet(schoolItems) {
    return (schoolItems || []).map(function(item) {
        var turns = item.conditionMetTurns || [];
        var turnText = turns.length ? turns.join(', ') + 'ターン' : '条件成立なし';
        return item.name + '（条件成立: ' + turnText + '）';
    }).join(' / ');
}

/**
 * 既存のシートにも追加列を安全に追加し、現在のヘッダー列を返す。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {string[]}
 */
function ensureScoreRecordHeaders(sheet) {
    var requiredHeaders = [
        '受信日時', 'ゲーム開始日時', 'ゲーム完了日時', 'ビルドバージョン',
        '利用者UUID',
        '難易度', 'モード', '体験', '入塾', '満足', '経理',
        '総合スコア', 'ランク', '目標ポイント',
        '退塾数', '動員合計', '入退差', '最終デッキ', '削除カード', '塾アイテム',
        '結果ID', 'ルールバージョン', 'カードバージョン', 'ランクバージョン'
    ];

    if (sheet.getLastRow() === 0) {
        sheet.appendRow(requiredHeaders);
        return requiredHeaders;
    }

    var lastColumn = Math.max(1, sheet.getLastColumn());
    var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    requiredHeaders.forEach(function(header) {
        if (headers.indexOf(header) === -1) {
            headers.push(header);
            sheet.getRange(1, headers.length).setValue(header);
        }
    });
    return headers;
}

/** ヘッダー順にスコア記録行を構築する。 */
function buildScoreRecordRow(headers, data) {
    var valuesByHeader = {
        '受信日時': new Date(),
        'ゲーム開始日時': sanitizeForSheet(data.startedAt || ''),
        'ゲーム完了日時': sanitizeForSheet(data.completedAt || ''),
        'ビルドバージョン': sanitizeForSheet(data.buildVersion || ''),
        '利用者UUID': sanitizeForSheet(data.userUUID || ''),
        '難易度': sanitizeForSheet(data.difficulty || ''),
        'モード': sanitizeForSheet(data.mode || '通常'),
        '体験': data.experience,
        '入塾': data.enrollment,
        '満足': data.satisfaction,
        '経理': data.accounting,
        '総合スコア': data.displayScore,
        'ランク': sanitizeForSheet(data.grade),
        '目標ポイント': data.points,
        '退塾数': data.withdrawal,
        '動員合計': data.mobilization,
        '入退差': data.enrollmentDiff,
        '最終デッキ': sanitizeForSheet((data.finalDeck || []).join(', ')),
        '削除カード': sanitizeForSheet((data.discardedCards || []).join(', ')),
        '塾アイテム': sanitizeForSheet(formatSchoolItemsForSheet(data.schoolItems)),
        '結果ID': sanitizeForSheet(data.resultId),
        'ルールバージョン': sanitizeForSheet(data.rulesVersion || ''),
        'カードバージョン': sanitizeForSheet(data.cardVersion || ''),
        'ランクバージョン': sanitizeForSheet(data.rankVersion || '')
    };
    return headers.map(function(header) {
        return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? valuesByHeader[header] : '';
    });
}

/**
 * ペイロードのバリデーション
 * 不正な場合はエラーメッセージ文字列を返し、正常なら null を返す
 */
function validatePayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'invalid payload';
    if (data.resultId != null && (typeof data.resultId !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(data.resultId))) return 'invalid field: resultId';
    if (data.totalTurns != null && (typeof data.totalTurns !== 'number' || data.totalTurns % 1 !== 0 || data.totalTurns < 1 || data.totalTurns > 100)) return 'invalid field: totalTurns';
    var versions = ['buildVersion', 'rulesVersion', 'cardVersion', 'rankVersion'];
    for (var v = 0; v < versions.length; v++) {
        if (data[versions[v]] != null && (typeof data[versions[v]] !== 'string' || data[versions[v]].length > 100)) return 'invalid field: ' + versions[v];
    }
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

    // 難易度登録と同じID形式。追加難易度をFRESH/PROに置き換えない。
    if (typeof data.difficulty !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(data.difficulty)) {
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

    // カードの種類数とは別の、送信する所持・削除枚数の技術上限。
    var arrayFields = ['finalDeck', 'discardedCards'];
    for (var k = 0; k < arrayFields.length; k++) {
        var arr = data[arrayFields[k]];
        if (arr != null) {
            if (!Array.isArray(arr) || arr.length > 200) {
                return 'invalid field: ' + arrayFields[k];
            }
            for (var m = 0; m < arr.length; m++) {
                if (typeof arr[m] !== 'string' || arr[m].length > 50) {
                    return 'invalid field: ' + arrayFields[k] + '[' + m + ']';
                }
            }
        }
    }

    // schoolItems: [{ name, conditionMetTurns: [1..8] }]（古いクライアントは未送信を許容）
    if (data.schoolItems != null) {
        if (!Array.isArray(data.schoolItems) || data.schoolItems.length > 10) {
            return 'invalid field: schoolItems';
        }
        for (var n = 0; n < data.schoolItems.length; n++) {
            var schoolItem = data.schoolItems[n];
            if (!schoolItem || typeof schoolItem !== 'object' || Array.isArray(schoolItem)
                || typeof schoolItem.name !== 'string' || schoolItem.name.length > 50
                || !Array.isArray(schoolItem.conditionMetTurns) || schoolItem.conditionMetTurns.length > (data.totalTurns || 8)) {
                return 'invalid field: schoolItems[' + n + ']';
            }
            var seenTurns = {};
            for (var p = 0; p < schoolItem.conditionMetTurns.length; p++) {
                var turn = schoolItem.conditionMetTurns[p];
                if (typeof turn !== 'number' || !isFinite(turn) || Math.floor(turn) !== turn || turn < 1 || turn > (data.totalTurns || 8) || seenTurns[turn]) {
                    return 'invalid field: schoolItems[' + n + '].conditionMetTurns[' + p + ']';
                }
                seenTurns[turn] = true;
            }
        }
    }

    return null; // バリデーション成功
}

/* ===== メインハンドラ ===== */

function jsonResponse(value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function scoreAcknowledgement(data, duplicate) {
    return jsonResponse({ status: 'ok', resultId: data.resultId, duplicate: duplicate,
        currentVersion: CURRENT_BUILD_VERSION, clientVersion: data.buildVersion || '',
        versionMatch: isClientVersionCurrent(data.buildVersion || '', CURRENT_BUILD_VERSION) });
}

function scoreDigest(value) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, value, Utilities.Charset.UTF_8)
        .map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** 書き込みと重複判定を同じロック内で行う。Cacheの失効後も結果ID列で判定する。 */
function appendScoreOnce(data) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return jsonResponse({ status: 'error', message: 'busy' });
    try {
        // 古いクライアントも、同じ不変ペイロードの再送を受領済みとして返す。
        data.resultId = data.resultId || 'legacy-' + scoreDigest(JSON.stringify([
            data.userUUID || '', data.startedAt || '', data.completedAt || '', data.displayScore
        ]));
        var cacheKey = 'score_' + scoreDigest(data.resultId);
        var cache = null;
        try {
            cache = CacheService.getScriptCache();
            if (cache.get(cacheKey)) return scoreAcknowledgement(data, true);
        } catch (cacheError) { /* Cacheは必須ではない */ }

        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName('スコア記録') || ss.insertSheet('スコア記録');
        var headers = ensureScoreRecordHeaders(sheet);
        var idColumn = headers.indexOf('結果ID') + 1;
        var lastRow = sheet.getLastRow();
        var existing = lastRow > 1 && sheet.getRange(2, idColumn, lastRow - 1, 1)
            .createTextFinder(data.resultId).matchEntireCell(true).matchCase(true).findNext();
        if (!existing) sheet.appendRow(buildScoreRecordRow(headers, data));
        // 永続化できてから受領済みにする。失敗した書き込みをCacheで塞がない。
        SpreadsheetApp.flush();
        try { if (cache) cache.put(cacheKey, '1', 21600); } catch (cacheError) { /* 永続列を使う */ }
        return scoreAcknowledgement(data, !!existing);
    } catch (sheetError) {
        logServerError('sheet write failed', data);
        return jsonResponse({ status: 'error', message: 'sheet write failed' });
    } finally { lock.releaseLock(); }
}

function doPost(e) {
    try {
        // M1: ペイロードサイズ制限
        if (e.postData.contents.length > 32000) {
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

        return appendScoreOnce(data);
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
