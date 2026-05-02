#!/usr/bin/env node
// generate_combine.js
// cards_fresh.csv + cards_pro.csv → cards_combine.csv（スコア列付き）

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../game/data');
const FRESH_PATH = path.join(DATA_DIR, 'cards_fresh.csv');
const PRO_PATH   = path.join(DATA_DIR, 'cards_pro.csv');
const OUT_PATH   = path.join(DATA_DIR, 'cards_combine.csv');

// ── CSV パーサ（RFC 4180 簡易実装） ────────────────────────────────────────
function parseCSV(text) {
    const rows = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
        const row = [];
        while (i < n && text[i] !== '\n') {
            if (text[i] === '"') {
                // quoted field
                i++; // skip opening "
                let field = '';
                while (i < n) {
                    if (text[i] === '"') {
                        if (text[i + 1] === '"') { field += '"'; i += 2; }
                        else { i++; break; }
                    } else {
                        field += text[i++];
                    }
                }
                row.push(field);
                if (i < n && text[i] === ',') i++;
            } else {
                let field = '';
                while (i < n && text[i] !== ',' && text[i] !== '\n') {
                    field += text[i++];
                }
                row.push(field);
                if (i < n && text[i] === ',') i++;
            }
        }
        if (i < n) i++; // skip \n
        if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row);
    }
    return rows;
}

// ── CSV シリアライザ ────────────────────────────────────────────────────────
function quoteField(val) {
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
function serializeRow(arr) {
    return arr.map(quoteField).join(',');
}

// ── スコア計算 ──────────────────────────────────────────────────────────────
function calcRestriction(effectPro) {
    const m = effectPro.match(/【([^】]+)】/);
    if (!m) return 0;
    const count = m[1].split('・').length;
    return count >= 2 ? -1 : -2;
}

function calcCondition(effectPro) {
    return /〈/.test(effectPro) ? -1 : 0;
}

function calcStatus(effectPro, label) {
    // 絶対値指定（「体験を12にする」等）を先に除去
    const cleaned = effectPro.replace(/(体験|入塾|満足|経理)を\d+にする/g, '');
    let total = 0;
    const re = new RegExp(label + '([+\\-])(\\d+)', 'g');
    let r;
    while ((r = re.exec(cleaned)) !== null) {
        total += r[1] === '+' ? +r[2] : -+r[2];
    }
    return total;
}

function calcParallel(effectPro) {
    return effectPro.includes('並行') ? 1 : 0;
}

function calcToken(effectPro, keyword) {
    return (effectPro.match(new RegExp(keyword, 'g')) || []).length;
}

function calcFatigue(effectPro) {
    const cnt = (effectPro.match(/疲労/g) || []).length;
    return cnt > 0 ? -cnt : 0;
}

function calcScores(effectPro) {
    if (!effectPro) {
        return ['', '', '', '', '', '', '', '', '', '', ''];
    }
    return [
        calcRestriction(effectPro),
        calcCondition(effectPro),
        calcStatus(effectPro, '体験'),
        calcStatus(effectPro, '入塾'),
        calcStatus(effectPro, '満足'),
        calcStatus(effectPro, '経理'),
        calcParallel(effectPro),
        calcToken(effectPro, '情熱'),
        calcToken(effectPro, '発想'),
        calcToken(effectPro, '整理'),
        calcFatigue(effectPro),
    ];
}

// ── メイン ──────────────────────────────────────────────────────────────────
const freshRaw = fs.readFileSync(FRESH_PATH, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const proRaw   = fs.readFileSync(PRO_PATH,   'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const freshAll = parseCSV(freshRaw);
const proAll   = parseCSV(proRaw);

// ヘッダー行をスキップ（最初の行）
const freshRows = freshAll.slice(1);
const proRows   = proAll.slice(1);

// pro 行をキー別に未マッチキューとして管理
// キー: "category,rarity,cardName"
const proQueues = new Map();
for (const row of proRows) {
    const [category, rarity, cardName, topEffectPro, effectPro] = row;
    const key = `${category},${rarity},${cardName}`;
    if (!proQueues.has(key)) proQueues.set(key, []);
    proQueues.get(key).push({ topEffectPro, effectPro, matched: false, _row: row });
}

const outputRows = [];

// fresh 走査 → shared / fresh-only
for (const row of freshRows) {
    const [category, rarity, cardName, topEffect, effectFresh] = row;
    const key = `${category},${rarity},${cardName}`;

    const queue = proQueues.get(key);
    const proEntry = queue ? queue.find(e => !e.matched) : null;

    let topEffectPro = '';
    let effectPro    = '';

    if (proEntry) {
        proEntry.matched = true;
        topEffectPro = proEntry.topEffectPro;
        effectPro    = proEntry.effectPro;
    }

    const scores = calcScores(effectPro);
    outputRows.push([category, rarity, cardName, topEffect, effectFresh, topEffectPro, effectPro, ...scores]);
}

// pro 側の未マッチ行 → pro-only（pro.csv の出現順を維持）
for (const row of proRows) {
    const [category, rarity, cardName, topEffectPro, effectPro] = row;
    const key = `${category},${rarity},${cardName}`;
    const queue = proQueues.get(key);
    const entry = queue ? queue.find(e => !e.matched && e._row === row) : null;
    if (entry) {
        entry.matched = true;
        const scores = calcScores(effectPro);
        outputRows.push([category, rarity, cardName, '', '', topEffectPro, effectPro, ...scores]);
    }
}

// 出力
const header = 'category,rarity,cardName,topEffectFresh,effectFresh,topEffectPro,effectPro,制限,条件,体験,入塾,満足,経理,並行,情熱,発想,整理,疲労';
const lines = [header, ...outputRows.map(serializeRow)];
fs.writeFileSync(OUT_PATH, lines.join('\n') + '\n', 'utf8');

console.log(`✅ cards_combine.csv を生成しました（${outputRows.length}行）`);
