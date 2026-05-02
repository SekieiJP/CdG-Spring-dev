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

function parseCardList(listText) {
  if (!listText) return [];
  return listText
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums) {
  if (!nums.length) return 0;
  const m = mean(nums);
  const v = mean(nums.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

function pearson(xs, ys) {
  if (!xs.length || xs.length !== ys.length) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx <= 0 || dy <= 0) return null;
  return num / Math.sqrt(dx * dy);
}

function toRate(n, d) {
  if (!d) return 0;
  return n / d;
}

function fmtPct(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtNum(v, digits = 3) {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function buildCardMeta(csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0] || [];
  const idx = new Map(header.map((h, i) => [h, i]));
  const get = (r, k) => r[idx.get(k)] ?? '';
  const map = new Map();

  for (const r of rows.slice(1)) {
    const cardName = String(get(r, 'cardName') || '').trim();
    const rarity = String(get(r, 'rarity') || '').trim();
    const category = String(get(r, 'category') || '').trim();
    if (!cardName) continue;
    if (!map.has(cardName)) {
      map.set(cardName, { rarity, category });
    }
  }
  return map;
}

function buildUsageStats(records, scoreKey, cardMeta, unknownSet) {
  const n = records.length;
  const scoreArray = records.map((r) => r[scoreKey]);
  const finalPresence = new Map();
  const finalCopies = new Map();

  for (const r of records) {
    const set = new Set(r.finalCards);
    for (const c of set) finalPresence.set(c, (finalPresence.get(c) || 0) + 1);
    for (const c of r.finalCards) finalCopies.set(c, (finalCopies.get(c) || 0) + 1);
  }

  const usageRows = [...new Set([...finalPresence.keys(), ...finalCopies.keys()])]
    .map((cardName) => {
      if (!cardMeta.has(cardName)) unknownSet.add(cardName);
      const presenceCount = finalPresence.get(cardName) || 0;
      const copyCount = finalCopies.get(cardName) || 0;
      const usedScores = [];
      const notUsedScores = [];
      const xPresence = [];
      const xCopies = [];
      for (const r of records) {
        const c = r.finalCards.filter((x) => x === cardName).length;
        xCopies.push(c);
        const has = c > 0 ? 1 : 0;
        xPresence.push(has);
        if (has) usedScores.push(r[scoreKey]);
        else notUsedScores.push(r[scoreKey]);
      }
      const corrPresence = pearson(xPresence, scoreArray);
      const corrCopies = pearson(xCopies, scoreArray);
      const usedMean = mean(usedScores);
      const notUsedMean = mean(notUsedScores);
      return {
        cardName,
        rarity: cardMeta.get(cardName)?.rarity || 'UNKNOWN',
        category: cardMeta.get(cardName)?.category || 'UNKNOWN',
        presenceCount,
        presenceRate: toRate(presenceCount, n),
        copyCount,
        avgCopiesPerRun: toRate(copyCount, n),
        avgCopiesWhenPresent: toRate(copyCount, presenceCount),
        usedMean,
        notUsedMean,
        meanDiff: usedMean - notUsedMean,
        corrPresence,
        corrCopies
      };
    })
    .sort((a, b) => b.presenceRate - a.presenceRate || b.copyCount - a.copyCount || a.cardName.localeCompare(b.cardName, 'ja'));

  return usageRows;
}

function buildAcquisitionStats(records, scoreKey, cardMeta, unknownSet) {
  const n = records.length;
  const scoreArray = records.map((r) => r[scoreKey]);
  const acqPresence = new Map();
  const acqCopies = new Map();
  let totalAcqCopies = 0;

  for (const r of records) {
    const merged = [...r.finalCards, ...r.deletedCards];
    const nonN = merged.filter((cardName) => {
      const rarity = cardMeta.get(cardName)?.rarity;
      if (!rarity) {
        unknownSet.add(cardName);
        return false;
      }
      return rarity !== 'N';
    });
    const set = new Set(nonN);
    for (const c of set) acqPresence.set(c, (acqPresence.get(c) || 0) + 1);
    for (const c of nonN) {
      acqCopies.set(c, (acqCopies.get(c) || 0) + 1);
      totalAcqCopies += 1;
    }
  }

  const acqRows = [...new Set([...acqPresence.keys(), ...acqCopies.keys()])]
    .map((cardName) => {
      const presenceCount = acqPresence.get(cardName) || 0;
      const copyCount = acqCopies.get(cardName) || 0;
      const usedScores = [];
      const notUsedScores = [];
      const xPresence = [];
      const xCopies = [];
      for (const r of records) {
        const merged = [...r.finalCards, ...r.deletedCards];
        const copies = merged.filter((x) => x === cardName).length;
        xCopies.push(copies);
        const has = copies > 0 ? 1 : 0;
        xPresence.push(has);
        if (has) usedScores.push(r[scoreKey]);
        else notUsedScores.push(r[scoreKey]);
      }
      const corrPresence = pearson(xPresence, scoreArray);
      const corrCopies = pearson(xCopies, scoreArray);
      const usedMean = mean(usedScores);
      const notUsedMean = mean(notUsedScores);
      return {
        cardName,
        rarity: cardMeta.get(cardName)?.rarity || 'UNKNOWN',
        category: cardMeta.get(cardName)?.category || 'UNKNOWN',
        presenceCount,
        presenceRate: toRate(presenceCount, n),
        copyCount,
        shareInAcquired: toRate(copyCount, totalAcqCopies),
        avgCopiesPerRun: toRate(copyCount, n),
        avgCopiesWhenPresent: toRate(copyCount, presenceCount),
        usedMean,
        notUsedMean,
        meanDiff: usedMean - notUsedMean,
        corrPresence,
        corrCopies
      };
    })
    .sort((a, b) => b.presenceRate - a.presenceRate || b.copyCount - a.copyCount || a.cardName.localeCompare(b.cardName, 'ja'));

  return { rows: acqRows, totalAcqCopies };
}

function topBy(rows, key, options = {}) {
  const {
    minPresence = 1,
    maxPresenceRate = 1,
    minPresenceRate = 0,
    limit = 10,
    desc = true
  } = options;
  const filtered = rows.filter((r) => r.presenceCount >= minPresence && r.presenceRate >= minPresenceRate && r.presenceRate <= maxPresenceRate && Number.isFinite(r[key]));
  filtered.sort((a, b) => (desc ? (b[key] - a[key]) : (a[key] - b[key])));
  return filtered.slice(0, limit);
}

function renderTable(rows, cols) {
  const header = `| ${cols.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${cols.map((c) => c.value(r)).join(' | ')} |`);
  return [header, sep, ...body];
}

async function main() {
  const scorePath = path.resolve('solver/CdGスコアシート - スコア記録DL.csv');
  const freshCardsPath = path.resolve('game/data/cards_fresh.csv');
  const proCardsPath = path.resolve('game/data/cards_pro.csv');
  const outPath = path.resolve('solver/human-score-card-usage-analysis-20260417.md');

  const [scoreRaw, freshCardsRaw, proCardsRaw] = await Promise.all([
    readFile(scorePath, 'utf8'),
    readFile(freshCardsPath, 'utf8'),
    readFile(proCardsPath, 'utf8')
  ]);

  const freshMeta = buildCardMeta(freshCardsRaw);
  const proMeta = buildCardMeta(proCardsRaw);

  const rows = parseCsv(scoreRaw);
  const header = rows[0] || [];
  const idx = new Map(header.map((h, i) => [h, i]));
  const get = (r, k) => r[idx.get(k)] ?? '';

  const data = rows.slice(1).map((r) => ({
    difficulty: String(get(r, '難易度') || '').trim().toLowerCase(),
    score: Number(get(r, '総合スコア') || 0),
    rank: String(get(r, 'ランク') || '').trim(),
    finalCards: parseCardList(get(r, '最終デッキ')),
    deletedCards: parseCardList(get(r, '削除カード'))
  })).filter((r) => r.difficulty === 'fresh' || r.difficulty === 'pro');

  const groups = {
    fresh: data.filter((r) => r.difficulty === 'fresh'),
    pro: data.filter((r) => r.difficulty === 'pro')
  };

  const lines = [];
  lines.push('# 人間プレイヤー成績のカード使用率・取得率分析（2026-04-17）');
  lines.push('');
  lines.push(`- 入力: \`solver/CdGスコアシート - スコア記録DL.csv\``);
  lines.push(`- 集計対象: ${data.length}件（fresh: ${groups.fresh.length}, pro: ${groups.pro.length}）`);
  lines.push('- 取得率の定義: 「最終デッキ + 削除カード」に含まれるカードのうち、該当難易度カードプールで rarity != N のカードの出現率');
  lines.push('');

  for (const difficulty of ['fresh', 'pro']) {
    const records = groups[difficulty];
    const cardMeta = difficulty === 'fresh' ? freshMeta : proMeta;
    const unknownCards = new Set();
    const scores = records.map((r) => r.score);
    const scoreMean = mean(scores);
    const scoreStd = stddev(scores);
    const scoreMin = scores.length ? Math.min(...scores) : 0;
    const scoreMax = scores.length ? Math.max(...scores) : 0;

    const usageRows = buildUsageStats(records, 'score', cardMeta, unknownCards);
    const acq = buildAcquisitionStats(records, 'score', cardMeta, unknownCards);
    const acqRows = acq.rows;

    const usageTop = usageRows.slice(0, 20);
    const acqTop = acqRows.slice(0, 20);

    const usagePos = topBy(usageRows, 'meanDiff', { minPresence: 5, maxPresenceRate: 0.95, limit: 12, desc: true });
    const usageNeg = topBy(usageRows, 'meanDiff', { minPresence: 5, maxPresenceRate: 0.95, limit: 12, desc: false });
    const acqPos = topBy(acqRows, 'meanDiff', { minPresence: 5, maxPresenceRate: 0.95, limit: 12, desc: true });
    const acqNeg = topBy(acqRows, 'meanDiff', { minPresence: 5, maxPresenceRate: 0.95, limit: 12, desc: false });

    lines.push(`## ${difficulty.toUpperCase()}`);
    lines.push('');
    lines.push(`- サンプル数: ${records.length}`);
    lines.push(`- 総合スコア: 平均 ${fmtNum(scoreMean, 3)} / 標準偏差 ${fmtNum(scoreStd, 3)} / 最小 ${fmtNum(scoreMin, 1)} / 最大 ${fmtNum(scoreMax, 1)}`);
    lines.push(`- 非N取得カード総コピー数: ${acq.totalAcqCopies}`);
    if (unknownCards.size > 0) {
      lines.push(`- カードCSVに未登録のカード名（参考）: ${[...unknownCards].slice(0, 10).join(', ')}${unknownCards.size > 10 ? ` ...(+${unknownCards.size - 10})` : ''}`);
    }
    lines.push('');

    lines.push('### 最終カード使用率 Top20');
    lines.push('');
    lines.push(...renderTable(usageTop, [
      { label: 'Card', value: (r) => r.cardName },
      { label: 'Rarity', value: (r) => r.rarity },
      { label: 'Category', value: (r) => r.category },
      { label: '使用率', value: (r) => fmtPct(r.presenceRate) },
      { label: '平均枚数/試行', value: (r) => fmtNum(r.avgCopiesPerRun, 3) },
      { label: '使用時スコア差', value: (r) => fmtNum(r.meanDiff, 3) },
      { label: '相関(有無)', value: (r) => fmtNum(r.corrPresence, 3) }
    ]));
    lines.push('');

    lines.push('### カード取得率 Top20（非N, 最終+削除）');
    lines.push('');
    lines.push(...renderTable(acqTop, [
      { label: 'Card', value: (r) => r.cardName },
      { label: 'Rarity', value: (r) => r.rarity },
      { label: 'Category', value: (r) => r.category },
      { label: '取得率', value: (r) => fmtPct(r.presenceRate) },
      { label: '取得シェア', value: (r) => fmtPct(r.shareInAcquired) },
      { label: '取得時スコア差', value: (r) => fmtNum(r.meanDiff, 3) },
      { label: '相関(有無)', value: (r) => fmtNum(r.corrPresence, 3) }
    ]));
    lines.push('');

    lines.push('### 成績相関（最終カード使用）: 正相関 Top12');
    lines.push('');
    lines.push(...renderTable(usagePos, [
      { label: 'Card', value: (r) => r.cardName },
      { label: '使用率', value: (r) => fmtPct(r.presenceRate) },
      { label: '使用時スコア差', value: (r) => fmtNum(r.meanDiff, 3) },
      { label: '相関(有無)', value: (r) => fmtNum(r.corrPresence, 3) }
    ]));
    lines.push('');

    lines.push('### 成績相関（最終カード使用）: 負相関 Top12');
    lines.push('');
    lines.push(...renderTable(usageNeg, [
      { label: 'Card', value: (r) => r.cardName },
      { label: '使用率', value: (r) => fmtPct(r.presenceRate) },
      { label: '使用時スコア差', value: (r) => fmtNum(r.meanDiff, 3) },
      { label: '相関(有無)', value: (r) => fmtNum(r.corrPresence, 3) }
    ]));
    lines.push('');

    lines.push('### 成績相関（非N取得）: 正相関 Top12');
    lines.push('');
    lines.push(...renderTable(acqPos, [
      { label: 'Card', value: (r) => r.cardName },
      { label: '取得率', value: (r) => fmtPct(r.presenceRate) },
      { label: '取得時スコア差', value: (r) => fmtNum(r.meanDiff, 3) },
      { label: '相関(有無)', value: (r) => fmtNum(r.corrPresence, 3) }
    ]));
    lines.push('');

    lines.push('### 成績相関（非N取得）: 負相関 Top12');
    lines.push('');
    lines.push(...renderTable(acqNeg, [
      { label: 'Card', value: (r) => r.cardName },
      { label: '取得率', value: (r) => fmtPct(r.presenceRate) },
      { label: '取得時スコア差', value: (r) => fmtNum(r.meanDiff, 3) },
      { label: '相関(有無)', value: (r) => fmtNum(r.corrPresence, 3) }
    ]));
    lines.push('');
  }

  lines.push('## 解釈上の注意');
  lines.push('');
  lines.push('- 本分析は観測データに対する相関であり、因果を直接示すものではない。');
  lines.push('- 使用率が高すぎるカード（ほぼ全試行で使用）は、相関係数が小さく出やすい。');
  lines.push('- 取得率の母集団は「非Nカード取得」に限定しているため、N中心戦略との直接比較には補正が必要。');
  lines.push('');

  await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

