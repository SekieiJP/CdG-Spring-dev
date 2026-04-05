function doPost(e) {
    try {
        var data = JSON.parse(e.postData.contents);
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName('スコア記録') || ss.insertSheet('スコア記録');

        if (sheet.getLastRow() === 0) {
            sheet.appendRow([
                '受信日時', 'ゲーム開始日時', 'ゲーム完了日時', 'ビルドバージョン',
                '難易度', '体験', '入塾', '満足', '経理',
                '総合スコア', 'ランク', '目標ポイント',
                '退塾数', '動員合計', '入退差', '最終デッキ'
            ]);
        }

        sheet.appendRow([
            new Date(),
            data.startedAt || '', data.completedAt || '', data.buildVersion || '',
            data.difficulty || '',
            data.experience, data.enrollment, data.satisfaction, data.accounting,
            data.displayScore, data.grade, data.points,
            data.withdrawal, data.mobilization, data.enrollmentDiff,
            (data.finalDeck || []).join(', ')
        ]);

        return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function doGet(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Score receiver is running' }))
        .setMimeType(ContentService.MimeType.JSON);
}
