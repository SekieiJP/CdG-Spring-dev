import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const paths = {
  combine: path.join(repoRoot, 'game/data/cards_combine.csv'),
  fresh: path.join(repoRoot, 'game/data/cards_fresh.csv'),
  freshOld: path.join(repoRoot, 'game/data/cards_fresh_old.csv'),
  pro: path.join(repoRoot, 'game/data/cards_pro.csv'),
  proOld: path.join(repoRoot, 'game/data/cards_pro_old.csv'),
  releaseNote: path.join(repoRoot, 'game/releaseNote.html'),
};

const freshHeader = ['category', 'rarity', 'cardName', 'topEffect', 'effect 【】=カードを配置できるスタッフ。〈〉=以降の効果が発動する条件。', 'cardNo'];
const proHeader = ['category', 'rarity', 'cardName', 'topEffectPro', 'effectPro', 'cardNo'];
const requiredCombineColumns = ['cardNo', 'category', 'rarity', 'cardName', 'topEffectFresh', 'effectFresh', 'topEffectPro', 'effectPro'];

async function main() {
  const combineText = await readFile(paths.combine, 'utf8');
  const combineRows = parseCsvWithHeader(combineText, paths.combine);
  assertColumns(combineRows.header, requiredCombineColumns, paths.combine);

  const oldFreshText = await readFile(paths.fresh, 'utf8');
  const oldProText = await readFile(paths.pro, 'utf8');
  const releaseFreshBaseText = await readOptionalFile(paths.freshOld) ?? oldFreshText;
  const releaseProBaseText = await readOptionalFile(paths.proOld) ?? oldProText;

  await copyFile(paths.fresh, paths.freshOld);
  await copyFile(paths.pro, paths.proOld);

  const freshRows = combineRows.records
    .filter((row) => (row.effectFresh ?? '').trim() !== '')
    .map((row) => ({
      category: row.category,
      rarity: row.rarity,
      cardName: row.cardName,
      topEffect: row.topEffectFresh,
      effect: row.effectFresh,
      cardNo: row.cardNo,
    }));

  const proRows = combineRows.records
    .filter((row) => (row.effectPro ?? '').trim() !== '')
    .map((row) => ({
      category: row.category,
      rarity: row.rarity,
      cardName: row.cardName,
      topEffectPro: row.topEffectPro,
      effectPro: row.effectPro,
      cardNo: row.cardNo,
    }));

  const newFreshText = stringifyCsv([
    freshHeader,
    ...freshRows.map((row) => [row.category, row.rarity, row.cardName, row.topEffect, row.effect, row.cardNo]),
  ]);
  const newProText = stringifyCsv([
    proHeader,
    ...proRows.map((row) => [row.category, row.rarity, row.cardName, row.topEffectPro, row.effectPro, row.cardNo]),
  ]);

  await writeFile(paths.fresh, newFreshText, 'utf8');
  await writeFile(paths.pro, newProText, 'utf8');

  const freshChanges = diffCards(
    normalizeDifficultyRows(parseCsvWithHeader(releaseFreshBaseText, paths.freshOld).records, 'fresh'),
    normalizeDifficultyRows(parseCsvWithHeader(newFreshText, paths.fresh).records, 'fresh'),
  );
  const proChanges = diffCards(
    normalizeDifficultyRows(parseCsvWithHeader(releaseProBaseText, paths.proOld).records, 'pro'),
    normalizeDifficultyRows(parseCsvWithHeader(newProText, paths.pro).records, 'pro'),
  );

  await prependReleaseNoteSlide(freshChanges, proChanges);

  console.log(`Updated ${path.relative(repoRoot, paths.fresh)} (${freshRows.length} rows)`);
  console.log(`Updated ${path.relative(repoRoot, paths.pro)} (${proRows.length} rows)`);
  console.log(`Backed up previous CSVs to ${path.relative(repoRoot, paths.freshOld)} and ${path.relative(repoRoot, paths.proOld)}`);
  console.log(`Updated release note slides with ${freshChanges.length + proChanges.length} change rows`);
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function parseCsvWithHeader(csvText, sourceName) {
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ''));
  if (rows.length === 0) {
    throw new Error(`${sourceName} is empty`);
  }

  const header = rows[0].map((value) => value.trim());
  const records = rows.slice(1)
    .filter((row) => row.some((value) => value.trim() !== ''))
    .map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ''])));

  return { header, records };
}

