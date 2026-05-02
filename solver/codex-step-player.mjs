#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import readline from 'node:readline';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const gameRoot = path.join(repoRoot, 'game');
const profileDir = path.join(__dirname, '.codex-step-profile');
const tracePath = path.join(__dirname, 'codex-step-session.jsonl');

function parseArgs(argv) {
    const out = {
        command: 'state',
        difficulty: 'pro',
        port: 4174,
        args: []
    };
    if (argv[0] && !argv[0].startsWith('--')) {
        out.command = argv[0];
        argv = argv.slice(1);
    }
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const next = argv[i + 1];
        if (key === '--difficulty' && next) {
            out.difficulty = next.toLowerCase() === 'fresh' ? 'fresh' : 'pro';
            i += 1;
        } else if (key === '--port' && next) {
            out.port = Number.parseInt(next, 10) || out.port;
            i += 1;
        } else {
            out.args.push(key);
        }
    }
    return out;
}

function getMimeType(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.csv')) return 'text/csv; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}

async function createStaticServer(rootDir, port) {
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
            const relPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
            const absPath = path.resolve(rootDir, `.${relPath}`);
            if (!absPath.startsWith(rootDir)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            const content = await readFile(absPath);
            res.writeHead(200, {
                'Content-Type': getMimeType(absPath),
                'Cache-Control': 'no-store'
            });
            res.end(content);
        } catch {
            res.writeHead(404);
            res.end('Not Found');
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return server;
}

async function withPage(port, fn) {
    await mkdir(profileDir, { recursive: true });
    const server = await createStaticServer(gameRoot, port);
    const context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 430, height: 932 }
    });
    await context.addInitScript(() => {
        window.alert = () => {};
        window.confirm = () => true;
        window.CDG_DEBUG = false;
    });
    const page = context.pages()[0] || await context.newPage();
    try {
        await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.game && !!window.game.cardManager && window.game.cardManager.allCards.length > 0, null, { timeout: 30000 });
        return await fn(page);
    } finally {
        await context.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

async function openRuntime(port) {
    await mkdir(profileDir, { recursive: true });
    const server = await createStaticServer(gameRoot, port);
    const context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 430, height: 932 }
    });
    await context.addInitScript(() => {
        window.alert = () => {};
        window.confirm = () => true;
        window.CDG_DEBUG = false;
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.game && !!window.game.cardManager && window.game.cardManager.allCards.length > 0, null, { timeout: 30000 });
    return {
        page,
        async close() {
            await context.close();
            await new Promise((resolve) => server.close(resolve));
        }
    };
}

