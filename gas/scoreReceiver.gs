var CURRENT_BUILD_VERSION = 'v20261122-0069';

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
        '結果ID', 'ルールバージョン', 'カードバージョン', 'ランクバージョン', '共有同意ID'
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
        'ランクバージョン': sanitizeForSheet(data.rankVersion || ''),
        '共有同意ID': data.sharingOwner || ''
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
    if (data.turnHistory != null) {
        var phases = ['start', 'training', 'action', 'meeting', 'end'];
        if (data.difficulty === 'int') phases.push('outing');
        if (!Array.isArray(data.turnHistory) || data.turnHistory.length > 10000) return 'invalid field: turnHistory';
        for (var h = 0; h < data.turnHistory.length; h++) {
            var entry = data.turnHistory[h];
            if (!entry || !Number.isInteger(entry.turn) || entry.turn < 0 || entry.turn >= (data.totalTurns || 8)
                || ['acquire', 'place', 'unplace', 'delete'].indexOf(entry.type) === -1
                || phases.indexOf(entry.phase) === -1
                || !entry.card || typeof entry.card.cardName !== 'string' || entry.card.cardName.length > 200
                || (entry.staff != null && (typeof entry.staff !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(entry.staff)))
                || (entry.card.instanceId != null && (typeof entry.card.instanceId !== 'string' || entry.card.instanceId.length > 160))
                || (entry.card.cardNo != null && !/^[a-zA-Z0-9:_-]{1,64}$/.test(String(entry.card.cardNo)))) return 'invalid field: turnHistory[' + h + ']';
        }
    }
    if (data.resultId != null && (typeof data.resultId !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(data.resultId))) return 'invalid field: resultId';
    if (data.replayText != null) {
        if (data.action !== 'score.submit' || !data.resultId || typeof data.replayText !== 'string'
            || !/^CDGR1[.:][A-Za-z0-9_-]+$/.test(data.replayText)) return 'invalid field: replayText';
        if (!Array.isArray(data.diaryFinalDeck) || data.diaryFinalDeck.length > 200
            || data.diaryFinalDeck.some(function(card) {
                return !card || typeof card.cardName !== 'string' || card.cardName.length > 50
                    || !/^[a-zA-Z0-9:_-]{1,64}$/.test(String(card.cardNo))
                    || ['rarity', 'category'].some(function(key) { return card[key] != null && (typeof card[key] !== 'string' || card[key].length > 40); });
            })) return 'invalid field: diaryFinalDeck';
        if (typeof data.completedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.completedAt)) return 'invalid field: completedAt';
    }
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
    return jsonResponse({ status: 'ok', resultId: data.resultId, duplicate: duplicate, turnHistoryStored: true, diaryStored: !!data.replayText,
        currentVersion: CURRENT_BUILD_VERSION, clientVersion: data.buildVersion || '',
        versionMatch: isClientVersionCurrent(data.buildVersion || '', CURRENT_BUILD_VERSION) });
}

function scoreDigest(value) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, value, Utilities.Charset.UTF_8)
        .map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** セル上限を超えないよう、イベント単位でJSONを分割する。ID+分割番号で再送を重複排除する。 */
function appendTurnHistory(ss, data) {
    if (!data.turnHistory || !data.turnHistory.length) return;
    var sheet = ss.getSheetByName('ターン履歴') || ss.insertSheet('ターン履歴');
    if (!sheet.getLastRow()) sheet.appendRow(['履歴ID', '結果ID', '分割No', 'ターン履歴JSON']);
    var parts = [], current = [], size = 2;
    data.turnHistory.forEach(function(event) {
        event = { turn: event.turn, phase: event.phase, type: event.type,
            card: { cardNo: event.card.cardNo, cardName: event.card.cardName, instanceId: event.card.instanceId }, staff: event.staff };
        var eventSize = JSON.stringify(event).length + 1;
        if (current.length && size + eventSize > 24000) { parts.push(current); current = []; size = 2; }
        current.push(event); size += eventSize;
    });
    if (current.length) parts.push(current);
    parts.forEach(function(events, index) {
        var key = data.resultId + ':' + index;
        var lastRow = sheet.getLastRow();
        var found = lastRow > 1 && sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(key)
            .matchEntireCell(true).matchCase(true).findNext();
        if (!found) sheet.appendRow([key, data.resultId, index, JSON.stringify(events)]);
    });
}