function assertColumns(header, requiredColumns, sourceName) {
  const missing = requiredColumns.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`${sourceName} is missing required columns: ${missing.join(', ')}`);
  }
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];

    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && csvText[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function stringifyCsv(rows) {
  return `${rows.map((row) => row.map(escapeCsvField).join(',')).join('\n')}\n`;
}

function escapeCsvField(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function normalizeDifficultyRows(rows, difficulty) {
  return rows.map((row) => {
    const topEffectKey = difficulty === 'fresh' ? 'topEffect' : 'topEffectPro';
    const effectKey = difficulty === 'fresh'
      ? findHeaderKey(row, /^effect(?:\s|$)/) ?? 'effect'
      : 'effectPro';

    return {
      category: row.category ?? '',
      rarity: row.rarity ?? '',
      cardName: row.cardName ?? '',
      topEffect: row[topEffectKey] ?? '',
      effect: row[effectKey] ?? '',
      cardNo: row.cardNo ?? '',
    };
  });
}

function findHeaderKey(row, pattern) {
  return Object.keys(row).find((key) => pattern.test(key));
}

function diffCards(oldRows, newRows) {
  const oldMap = rowsByCardNameOccurrence(oldRows);
  const newMap = rowsByCardNameOccurrence(newRows);
  const keys = [...new Set([...oldMap.keys(), ...newMap.keys()])];
  const changes = [];

  for (const key of keys) {
    const before = oldMap.get(key);
    const after = newMap.get(key);
    const cardName = after?.cardName || before?.cardName || '';

    if (!before && after) {
      changes.push({ cardName, type: '追加', before: '', after });
    } else if (before && !after) {
      changes.push({ cardName, type: '削除', before, after: '' });
    } else if (before && after && hasCardChanged(before, after)) {
      changes.push({ cardName, type: '変更', before, after });
    }
  }

  return changes;
}

function rowsByCardNameOccurrence(rows) {
  const counts = new Map();
  const result = new Map();

  for (const row of rows) {
    const count = (counts.get(row.cardName) ?? 0) + 1;
    counts.set(row.cardName, count);
    result.set(`${row.cardName}\u0000${count}`, row);
  }

  return result;
}

function hasCardChanged(before, after) {
  return normalizeEffectForDiff(before.effect) !== normalizeEffectForDiff(after.effect);
}

function normalizeEffectForDiff(effect) {
  return String(effect ?? '').replaceAll(/\r?\n/g, '').trim();
}

async function prependReleaseNoteSlide(freshChanges, proChanges) {
  const releaseNoteText = await readFile(paths.releaseNote, 'utf8');
  const slideContainerStart = /<div class="slide-container" id="slide-container">\s*/;
  const match = releaseNoteText.match(slideContainerStart);

  if (!match || match.index === undefined) {
    throw new Error('Could not find slide-container in releaseNote.html');
  }

  const title = `${formatJapaneseDate(new Date())} アップデート`;
  const activeRemoved = releaseNoteText.replaceAll(/<div class="slide active">/g, '<div class="slide">');
  const replaced = removeAutoUpdateSlides(activeRemoved, title);
  const updatedMatch = replaced.match(slideContainerStart);
  const insertAt = updatedMatch.index + updatedMatch[0].length;
  const nextText = `${replaced.slice(0, insertAt)}\n${buildReleaseNoteSlides(title, freshChanges, proChanges)}${replaced.slice(insertAt)}`;

  await writeFile(paths.releaseNote, nextText, 'utf8');
}

function removeAutoUpdateSlides(html, title) {
  let result = html;
  const commentPrefix = `<!-- Slide: ${title}`;

  while (true) {
    const commentStart = result.indexOf(commentPrefix);
    if (commentStart === -1) return result;

    const commentEnd = result.indexOf('-->', commentStart);
    if (commentEnd === -1 || !result.slice(commentStart, commentEnd).includes('カード自動更新')) {
      return result;
    }

    const slideStart = result.indexOf('<div class="slide', commentEnd);
    if (slideStart === -1) return result;

    const slideEnd = findMatchingDivEnd(result, slideStart);
    if (slideEnd === -1) return result;

    let removeEnd = slideEnd;
    while (removeEnd < result.length && /\s/.test(result[removeEnd])) {
      removeEnd++;
    }
    result = `${result.slice(0, commentStart)}${result.slice(removeEnd)}`;
  }
}

function findMatchingDivEnd(html, divStart) {
  const divRegex = /<\/?div\b[^>]*>/g;
  divRegex.lastIndex = divStart;
  let depth = 0;
  let match;

  while ((match = divRegex.exec(html)) !== null) {
    if (match[0].startsWith('</div')) {
      depth--;
      if (depth === 0) {
        return divRegex.lastIndex;
      }
    } else {
      depth++;
    }
  }

  return -1;
}

function buildReleaseNoteSlides(title, freshChanges, proChanges) {
  return buildReleaseNoteSlide(title, 'FRESH', freshChanges, true) +
    buildReleaseNoteSlide(title, 'PRO', proChanges, false);
}

function buildReleaseNoteSlide(title, label, changes, active) {
  return `            <!-- Slide: ${escapeHtml(title)} ${escapeHtml(label)} カード自動更新 -->\n` +
    `            <div class="slide${active ? ' active' : ''}">\n` +
    `                <div class="slide-content" style="justify-content: flex-start;">\n` +
    `                    <h2>${escapeHtml(title)} [${escapeHtml(label)}]</h2>\n` +
    `                    <p style="margin-bottom: 10px;">カード改訂一覧</p>\n` +
    buildChangeTable(changes) +
    `                </div>\n` +
    `            </div>\n`;
}

function formatJapaneseDate(date) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const weekday = parts.find((part) => part.type === 'weekday')?.value;

  return `${month}/${day}(${weekday})`;
}

function buildChangeTable(changes) {
  const body = changes.length > 0
    ? changes.map(buildChangeRow).join('')
    : `                                <tr><td colspan="3" style="padding: 6px 4px; color: var(--color-text-secondary);">変更なし</td></tr>\n`;

  return `                    <div style="overflow-x: auto; margin-bottom: 12px;">\n` +
    `                        <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem; text-align: left;">\n` +
    `                            <thead>\n` +
    `                                <tr style="border-bottom: 2px solid var(--color-border);">\n` +
    `                                    <th style="padding: 6px 4px; min-width: 7em;">カード名</th>\n` +
    `                                    <th style="padding: 6px 4px; min-width: 12em;">改訂前</th>\n` +
    `                                    <th style="padding: 6px 4px; min-width: 12em;">改訂後</th>\n` +
    `                                </tr>\n` +
    `                            </thead>\n` +
    `                            <tbody>\n${body}` +
    `                            </tbody>\n` +
    `                        </table>\n` +
    `                    </div>\n`;
}

function buildChangeRow(change) {
  return `                                <tr style="border-bottom: 1px solid var(--color-border);">\n` +
    `                                    <td style="padding: 6px 4px; vertical-align: top;">${escapeHtml(change.cardName)}</td>\n` +
    `                                    <td style="padding: 6px 4px; vertical-align: top; color: var(--color-text-secondary);">${formatChangeValue(change.before)}</td>\n` +
    `                                    <td style="padding: 6px 4px; vertical-align: top;">${formatChangeValue(change.after)}</td>\n` +
    `                                </tr>\n`;
}

function formatChangeValue(value) {
  if (!value) {
    return '-';
  }

  return escapeHtml(value.effect || '-').replaceAll(/\r?\n/g, '<br>');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
