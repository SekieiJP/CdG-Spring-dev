#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

function parseDeck(listText) {
  if (!listText) return [];
  return listText
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function cardCounts(records) {
  const m = new Map();
  for (const r of records) {
    for (const c of r.deck) {
      m.set(c, (m.get(c) || 0) + 1);
    }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function avg(records, key) {
  if (records.length === 0) return 0;
  return records.reduce((s, r) => s + (r[key] || 0), 0) / records.length;
}

function rankValue(rank) {
  const order = ['F', 'E', 'D', 'C', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS'];
  const idx = order.indexOf(rank);
  return idx >= 0 ? idx : -1;
}

async function main() {
  const csvPath = path.resolve('solver/スコア記録20260412.csv');
  const outPath = path.resolve('solver/pro-player-score-analysis-20260412.md');
  const raw = await readFile(csvPath, 'utf8');
  const rows = parseCsv(raw);
  const header = rows[0];
  const index = new Map(header.map((h, i) => [h, i]));
  const get = (r, k) => r[index.get(k)] ?? '';

  const data = rows.slice(1).map((r) => ({
    difficulty: get(r, '難易度').trim(),
    version: get(r, 'ビルドバージョン').trim(),
    experience: Number(get(r, '体験') || 0),
    enrollment: Number(get(r, '入塾') || 0),
    satisfaction: Number(get(r, '満足') || 0),
    accounting: Number(get(r, '経理') || 0),
    totalScore: Number(get(r, '総合スコア') || 0),
    rank: get(r, 'ランク').trim(),
    points: Number(get(r, '目標ポイント') || 0),
    withdrawal: Number(get(r, '退塾数') || 0),
    mobilization: Number(get(r, '動員合計') || 0),
    enrollmentDiff: Number(get(r, '入退差') || 0),
    deck: parseDeck(get(r, '最終デッキ')),
    deleted: parseDeck(get(r, '削除カード'))
  }));

  const pro = data.filter((r) => r.difficulty === 'pro');
  const currentRuleS = pro.filter((r) => r.points >= 12);
  const currentRuleAplus = pro.filter((r) => r.points >= 10);
  const oldHighRank = pro.filter((r) => rankValue(r.rank) >= rankValue('A+'));
  const topQuartileByPoints = [...pro].sort((a, b) => b.points - a.points).slice(0, Math.max(1, Math.ceil(pro.length * 0.25)));

  const topCardsS = cardCounts(currentRuleS).slice(0, 15);
  const topCardsAplus = cardCounts(currentRuleAplus).slice(0, 15);
  const topCardsOldHigh = cardCounts(oldHighRank).slice(0, 15);

  const lines = [];
  lines.push('# PRO 実プレイ記録分析（2026-04-12）');
  lines.push('');
  lines.push(`- サンプル総数: ${data.length}`);
  lines.push(`- PROサンプル: ${pro.length}`);
  lines.push(`- 現行ルールS相当（points>=12）: ${currentRuleS.length} (${pro.length ? ((currentRuleS.length / pro.length) * 100).toFixed(1) : '0.0'}%)`);
  lines.push(`- 現行ルールA+相当（points>=10）: ${currentRuleAplus.length} (${pro.length ? ((currentRuleAplus.length / pro.length) * 100).toFixed(1) : '0.0'}%)`);
  lines.push(`- 旧ランク高成績（rank>=A+）: ${oldHighRank.length} (${pro.length ? ((oldHighRank.length / pro.length) * 100).toFixed(1) : '0.0'}%)`);
  lines.push('');

  const groups = [
    ['全PRO', pro],
    ['現行A+相当(points>=10)', currentRuleAplus],
    ['現行S相当(points>=12)', currentRuleS],
    ['旧ランク高成績(rank>=A+)', oldHighRank],
    ['ポイント上位25%', topQuartileByPoints]
  ];

  lines.push('## ステータス平均');
  lines.push('');
  lines.push('| Group | n | 体験 | 入塾 | 満足 | 経理 | 退塾 | 入退差 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [label, recs] of groups) {
    lines.push(`| ${label} | ${recs.length} | ${avg(recs, 'experience').toFixed(2)} | ${avg(recs, 'enrollment').toFixed(2)} | ${avg(recs, 'satisfaction').toFixed(2)} | ${avg(recs, 'accounting').toFixed(2)} | ${avg(recs, 'withdrawal').toFixed(2)} | ${avg(recs, 'enrollmentDiff').toFixed(2)} |`);
  }
  lines.push('');

  function pushCardTable(title, rowsCard) {
    lines.push(`## ${title}`);
    lines.push('');
    lines.push('| Card | Count |');
    lines.push('|---|---:|');
    if (rowsCard.length === 0) {
      lines.push('| (なし) | 0 |');
    } else {
      for (const [name, c] of rowsCard) {
        lines.push(`| ${name} | ${c} |`);
      }
    }
    lines.push('');
  }

  pushCardTable('現行S相当（points>=12）デッキ頻出カード Top15', topCardsS);
  pushCardTable('現行A+相当（points>=10）デッキ頻出カード Top15', topCardsAplus);
  pushCardTable('旧ランク高成績（rank>=A+）デッキ頻出カード Top15', topCardsOldHigh);

  lines.push('## メモ');
  lines.push('');
  lines.push('- ビルドバージョンが混在し、旧ビルドでは rank と points の対応が現行と異なる。');
  lines.push('- 方略重みへの反映は、rankよりも `目標ポイント`（points）基準を優先する。');
  lines.push('- token相互作用はカード名頻度とステータス平均の両方を見て、過適合を避ける。');
  lines.push('');

  await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
