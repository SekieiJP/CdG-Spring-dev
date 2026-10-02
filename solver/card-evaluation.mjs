import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const cardKey = card => card.definitionId || `card:${card.cardNo || `${card.rarity}:${card.cardName}`}`;
const modeKey = meta => `${meta.calcMode ? '計算機' : '通常'}${meta.eventId ? `/${meta.eventId}` : ''}`;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function distribution(values) {
    const sorted = [...values].sort((a, b) => a - b); const average = mean(sorted);
    const variance = sorted.length > 1 ? sorted.reduce((sum, value) => sum + (value - average) ** 2, 0) / (sorted.length - 1) : 0;
    return { n: sorted.length, mean: average, p10: sorted[Math.ceil(sorted.length * .1) - 1] ?? null,
        p50: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p90: sorted[Math.ceil(sorted.length * .9) - 1] ?? null,
        approximate95HalfWidth: sorted.length >= 30 ? 1.96 * Math.sqrt(variance / sorted.length) : null };
}

export function recordsFrom(data) {
    if (data?.schema === 1 && Array.isArray(data.events)) return [data];
    if (Array.isArray(data?.records)) return data.records;
    if (Array.isArray(data?.simulations)) return data.simulations.flatMap(sim => sim.playRecords || []);
    throw new Error('共通形式のプレイ記録がありません。新しいsolverで再計測してください');
}

export function aggregateRecords(records) {
    const groups = new Map();
    for (const record of records) {
        const meta = record.metadata;
        const groupKey = JSON.stringify([meta.difficulty, meta.cardVersion, meta.rankVersion, meta.codeVersion,
            meta.provenance?.codeHash, meta.strategy, meta.source, modeKey(meta), meta.replacement]);
        let group = groups.get(groupKey);
        if (!group) {
            group = { id: groups.size, metadata: meta, mode: modeKey(meta), games: 0, completed: 0, truncated: 0, scores: [], cards: new Map() };
            groups.set(groupKey, group);
        }
        group.games++; group.truncated += record.truncated ? 1 : 0;
        const score = Number(record.result?.score?.displayScore ?? record.result?.score?.points);
        const complete = record.result && Number.isFinite(score);
        if (complete) { group.completed++; group.scores.push(score); }
        const ensure = card => {
            const id = cardKey(card);
            if (!group.cards.has(id)) group.cards.set(id, { id, name: card.cardName, cardNo: card.cardNo, rarity: card.rarity,
                category: card.category, effect: card.effect, offered: 0, acquired: 0, drawn: 0, placed: 0, resolved: 0, applied: 0,
                costFailures: 0, conditionsChecked: 0, conditionsMatched: 0, recommended: 0,
                deltas: Object.fromEntries(STATS.map(key => [key, 0])), tokenDeltas: {}, acquireTurns: {}, turns: {}, staffs: {},
                ownedScores: [], usedScores: [], notOwnedScores: [], finalHeld: 0 });
            return group.cards.get(id);
        };
        for (const card of meta.catalog || []) ensure(card);
        const acquired = new Set(); const used = new Set(); const held = new Set();
        for (const event of record.events) {
            if (event.type === 'offer' || event.type === 'draw') for (const card of event.cards || []) ensure(card)[event.type === 'offer' ? 'offered' : 'drawn']++;
            else if (event.type === 'acquire') {
                const row = ensure(event.card); row.acquired++; acquired.add(row.id);
                row.acquireTurns[event.turn + 1] = (row.acquireTurns[event.turn + 1] || 0) + 1;
            } else if (event.type === 'place') ensure(event.card).placed++;
            else if (event.type === 'resolve') {
                const row = ensure(event); row.resolved++; row.applied += event.applied ? 1 : 0;
                row.costFailures += event.skippedReason === 'cost_shortage' ? 1 : 0;
                row.conditionsChecked += event.conditions?.length || 0;
                row.conditionsMatched += event.conditions?.filter(condition => condition.matched).length || 0;
                row.recommended += event.recommendedApplied ? 1 : 0;
                for (const key of STATS) row.deltas[key] += (event.afterStats[key] || 0) - (event.beforeStats[key] || 0);
                for (const key of new Set([...Object.keys(event.beforeTokens || {}), ...Object.keys(event.afterTokens || {})])) {
                    row.tokenDeltas[key] = (row.tokenDeltas[key] || 0) + (event.afterTokens?.[key] || 0) - (event.beforeTokens?.[key] || 0);
                }
                row.turns[event.turn + 1] = (row.turns[event.turn + 1] || 0) + 1;
                row.staffs[event.staff] = (row.staffs[event.staff] || 0) + 1;
                if (event.applied) used.add(row.id);
            }
        }
        for (const card of record.result?.finalDeck || []) { const row = ensure(card); row.finalHeld++; held.add(row.id); }
        if (complete) for (const row of group.cards.values()) {
            if (acquired.has(row.id)) row.ownedScores.push(score); else row.notOwnedScores.push(score);
            if (used.has(row.id)) row.usedScores.push(score);
        }
    }
    return [...groups.values()].map(group => ({ ...group, scores: distribution(group.scores), cards: [...group.cards.values()].map(row => ({
        ...row, acquisitionRateWhenOffered: row.rarity === 'N' || !row.offered ? null : row.acquired / row.offered,
        ownedScores: distribution(row.ownedScores), usedScores: distribution(row.usedScores), notOwnedScores: distribution(row.notOwnedScores)
    })).sort((a, b) => Number(a.cardNo) - Number(b.cardNo) || a.name.localeCompare(b.name)) }));
}