async function appendTrace(event) {
    await appendFile(tracePath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

function pretty(data) {
    console.log(JSON.stringify(data, null, 2));
}

async function getSnapshot(page) {
    return page.evaluate(() => {
        const game = window.game;
        const gs = game.gameState;
        const tm = game.turnManager;
        const sm = game.scoreManager;
        const config = gs.turn >= 0 && gs.turn < 8 ? tm.getCurrentTurnConfig() : null;
        const player = gs.player;
        const score = sm.calculateScore(gs);
        const withdrawal = sm.calculateWithdrawal(gs);
        const enrollmentDiff = player.enrollment - withdrawal;
        return {
            difficulty: gs.difficulty,
            turnIndex: gs.turn,
            turnNumber: gs.turn + 1,
            phase: gs.phase,
            config: config ? {
                week: config.week,
                recommended: config.recommended,
                recommendedStatus: config.recommendedStatus,
                training: config.training,
                delete: config.delete
            } : null,
            status: {
                experience: player.experience,
                enrollment: player.enrollment,
                satisfaction: player.satisfaction,
                accounting: player.accounting,
                withdrawal,
                enrollmentDiff
            },
            tokens: { ...(gs.tokens || {}) },
            hand: player.hand.map((c) => ({ cardName: c.cardName, category: c.category, rarity: c.rarity, effect: c.effect })),
            deck: player.deck.map((c) => ({ cardName: c.cardName, category: c.category, rarity: c.rarity, effect: c.effect })),
            placed: {
                leader: player.placed.leader.map((c) => c.cardName),
                teacher: player.placed.teacher.map((c) => c.cardName),
                staff: player.placed.staff.map((c) => c.cardName)
            },
            currentTrainingCards: (gs.currentTrainingCards || []).map((c) => ({ cardName: c.cardName, category: c.category, rarity: c.rarity, effect: c.effect })),
            currentScore: {
                points: score.points,
                rank: score.rank,
                withdrawal: score.withdrawal,
                mobilization: score.mobilization,
                enrollmentDiff: score.enrollmentDiff
            }
        };
    });
}

async function getRecommendations(page) {
    return page.evaluate(() => {
        const game = window.game;
        const gs = game.gameState;
        const sm = game.scoreManager;
        const tm = game.turnManager;
        const config = gs.turn >= 0 && gs.turn < 8 ? tm.getCurrentTurnConfig() : null;
        const categoryWeight = { '動員': 'experience', '教務': 'enrollmentDiff', '庶務': 'accounting', '応対': 'satisfaction' };

        function cloneCard(card) {
            return { ...card };
        }

        function cloneState(state) {
            return {
                difficulty: state.difficulty,
                turn: state.turn,
                tokens: { ...(state.tokens || {}) },
                player: {
                    experience: state.player.experience,
                    enrollment: state.player.enrollment,
                    satisfaction: state.player.satisfaction,
                    accounting: state.player.accounting,
                    deck: (state.player.deck || []).map(cloneCard),
                    hand: (state.player.hand || []).map(cloneCard),
                    placed: {
                        leader: (state.player.placed?.leader || []).map(cloneCard),
                        teacher: (state.player.placed?.teacher || []).map(cloneCard),
                        staff: (state.player.placed?.staff || []).map(cloneCard)
                    }
                },
                updateStatus(type, delta) {
                    const oldValue = this.player[type];
                    let newValue = Math.max(0, oldValue + delta);
                    if (type === 'enrollment') newValue = Math.min(newValue, this.player.experience);
                    this.player[type] = newValue;
                    return newValue - oldValue;
                }
            };
        }

        function parseStaffRestriction(effect = '') {
            const match = effect.match(/【(.+?)】/);
            if (!match) return null;
            const map = { '室長': 'leader', '講師': 'teacher', '事務': 'staff' };
            const slots = match[1].split('・').map((s) => map[s.trim()]).filter(Boolean);
            return slots.length > 0 ? slots : null;
        }

        function hasParallel(card) {
            return (card.effect || '').includes('並行');
        }

        function getLegalSlots(card, state) {
            const order = ['leader', 'teacher', 'staff'];
            const allowed = parseStaffRestriction(card.effect);
            return order.filter((slot) => {
                if (allowed && !allowed.includes(slot)) return false;
                if (!hasParallel(card) && state.player.placed[slot].length > 0) return false;
                return true;
            });
        }

        function simulateActionState(state) {
            const sim = cloneState(state);
            const staffOrder = ['leader', 'teacher', 'staff'];
            for (const staff of staffOrder) {
                for (const card of sim.player.placed[staff]) {
                    if (config?.recommended && card.category === config.recommended && config.recommendedStatus) {
                        sim.updateStatus(config.recommendedStatus, 1);
                    }
                    game.cardManager.applyCardEffect(card, staff, sim);
                }
            }
            return sim;
        }

        function evaluateTerminal(state) {
            const sim = simulateActionState(state);
            const score = sm.calculateScore(sim);
            const withdrawal = sm.calculateWithdrawal(sim);
            const diff = sim.player.enrollment - withdrawal;
            const satExcess = Math.max(sim.player.satisfaction - 22, 0);
            const accExcess = Math.max(sim.player.accounting - 18, 0);
            const expNeed = Math.max(40 - sim.player.experience, 0);
            const diffNeed = Math.max(32 - diff, 0);
            const satNeed = Math.max(15 - sim.player.satisfaction, 0);
            const accNeed = Math.max(15 - sim.player.accounting, 0);
            const unmet = Math.max(40 - sim.player.experience, 0) * 0.22
                + Math.max(32 - diff, 0) * 0.32
                + Math.max(15 - sim.player.satisfaction, 0) * 0.55
                + Math.max(15 - sim.player.accounting, 0) * 0.6;
            const lateTurn = gs.turn >= 4;
            const veryLateTurn = gs.turn >= 5;
            const thresholdBias = lateTurn
                ? (Math.min(sim.player.experience, 40) * 0.2)
                    + (Math.min(diff, 32) * 1.25)
                    + (Math.min(sim.player.satisfaction, 15) * 0.7)
                    + (Math.min(sim.player.accounting, 15) * 0.8)
                : 0;
            const thresholdPenalty = lateTurn
                ? (diffNeed * (veryLateTurn ? 1.7 : 1.1))
                    + (expNeed * (veryLateTurn ? 0.35 : 0.18))
                    + (satNeed * 0.8)
                    + (accNeed * 0.9)
                : 0;
            const value = (score.points * (veryLateTurn ? 16 : 10))
                + (sim.player.experience * (lateTurn ? 0.3 : 0.45))
                + (diff * (lateTurn ? 1.35 : 0.85))
                + (Math.min(sim.player.satisfaction, 15) * (lateTurn ? 0.5 : 0.8))
                + (Math.min(sim.player.accounting, 15) * (lateTurn ? 0.65 : 0.95))
                + thresholdBias
                - (satExcess * 1.1)
                - (accExcess * 0.4)
                - unmet
                - thresholdPenalty;
            return {
                value,
                score: score.points,
                rank: score.rank,
                status: {
                    experience: sim.player.experience,
                    enrollment: sim.player.enrollment,
                    satisfaction: sim.player.satisfaction,
                    accounting: sim.player.accounting,
                    withdrawal,
                    enrollmentDiff: diff
                }
            };
        }

        function cardBias(card, baseStatus) {
            let bias = 0;
            const name = card.cardName;
            const withdrawal = Math.max(15 - baseStatus.accounting, 0) + Math.max(15 - baseStatus.satisfaction, 0);
            const diff = baseStatus.enrollment - withdrawal;
            if (name === '学力確認＆向上 公開模試') bias += baseStatus.accounting >= 14 ? 7.0 : 3.0;
            if (name === '学力確認＆向上 公開模試' && gs.turn >= 4) bias += diff < 20 ? 3.0 : 1.2;
            if (name === '締切間近の書類リマインド') bias += 4.0;
            if (name === '振込用紙印刷') bias += 3.7;
            if (name === '入塾手続きのご案内') bias += 3.4;
            if (name === 'プロジェクター授業' && gs.turn >= 3) bias += baseStatus.accounting >= 10 ? 4.2 : 1.4;
            if (name === '提出書類ファイリング') bias += gs.turn <= 4 ? 2.8 : 1.1;
            if (name === '今だけ！体験生特典') bias += baseStatus.accounting >= 13 ? 2.2 : 0.8;
            if (name === '笑顔伝わる教室通信') bias += baseStatus.satisfaction < 15 ? 1.8 : -0.5;
            if (name === '生徒面談の基本') bias -= baseStatus.satisfaction >= 15 ? 4.0 : 2.0;
            if (name === '質問対応の基本') bias -= 2.5;
            if (name === '問合対応の基本') bias -= baseStatus.satisfaction >= 14 ? 2.0 : 0.7;
            if (name === '経理精算の基本') bias -= baseStatus.accounting >= 14 ? 2.0 : 0.4;
            if (name === '公開模試' && diff >= 32) bias -= 1.5;
            if ((card.effect || '').includes('整理')) bias += 1.4;
            if ((card.effect || '').includes('発想')) bias += 1.2;
            if ((card.effect || '').includes('情熱')) bias += gs.turn <= 4 ? 1.1 : 0.6;
            if ((card.effect || '').includes('疲労')) bias -= gs.turn <= 5 ? 0.8 : 0.2;
            return bias;
        }

        function recommendTraining() {
            const options = (gs.currentTrainingCards || []).map(cloneCard);
            const status = gs.player;
            const withdrawal = Math.max(15 - status.accounting, 0) + Math.max(15 - status.satisfaction, 0);
            const diff = status.enrollment - withdrawal;
            const ranking = options.map((card) => {
                let score = 0;
                if (card.category === '庶務') score += Math.max(15 - status.accounting, 0) * 1.3;
                if (card.category === '応対') score += Math.max(15 - status.satisfaction, 0) * 1.15;
                if (card.category === '動員') score += Math.max(40 - status.experience, 0) * 0.25;
                if (card.category === '教務') score += Math.max(32 - diff, 0) * 0.4;
                if (card.rarity === 'SSR') score += 0.8;
                if (card.rarity === 'SR') score += 0.35;
                score += cardBias(card, status);
                return {
                    cardName: card.cardName,
                    category: card.category,
                    rarity: card.rarity,
                    score: Number(score.toFixed(3)),
                    reason: `${card.category}補完 + 圧縮軸補正`
                };
            }).sort((a, b) => b.score - a.score);
            const pickCount = gs.turn === 0 ? 2 : 1;
            return {
                kind: 'training',
                pickCount,
                ranking,
                recommended: ranking.slice(0, pickCount).map((x) => x.cardName)
            };
        }

        function recommendDeletion() {
            const status = gs.player;
            const withdrawal = Math.max(15 - status.accounting, 0) + Math.max(15 - status.satisfaction, 0);
            const diff = status.enrollment - withdrawal;
            const maxDelete = tm.getCurrentDeleteMax();
            const ranking = gs.player.deck.map(cloneCard).map((card) => {
                let keep = 0;
                if (card.category === '庶務') keep += Math.max(15 - status.accounting, 0) * 0.9;
                if (card.category === '応対') keep += Math.max(15 - status.satisfaction, 0) * 0.8;
                if (card.category === '教務') keep += Math.max(32 - diff, 0) * 0.32;
                if (card.category === '動員') keep += Math.max(40 - status.experience, 0) * 0.18;
                keep += cardBias(card, status);
                if (card.rarity === 'N') keep -= 1.0;
                return {
                    cardName: card.cardName,
                    category: card.category,
                    rarity: card.rarity,
                    keepScore: Number(keep.toFixed(3))
                };
            }).sort((a, b) => a.keepScore - b.keepScore);
            return {
                kind: 'meeting',
                deleteMax: maxDelete,
                ranking,
                recommended: ranking.slice(0, maxDelete).map((x) => x.cardName)
            };
        }

        function recommendAction() {
            const root = cloneState(gs);
            const plans = [];

            function dfs(state, moves) {
                const terminal = evaluateTerminal(state);
                plans.push({
                    moves: [...moves],
                    terminal
                });

                const hand = state.player.hand;
                if (hand.length === 0) return;

                for (let i = 0; i < hand.length; i += 1) {
                    const card = hand[i];
                    const slots = getLegalSlots(card, state);
                    for (const slot of slots) {
                        const next = cloneState(state);
                        const [picked] = next.player.hand.splice(i, 1);
                        next.player.placed[slot].push(picked);
                        dfs(next, [...moves, { cardName: picked.cardName, slot }]);
                    }
                }
            }

            dfs(root, []);
            plans.sort((a, b) => b.terminal.value - a.terminal.value);
            const topPlans = plans.slice(0, 8);
            const firstMoveMap = new Map();

            for (const plan of topPlans) {
                const first = plan.moves[0];
                const key = first ? `${first.cardName}@@${first.slot}` : 'confirm';
                if (!firstMoveMap.has(key)) {
                    firstMoveMap.set(key, {
                        move: first || null,
                        bestValue: plan.terminal.value,
                        bestPlan: plan,
                        hits: 1
                    });
                } else {
                    const row = firstMoveMap.get(key);
                    row.hits += 1;
                    if (plan.terminal.value > row.bestValue) {
                        row.bestValue = plan.terminal.value;
                        row.bestPlan = plan;
                    }
                }
            }

            const firstMoves = [...firstMoveMap.values()]
                .sort((a, b) => b.bestValue - a.bestValue)
                .map((row) => ({
                    move: row.move,
                    hits: row.hits,
                    projected: row.bestPlan.terminal
                }));

            return {
                kind: 'action',
                topPlans: topPlans.map((plan) => ({
                    moves: plan.moves,
                    projected: plan.terminal
                })),
                recommended: firstMoves[0]?.move || null,
                firstMoves
            };
        }

        if (gs.phase === 'training') return recommendTraining();
        if (gs.phase === 'action') return recommendAction();
        if (gs.phase === 'meeting') return recommendDeletion();
        return { kind: gs.phase, recommended: null };
    });
}

async function startRun(page, difficulty) {
    return page.evaluate(async (diff) => {
        const game = window.game;
        game.saveManager.clear();
        localStorage.removeItem('cdg_save_data');
        game.uiController.onDifficultySelect(diff);
        await game.uiController.onStartGame();
        return {
            ok: true,
            difficulty: game.gameState.difficulty,
            phase: game.gameState.phase,
            turn: game.gameState.turn + 1,
            options: game.gameState.currentTrainingCards.map((c) => c.cardName)
        };
    }, difficulty);
}

async function pickTraining(page, names) {
    return page.evaluate((pickedNames) => {
        const game = window.game;
        const ui = game.uiController;
        const cards = game.gameState.currentTrainingCards || [];
        if (game.gameState.turn === 0) {
            ui.selectedInitialCards = cards.filter((c) => pickedNames.includes(c.cardName)).slice(0, 2);
        } else {
            ui.selectedTrainingCard = cards.find((c) => c.cardName === pickedNames[0]) || null;
        }
        ui.onConfirmTraining();
        return {
            ok: true,
            phase: game.gameState.phase,
            picked: pickedNames
        };
    }, names);
}

async function placeCard(page, cardName, slot) {
    return page.evaluate(({ targetName, targetSlot }) => {
        const game = window.game;
        const card = game.gameState.player.hand.find((c) => c.cardName === targetName);
        if (!card) {
            throw new Error(`手札に ${targetName} がありません`);
        }
        game.uiController.tryPlaceCardToSlot(card, targetSlot);
        game.saveManager.save(game.gameState, game.cardManager);
        return {
            ok: true,
            placed: { cardName: targetName, slot: targetSlot },
            hand: game.gameState.player.hand.map((c) => c.cardName),
            placedState: {
                leader: game.gameState.player.placed.leader.map((c) => c.cardName),
                teacher: game.gameState.player.placed.teacher.map((c) => c.cardName),
                staff: game.gameState.player.placed.staff.map((c) => c.cardName)
            }
        };
    }, { targetName: cardName, targetSlot: slot });
}

async function confirmAction(page) {
    return page.evaluate(async () => {
        const game = window.game;
        game.uiController.onConfirmAction();
        await new Promise((resolve) => setTimeout(resolve, 3500));
        return {
            ok: true,
            phase: game.gameState.phase,
            turn: game.gameState.turn + 1
        };
    });
}

async function deleteCards(page, names) {
    return page.evaluate((pickedNames) => {
        const game = window.game;
        const remaining = [...pickedNames];
        const selected = [];
        for (const card of game.gameState.player.deck) {
            const idx = remaining.indexOf(card.cardName);
            if (idx === -1) continue;
            selected.push(card);
            remaining.splice(idx, 1);
            if (remaining.length === 0) break;
        }
        game.uiController.selectedCardsForDeletion = selected;
        game.saveManager.save(game.gameState, game.cardManager);
        return {
            ok: true,
            selected: game.uiController.selectedCardsForDeletion.map((c) => c.cardName)
        };
    }, names);
}

async function confirmMeeting(page) {
    return page.evaluate(() => {
        const game = window.game;
        game.uiController.onConfirmMeeting();
        return {
            ok: true,
            phase: game.gameState.phase,
            turn: game.gameState.turn + 1
        };
    });
}

function summarize(snapshot) {
    return {
        phase: snapshot.phase,
        turn: `${snapshot.turnNumber}/8`,
        week: snapshot.config?.week || null,
        recommended: snapshot.config?.recommended || null,
        status: snapshot.status,
        tokens: snapshot.tokens,
        hand: snapshot.hand.map((c) => c.cardName),
        placed: snapshot.placed,
        training: snapshot.currentTrainingCards.map((c) => c.cardName),
        currentScore: snapshot.currentScore
    };
}

async function autoStep(page) {
    const snapshot = await getSnapshot(page);
    const rec = await getRecommendations(page);

    if (snapshot.phase === 'training') {
        const picked = rec.recommended;
        const result = await pickTraining(page, picked);
        return { action: 'pick-training', picked, result, recommendation: rec };
    }
    if (snapshot.phase === 'action') {
        if (!rec.recommended) {
            const result = await confirmAction(page);
            return { action: 'confirm-action', result, recommendation: rec };
        }
        const result = await placeCard(page, rec.recommended.cardName, rec.recommended.slot);
        return { action: 'place', move: rec.recommended, result, recommendation: rec };
    }
    if (snapshot.phase === 'meeting') {
        const selected = rec.recommended;
        await deleteCards(page, selected);
        const result = await confirmMeeting(page);
        return { action: 'delete-confirm', selected, result, recommendation: rec };
    }
    return { action: 'noop', phase: snapshot.phase };
}

async function main() {
    const cli = parseArgs(process.argv.slice(2));
    if (cli.command === 'repl') {
        const runtime = await openRuntime(cli.port);
        const { page } = runtime;
        if (cli.difficulty) {
            const started = await startRun(page, cli.difficulty);
            await appendTrace({
                command: 'start',
                args: [cli.difficulty],
                result: started,
                snapshot: summarize(await getSnapshot(page))
            });
            pretty(started);
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });
        console.log(JSON.stringify({ repl: true, commands: ['state', 'recommend', 'auto-step', 'pick-training ...', 'place ...', 'confirm-action', 'delete ...', 'confirm-meeting', 'score', 'exit'] }, null, 2));

        const runCommand = async (line) => {
            const tokens = line.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map((t) => t.replace(/^"|"$/g, '')) || [];
            if (tokens.length === 0) return;
            const [command, ...args] = tokens;
            let result;
            if (command === 'exit' || command === 'quit') {
                await runtime.close();
                rl.close();
                process.exit(0);
                return;
            }
            if (command === 'start') {
                result = await startRun(page, args[0] || cli.difficulty);
            } else if (command === 'state') {
                result = summarize(await getSnapshot(page));
            } else if (command === 'recommend') {
                result = await getRecommendations(page);
            } else if (command === 'pick-training') {
                result = await pickTraining(page, args);
            } else if (command === 'place') {
                result = await placeCard(page, args[0], args[1]);
            } else if (command === 'confirm-action') {
                result = await confirmAction(page);
            } else if (command === 'delete') {
                result = await deleteCards(page, args);
            } else if (command === 'confirm-meeting') {
                result = await confirmMeeting(page);
            } else if (command === 'auto-step') {
                result = await autoStep(page);
            } else if (command === 'score') {
                result = (await getSnapshot(page)).currentScore;
            } else {
                result = { error: `unknown command: ${command}` };
            }
            const snapshot = await getSnapshot(page);
            await appendTrace({
                command,
                args,
                result,
                snapshot: summarize(snapshot)
            });
            pretty(result);
        };

        rl.on('line', async (line) => {
            try {
                await runCommand(line);
            } catch (error) {
                console.error(error?.stack || String(error));
            }
        });
        return;
    }

    await withPage(cli.port, async (page) => {
        let result;
        if (cli.command === 'start') {
            result = await startRun(page, cli.difficulty);
        } else if (cli.command === 'state') {
            result = summarize(await getSnapshot(page));
        } else if (cli.command === 'recommend') {
            result = await getRecommendations(page);
        } else if (cli.command === 'pick-training') {
            result = await pickTraining(page, cli.args);
        } else if (cli.command === 'place') {
            result = await placeCard(page, cli.args[0], cli.args[1]);
        } else if (cli.command === 'confirm-action') {
            result = await confirmAction(page);
        } else if (cli.command === 'delete') {
            result = await deleteCards(page, cli.args);
        } else if (cli.command === 'confirm-meeting') {
            result = await confirmMeeting(page);
        } else if (cli.command === 'auto-step') {
            result = await autoStep(page);
        } else if (cli.command === 'score') {
            result = (await getSnapshot(page)).currentScore;
        } else {
            throw new Error(`unknown command: ${cli.command}`);
        }

        const snapshot = await getSnapshot(page);
        await appendTrace({
            command: cli.command,
            args: cli.args,
            result,
            snapshot: summarize(snapshot)
        });
        pretty(result);
    });
}

main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
});
