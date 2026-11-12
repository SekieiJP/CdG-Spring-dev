import { formatResultNumber, formatResultPoints, resultMetrics, resultPrecisionText, resultRulesEpoch, sortResultDeck } from './resultPresentation.js?v=20261110-0066';

const WIDTH = 640;
const MARGIN = 20;
const THUMB_SIZE = 54;
const THUMB_GAP = 6;
const THUMB_COLUMNS = 10;
const TABLE_TOP = 152;
const TABLE_HEADING = 28;
const ROW_HEIGHT = 38;
const FONT = 'system-ui, -apple-system, sans-serif';
const OUTCOMES = { win: '勝利', lose: '敗北', draw: '引き分け' };
const DATE_FORMAT = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'short'
});

function loadImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function imageTitle(summary) {
    const difficulty = (summary.difficultyName || summary.difficulty).toUpperCase();
    if (summary.room) return `部屋 ${summary.room.code}　${difficulty}`;
    const mode = (summary.mode || '通常')
        .replace(/^対戦:[^/]+\/(?:同一シード\/)?/, '')
        .replace(/^イベント:\(([^)]+)\)/, 'イベント $1')
        .replaceAll('/', '・');
    const opponent = summary.battle?.opponentName;
    return [difficulty, opponent && `${opponent}と対戦`, !opponent || mode !== '通常' ? mode : ''].filter(Boolean).join('　');
}

function getPlayers(summary, cardIconPath) {
    const player = (name, score, deck) => ({
        name, score, metrics: resultMetrics(score), precision: resultPrecisionText(score),
        thumbnails: sortResultDeck(deck).map(cardIconPath)
    });
    const players = [player('あなた', summary.score, summary.finalDeck)];
    if (summary.battle) {
        const { opponentName, opponentScore, opponentFinalDeck } = summary.battle;
        players.push(player(opponentName, opponentScore, opponentFinalDeck));
    }
    return players;
}

function deckHeight(count) {
    return 29 + Math.ceil(count / THUMB_COLUMNS) * (THUMB_SIZE + THUMB_GAP);
}

function drawDeck(ctx, text, player, images, y, label, theme) {
    text(`${label}　${player.thumbnails.length}枚`, MARGIN, y + 12, { size: 19, weight: 700 });
    player.thumbnails.forEach((src, index) => {
        const x = MARGIN + index % THUMB_COLUMNS * (THUMB_SIZE + THUMB_GAP);
        const top = y + 29 + Math.floor(index / THUMB_COLUMNS) * (THUMB_SIZE + THUMB_GAP);
        ctx.fillStyle = theme.panel;
        ctx.fillRect(x, top, THUMB_SIZE, THUMB_SIZE);
        const image = images.get(src);
        if (!image) {
            text('🃏', x + THUMB_SIZE / 2, top + THUMB_SIZE / 2, { size: 24, align: 'center' });
            return;
        }
        const scale = (THUMB_SIZE - 2) / Math.max(image.naturalWidth, image.naturalHeight);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        ctx.drawImage(image, x + (THUMB_SIZE - w) / 2, top + (THUMB_SIZE - h) / 2, w, h);
    });
    return y + deckHeight(player.thumbnails.length) + 8;
}