/** 同じseed・戦略・難易度・実行モードのゲームを対にする。版は比較差として明示する。 */
export function comparePaired(before, after) {
    const key = record => JSON.stringify([record.metadata.seed, record.metadata.strategy, record.metadata.difficulty, modeKey(record.metadata)]);
    const score = record => Number(record.result?.score?.displayScore ?? record.result?.score?.points);
    const indexed = new Map(before.filter(record => record.result).map(record => [key(record), record]));
    const pairs = after.filter(record => record.result && indexed.has(key(record))).map(record => ({ seed: record.metadata.seed,
        strategy: record.metadata.strategy, before: score(indexed.get(key(record))), after: score(record),
        difference: score(record) - score(indexed.get(key(record))) }));
    return { paired: pairs.length, beforeGames: before.length, afterGames: after.length,
        differences: distribution(pairs.map(pair => pair.difference)), pairs };
}

export function buildEvaluationHTML(groups, comparison = null) {
    const rows = groups.flatMap(group => group.cards.map(card => ({ ...card, group: group.id })));
    const embedded = JSON.stringify({ groups, rows, comparison }).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>カード評価・開発用</title><style>body{font:15px system-ui;margin:24px;background:#f4f7fb;color:#15243b}h1{font-size:24px}select,input{padding:8px;margin:4px;max-width:90vw}table{border-collapse:collapse;background:white;width:100%;font-size:13px}th,td{padding:9px;border-bottom:1px solid #dce3ec;text-align:right}th{position:sticky;top:0;background:#e6edf7}td:nth-child(2),th:nth-child(2){text-align:left}details{max-width:360px;text-align:left}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;font-size:12px}.table{overflow:auto}#meta{background:white;padding:16px;border-radius:10px;white-space:pre-wrap}button{padding:8px}</style>
<h1>カード評価・開発用</h1><p>提示・取得・ドロー・有効解決を別々に観測します。直接増分にはおすすめを含みます。トークンや将来のドローの価値は最終得点と併せて確認してください。取得・使用ゲームの高得点は相関であり、カード単独の強さを証明しません。</p>
<label>測定環境<select id="group"></select></label><label>カード<input id="search" placeholder="名前・No・カテゴリ"></label><p id="summary"></p><details><summary>測定条件・版・seed</summary><pre id="meta"></pre></details>
${comparison ? `<p>同じseedの対比較：${comparison.paired}ゲーム、得点差の平均 ${comparison.differences.mean?.toFixed(3) ?? '—'}。初期seedを揃えた比較です。差し替え後の判断・候補・山札は変化し得ます。</p>` : ''}
<div class="table"><table><thead><tr><th>No</th><th>カード（クリックで詳細）</th><th>提示</th><th>取得</th><th>取得/提示</th><th>ドロー</th><th>解決/有効</th><th>コスト不足</th><th>条件成立/判定</th><th>実使用ゲーム得点・n</th><th>最終所持枚数</th></tr></thead><tbody id="rows"></tbody></table></div>
<script>const data=${embedded};const group=document.querySelector('#group'),search=document.querySelector('#search');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const g of data.groups){const o=document.createElement('option');o.value=g.id;o.textContent=g.metadata.difficulty+' / '+(g.metadata.strategy||g.metadata.source)+' / '+g.metadata.codeVersion+' / '+(g.metadata.replacement||'原版')+' / '+g.metadata.cardVersion?.slice(0,15);group.append(o)}
function draw(){const g=data.groups.find(g=>String(g.id)===group.value);if(!g)return;
document.querySelector('#summary').textContent='完了 '+g.completed+' / '+g.games+'ゲーム、平均 '+g.scores.mean?.toFixed(2)+'、中央値 '+g.scores.p50+'、p10〜p90 '+g.scores.p10+'〜'+g.scores.p90+'。記録の上限到達 '+g.truncated+'件。';
document.querySelector('#meta').textContent=JSON.stringify({...g.metadata,catalog:undefined},null,2);
document.querySelector('#rows').innerHTML=data.rows.filter(r=>r.group===g.id&&[r.name,r.cardNo,r.category].join(' ').includes(search.value)).map(r=>'<tr><td>'+esc(r.cardNo)+'</td><td><details><summary>'+esc(r.name)+'</summary><p>'+esc(r.effect)+'</p><pre>'+esc(JSON.stringify({取得ターン:r.acquireTurns,解決ターン:r.turns,配置先:r.staffs,直接増分:r.deltas,トークン増分:r.tokenDeltas,おすすめ回数:r.recommended,取得ゲーム得点:r.ownedScores,未取得ゲーム得点:r.notOwnedScores},null,2))+'</pre></details></td><td>'+r.offered+'</td><td>'+r.acquired+'</td><td>'+(r.acquisitionRateWhenOffered===null?'—':(100*r.acquisitionRateWhenOffered).toFixed(1)+'%')+'</td><td>'+r.drawn+'</td><td>'+r.resolved+'/'+r.applied+'</td><td>'+r.costFailures+'</td><td>'+r.conditionsMatched+'/'+r.conditionsChecked+'</td><td>'+(r.usedScores.mean?.toFixed(2)??'—')+'・'+r.usedScores.n+(r.usedScores.approximate95HalfWidth===null?'（少試行）':' ±'+r.usedScores.approximate95HalfWidth.toFixed(2)+'（95%概算）')+'</td><td>'+r.finalHeld+'</td></tr>').join('')}
group.onchange=draw;search.oninput=draw;draw();</script></html>`;
}

export function buildEvaluationCSV(groups) {
    const fields = ['difficulty','source','mode','strategy','strategyVersion','rulesVersion','cardVersion','rankVersion','codeVersion','codeHash','randomAlgorithm','replacement','games','cardNo','name','rarity','category','offered','acquired','acquisitionRateWhenOffered','drawn','resolved','applied','costFailures','conditionsChecked','conditionsMatched','finalHeld','usedGameMean','usedGameN'];
    const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return fields.map(cell).join(',') + '\n' + groups.flatMap(group => group.cards.map(card => {
        const row = { ...group.metadata, ...group.metadata.provenance, ...card, mode: group.mode, games: group.games,
            usedGameMean: card.usedScores.mean, usedGameN: card.usedScores.n };
        return fields.map(field => cell(row[field])).join(',');
    })).join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const inputs = process.argv.slice(2); const flag = inputs.indexOf('--output-dir');
    const outputDir = flag >= 0 ? inputs.splice(flag, 2)[1] : 'solver/local-evaluation';
    const beforeFlag = inputs.indexOf('--compare-before'); const beforePath = beforeFlag >= 0 ? inputs.splice(beforeFlag, 2)[1] : null;
    if (!inputs.length) throw new Error('入力JSONを指定してください');
    const records = (await Promise.all(inputs.map(async file => recordsFrom(JSON.parse(await readFile(file, 'utf8')))))).flat();
    const groups = aggregateRecords(records);
    const comparison = beforePath ? comparePaired(recordsFrom(JSON.parse(await readFile(beforePath, 'utf8'))), records) : null;
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(outputDir, 'cards.json'), JSON.stringify({ generatedAt: new Date().toISOString(), groups, comparison }, null, 2));
    await writeFile(resolve(outputDir, 'cards.csv'), buildEvaluationCSV(groups));
    await writeFile(resolve(outputDir, 'index.html'), buildEvaluationHTML(groups, comparison));
    console.log(`評価レポート: ${resolve(outputDir, 'index.html')} / ${records.length}ゲーム / ${groups.length}条件`);
}