/** 書き込みと重複判定を同じロック内で行う。Cacheの失効後も結果ID列で判定する。 */
function appendScoreOnce(data) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return jsonResponse({ status: 'error', message: 'busy' });
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var authenticated = data.action === 'score.submit';
        data.sharingOwner = '';
        if (authenticated) {
            var profile = findSharingProfile(ss, data.sharingToken);
            if (!profile || profile.values[2] !== true) return sharingDenied();
            data.sharingOwner = profile.values[0];
        }
        // 古いクライアントも、同じ不変ペイロードの再送を受領済みとして返す。
        data.resultId = data.resultId || 'legacy-' + scoreDigest(JSON.stringify([
            data.userUUID || '', data.startedAt || '', data.completedAt || '', data.displayScore
        ]));
        var cacheKey = 'score_history_' + scoreDigest(data.resultId + JSON.stringify(data.turnHistory || []));
        var cache = null;
        try {
            cache = authenticated ? null : CacheService.getScriptCache();
            if (cache && cache.get(cacheKey)) return scoreAcknowledgement(data, true);
        } catch (cacheError) { /* Cacheは必須ではない */ }

        var sheet = ss.getSheetByName('スコア記録') || ss.insertSheet('スコア記録');
        var headers = ensureScoreRecordHeaders(sheet);
        var idColumn = headers.indexOf('結果ID') + 1;
        var lastRow = sheet.getLastRow();
        var existing = lastRow > 1 && sheet.getRange(2, idColumn, lastRow - 1, 1)
            .createTextFinder(data.resultId).matchEntireCell(true).matchCase(true).findNext();
        if (existing) {
            var owner = sheet.getRange(existing.getRow(), headers.indexOf('共有同意ID') + 1).getValue();
            if ((owner || '') !== data.sharingOwner) return sharingDenied();
        } else sheet.appendRow(buildScoreRecordRow(headers, data));
        appendTurnHistory(ss, data);
        if (authenticated && data.replayText) appendSharedDiary(ss, data);
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
        if (e.postData.contents.length > 2000000) {
            console.error('[scoreReceiver] payload too large: length=' + e.postData.contents.length);
            return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'payload too large', turnHistorySupported: true }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        var data = JSON.parse(e.postData.contents);
        if (data && typeof data.action === 'string' && data.action !== 'score.submit') return sharingAction(data);

        if (data && data.action !== 'score.submit' && buildVersionNumber(data.buildVersion) >= 202611220069) return sharingDenied();

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
        sharingSupported: true,
        currentVersion: CURRENT_BUILD_VERSION
    }))
        .setMimeType(ContentService.MimeType.JSON);
}


function sharingDenied() {
    return jsonResponse({ status: 'error', message: 'forbidden' });
}

function sharingTokenHash(token) {
    if (typeof token !== 'string' || !/^[a-f0-9-]{72}$/.test(token)) return null;
    return 'token-' + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8)
        .map(function(value) { return ('0' + (value & 0xFF).toString(16)).slice(-2); }).join('');
}

function findSharingRow(sheet, key) {
    if (!sheet || sheet.getLastRow() < 2) return null;
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(key)
        .matchEntireCell(true).matchCase(true).findNext();
}

function findSharingProfile(ss, token) {
    var hash = sharingTokenHash(token);
    if (!hash) return null;
    var sheet = ss.getSheetByName('教室日誌の共有設定');
    var found = findSharingRow(sheet, hash);
    if (!found) return null;
    var row = found.getRow();
    return { sheet: sheet, row: row, values: sheet.getRange(row, 1, 1, 4).getValues()[0] };
}

function sharingSheet(ss, name, headers) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (!sheet.getLastRow()) sheet.appendRow(headers);
    return sheet;
}