export async function createResultImage(summary, cardIconPath) {
    const players = getPlayers(summary, cardIconPath);
    const paths = new Set(players.flatMap(player => player.thumbnails).filter(Boolean));
    const images = new Map(await Promise.all([...paths].map(async src => [src, await loadImage(src)])));
    const tableBottom = TABLE_TOP + TABLE_HEADING + players[0].metrics.length * ROW_HEIGHT;
    const precisionHeight = players.some(player => player.precision) ? 24 : 0;
    const decksHeight = players.reduce((sum, player) => sum + deckHeight(player.thumbnails.length) + 8, 0);
    const height = tableBottom + precisionHeight + 12 + decksHeight + 67;

    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = WIDTH * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画像を描画できません');
    ctx.scale(scale, scale);

    const styles = getComputedStyle(document.documentElement);
    const color = variable => styles.getPropertyValue(variable).trim();
    const theme = {
        background: color('--color-bg'), panel: color('--color-bg-light'),
        text: color('--color-text'), secondary: color('--color-text-secondary'), border: color('--color-border')
    };
    const text = (value, x, y, { size = 20, weight = 500, ink = theme.text, align = 'left', maxWidth = WIDTH - MARGIN * 2 } = {}) => {
        ctx.font = `${weight} ${size}px ${FONT}`;
        ctx.fillStyle = ink;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), x, y, maxWidth);
    };
    const line = y => {
        ctx.fillStyle = theme.border;
        ctx.fillRect(MARGIN, y, WIDTH - MARGIN * 2, 1);
    };

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.fillStyle = theme.panel;
    ctx.fillRect(MARGIN, 14, WIDTH - MARGIN * 2, TABLE_TOP - 25);
    text(imageTitle(summary), WIDTH / 2, 35, { size: 19, weight: 700, align: 'center' });
    const context = [`ルール ${resultRulesEpoch(summary)}`, summary.room?.revenge ? 'リベンジ' : OUTCOMES[summary.battle?.outcome]];
    text(context.filter(Boolean).join('　'), WIDTH / 2, 60, { size: 16, ink: theme.secondary, align: 'center' });

    const comparison = players.length > 1;
    const labelWidth = 125;
    const columnWidth = (WIDTH - MARGIN * 2 - labelWidth) / players.length;
    const columnLeft = index => MARGIN + labelWidth + index * columnWidth;
    for (const [index, player] of players.entries()) {
        const center = comparison ? columnLeft(index) + columnWidth / 2 : WIDTH / 2;
        if (comparison) text(player.name, center, 85, { size: 16, align: 'center' });
        const y = comparison ? 115 : 103;
        const label = `${formatResultNumber(player.score.displayScore)}点`;
        text(label, center + 18, y, { size: comparison ? 34 : 46, weight: 800, align: 'right', maxWidth: 175 });
        text(player.score.rank?.grade || '—', center + 30, y, { size: 24, weight: 800, ink: '#fde68a' });
    }

    const valueX = index => columnLeft(index) + columnWidth * .42;
    const pointsX = index => columnLeft(index) + columnWidth - 6;
    text('項目', MARGIN + 13, TABLE_TOP + 11, { size: 15, ink: theme.secondary });
    players.forEach((_, index) => {
        text('値', valueX(index), TABLE_TOP + 11, { size: 15, ink: theme.secondary, align: 'right' });
        text('評価点', pointsX(index), TABLE_TOP + 11, { size: 15, ink: theme.secondary, align: 'right' });
    });
    line(TABLE_TOP + TABLE_HEADING);
    players[0].metrics.forEach((metric, index) => {
        const top = TABLE_TOP + TABLE_HEADING + index * ROW_HEIGHT;
        const y = top + ROW_HEIGHT / 2;
        const colors = metric.colors.map(color);
        if (colors.length > 1) {
            const gradient = ctx.createLinearGradient(0, top + 3, 0, top + ROW_HEIGHT - 3);
            gradient.addColorStop(0, colors[0]);
            gradient.addColorStop(1, colors[1]);
            ctx.fillStyle = gradient;
        } else {
            ctx.fillStyle = colors[0];
        }
        ctx.fillRect(MARGIN, top + 3, 5, ROW_HEIGHT - 6);
        text(metric.label, MARGIN + 13, y, { weight: 700 });
        players.forEach((player, playerIndex) => {
            const { value, points, overflow } = player.metrics[index];
            const total = overflow ? Number((Number(points) + overflow).toFixed(3)) : points;
            text(formatResultNumber(value), valueX(playerIndex), y, { size: 23, align: 'right' });
            text(formatResultPoints(total), pointsX(playerIndex), y, {
                size: 23, align: 'right', ink: Number(total) < 0 ? '#fca5a5' : '#bfdbfe',
                maxWidth: columnWidth * .52
            });
        });
        line(top + ROW_HEIGHT);
    });
    players.forEach((player, index) => {
        if (player.precision) {
            text(player.precision, pointsX(index), tableBottom + 13, { size: 16, ink: '#c4b5fd', align: 'right' });
        }
    });
    let y = tableBottom + precisionHeight + 12;
    for (const player of players) {
        const label = comparison ? `${player.name}の最終デッキ` : '最終デッキ';
        y = drawDeck(ctx, text, player, images, y, label, theme);
    }
    const completedAt = new Date(summary.completedAt);
    const date = summary.completedAt && Number.isFinite(completedAt.getTime()) ? DATE_FORMAT.format(completedAt) : '—';
    line(y + 7);
    text(`プレイ終了日時　${date}`, MARGIN, y + 25, { size: 13, ink: theme.secondary });
    text(`利用者UUID　${summary.userUUID || '—'}`, MARGIN, y + 46, { size: 13, ink: theme.secondary });

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('PNGを作成できません'));
        }, 'image/png');
    });
}

export function downloadResultImage(blob, completedAt) {
    const stamp = String(completedAt || '').replace(/\D/g, '');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = stamp ? `cdg-result-${stamp}.png` : 'cdg-result.png';
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
}