function sharingAction(data) {
    var nickname = typeof data.nickname === 'string' ? data.nickname.trim() : '';
    if ((data.action === 'sharing.enable' || data.action === 'sharing.rename')
        && (!nickname || Array.from(nickname).length > 8 || /[\u0000-\u001f\u007f-\u009f]/.test(nickname))) {
        return jsonResponse({ status: 'error', message: 'invalid nickname' });
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return jsonResponse({ status: 'error', message: 'busy' });
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        if (data.action === 'sharing.enable') {
            var token = Utilities.getUuid() + Utilities.getUuid();
            var grantId = Utilities.getUuid();
            var sheet = sharingSheet(ss, '教室日誌の共有設定', ['トークンハッシュ', 'ニックネームJSON', '共有中', '同意ID']);
            sheet.appendRow([sharingTokenHash(token), JSON.stringify(nickname), true, grantId]);
            SpreadsheetApp.flush();
            return jsonResponse({ status: 'ok', token: token, grantId: grantId });
        }
        var profile = findSharingProfile(ss, data.sharingToken);
        if (!profile) return sharingDenied();
        if (data.action === 'sharing.revoke') {
            profile.sheet.getRange(profile.row, 3).setValue(false);
            SpreadsheetApp.flush();
            return jsonResponse({ status: 'ok' });
        }
        if (profile.values[2] !== true) return sharingDenied();
        if (data.action === 'sharing.rename') {
            profile.sheet.getRange(profile.row, 2).setValue(JSON.stringify(nickname));
            SpreadsheetApp.flush();
            return jsonResponse({ status: 'ok' });
        }
        if (data.action === 'diary.list') return listDiaries(ss, profile.sheet, data.before, profile.values[0]);
        if (data.action === 'diary.get') return readDiary(ss, profile.sheet, data.resultId);
        return jsonResponse({ status: 'error', message: 'unknown action' });
    } finally { lock.releaseLock(); }
}

function appendSharedDiary(ss, data) {
    var diaries = sharingSheet(ss, '共有した教室日誌', ['結果ID', '共有同意ID', '日誌一覧JSON', 'リプレイ行', 'リプレイ分割数']);
    if (findSharingRow(diaries, data.resultId)) return;
    var deck = data.diaryFinalDeck.map(function(card) {
        return { cardNo: card.cardNo, cardName: card.cardName, rarity: card.rarity, category: card.category };
    });
    var entry = { resultId: data.resultId, difficulty: data.difficulty, displayScore: data.displayScore,
        grade: data.grade, completedAt: data.completedAt, finalDeck: deck };
    var parts = sharingSheet(ss, '教室日誌リプレイ', ['リプレイ片']);
    var firstRow = parts.getLastRow() + 1;
    var replay = data.replayText;
    for (var i = 0; i < replay.length; i += 24000) parts.appendRow(['r:' + replay.slice(i, i + 24000)]);
    SpreadsheetApp.flush();
    diaries.appendRow([data.resultId, data.sharingOwner, JSON.stringify(entry), firstRow, Math.ceil(replay.length / 24000)]);
}

function activeDiaryNicknames(sheet) {
    var nicknames = Object.create(null);
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(function(row) {
        if (row[2] === true) nicknames[row[0]] = JSON.parse(row[1]);
    });
    return nicknames;
}

function listDiaries(ss, profiles, before, reader) {
    var sheet = ss.getSheetByName('共有した教室日誌');
    var entries = [];
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ status: 'ok', entries: entries, nextBefore: null });
    var nicknames = activeDiaryNicknames(profiles);
    var row = Number.isInteger(before) && before >= 2 ? Math.min(sheet.getLastRow(), before - 1) : sheet.getLastRow();
    while (row >= 2 && entries.length < 20) {
        var start = Math.max(2, row - 99);
        var batch = sheet.getRange(start, 1, row - start + 1, 3).getValues();
        for (var i = batch.length - 1; i >= 0 && entries.length < 20; i--, row--) {
            if (batch[i][1] === reader) continue;
            var nickname = nicknames[batch[i][1]];
            if (!nickname) continue;
            var entry = JSON.parse(batch[i][2]);
            entry.nickname = nickname;
            entries.push(entry);
        }
    }
    return jsonResponse({ status: 'ok', entries: entries, nextBefore: row >= 2 ? row + 1 : null });
}

function readDiary(ss, profiles, resultId) {
    if (typeof resultId !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(resultId)) return sharingDenied();
    var sheet = ss.getSheetByName('共有した教室日誌');
    var found = findSharingRow(sheet, resultId);
    if (!found) return sharingDenied();
    var row = sheet.getRange(found.getRow(), 1, 1, 5).getValues()[0];
    var nickname = activeDiaryNicknames(profiles)[row[1]];
    if (!nickname) return sharingDenied();
    var entry = JSON.parse(row[2]);
    entry.nickname = nickname;
    entry.replayText = ss.getSheetByName('教室日誌リプレイ').getRange(row[3], 1, row[4], 1).getValues()
        .map(function(part) { return part[0].slice(2); }).join('');
    return jsonResponse({ status: 'ok', entry: entry });
}
