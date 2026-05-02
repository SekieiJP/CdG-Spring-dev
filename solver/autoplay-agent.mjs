#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildNaturalLanguageReport } from './reportBuilder.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const gameRoot = path.join(repoRoot, 'game');

function normalizePolicyName(name) {
    if (name === 'random') return 'random';
    if (name === 'beam') return 'beam';
    if (name === 'deep_beam' || name === 'deepbeam' || name === 'deep') return 'deep_beam';
    if (name === 'deep_beam_satcap' || name === 'satcap' || name === 'deep_satcap') return 'deep_beam_satcap';
    if (name === 'fresh_rule_nonly' || name === 'rule_nonly' || name === 'nonly' || name === 'rule') return 'fresh_rule_nonly';
    if (name === 'fresh_s50' || name === 's50' || name === 's50_beam' || name === 'deep_beam_s50') return 'fresh_s50';
    if (name === 'fresh_stable' || name === 'stable' || name === 'fresh_safe') return 'fresh_stable';
    if (name === 'fresh_stable_classic' || name === 'stable_classic' || name === 'fresh_stable_v1') return 'fresh_stable_classic';
    if (name === 'fresh_stable_push' || name === 'stable_push' || name === 'fresh_stable_v2') return 'fresh_stable_push';
    if (name === 'fresh_upside' || name === 'upside' || name === 'fresh_spike') return 'fresh_upside';
    if (name === 'fresh_adaptive' || name === 'fresh-adaptive' || name === 'adaptive' || name === 'fresh') {
        return 'fresh_adaptive';
    }
    if (name === 'pro_foundation' || name === 'pro-foundation' || name === 'pro_base' || name === 'probase') {
        return 'pro_foundation';
    }
    if (name === 'pro_stable' || name === 'pro-safe' || name === 'pro_safe') {
        return 'pro_stable';
    }
    if (name === 'pro_stable_refreshless' || name === 'pro-stable-refreshless' || name === 'pro_refreshless') {
        return 'pro_stable_refreshless';
    }
    if (name === 'pro_stable_refresh_init' || name === 'pro-stable-refresh-init' || name === 'pro_refresh_init') {
        return 'pro_stable_refresh_init';
    }
    if (name === 'pro_nonly' || name === 'pro-nonly' || name === 'prononly' || name === 'pro_rule_nonly') {
        return 'pro_nonly';
    }
    if (name === 'pro_nonly_refreshless' || name === 'pro-nonly-refreshless' || name === 'prononlyrefreshless') {
        return 'pro_nonly_refreshless';
    }
    if (name === 'pro_adaptive' || name === 'pro-adaptive' || name === 'pro_mixsafe' || name === 'proadapt') {
        return 'pro_adaptive';
    }
    if (name === 'pro_adaptive_nonly' || name === 'pro-adaptive-nonly' || name === 'proadaptnonly') {
        return 'pro_adaptive_nonly';
    }
    if (name === 'pro_smax' || name === 'pro-smax' || name === 'pro_s' || name === 'prosmax') {
        return 'pro_smax';
    }
    if (name === 'pro_hybrid' || name === 'pro-hybrid' || name === 'pro_mix' || name === 'promix') {
        return 'pro_hybrid';
    }
    if (name === 'pro_upside' || name === 'pro-upside' || name === 'pro_spike') {
        return 'pro_upside';
    }
    if (name === 'pro_strategic1' || name === 'pro-strategic1' || name === 'pro_strategy1') {
        return 'pro_strategic1';
    }
    if (name === 'pro_strategic1_stable' || name === 'pro-strategic1-stable' || name === 'pro_strategy1_stable') {
        return 'pro_strategic1_stable';
    }
    if (name === 'pro_strategic1_upside' || name === 'pro-strategic1-upside' || name === 'pro_strategy1_upside') {
        return 'pro_strategic1_upside';
    }
    if (name === 'pro_compress' || name === 'pro-compress' || name === 'pro_compression') {
        return 'pro_compress';
    }
    if (name === 'pro_spike12' || name === 'pro-spike12' || name === 'pro_spike') {
        return 'pro_spike12';
    }
    if (name === 'pro_expand' || name === 'pro-expand' || name === 'pro_parallel') {
        return 'pro_expand';
    }
    return 'greedy';
}

function getScoreTargets(difficulty) {
    if (difficulty === 'pro') {
        return {
            aPoints: 8,
            sClearPoints: 12,
            aPlusPoints: 10,
            sPlusPoints: 14
        };
    }
    return {
        aPoints: 7,
        sClearPoints: 8,
        aPlusPoints: 7,
        sPlusPoints: 9
    };
}

function parseArgs(argv) {
    const args = {
        episodes: 200,
        difficulty: 'fresh',
        policies: null,
        output: 'solver/latest-simulation.json',
        report: 'solver/latest-report.md',
        traceSamples: 0,
        headful: false,
        port: 4173
    };

    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const next = argv[i + 1];

        if (key === '--episodes' && next) {
            args.episodes = Math.max(1, Number.parseInt(next, 10) || args.episodes);
            i += 1;
        } else if (key === '--difficulty' && next) {
            args.difficulty = next.toLowerCase() === 'pro' ? 'pro' : 'fresh';
            i += 1;
        } else if (key === '--policies' && next) {
            args.policies = next
                .split(',')
                .map((s) => normalizePolicyName(s.trim().toLowerCase()))
                .filter(Boolean);
            i += 1;
        } else if (key === '--output' && next) {
            args.output = next;
            i += 1;
        } else if (key === '--report' && next) {
            args.report = next;
            i += 1;
        } else if (key === '--trace-samples' && next) {
            args.traceSamples = Math.max(0, Number.parseInt(next, 10) || 0);
            i += 1;
        } else if (key === '--no-report') {
            args.report = null;
        } else if (key === '--port' && next) {
            args.port = Number.parseInt(next, 10) || args.port;
            i += 1;
        } else if (key === '--headful') {
            args.headful = true;
        }
    }

    if (!Array.isArray(args.policies) || args.policies.length === 0) {
        args.policies = args.difficulty === 'pro'
            ? ['pro_stable', 'pro_adaptive', 'pro_hybrid', 'pro_upside']
            : ['fresh_stable_push', 'fresh_stable_classic', 'fresh_stable', 'fresh_adaptive', 'deep_beam', 'fresh_upside', 'deep_beam_satcap', 'fresh_s50'];
    }

    return args;
}

function getMimeType(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.csv')) return 'text/csv; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    if (filePath.endsWith('.jpeg') || filePath.endsWith('.jpg')) return 'image/jpeg';
    if (filePath.endsWith('.png')) return 'image/png';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}

async function createStaticServer(rootDir, port) {
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
            const rawPath = decodeURIComponent(url.pathname);
            const relPath = rawPath === '/' ? '/index.html' : rawPath;
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

async function runPolicy(page, { episodes, difficulty, policyName, traceSamples }) {
    return page.evaluate(async ({ episodes: epCount, difficulty: diff, policyName: policy, traceSampleCount }) => {
        const game = window.game;
        if (!game) {
            throw new Error('window.game が見つかりません。');
        }

        // 余計なUI/ログ処理を抑制
        window.alert = () => {};
        window.confirm = () => true;
        console.log = () => {};
        if (game.logger) {
            game.logger.log = () => {};
            game.logger.updateUI = () => {};
        }

        await game.setDifficulty(diff);

        const freshOnlyPolicies = new Set(['fresh_adaptive', 'deep_beam', 'deep_beam_satcap', 'fresh_rule_nonly', 'fresh_s50', 'fresh_stable', 'fresh_stable_classic', 'fresh_stable_push', 'fresh_upside']);
        const proPolicies = new Set(['pro_foundation', 'pro_stable', 'pro_stable_refreshless', 'pro_stable_refresh_init', 'pro_nonly', 'pro_nonly_refreshless', 'pro_adaptive', 'pro_adaptive_nonly', 'pro_smax', 'pro_hybrid', 'pro_upside', 'pro_strategic1', 'pro_strategic1_stable', 'pro_strategic1_upside', 'pro_compress', 'pro_spike12', 'pro_expand']);
        let strategyPolicy = policy;
        if (diff !== 'fresh' && freshOnlyPolicies.has(policy)) {
            // FRESH方略をPROで使う場合は、合法手選択を重視したPRO基盤へ寄せる
            strategyPolicy = 'pro_foundation';
        } else if (diff === 'fresh' && proPolicies.has(policy)) {
            strategyPolicy = 'fresh_stable_classic';
        }
        const isFreshAdaptive = freshOnlyPolicies.has(strategyPolicy);
        const isProDifficulty = diff === 'pro';
        const isProFoundation = strategyPolicy === 'pro_foundation';
        const isProRefreshless = strategyPolicy === 'pro_stable_refreshless' || strategyPolicy === 'pro_nonly_refreshless';
        const isProRefreshInit = strategyPolicy === 'pro_stable_refresh_init';
        const isProStableNOnly = strategyPolicy === 'pro_nonly';
        const isProStableNOnlyRefreshless = strategyPolicy === 'pro_nonly_refreshless';
        const isProAdaptiveNOnly = strategyPolicy === 'pro_adaptive_nonly';
        const isProNOnly = isProStableNOnly || isProStableNOnlyRefreshless || isProAdaptiveNOnly;
        const isProStable = strategyPolicy === 'pro_stable' || isProRefreshless || isProRefreshInit || isProStableNOnly || isProStableNOnlyRefreshless;
        const isProAdaptive = strategyPolicy === 'pro_adaptive' || strategyPolicy === 'pro_adaptive_nonly';
        const isProSmax = strategyPolicy === 'pro_smax';
        const isProHybrid = strategyPolicy === 'pro_hybrid';
        const isProUpside = strategyPolicy === 'pro_upside';
        const isProStrategic1Stable = strategyPolicy === 'pro_strategic1_stable';
        const isProStrategic1Upside = strategyPolicy === 'pro_strategic1_upside';
        const isProStrategic1 = strategyPolicy === 'pro_strategic1' || isProStrategic1Stable || isProStrategic1Upside;
        const isProSpike12 = strategyPolicy === 'pro_spike12';
        const isProCompress = strategyPolicy === 'pro_compress' || isProSpike12;
        const isProExpand = strategyPolicy === 'pro_expand';
        const isProStrategy = isProDifficulty && (isProFoundation || isProStable || isProAdaptive || isProSmax || isProHybrid || isProUpside || isProStrategic1 || isProCompress || isProExpand);
        const isDeepBeam = strategyPolicy === 'deep_beam';
        const isDeepBeamSatCap = strategyPolicy === 'deep_beam_satcap';
        const isRuleNOnly = strategyPolicy === 'fresh_rule_nonly' || isProNOnly;
        const isFreshS50 = strategyPolicy === 'fresh_s50';
        const isFreshStable = strategyPolicy === 'fresh_stable';
        const isFreshStableClassic = strategyPolicy === 'fresh_stable_classic';
        const isFreshStablePush = strategyPolicy === 'fresh_stable_push';
        const isFreshUpside = strategyPolicy === 'fresh_upside';
        const scoreTargets = diff === 'pro'
            ? { aPoints: 8, sClearPoints: 12, aPlusPoints: 10, sPlusPoints: 14 }
            : { aPoints: 7, sClearPoints: 8, aPlusPoints: 7, sPlusPoints: 9 };

        const STATUS_KEYS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
        const SLOT_KEYS = ['leader', 'teacher', 'staff'];
        const statusWeights = {
            experience: 2.0,
            enrollment: 2.8,
            satisfaction: 1.2,
            accounting: 1.0
        };
        const tokenWeights = {
            passion: 1.3,
            inspiration: 1.8,
            organize: 1.1,
            fatigue: -1.3
        };

        function calcWithdrawalFromPlayer(player) {
            const accountingShortage = Math.max(15 - (player.accounting || 0), 0);
            const satisfactionShortage = Math.max(15 - (player.satisfaction || 0), 0);
            return accountingShortage + satisfactionShortage;
        }

        function buildFreshNeeds(player) {
            const withdrawal = calcWithdrawalFromPlayer(player);
            const experience = player.experience || 0;
            const enrollment = player.enrollment || 0;
            const satisfaction = player.satisfaction || 0;
            const accounting = player.accounting || 0;
            const enrollmentDiff = enrollment - withdrawal;
            const enrollmentNeedForS = Math.max((12 + withdrawal) - enrollment, 0);
            const satisfactionExcess = Math.max(satisfaction - 15, 0);
            const accountingExcess = Math.max(accounting - 15, 0);

            return {
                withdrawal,
                enrollmentDiff,
                enrollmentNeedForS,
                experienceNeed: Math.max(12 - experience, 0),
                enrollmentDiffNeed: Math.max(12 - enrollmentDiff, 0),
                accountingNeed: Math.max(15 - accounting, 0),
                satisfactionNeed: Math.max(15 - satisfaction, 0),
                satisfactionExcess,
                accountingExcess,
                safetyRisk: withdrawal >= 4
            };
        }

        function buildProNeeds(player) {
            const withdrawal = calcWithdrawalFromPlayer(player);
            const experience = player.experience || 0;
            const enrollment = player.enrollment || 0;
            const satisfaction = player.satisfaction || 0;
            const accounting = player.accounting || 0;
            const enrollmentDiff = enrollment - withdrawal;

            return {
                withdrawal,
                enrollmentDiff,
                experienceNeed: Math.max(40 - experience, 0),
                enrollmentNeed: Math.max(32 - enrollment, 0),
                enrollmentDiffNeed: Math.max(32 - enrollmentDiff, 0),
                enrollmentDiffNeed40: Math.max(40 - enrollmentDiff, 0),
                accountingNeed: Math.max(15 - accounting, 0),
                satisfactionNeed: Math.max(15 - satisfaction, 0),
                satisfactionBridgeNeed: Math.max(25 - satisfaction, 0),
                satisfactionExcess: Math.max(satisfaction - 25, 0),
                accountingExcess: Math.max(accounting - 18, 0),
                safetyRisk: withdrawal >= 3
            };
        }

        function getDynamicStatusWeights(stateLike, turnIndex = game.gameState.turn) {
            if (!isFreshAdaptive && !isProStrategy) {
                return statusWeights;
            }

            if (isProStrategy) {
                const needs = buildProNeeds(stateLike.player);
                const turnsRemaining = Math.max(1, 8 - (turnIndex + 1));
                const dynamic = {
                    experience: 2.1,
                    enrollment: 2.7,
                    satisfaction: 1.5,
                    accounting: 1.7
                };

                dynamic.experience += Math.min(needs.experienceNeed / 12, 2.2);
                dynamic.enrollment += Math.min(needs.enrollmentDiffNeed / 10, 2.8);
                dynamic.satisfaction += Math.min(needs.satisfactionNeed / 6, 2.0);
                dynamic.accounting += Math.min(needs.accountingNeed / 6, 2.0);

                if (needs.safetyRisk) {
                    dynamic.accounting += 1.6;
                    dynamic.satisfaction += 1.4;
                }
                if (needs.accountingNeed > needs.satisfactionNeed) dynamic.accounting += 0.5;
                if (needs.satisfactionNeed > needs.accountingNeed) dynamic.satisfaction += 0.4;

                if (turnsRemaining <= 2) {
                    if (needs.experienceNeed > 0) dynamic.experience += 1.2;
                    if (needs.enrollmentDiffNeed > 0) dynamic.enrollment += 1.5;
                    if (needs.accountingNeed > 0) dynamic.accounting += 1.3;
                    if (needs.satisfactionNeed > 0) dynamic.satisfaction += 1.1;
                }

                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= isProUpside ? 0.62 : 0.45;
                if (needs.accountingNeed <= 0) dynamic.accounting *= isProUpside ? 0.85 : 0.72;
                if (needs.satisfactionExcess > 0) {
                    dynamic.satisfaction *= Math.max(0.2, 1 - Math.min(needs.satisfactionExcess * 0.08, 0.55));
                    dynamic.experience += Math.min(needs.satisfactionExcess / 6, 0.9);
                    dynamic.enrollment += Math.min(needs.satisfactionExcess / 5, 1.1);
                }
                if (needs.accountingExcess > 0) {
                    dynamic.accounting *= Math.max(0.35, 1 - Math.min(needs.accountingExcess * 0.06, 0.45));
                    dynamic.experience += Math.min(needs.accountingExcess / 8, 0.5);
                    dynamic.enrollment += Math.min(needs.accountingExcess / 7, 0.6);
                }

                if (isProStable) {
                    dynamic.accounting += 1.1;
                    dynamic.satisfaction += 1.0;
                    dynamic.enrollment += 0.4;
                    if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.62;
                    if (needs.accountingNeed <= 0) dynamic.accounting *= 0.78;
                    if (needs.satisfactionExcess > 2) dynamic.satisfaction *= 0.6;
                    if (needs.accountingExcess > 2) dynamic.accounting *= 0.72;
                } else if (isProAdaptive) {
                    dynamic.accounting += 0.9;
                    dynamic.satisfaction += 0.8;
                    dynamic.enrollment += 0.8;
                    dynamic.experience += 0.45;
                    if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.72;
                    if (needs.accountingNeed <= 0) dynamic.accounting *= 0.82;
                    if (
                        needs.withdrawal <= 1 &&
                        needs.accountingNeed <= 1 &&
                        needs.satisfactionNeed <= 1
                    ) {
                        dynamic.experience += 0.75;
                        dynamic.enrollment += 1.2;
                        dynamic.satisfaction *= 0.74;
                        dynamic.accounting *= 0.8;
                    }
                } else if (isProSmax) {
                    dynamic.experience += 0.9;
                    dynamic.enrollment += 1.4;
                    dynamic.accounting += 0.2;
                    dynamic.satisfaction += 0.2;
                    if (needs.withdrawal <= 1) {
                        dynamic.experience += 0.8;
                        dynamic.enrollment += 1.0;
                        dynamic.accounting *= 0.86;
                        dynamic.satisfaction *= 0.84;
                    }
                    if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.78;
                    if (needs.accountingNeed <= 0) dynamic.accounting *= 0.84;
                } else if (isProHybrid) {
                    dynamic.accounting += 0.65;
                    dynamic.satisfaction += 0.45;
                    dynamic.experience += 0.55;
                    dynamic.enrollment += 0.95;
                    if (needs.withdrawal <= 1) {
                        dynamic.experience += 0.7;
                        dynamic.enrollment += 0.9;
                        dynamic.accounting *= 0.88;
                        dynamic.satisfaction *= 0.82;
                    }
                    if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.72;
                    if (needs.accountingNeed <= 0) dynamic.accounting *= 0.84;
                } else if (isProStrategic1) {
                    // フェーズ遷移: 体験(序盤) -> 満足(中盤) -> 教務(終盤) を強める
                    if (turnIndex <= 2) {
                        dynamic.experience += 1.25;
                        dynamic.enrollment += 0.8;
                        dynamic.satisfaction += 0.15;
                        dynamic.accounting += 0.45;
                    } else if (turnIndex <= 4) {
                        dynamic.satisfaction += 0.9;
                        dynamic.accounting += 0.85;
                        dynamic.experience += 0.3;
                    } else {
                        dynamic.enrollment += 2.35;
                        dynamic.experience += 0.85;
                        dynamic.satisfaction *= needs.satisfactionNeed > 0 ? 1.05 : 0.58;
                    }
                    if (needs.accountingNeed > 0) dynamic.accounting += 1.2;
                    if (needs.satisfactionNeed > 0) dynamic.satisfaction += 0.9;
                    if (turnIndex >= 5 && needs.accountingNeed > 0) dynamic.accounting += 0.9;
                    if (turnIndex >= 5 && needs.satisfactionNeed > 0) dynamic.satisfaction += 0.6;
                    if (turnIndex >= 5 && needs.enrollmentDiffNeed > 0) dynamic.enrollment += 1.0;
                    if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0) {
                        dynamic.enrollment += Math.min(needs.enrollmentDiffNeed40 / 6, 2.2);
                    }
                    if (turnIndex >= 4 && needs.experienceNeed > 0) dynamic.experience += 0.7;
                    if (needs.withdrawal <= 1 && needs.accountingNeed <= 1 && needs.satisfactionNeed <= 1 && turnIndex >= 4) {
                        dynamic.enrollment += 0.9;
                        dynamic.experience += 0.45;
                    }
                    if (isProStrategic1Stable) {
                        if (turnIndex >= 5) dynamic.enrollment += 0.55;
                        if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.78;
                        if (needs.accountingNeed <= 0) dynamic.accounting *= 0.9;
                    } else if (isProStrategic1Upside) {
                        if (turnIndex >= 5) dynamic.enrollment += 0.35;
                        dynamic.experience += 0.2;
                        if (needs.accountingNeed <= 0) dynamic.accounting *= 0.95;
                    }
                } else if (isProCompress) {
                    if (turnIndex <= 2) {
                        dynamic.experience += 1.0;
                        dynamic.enrollment += 0.55;
                        dynamic.accounting += 0.5;
                    } else if (turnIndex <= 4) {
                        dynamic.experience += 0.6;
                        dynamic.enrollment += 1.35;
                        dynamic.accounting += 0.7;
                        dynamic.satisfaction += 0.45;
                    } else {
                        dynamic.enrollment += 2.6;
                        dynamic.experience += 1.45;
                        dynamic.satisfaction *= needs.satisfactionNeed > 0 ? 1.0 : 0.52;
                    }
                    if (needs.accountingNeed > 0) dynamic.accounting += 1.05;
                    if (needs.satisfactionNeed > 0) dynamic.satisfaction += 0.55;
                    if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0) dynamic.enrollment += Math.min(needs.enrollmentDiffNeed40 / 5, 2.4);
                    if (turnIndex >= 4 && needs.experienceNeed > 0) dynamic.experience += Math.min(needs.experienceNeed / 8, 1.2);
                    if (needs.accountingNeed <= 0) dynamic.accounting *= 0.82;
                    if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.62;
                    if (isProSpike12) {
                        dynamic.experience += (turnIndex >= 3 ? 1.1 : 0.8);
                        dynamic.enrollment += (turnIndex >= 3 ? 1.9 : 1.0);
                        if (turnIndex >= 5) {
                            dynamic.experience += 0.9;
                            dynamic.enrollment += 1.3;
                        }
                        if (needs.accountingNeed <= 2) dynamic.accounting *= 0.5;
                        if (needs.satisfactionNeed <= 2) dynamic.satisfaction *= 0.45;
                        if (needs.withdrawal >= 3) {
                            dynamic.accounting += 1.1;
                            dynamic.satisfaction += 0.9;
                        }
                    }
                } else if (isProExpand) {
                    dynamic.experience += 0.75;
                    dynamic.enrollment += 1.45;
                    dynamic.accounting += 0.6;
                    dynamic.satisfaction += 0.55;
                    if (turnIndex <= 3) {
                        dynamic.experience += 0.7;
                    } else if (turnIndex >= 5) {
                        dynamic.enrollment += 1.4;
                    }
                    if (needs.withdrawal <= 1) {
                        dynamic.experience += 0.35;
                        dynamic.enrollment += 0.45;
                        dynamic.accounting *= 0.92;
                        dynamic.satisfaction *= 0.9;
                    }
                    if (needs.accountingNeed <= 0) dynamic.accounting *= 0.9;
                    if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.86;
                } else if (isProUpside) {
                    dynamic.experience += 1.0;
                    dynamic.enrollment += 1.3;
                    dynamic.accounting -= 0.25;
                    if (needs.withdrawal <= 1) {
                        dynamic.accounting *= 0.88;
                        dynamic.satisfaction *= 0.85;
                    }
                }

                return dynamic;
            }

            const needs = buildFreshNeeds(stateLike.player);
            const turnsRemaining = Math.max(1, 8 - (turnIndex + 1));
            const dynamic = {
                experience: 1.9,
                enrollment: 2.6,
                satisfaction: 1.2,
                accounting: 1.2
            };

            if (needs.experienceNeed > 0) {
                dynamic.experience += Math.min(needs.experienceNeed / 4, 1.2);
            }
            if (needs.enrollmentDiffNeed > 0) {
                dynamic.enrollment += Math.min(needs.enrollmentDiffNeed / 3, 2.2);
            }
            if (needs.accountingNeed > 0) {
                dynamic.accounting += Math.min(needs.accountingNeed / 4, 1.8);
            }
            if (needs.satisfactionNeed > 0) {
                dynamic.satisfaction += Math.min(needs.satisfactionNeed / 4, 1.8);
            }

            if (needs.safetyRisk) {
                dynamic.accounting += 1.2;
                dynamic.satisfaction += 1.2;
            }
            if (needs.accountingNeed > needs.satisfactionNeed) {
                dynamic.accounting += 0.5;
            }

            if (needs.enrollmentDiffNeed <= 1) {
                dynamic.experience += 0.7;
            }

            // 満足を稼ぎすぎている場合は応対価値を抑え、攻め筋へ重みを寄せる
            if (needs.satisfactionExcess > 0) {
                dynamic.satisfaction *= 0.55;
                dynamic.enrollment += Math.min(needs.satisfactionExcess / 3, 1.2);
            }

            // 終盤で目標未達なら不足項目をさらに強調
            if (turnsRemaining <= 2) {
                if (needs.experienceNeed > 0) dynamic.experience += 1.0;
                if (needs.enrollmentNeedForS > 0) dynamic.enrollment += 1.2;
                if (needs.accountingNeed > 0) dynamic.accounting += 1.1;
                if (needs.satisfactionNeed > 0) dynamic.satisfaction += 1.1;
            }

            // 新戦略: N限定削除型では満足より入退差達成に明確に寄せる
            if (isRuleNOnly) {
                dynamic.enrollment += 0.8;
                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.45;
            }
            if (isDeepBeamSatCap) {
                dynamic.enrollment += 0.5;
                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.35;
                if (needs.satisfactionExcess > 2) {
                    dynamic.satisfaction *= 0.25;
                    dynamic.experience += 0.4;
                }
            }
            if (isFreshS50) {
                dynamic.experience += 0.8;
                dynamic.enrollment += 1.4;
                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.28;
                if (needs.accountingNeed <= 0) dynamic.accounting *= 0.72;
                if (needs.withdrawal > 1) {
                    dynamic.accounting += 1.1;
                    dynamic.satisfaction += 0.9;
                }
                if (turnsRemaining <= 2) {
                    if (needs.experienceNeed > 0) dynamic.experience += 1.4;
                    if (needs.enrollmentNeedForS > 0) dynamic.enrollment += 1.8;
                    if (needs.withdrawal > 1) {
                        dynamic.accounting += 1.3;
                        dynamic.satisfaction += 1.2;
                    }
                }
            }
            if (isFreshStable) {
                dynamic.accounting += 1.2;
                dynamic.satisfaction += 1.1;
                dynamic.enrollment += 1.15;
                dynamic.experience += 0.35;
                if (needs.withdrawal > 1) {
                    dynamic.accounting += 1.8;
                    dynamic.satisfaction += 1.8;
                }
                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.42;
                if (needs.accountingNeed <= 0) dynamic.accounting *= 0.48;
                if (needs.satisfactionExcess > 2) dynamic.satisfaction *= 0.62;
                if (needs.accountingExcess > 2) dynamic.accounting *= 0.66;
                if (needs.enrollmentNeedForS > 0 && turnsRemaining <= 3) {
                    dynamic.enrollment += 1.2;
                    dynamic.experience += 0.6;
                }
            }
            if (isFreshStableClassic) {
                dynamic.accounting += 1.4;
                dynamic.satisfaction += 1.3;
                dynamic.enrollment += 0.8;
                if (needs.withdrawal > 1) {
                    dynamic.accounting += 1.8;
                    dynamic.satisfaction += 1.8;
                }
                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.55;
                if (needs.accountingNeed <= 0) dynamic.accounting *= 0.6;
                if (needs.enrollmentNeedForS > 0 && turnsRemaining <= 3) {
                    dynamic.enrollment += 0.9;
                }
            }
            if (isFreshStablePush) {
                dynamic.accounting += 1.35;
                dynamic.satisfaction += 1.15;
                dynamic.enrollment += 1.2;
                dynamic.experience += 0.35;
                if (needs.withdrawal > 1) {
                    dynamic.accounting += 1.7;
                    dynamic.satisfaction += 1.6;
                }
                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.45;
                if (needs.accountingNeed <= 0) dynamic.accounting *= 0.55;
                if (needs.satisfactionExcess > 2) dynamic.satisfaction *= 0.72;
                if (needs.accountingExcess > 2) dynamic.accounting *= 0.76;
                if (needs.enrollmentNeedForS > 0) dynamic.enrollment += 0.75;
                if (needs.enrollmentNeedForS > 0 && turnsRemaining <= 3) {
                    dynamic.enrollment += 1.0;
                    dynamic.experience += 0.55;
                }
            }
            if (isFreshUpside) {
                dynamic.experience += 1.1;
                dynamic.enrollment += 1.8;
                dynamic.accounting += 0.6;
                dynamic.satisfaction += 0.4;
                if (needs.withdrawal > 2) {
                    dynamic.accounting += 0.8;
                    dynamic.satisfaction += 0.8;
                }
                if (needs.satisfactionNeed <= 0) dynamic.satisfaction *= 0.25;
                if (turnsRemaining <= 2) {
                    dynamic.experience += 1.3;
                    dynamic.enrollment += 1.8;
                }
            }

            return dynamic;
        }

        function calcFreshProgressSignal(stateLike) {
            const player = stateLike.player;
            const needs = buildFreshNeeds(player);
            const experience = player.experience || 0;
            const enrollment = player.enrollment || 0;
            const withdrawal = needs.withdrawal;
            const enrollmentDiff = needs.enrollmentDiff;

            let signal = 0;
            signal += Math.min(experience, 12) * 0.45;
            signal += Math.min(Math.max(enrollmentDiff, -6), 12) * 0.65;
            signal += Math.min(enrollment, 12) * 0.35;
            signal -= Math.max(withdrawal - 1, 0) * 0.85;

            // 目標帯に入った値はボーナス
            if (experience >= 10) signal += 1.0;
            if (enrollmentDiff >= 8) signal += 1.6;
            if (withdrawal <= 1) signal += 1.2;

            return signal;
        }

        function calcFreshSObjectiveSignal(stateLike) {
            const player = stateLike.player;
            const needs = buildFreshNeeds(player);
            const experience = player.experience || 0;
            const enrollmentDiff = needs.enrollmentDiff;
            const withdrawal = needs.withdrawal;

            let signal = 0;
            signal += Math.min(experience, 12) / 12 * 2.0;
            signal += Math.min(Math.max(enrollmentDiff, 0), 12) / 12 * 5.0;

            if (withdrawal <= 1) {
                signal += 1.2;
            } else if (withdrawal >= 4) {
                signal -= 2.8;
            } else {
                signal += Math.max(1.0 - (withdrawal - 1) * 0.55, 0);
            }

            // 目標超過は評価するが、満足の過剰獲得は軽く減点
            signal += Math.max(experience - 12, 0) * 0.03;
            signal += Math.max(enrollmentDiff - 12, 0) * 0.08;
            signal -= needs.satisfactionExcess * 0.12;
            signal -= needs.accountingExcess * 0.05;

            return signal;
        }

        function calcFreshExactPointsFromPlayer(player) {
            const withdrawal = calcWithdrawalFromPlayer(player);
            const mobilization = player.experience || 0;
            const enrollmentDiff = (player.enrollment || 0) - withdrawal;

            let points = 0;
            if (withdrawal >= 4) points -= 3;
            else if (withdrawal <= 1) points += 1;

            if (mobilization >= 12) points += 2;
            else if (mobilization >= 10) points += 1;

            if (enrollmentDiff >= 12) points += 5;
            else if (enrollmentDiff >= 10) points += 4;
            else if (enrollmentDiff >= 8) points += 3;

            return { points, withdrawal, mobilization, enrollmentDiff };
        }

        function calcFreshObjectivePotential(stateLike) {
            const player = stateLike.player;
            const exact = calcFreshExactPointsFromPlayer(player);
            const needs = buildFreshNeeds(player);

            let potential = 0;
            potential += Math.min(Math.max(exact.mobilization, 0), 12) / 12 * 2.0;
            potential += Math.min(Math.max(exact.enrollmentDiff, 0), 12) / 12 * 5.0;

            if (exact.withdrawal <= 1) {
                potential += 1.0;
            } else if (exact.withdrawal >= 4) {
                potential -= 2.6;
            } else {
                potential += Math.max(1.0 - (exact.withdrawal - 1) * 0.5, 0);
            }

            // S+表示点の上振れ余地（8点到達後の伸び）を加味
            let displayPotential = exact.points;
            if (exact.points === 8) {
                const expUsed = Math.min(player.experience || 0, 30);
                const diffUsed = Math.min(exact.enrollmentDiff, 30);
                const rawExpBonus = 0.5 * (expUsed - 12) / 18;
                const rawDiffBonus = 1.5 * (diffUsed - 12) / 18;
                displayPotential = 8 + rawExpBonus + rawDiffBonus;
            }

            potential -= needs.satisfactionExcess * 0.1;
            potential -= needs.accountingExcess * 0.04;

            return {
                potential,
                displayPotential,
                ...exact
            };
        }

        function calcProExactPointsFromPlayer(player) {
            const withdrawal = calcWithdrawalFromPlayer(player);
            const mobilization = player.experience || 0;
            const enrollmentDiff = (player.enrollment || 0) - withdrawal;
            const satisfaction = player.satisfaction || 0;

            let mobilizationPoints = 0;
            if (mobilization >= 50) mobilizationPoints = 5;
            else if (mobilization >= 40) mobilizationPoints = 4;
            else if (mobilization >= 25) mobilizationPoints = 3;
            else if (mobilization >= 20) mobilizationPoints = 2;
            else if (mobilization >= 15) mobilizationPoints = 1;

            let enrollmentDiffPoints = 0;
            if (enrollmentDiff >= 48) enrollmentDiffPoints = 8;
            else if (enrollmentDiff >= 40) enrollmentDiffPoints = 7;
            else if (enrollmentDiff >= 32) enrollmentDiffPoints = 6;
            else if (enrollmentDiff >= 26) enrollmentDiffPoints = 5;
            else if (enrollmentDiff >= 20) enrollmentDiffPoints = 4;
            else if (enrollmentDiff >= 18) enrollmentDiffPoints = 3;
            else if (enrollmentDiff >= 16) enrollmentDiffPoints = 2;
            else if (enrollmentDiff >= 12) enrollmentDiffPoints = 1;

            let withdrawalPoints = -13;
            if (withdrawal <= 0) withdrawalPoints = 1;
            else if (withdrawal <= 1) withdrawalPoints = 0;
            else if (withdrawal <= 2) withdrawalPoints = -1;
            else if (withdrawal <= 3) withdrawalPoints = -3;
            else if (withdrawal <= 4) withdrawalPoints = -5;

            let satisfactionPoints = 0;
            if (satisfaction >= 35) satisfactionPoints = 2;
            else if (satisfaction >= 25) satisfactionPoints = 1;

            const points = mobilizationPoints + enrollmentDiffPoints + withdrawalPoints + satisfactionPoints;
            return {
                points,
                withdrawal,
                mobilization,
                enrollmentDiff,
                satisfaction,
                mobilizationPoints,
                enrollmentDiffPoints,
                withdrawalPoints,
                satisfactionPoints
            };
        }

        function calcProObjectivePotential(stateLike) {
            const exact = calcProExactPointsFromPlayer(stateLike.player);
            let potential = exact.points;

            potential += Math.min(Math.max(exact.mobilization, 0), 40) / 40 * 2.2;
            potential += Math.min(Math.max(exact.enrollmentDiff, 0), 32) / 32 * 3.0;
            if (exact.mobilization > 40) potential += Math.min(exact.mobilization - 40, 10) / 10 * 1.2;
            if (exact.enrollmentDiff > 32) potential += Math.min(exact.enrollmentDiff - 32, 16) / 16 * 2.0;

            if (exact.withdrawal <= 1) potential += 1.1;
            else if (exact.withdrawal <= 2) potential -= 0.6;
            else if (exact.withdrawal <= 3) potential -= 1.4;
            else if (exact.withdrawal <= 4) potential -= 2.3;
            else potential -= 4.0;

            potential += Math.min(Math.max(exact.satisfaction, 0), 25) / 25 * 0.9;
            return {
                potential,
                ...exact
            };
        }

        function calcProThresholdSignal(exact) {
            if (!exact) return 0;
            let signal = 0;

            signal += Math.min(Math.max(exact.mobilization, 0), 40) / 40 * 3.0;
            if (exact.mobilization >= 40) {
                signal += 1.4;
                signal += Math.min(exact.mobilization - 40, 10) / 10 * 1.8;
            }

            signal += Math.min(Math.max(exact.enrollmentDiff, 0), 32) / 32 * 4.0;
            if (exact.enrollmentDiff >= 32) {
                signal += 1.6;
                signal += Math.min(exact.enrollmentDiff - 32, 8) / 8 * 2.3;
            }

            if (exact.withdrawal <= 0) signal += 0.6;
            else if (exact.withdrawal <= 1) signal += 0.2;
            else signal -= Math.min((exact.withdrawal - 1) * 0.8, 3.2);

            signal += Math.min(Math.max(exact.satisfaction, 0), 25) / 25 * 0.55;
            if (exact.satisfaction >= 25) {
                signal += 0.2;
                signal += Math.min(exact.satisfaction - 25, 10) / 10 * 0.3;
            }

            return signal;
        }

        function estimateProThresholdDelta(card, stateLike, turnIndex = game.gameState.turn) {
            if (!isProStrategy || !card) return 0;

            const beforePlayer = snapshotStatus(stateLike.player);
            const beforeExact = calcProExactPointsFromPlayer(stateLike.player);
            const beforePotential = calcProObjectivePotential(stateLike);
            const beforeSignal = calcProThresholdSignal(beforeExact);
            const legalSlots = listLegalSlots(card, null);
            if (legalSlots.length === 0) return -999;

            let best = -999;
            legalSlots.forEach((slot) => {
                const sim = cloneForSimulation(stateLike);
                const applied = game.cardManager.applyCardEffect(card, slot, sim);
                if (!applied) return;

                const afterExact = calcProExactPointsFromPlayer(sim.player);
                const afterPotential = calcProObjectivePotential(sim);
                const afterSignal = calcProThresholdSignal(afterExact);
                const delta = calcStatusDelta(beforePlayer, snapshotStatus(sim.player));
                const dynamicWeights = getDynamicStatusWeights(stateLike, turnIndex);
                const statusDeltaScore = scoreStatusDelta(delta, dynamicWeights) * 0.22;
                const pointDelta = afterExact.points - beforeExact.points;
                const potentialDelta = afterPotential.potential - beforePotential.potential;
                const signalDelta = afterSignal - beforeSignal;
                const slotScore = (pointDelta * 3.5) + (signalDelta * 2.6) + (potentialDelta * 0.9) + statusDeltaScore;
                if (slotScore > best) best = slotScore;
            });

            return best;
        }

        function getCategoryNeedBonus(card, stateLike, turnIndex = game.gameState.turn) {
            if (isProStrategy) {
                const needs = buildProNeeds(stateLike.player);
                const turnsRemaining = Math.max(1, 8 - (turnIndex + 1));
                const category = card?.category;
                if (!category) return 0;

                if (category === '動員') {
                    let bonus = needs.experienceNeed > 0 ? 0.8 + Math.min(needs.experienceNeed / 20, 1.8) : 0.2;
                    if (turnsRemaining <= 2 && needs.experienceNeed > 0) bonus += 0.9;
                    if (isProUpside) bonus += 0.5;
                    if (isProSmax) bonus += 0.45;
                    if (isProAdaptive) bonus += 0.35;
                    if (isProHybrid) bonus += 0.35;
                    if (isProStrategic1) {
                        if (turnIndex <= 2) bonus += 1.0;
                        else if (turnIndex >= 5 && needs.experienceNeed <= 0) bonus -= 0.45;
                    }
                    if (isProCompress) {
                        if (turnIndex <= 2) bonus += 0.8;
                        if (turnIndex >= 4 && needs.experienceNeed > 0) bonus += 0.95;
                        if (turnIndex >= 5 && needs.experienceNeed <= 0) bonus -= 0.35;
                    }
                    if (isProExpand && turnIndex <= 3) bonus += 0.7;
                    return bonus;
                }
                if (category === '教務') {
                    let bonus = needs.enrollmentDiffNeed > 0 ? 1.1 + Math.min(needs.enrollmentDiffNeed / 16, 2.0) : 0.25;
                    if (turnsRemaining <= 2 && needs.enrollmentDiffNeed > 0) bonus += 1.0;
                    if (isProUpside) bonus += 0.55;
                    if (isProSmax) bonus += 0.65;
                    if (isProStable) bonus += 0.2;
                    if (isProAdaptive) bonus += 0.45;
                    if (isProHybrid) bonus += 0.35;
                    if (isProStrategic1) {
                        if (turnIndex >= 5) bonus += 1.35;
                        if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0) bonus += 0.8;
                        if (turnIndex >= 2 && turnIndex <= 4) bonus += 0.45;
                    }
                    if (isProCompress) {
                        if (turnIndex >= 4) bonus += 1.5;
                        if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0) bonus += 1.05;
                    }
                    if (isProExpand) {
                        if (turnIndex >= 5) bonus += 1.1;
                        if (turnIndex >= 2 && turnIndex <= 4) bonus += 0.3;
                    }
                    return bonus;
                }
                if (category === '庶務') {
                    let bonus = needs.accountingNeed > 0 ? 0.9 + Math.min(needs.accountingNeed / 9, 1.8) : 0.25;
                    if (needs.safetyRisk) bonus += 0.8;
                    if (isProStable && needs.accountingNeed > 0) bonus += 0.7;
                    if (isProAdaptive && needs.accountingNeed > 0) bonus += 0.45;
                    if (needs.accountingExcess > 0) bonus -= Math.min(needs.accountingExcess * 0.14, 1.2);
                    if (needs.accountingNeed <= 0 && turnIndex >= 4) bonus -= 0.35;
                    if (isProStrategic1 && turnIndex >= 5 && needs.accountingNeed <= 1) bonus -= 0.3;
                    if (isProCompress && needs.accountingNeed <= 0) bonus -= 0.25;
                    if (isProExpand && needs.accountingNeed > 0) bonus += 0.4;
                    return bonus;
                }
                if (category === '応対') {
                    let bonus = needs.satisfactionNeed > 0 ? 0.8 + Math.min(needs.satisfactionNeed / 9, 1.8) : 0.2;
                    if (needs.safetyRisk) bonus += 0.7;
                    if (isProStable && needs.satisfactionNeed > 0) bonus += 0.7;
                    if (isProAdaptive && needs.satisfactionNeed > 0) bonus += 0.4;
                    if (
                        isProStable &&
                        needs.withdrawal <= 1 &&
                        needs.satisfactionBridgeNeed > 0 &&
                        needs.satisfactionBridgeNeed <= 8 &&
                        (needs.experienceNeed <= 15 || needs.enrollmentDiffNeed <= 10)
                    ) {
                        bonus += 0.8;
                    }
                    if (
                        isProAdaptive &&
                        needs.withdrawal <= 1 &&
                        needs.accountingNeed <= 1 &&
                        needs.satisfactionBridgeNeed > 0 &&
                        needs.satisfactionBridgeNeed <= 6
                    ) {
                        bonus += 0.55;
                    }
                    if (
                        isProHybrid &&
                        needs.withdrawal <= 1 &&
                        needs.satisfactionBridgeNeed > 0 &&
                        (needs.experienceNeed <= 18 || needs.enrollmentDiffNeed <= 14)
                    ) {
                        bonus += 0.8 + Math.min(needs.satisfactionBridgeNeed / 8, 0.8);
                    }
                    if (isProHybrid && needs.satisfactionBridgeNeed <= 0) bonus -= 0.7;
                    if (needs.satisfactionExcess > 0) bonus -= Math.min(needs.satisfactionExcess * 0.18, 1.8);
                    if (needs.satisfactionNeed <= 0 && turnIndex >= 3) bonus -= 0.5;
                    if (isProStrategic1) {
                        if (turnIndex >= 2 && turnIndex <= 4 && needs.satisfactionNeed > 0) bonus += 1.2;
                        if (turnIndex >= 5 && needs.satisfactionNeed <= 0) bonus -= 0.4;
                    }
                    if (isProCompress) {
                        if (turnIndex >= 4 && needs.satisfactionNeed <= 0) bonus -= 0.55;
                        if (turnIndex >= 2 && turnIndex <= 4 && needs.satisfactionNeed > 0) bonus += 0.8;
                    }
                    if (isProExpand) {
                        if (needs.satisfactionNeed > 0) bonus += 0.45;
                        if (turnIndex >= 5 && needs.satisfactionNeed <= 0) bonus -= 0.2;
                    }
                    return bonus;
                }
                if (category === '支障') {
                    return -1.5;
                }
                return 0;
            }
            if (!isFreshAdaptive) return 0;

            const needs = buildFreshNeeds(stateLike.player);
            const turnsRemaining = Math.max(1, 8 - (turnIndex + 1));
            const category = card?.category;
            if (!category) return 0;

            if (category === '動員') {
                let bonus = needs.experienceNeed > 0 ? 0.7 + Math.min(needs.experienceNeed / 9, 1.2) : 0.15;
                if (turnsRemaining <= 2 && needs.experienceNeed > 0) bonus += 0.6;
                if (isFreshUpside && needs.experienceNeed > 0) bonus += 0.55;
                return bonus;
            }
            if (category === '教務') {
                let bonus = needs.enrollmentNeedForS > 0 ? 1.0 + Math.min(needs.enrollmentNeedForS / 7, 1.6) : 0.15;
                if (turnsRemaining <= 2 && needs.enrollmentNeedForS > 0) bonus += 0.7;
                if (isFreshUpside) bonus += 0.45;
                if (isFreshStable) bonus += 0.45;
                return bonus;
            }
            if (category === '庶務') {
                let bonus = needs.accountingNeed > 0 ? 0.7 + Math.min(needs.accountingNeed / 8, 1.3) : 0.12;
                if (needs.withdrawal > 1) bonus += 0.5;
                if (needs.accountingNeed > needs.satisfactionNeed) bonus += 0.45;
                if (needs.accountingExcess > 0) bonus -= Math.min(needs.accountingExcess * 0.08, 0.6);
                if (isFreshS50 && needs.accountingNeed > 0) bonus += 0.75;
                if (isFreshStable && needs.accountingNeed > 0) bonus += 0.9;
                if (isFreshStable && needs.accountingNeed <= 0 && needs.enrollmentNeedForS > 0) bonus -= 0.55;
                if (isFreshStableClassic && needs.accountingNeed > 0) bonus += 0.9;
                if (isFreshStablePush && needs.accountingNeed > 0) bonus += 0.8;
                if (isFreshStablePush && needs.accountingNeed <= 0 && needs.enrollmentNeedForS > 0) bonus -= 0.45;
                return bonus;
            }
            if (category === '応対') {
                let bonus = needs.satisfactionNeed > 0 ? 0.7 + Math.min(needs.satisfactionNeed / 8, 1.3) : 0.12;
                if (needs.withdrawal > 1) bonus += 0.5;
                if (needs.satisfactionNeed > needs.accountingNeed) bonus += 0.22;
                if (needs.satisfactionExcess > 0) bonus -= Math.min(needs.satisfactionExcess * 0.14, 1.3);
                if (needs.satisfactionNeed <= 0 && needs.enrollmentNeedForS > 0) bonus -= 0.45;
                if (isDeepBeamSatCap && needs.satisfactionNeed <= 0) bonus -= 0.9;
                if (needs.accountingNeed > needs.satisfactionNeed && needs.satisfactionNeed <= 1) bonus -= 0.45;
                if (isFreshS50 && needs.satisfactionNeed <= 0) bonus -= 0.9;
                if (isFreshStable && needs.satisfactionNeed > 0) bonus += 0.6;
                if (isFreshStable && needs.satisfactionNeed <= 0) bonus -= 0.25;
                if (isFreshStable && needs.satisfactionNeed <= 0 && needs.enrollmentNeedForS > 0) bonus -= 0.45;
                if (isFreshStableClassic && needs.satisfactionNeed > 0) bonus += 0.6;
                if (isFreshStableClassic && needs.satisfactionNeed <= 0) bonus -= 0.25;
                if (isFreshStablePush && needs.satisfactionNeed > 0) bonus += 0.55;
                if (isFreshStablePush && needs.satisfactionNeed <= 0) bonus -= 0.35;
                if (isFreshStablePush && needs.satisfactionNeed <= 0 && needs.enrollmentNeedForS > 0) bonus -= 0.35;
                return bonus;
            }

            return 0;
        }

        function ensureTokens(tokens) {
            return {
                passion: tokens?.passion || 0,
                inspiration: tokens?.inspiration || 0,
                organize: tokens?.organize || 0,
                fatigue: tokens?.fatigue || 0
            };
        }

        function snapshotStatus(player) {
            return {
                experience: player.experience,
                enrollment: player.enrollment,
                satisfaction: player.satisfaction,
                accounting: player.accounting
            };
        }

        function calcStatusDelta(before, after) {
            return {
                experience: (after.experience || 0) - (before.experience || 0),
                enrollment: (after.enrollment || 0) - (before.enrollment || 0),
                satisfaction: (after.satisfaction || 0) - (before.satisfaction || 0),
                accounting: (after.accounting || 0) - (before.accounting || 0)
            };
        }

        function scoreStatusDelta(delta, weights = statusWeights) {
            return STATUS_KEYS.reduce((acc, key) => acc + (delta[key] || 0) * (weights[key] || 0), 0);
        }

        function scoreTokenDelta(beforeTokens, afterTokens, weights = tokenWeights) {
            return Object.keys(weights).reduce((acc, key) => {
                return acc + ((afterTokens[key] || 0) - (beforeTokens[key] || 0)) * (weights[key] || 0);
            }, 0);
        }

        function getCardsForTokenSynergy(stateLike) {
            const deckCards = stateLike?.player?.deck || game.gameState?.player?.deck || [];
            const handCards = stateLike?.player?.hand || game.gameState?.player?.hand || [];
            return [...deckCards, ...handCards];
        }

        function getTokenSynergyContext(stateLike, turnIndex = game.gameState.turn, extra = {}) {
            const cards = getCardsForTokenSynergy(stateLike);
            const counts = {
                total: cards.length,
                passionCards: 0,
                inspirationCards: 0,
                organizeCards: 0,
                fatigueCards: 0,
                parallelCards: 0,
                ssrCards: 0,
                srCards: 0,
                nCards: 0
            };
            cards.forEach((card) => {
                const text = card?.effect || '';
                counts.passionCards += countKeyword(text, '情熱');
                counts.inspirationCards += countKeyword(text, '発想');
                counts.organizeCards += countKeyword(text, '整理');
                counts.fatigueCards += countKeyword(text, '疲労');
                if (text.includes('並行')) counts.parallelCards += 1;
                if (card?.rarity === 'SSR') counts.ssrCards += 1;
                else if (card?.rarity === 'SR') counts.srCards += 1;
                else if (card?.rarity === 'N') counts.nCards += 1;
            });

            const turnsRemaining = Math.max(0, 7 - turnIndex);
            const tokens = ensureTokens(stateLike?.tokens || game.gameState?.tokens);
            const tokenPressure = (tokens.passion || 0) - (tokens.fatigue || 0);
            const placedCounts = extra.placedCounts || {
                leader: game.gameState?.player?.placed?.leader?.length || 0,
                teacher: game.gameState?.player?.placed?.teacher?.length || 0,
                staff: game.gameState?.player?.placed?.staff?.length || 0
            };
            const occupiedSlots = (placedCounts.leader || 0) + (placedCounts.teacher || 0) + (placedCounts.staff || 0);
            const parallelPressure = Math.max(occupiedSlots - 2, 0);

            return {
                ...counts,
                turnsRemaining,
                tokenPressure,
                parallelPressure,
                tokens
            };
        }

        function getDynamicTokenWeights(stateLike, turnIndex = game.gameState.turn, extra = {}) {
            const ctx = getTokenSynergyContext(stateLike, turnIndex, extra);
            const weights = { ...tokenWeights };

            if (isProStrategic1) {
                if (ctx.turnsRemaining <= 1) {
                    weights.passion *= 0.65;
                    weights.inspiration *= 0.35;
                } else {
                    weights.passion += Math.min(ctx.parallelCards * 0.12, 0.8);
                    weights.passion += Math.max(ctx.tokenPressure, 0) * 0.2;
                    weights.inspiration += Math.min((ctx.ssrCards * 0.12) + (ctx.srCards * 0.06), 1.0);
                }

                weights.organize += Math.min(ctx.nCards * 0.08, 1.0);
                if (ctx.total >= 14) weights.organize += 0.3;

                let fatigueScale = 1;
                if (turnIndex >= 6) fatigueScale *= 0.42;
                if (ctx.passionCards > ctx.fatigueCards) fatigueScale *= 0.72;
                if (ctx.tokenPressure > 0) fatigueScale *= 0.68;
                weights.fatigue = tokenWeights.fatigue * fatigueScale;
            }
            if (isProCompress) {
                weights.inspiration += 0.55;
                weights.organize += 0.9 + Math.min(ctx.nCards * 0.05, 0.8);
                weights.passion *= 0.78;
                let fatigueScale = 1.05;
                if (turnIndex >= 6) fatigueScale *= 0.72;
                weights.fatigue = tokenWeights.fatigue * fatigueScale;
            }
            if (isProExpand) {
                weights.passion += 0.8 + Math.min(ctx.parallelCards * 0.12, 1.1);
                weights.inspiration += 0.35;
                weights.organize += 0.2;
                let fatigueScale = 0.85;
                if (ctx.passionCards > ctx.fatigueCards) fatigueScale *= 0.75;
                if (turnIndex >= 6) fatigueScale *= 0.58;
                weights.fatigue = tokenWeights.fatigue * fatigueScale;
            }

            return { weights, ctx };
        }

        function cloneForSimulation(srcState) {
            return {
                player: snapshotStatus(srcState.player),
                tokens: ensureTokens(srcState.tokens),
                updateStatus(type, delta) {
                    const oldValue = this.player[type];
                    let newValue = oldValue + delta;
                    newValue = Math.max(0, newValue);
                    if (type === 'enrollment') {
                        newValue = Math.min(newValue, this.player.experience);
                    }
                    this.player[type] = newValue;
                    return newValue - oldValue;
                }
            };
        }

        function effectValue(effect, weights = statusWeights) {
            if (!effect) return 0;
            if (effect.type === 'change') {
                return (weights[effect.status] || 0) * (effect.value || 0);
            }
            if (effect.type === 'set') {
                const target = effect.value || 0;
                return (weights[effect.status] || 0) * target * 0.2;
            }
            if (effect.type === 'token') {
                return tokenWeights[effect.token] || 0;
            }
            if (effect.type === 'immediate' && effect.effect === 'parallel') {
                return 0.6;
            }
            return 0;
        }

        function evaluateConditionSimple(condition, state, slot) {
            if (!condition) return false;
            if (condition.type === 'staff') {
                return Array.isArray(condition.staffList) && condition.staffList.includes(slot);
            }
            if (condition.type === 'status') {
                const value = state.player[condition.status] || 0;
                return condition.comparison === 'gte' ? value >= condition.value : value <= condition.value;
            }
            if (condition.type === 'statDiff') {
                const v1 = state.player[condition.stat1] || 0;
                const v2 = state.player[condition.stat2] || 0;
                const diffValue = Math.abs(v1 - v2);
                return condition.comparison === 'gte' ? diffValue >= condition.value : diffValue <= condition.value;
            }
            return false;
        }

        function estimateCardStaticValue(card, state, slotHint = 'leader', turnIndex = game.gameState.turn) {
            const parsed = game.cardManager.parseEffect(card.effect || '');
            const weights = getDynamicStatusWeights(state, turnIndex);
            let value = 0;

            parsed.baseEffects.forEach((effect) => {
                value += effectValue(effect, weights);
            });

            parsed.conditionalBlocks.forEach((block) => {
                if (evaluateConditionSimple(block.condition, state, slotHint)) {
                    block.effects.forEach((effect) => {
                        value += effectValue(effect, weights);
                    });
                } else {
                    block.effects.forEach((effect) => {
                        value += effectValue(effect, weights) * 0.25;
                    });
                }
            });

            value += getCategoryNeedBonus(card, state, turnIndex);
            return value;
        }

        function getStaffRestrictions(card) {
            const parsed = game.cardManager.parseEffect(card.effect || '');
            return parsed.staffRestrictions || [];
        }

        function hasParallelEffect(card) {
            return (card?.effect || '').includes('並行');
        }

        function listLegalSlots(card, placedCounts = null) {
            const restrictions = getStaffRestrictions(card);
            const slots = restrictions.length > 0 ? restrictions : SLOT_KEYS;
            if (!placedCounts) return [...slots];

            return slots.filter((slot) => {
                const parallel = hasParallelEffect(card);
                const slotCount = placedCounts[slot] || 0;
                return parallel || slotCount === 0;
            });
        }

        function estimateCardBestSlotValue(card, state, turnIndex = game.gameState.turn) {
            const legalSlots = listLegalSlots(card, null);
            if (legalSlots.length === 0) return -999;
            let best = -Infinity;
            legalSlots.forEach((slot) => {
                const score = estimateCardStaticValue(card, state, slot, turnIndex);
                if (score > best) best = score;
            });
            return best;
        }

        function canPlaceWithCounts(card, slot, placedCounts) {
            return listLegalSlots(card, placedCounts).includes(slot);
        }

        function canPlaceCurrent(card, slot) {
            const counts = {
                leader: game.gameState.player.placed.leader?.length || 0,
                teacher: game.gameState.player.placed.teacher?.length || 0,
                staff: game.gameState.player.placed.staff?.length || 0
            };
            return canPlaceWithCounts(card, slot, counts);
        }

        function enumeratePlacementOptions(handCards, placedCounts) {
            const options = [];
            for (let i = 0; i < handCards.length; i += 1) {
                const card = handCards[i];
                const legalSlots = listLegalSlots(card, placedCounts);
                legalSlots.forEach((slot) => {
                    options.push({ cardIndex: i, card, slot });
                });
            }
            return options;
        }

        function transitionPlacement(simState, card, slot, recommendedByStaff, placedCounts) {
            const turnConfig = game.turnManager.getCurrentTurnConfig();
            const nextState = cloneForSimulation(simState);
            const beforeStatus = snapshotStatus(nextState.player);
            const beforeTokens = ensureTokens(nextState.tokens);
            const turnIndex = game.gameState.turn;
            const beforeFreshProgress = isFreshAdaptive ? calcFreshProgressSignal(nextState) : 0;
            const beforeSObjective = isFreshAdaptive ? calcFreshSObjectiveSignal(nextState) : 0;
            const beforeFreshPotential = isFreshAdaptive ? calcFreshObjectivePotential(nextState) : null;
            const beforeProPotential = (isProStrategic1 || isProCompress || isProExpand) ? calcProObjectivePotential(nextState) : null;
            const beforeFreshNeeds = isFreshAdaptive ? buildFreshNeeds(nextState.player) : null;
            const beforeProNeeds = isProStrategy ? buildProNeeds(nextState.player) : null;

            const nextRecommended = { ...recommendedByStaff };
            if (
                turnConfig?.recommended &&
                turnConfig?.recommendedStatus &&
                card.category === turnConfig.recommended
            ) {
                nextState.updateStatus(turnConfig.recommendedStatus, 1);
                nextRecommended[slot] = true;
            }

            const applied = game.cardManager.applyCardEffect(card, slot, nextState);
            if (!applied) return null;

            const afterStatus = snapshotStatus(nextState.player);
            const afterTokens = ensureTokens(nextState.tokens);
            const delta = calcStatusDelta(beforeStatus, afterStatus);
            const dynamicWeights = getDynamicStatusWeights(nextState, turnIndex);
            const dynamicToken = getDynamicTokenWeights(game.gameState, turnIndex, { placedCounts });
            let stepScore = scoreStatusDelta(delta, dynamicWeights) + scoreTokenDelta(beforeTokens, afterTokens, dynamicToken.weights);
            if (nextState.player.accounting < 3) stepScore -= 1.5;
            if (nextState.player.satisfaction < 3) stepScore -= 1.2;

            if (isFreshAdaptive) {
                const afterProgress = calcFreshProgressSignal(nextState);
                stepScore += (afterProgress - beforeFreshProgress) * 0.9;
                stepScore += getCategoryNeedBonus(card, nextState, turnIndex) * 0.45;
                if (isFreshS50) {
                    const afterSObjective = calcFreshSObjectiveSignal(nextState);
                    stepScore += (afterSObjective - beforeSObjective) * 1.35;
                }
                const afterPotential = calcFreshObjectivePotential(nextState);
                const potentialDelta = afterPotential.potential - beforeFreshPotential.potential;
                const displayDelta = afterPotential.displayPotential - beforeFreshPotential.displayPotential;
                if (isFreshStable) {
                    stepScore += potentialDelta * 1.65;
                    stepScore += displayDelta * 0.45;
                } else if (isFreshStableClassic) {
                    stepScore += potentialDelta * 1.5;
                    stepScore += displayDelta * 0.35;
                } else if (isFreshStablePush) {
                    stepScore += potentialDelta * 1.6;
                    stepScore += displayDelta * 0.55;
                } else if (isFreshUpside) {
                    stepScore += potentialDelta * 1.25;
                    stepScore += displayDelta * 1.15;
                } else if (isFreshS50) {
                    stepScore += potentialDelta * 1.2;
                    stepScore += displayDelta * 0.55;
                } else {
                    stepScore += potentialDelta * 0.9;
                    stepScore += displayDelta * 0.35;
                }

                const afterNeeds = buildFreshNeeds(nextState.player);
                const withdrawalImprovement = beforeFreshNeeds.withdrawal - afterNeeds.withdrawal;
                if (withdrawalImprovement !== 0) {
                    stepScore += withdrawalImprovement * (isFreshS50 ? 2.1 : 1.55);
                }
                const enrollDiffImprovement = afterNeeds.enrollmentDiff - beforeFreshNeeds.enrollmentDiff;
                if (enrollDiffImprovement > 0) {
                    stepScore += enrollDiffImprovement * (isFreshS50 ? 0.9 : 0.55);
                }
                if (enrollDiffImprovement < 0 && turnIndex >= 4) {
                    stepScore += enrollDiffImprovement * 0.75;
                }
                if (beforeFreshNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * (0.8 + Math.min(beforeFreshNeeds.satisfactionExcess * 0.12, 1.2));
                }
                if (isFreshStable && beforeFreshNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * 0.65;
                }
                if (isFreshStableClassic && beforeFreshNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * 0.55;
                }
                if (isFreshStablePush && beforeFreshNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * 0.75;
                }
                if (beforeFreshNeeds.enrollmentNeedForS > 0 && delta.enrollment > 0) {
                    stepScore += delta.enrollment * 0.7;
                }
                if (isDeepBeamSatCap && beforeFreshNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * 1.2;
                }
                if (isFreshS50 && beforeFreshNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * 1.55;
                }
                if (isFreshUpside && beforeFreshNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * 1.35;
                }
                if (turnIndex <= 3 && delta.accounting < 0 && (delta.experience > 0 || delta.enrollment > 0)) {
                    // 序盤は攻めカードの経理マイナスをやや許容
                    stepScore += (-delta.accounting) * 0.8;
                }

                if (turnIndex >= 5) {
                    if (delta.accounting < 0) stepScore += delta.accounting * 1.8;
                    if (delta.satisfaction < 0 && afterNeeds.satisfactionNeed > 0) stepScore += delta.satisfaction * 1.2;
                    if (afterNeeds.withdrawal > 1) stepScore -= (afterNeeds.withdrawal - 1) * 0.8;
                    if (card.category === '応対' && afterNeeds.satisfactionNeed <= 0 && afterNeeds.enrollmentNeedForS > 0) {
                        stepScore -= 0.4;
                    }
                    if (isFreshS50 && card.category === '応対' && afterNeeds.satisfactionNeed <= 0) {
                        stepScore -= 0.5;
                    }
                    if (isFreshUpside && card.category === '応対' && afterNeeds.satisfactionNeed <= 0) {
                        stepScore -= 0.45;
                    }
                }
                if (isFreshS50 && afterNeeds.accountingNeed > 0 && delta.accounting < 0) {
                    stepScore += delta.accounting * 1.7;
                }
                if (isFreshStable && afterNeeds.accountingNeed > 0 && delta.accounting < 0) {
                    stepScore += delta.accounting * 2.0;
                }
                if (isFreshStable && afterNeeds.satisfactionNeed > 0 && delta.satisfaction < 0) {
                    stepScore += delta.satisfaction * 1.7;
                }
                if (isFreshStableClassic && afterNeeds.accountingNeed > 0 && delta.accounting < 0) {
                    stepScore += delta.accounting * 1.8;
                }
                if (isFreshStableClassic && afterNeeds.satisfactionNeed > 0 && delta.satisfaction < 0) {
                    stepScore += delta.satisfaction * 1.55;
                }
                if (isFreshStablePush && afterNeeds.accountingNeed > 0 && delta.accounting < 0) {
                    stepScore += delta.accounting * 1.9;
                }
                if (isFreshStablePush && afterNeeds.satisfactionNeed > 0 && delta.satisfaction < 0) {
                    stepScore += delta.satisfaction * 1.65;
                }
            } else if (isProStrategy) {
                const afterNeeds = buildProNeeds(nextState.player);
                const afterProPotential = (isProStrategic1 || isProCompress || isProExpand) ? calcProObjectivePotential(nextState) : null;
                const withdrawalImprovement = beforeProNeeds.withdrawal - afterNeeds.withdrawal;
                const expNeedImprovement = beforeProNeeds.experienceNeed - afterNeeds.experienceNeed;
                const diffNeedImprovement = beforeProNeeds.enrollmentDiffNeed - afterNeeds.enrollmentDiffNeed;
                const accountingNeedImprovement = beforeProNeeds.accountingNeed - afterNeeds.accountingNeed;
                const satisfactionNeedImprovement = beforeProNeeds.satisfactionNeed - afterNeeds.satisfactionNeed;
                const satisfactionBridgeImprovement = beforeProNeeds.satisfactionBridgeNeed - afterNeeds.satisfactionBridgeNeed;

                stepScore += expNeedImprovement * (isProUpside ? 0.3 : isProSmax ? 0.34 : isProAdaptive ? 0.28 : isProHybrid ? 0.28 : 0.22);
                stepScore += diffNeedImprovement * (isProSmax ? 0.48 : isProAdaptive ? 0.44 : isProHybrid ? 0.42 : 0.34);
                stepScore += accountingNeedImprovement * (isProStable ? 0.36 : isProAdaptive ? 0.33 : 0.25);
                stepScore += satisfactionNeedImprovement * (isProStable ? 0.32 : isProAdaptive ? 0.3 : 0.22);
                stepScore += withdrawalImprovement * (isProStable ? 1.8 : isProAdaptive ? 1.65 : 1.3);

                if (afterNeeds.withdrawal >= 4) stepScore -= 3.2;
                if (afterNeeds.withdrawal >= 2 && turnIndex >= 4) stepScore -= 1.2;
                if (
                    isProStable &&
                    beforeProNeeds.withdrawal <= 1 &&
                    beforeProNeeds.accountingNeed <= 1 &&
                    beforeProNeeds.satisfactionBridgeNeed > 0 &&
                    beforeProNeeds.satisfactionBridgeNeed <= 10 &&
                    (beforeProNeeds.enrollmentDiffNeed <= 12 || beforeProNeeds.experienceNeed <= 18) &&
                    satisfactionBridgeImprovement > 0
                ) {
                    stepScore += satisfactionBridgeImprovement * 0.22;
                    if (afterNeeds.satisfactionBridgeNeed <= 0) stepScore += 0.45;
                }
                if (beforeProNeeds.satisfactionNeed <= 0 && delta.satisfaction > 0 && !isProUpside) {
                    const stableBridgeMode = isProStable &&
                        beforeProNeeds.withdrawal <= 1 &&
                        beforeProNeeds.satisfactionBridgeNeed > 0 &&
                        beforeProNeeds.satisfactionBridgeNeed <= 8 &&
                        (beforeProNeeds.experienceNeed <= 15 || beforeProNeeds.enrollmentDiffNeed <= 10);
                    stepScore -= delta.satisfaction * (
                        isProStable
                            ? (stableBridgeMode ? 0.25 : 0.95)
                            : isProSmax ? 0.5 : isProAdaptive ? 0.55 : isProHybrid ? 0.2 : 0.78
                    );
                }
                if (afterNeeds.satisfactionExcess > 0 && delta.satisfaction > 0 && !isProUpside && !isProHybrid) {
                    stepScore -= delta.satisfaction * Math.min(0.55 + afterNeeds.satisfactionExcess * 0.08, 1.5);
                }
                if (
                    isProHybrid &&
                    beforeProNeeds.withdrawal <= 1 &&
                    delta.satisfaction > 0 &&
                    beforeProNeeds.satisfactionBridgeNeed > 0 &&
                    (beforeProNeeds.experienceNeed <= 18 || beforeProNeeds.enrollmentDiffNeed <= 14)
                ) {
                    stepScore += delta.satisfaction * 0.42;
                }
                if (isProHybrid && afterNeeds.satisfactionExcess > 0 && delta.satisfaction > 0) {
                    stepScore -= delta.satisfaction * Math.min(0.55 + afterNeeds.satisfactionExcess * 0.1, 1.6);
                }
                if (beforeProNeeds.accountingNeed <= 0 && delta.accounting > 0 && !isProStable && !isProAdaptive) {
                    stepScore -= delta.accounting * 0.32;
                }
                if (afterNeeds.accountingExcess > 0 && delta.accounting > 0 && !isProStable && !isProAdaptive) {
                    stepScore -= delta.accounting * Math.min(0.2 + afterNeeds.accountingExcess * 0.04, 0.8);
                }
                if (
                    isProAdaptive &&
                    beforeProNeeds.withdrawal <= 1 &&
                    beforeProNeeds.accountingNeed <= 1 &&
                    beforeProNeeds.satisfactionNeed <= 1 &&
                    beforeProNeeds.enrollmentDiffNeed > 0
                ) {
                    if (diffNeedImprovement > 0) stepScore += diffNeedImprovement * 0.26;
                    if (expNeedImprovement > 0) stepScore += expNeedImprovement * 0.12;
                }
                if ((isProStrategic1 || isProCompress || isProExpand) && beforeProPotential && afterProPotential) {
                    const objectiveDelta = afterProPotential.potential - beforeProPotential.potential;
                    const pointDelta = afterProPotential.points - beforeProPotential.points;
                    const thresholdDelta = calcProThresholdSignal(afterProPotential) - calcProThresholdSignal(beforeProPotential);
                    const objectiveScale = isProCompress ? 1.62 : isProExpand ? 1.32 : 1.45;
                    const pointScale = isProCompress ? 3.0 : isProExpand ? 2.5 : 2.7;
                    stepScore += objectiveDelta * objectiveScale;
                    stepScore += pointDelta * pointScale;
                    stepScore += thresholdDelta * (isProCompress ? 0.0 : isProExpand ? 0.0 : 0.0);
                    if (afterProPotential.enrollmentDiff > beforeProPotential.enrollmentDiff) {
                        stepScore += (afterProPotential.enrollmentDiff - beforeProPotential.enrollmentDiff) * (isProCompress ? 0.68 : 0.55);
                        if (beforeProPotential.enrollmentDiff >= 30) {
                            stepScore += (afterProPotential.enrollmentDiff - beforeProPotential.enrollmentDiff) * (isProCompress ? 1.15 : 0.95);
                        }
                    }
                    if (afterProPotential.mobilization > beforeProPotential.mobilization) {
                        stepScore += (afterProPotential.mobilization - beforeProPotential.mobilization) * 0.35;
                    }
                    if (afterProPotential.withdrawal > beforeProPotential.withdrawal) {
                        stepScore -= (afterProPotential.withdrawal - beforeProPotential.withdrawal) * 1.5;
                    }
                    if (!isProStrategic1Stable && turnIndex >= 5 && beforeProPotential.points >= 9) {
                        if (delta.enrollment > 0) stepScore += delta.enrollment * 0.95;
                        if (delta.experience > 0) stepScore += delta.experience * 0.55;
                        if (delta.accounting < 0 && beforeProPotential.withdrawal <= 1 && (beforeStatus.accounting || 0) >= 17) {
                            // 上振れ狙い: 余剰経理がある終盤のみ、教務スパイクを許容
                            stepScore += (-delta.accounting) * 0.45;
                        }
                    } else if (isProStrategic1Stable && turnIndex >= 6 && beforeProPotential.points >= 8) {
                        if (delta.enrollment > 0 && beforeProPotential.enrollmentDiff < 40) {
                            stepScore += delta.enrollment * 0.45;
                        }
                        if (delta.accounting < 0 && beforeProPotential.withdrawal <= 1 && (beforeStatus.accounting || 0) >= 18) {
                            stepScore += (-delta.accounting) * 0.18;
                        }
                    }
                    if (isProCompress) {
                        if (card.cardName === '学力確認＆向上 公開模試' && delta.enrollment > 0) {
                            stepScore += delta.enrollment * 0.85;
                        }
                        if (card.cardName === '締切間近の書類リマインド' && turnIndex <= 5) {
                            stepScore += 0.95;
                        }
                        if (delta.accounting < 0 && (beforeStatus.accounting || 0) < 17) {
                            stepScore += delta.accounting * 0.65;
                        }
                        if (isProSpike12) {
                            if (delta.enrollment > 0) stepScore += delta.enrollment * 0.55;
                            if (delta.experience > 0) stepScore += delta.experience * 0.35;
                            if (turnIndex >= 5 && beforeProNeeds.enrollmentDiffNeed40 > 0 && delta.enrollment > 0) {
                                stepScore += delta.enrollment * 0.45;
                            }
                            if (turnIndex >= 4 && beforeProNeeds.satisfactionNeed <= 1 && delta.satisfaction > 0) {
                                stepScore -= delta.satisfaction * 1.15;
                            }
                            if (delta.accounting < 0 && (beforeStatus.accounting || 0) >= 15 && beforeProNeeds.withdrawal <= 1) {
                                stepScore += (-delta.accounting) * 0.3;
                            }
                        }
                    }
                    if (isProExpand) {
                        if (hasParallelEffect(card)) stepScore += 0.7;
                        if ((card.effect || '').includes('情熱')) stepScore += 0.75;
                        if ((card.effect || '').includes('発想')) stepScore += 0.45;
                    }
                    if (hasParallelEffect(card)) {
                        stepScore += Math.min(dynamicToken.ctx.passionCards * 0.08, 0.6);
                        if (dynamicToken.ctx.tokenPressure > 0) stepScore += Math.min(dynamicToken.ctx.tokenPressure * 0.22, 0.8);
                    }
                    const fatigueCount = countKeyword(card.effect || '', '疲労');
                    if (fatigueCount > 0) {
                        if (turnIndex >= 6) stepScore += fatigueCount * 1.1;
                        if (dynamicToken.ctx.passionCards > dynamicToken.ctx.fatigueCards || dynamicToken.ctx.tokenPressure > 0) {
                            stepScore += fatigueCount * 0.85;
                        } else if (turnIndex <= 3) {
                            stepScore -= fatigueCount * 1.1;
                        }
                    }
                }
                if (card.category === '支障') {
                    stepScore -= 1.3;
                }
                if (hasParallelEffect(card)) {
                    stepScore += isProUpside ? 0.35 : isProSmax ? 0.28 : isProAdaptive ? 0.24 : isProHybrid ? 0.22 : 0.18;
                }
            }

            const nextCounts = {
                leader: placedCounts.leader || 0,
                teacher: placedCounts.teacher || 0,
                staff: placedCounts.staff || 0
            };
            nextCounts[slot] += 1;

            return {
                simState: nextState,
                stepScore,
                recommendedByStaff: nextRecommended,
                placedCounts: nextCounts
            };
        }

        function randomPick(cards, count = 1) {
            const shuffled = [...cards];
            for (let i = shuffled.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled.slice(0, Math.min(count, shuffled.length));
        }

        function estimateObjectiveDelta(card, state, slotHint = 'leader') {
            const simState = cloneForSimulation(state);
            const before = calcFreshSObjectiveSignal(simState);
            const beforeNeeds = buildFreshNeeds(simState.player);
            const beforePotential = calcFreshObjectivePotential(simState);
            const applied = game.cardManager.applyCardEffect(card, slotHint, simState);
            if (!applied) return -999;
            const after = calcFreshSObjectiveSignal(simState);
            const afterNeeds = buildFreshNeeds(simState.player);
            const afterPotential = calcFreshObjectivePotential(simState);
            let delta = after - before;
            delta += (afterPotential.potential - beforePotential.potential) * 0.7;
            delta += (afterPotential.displayPotential - beforePotential.displayPotential) * 0.35;
            if (beforeNeeds.satisfactionNeed <= 0 && afterNeeds.satisfactionExcess > beforeNeeds.satisfactionExcess) {
                delta -= (afterNeeds.satisfactionExcess - beforeNeeds.satisfactionExcess) * 0.5;
            }
            return delta;
        }

        function countKeyword(text, keyword) {
            return (text.match(new RegExp(keyword, 'g')) || []).length;
        }

        function getProCardNameBias(card, needs, turnIndex = game.gameState.turn, stateLike = game.gameState) {
            const name = card?.cardName || '';
            let bias = 0;

            // 低得点群で過多だったカードは抑制
            if (name === '生徒面談の基本') {
                bias -= needs.satisfactionNeed <= 0
                    ? 3.1 + Math.min(needs.satisfactionExcess * 0.15, 1.0)
                    : 1.7;
            }
            if (name === '休み時間トーク' && needs.satisfactionNeed <= 0) {
                bias -= 1.0 + Math.min(needs.satisfactionExcess * 0.08, 0.45);
            }
            if (name === '休み時間トーク' && needs.satisfactionNeed > 0) {
                bias -= 0.35;
            }
            if (name === '日々の出迎え' && needs.satisfactionNeed <= 0) {
                bias -= 0.9 + Math.min(needs.satisfactionExcess * 0.07, 0.35);
            }
            if (name === '補習大会' && needs.satisfactionNeed <= 0) {
                bias -= 0.75;
            }
            if (name === 'ごほうび差し入れスイーツ') {
                bias -= 1.7;
            }
            if (name === '卒業生からの手紙') {
                bias -= 1.25;
            }
            if (name === '兄弟紹介') {
                bias -= 0.95;
            }
            if (name === '苦手発見！質問対応') {
                bias -= 0.9;
            }
            if (name === 'プロジェクター授業') {
                const accountingNow = stateLike?.player?.accounting || 0;
                if (accountingNow < 16) bias -= 1.25;
                if (needs.accountingNeed > 0) bias -= 0.7;
                if (needs.enrollmentDiffNeed < 6) bias -= 0.75;
                if (needs.enrollmentDiffNeed >= 8 && accountingNow >= 17) bias += 1.2;
                if (isProStable) {
                    bias -= 0.6;
                    if (needs.accountingNeed <= 0 && needs.enrollmentDiffNeed >= 8 && accountingNow >= 17) {
                        bias += 0.4;
                    }
                }
            }

            // S+群で優位だったカードは加点
            if (name === '振込用紙印刷') {
                bias += 1.2;
                if (needs.enrollmentDiffNeed > 0) bias += 0.4;
            }
            if (name === '保護者説明会') {
                bias += needs.experienceNeed > 0 ? 1.1 : 0.2;
                if (turnIndex >= 5 && needs.experienceNeed <= 0) bias -= 0.3;
                if (isProStable) bias += 0.2;
            }
            if (name === '入塾手続きのご案内') {
                bias += (needs.enrollmentDiffNeed > 0 || needs.accountingNeed > 0) ? 1.1 : 0.3;
                if (isProStable) bias += 0.2;
            }
            if (name === '備品注文') {
                bias += 0.65;
            }
            if (name === '教室清掃') {
                bias += 0.5;
            }
            if (name === '今だけ！体験生特典') {
                if (needs.accountingNeed > 2) bias -= 0.35;
                else bias += 1.0;
            }
            if (name === '学力確認＆向上 公開模試') {
                if (needs.enrollmentDiffNeed > 6 && needs.accountingNeed <= 1) bias += 0.95;
                if (needs.accountingNeed > 2) bias -= 1.35;
                if (isProStrategic1 && needs.accountingNeed > 2) bias += 0.8;
            }
            if (name === 'できるまで居残り！') {
                if (needs.enrollmentDiffNeed > 8) bias += 0.75;
                if (needs.accountingNeed > 3) bias -= 0.45;
            }
            if (name === '友人紹介') {
                if (needs.satisfactionNeed > 0 && needs.accountingNeed > 1) bias -= 0.55;
                else bias += 0.45;
            }
            if (name === '未入金家庭へ電話') {
                if (needs.accountingNeed > 0) bias += 0.45;
                if (needs.satisfactionNeed > 0) bias -= 0.15;
            }
            if (name === '私も載ったよ！成績UP掲示') {
                bias += 1.35;
                if (needs.satisfactionNeed > 0) bias += 0.35;
                if (turnIndex >= 5 && needs.enrollmentDiffNeed > 0) bias += 0.3;
            }
            if (name === '提出書類ファイリング') {
                bias += 0.65;
            }
            if (name === '機材故障は本部に相談') {
                bias += needs.accountingNeed > 0 ? 0.75 : 0.25;
            }
            if (isProStrategic1) {
                const empiricalBoost = {
                    '振込用紙印刷': 0.85,
                    '教室清掃': 0.7,
                    '友人紹介': 0.55,
                    '進学相談フェア出展': 0.5,
                    '努力の結晶 合格実績掲示': 0.45,
                    '入塾手続きのご案内': 0.5,
                    '私も載ったよ！成績UP掲示': 0.8,
                    '機材故障は本部に相談': 0.65,
                    '宿題チェック': 0.35,
                    'チラシ折り': 0.3
                };
                if (empiricalBoost[name]) bias += empiricalBoost[name];
                if (name === '学力確認＆向上 公開模試') {
                    const experienceNow = stateLike?.player?.experience || 0;
                    const enrollmentNow = stateLike?.player?.enrollment || 0;
                    const expEnrollGap = Math.abs(experienceNow - enrollmentNow);
                    bias += 1.2;
                    if (turnIndex <= 4 && expEnrollGap <= 5) bias += 2.1;
                    if (turnIndex >= 5 && expEnrollGap >= 6) bias += 2.45;
                    if (needs.enrollmentDiffNeed > 0) bias += 1.25;
                    if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0) bias += 1.0;
                    if (needs.accountingNeed > 2) bias -= 0.8;
                }
                if (name === '締切間近の書類リマインド') {
                    bias += turnIndex <= 5 ? 1.25 : 0.45;
                }
                if (name === '笑顔伝わる教室通信' && turnIndex >= 2 && turnIndex <= 5 && needs.satisfactionNeed > 0) {
                    bias += 0.9;
                }
                if (name === '提出書類ファイリング') {
                    bias += turnIndex <= 4 ? 1.0 : 0.3;
                }
                if (name === '人気の秘密は？他塾研究' && turnIndex <= 4) {
                    bias += 1.5;
                }
                if (name === '設問の急所は？教材研究' && turnIndex >= 2) {
                    bias += 1.35;
                }
                if (name === '季節のデコレーション' && turnIndex <= 5) {
                    bias += 0.7;
                }
                if (name === '校門前ビラ配り' && turnIndex >= 4 && needs.satisfactionNeed <= 0) {
                    bias -= 0.8;
                }
                if (name === '質問対応の基本' && turnIndex <= 2) {
                    bias -= 1.15;
                }
            }
            if (isProCompress) {
                if (name === '学力確認＆向上 公開模試') {
                    bias += 3.0;
                    if (needs.enrollmentDiffNeed > 0) bias += 1.2;
                    if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0) bias += 1.4;
                    if (needs.accountingNeed > 2) bias -= 0.6;
                }
                if (name === '締切間近の書類リマインド') {
                    bias += turnIndex <= 5 ? 2.3 : 1.0;
                }
                if (name === '提出書類ファイリング') {
                    bias += turnIndex <= 4 ? 1.1 : 0.3;
                }
                if (name === '私も載ったよ！成績UP掲示') {
                    bias += 1.45;
                }
                if (name === '機材故障は本部に相談') {
                    bias += 0.95;
                }
                if (name === '未入金家庭へ電話') {
                    bias += 0.8;
                }
                if (name === '質問対応の基本' && turnIndex <= 3) {
                    bias -= 1.7;
                }
                if (name === '生徒面談の基本') {
                    bias -= needs.satisfactionNeed <= 0 ? 1.6 : 0.5;
                }
                if (name === 'ごほうび差し入れスイーツ' || name === '卒業生からの手紙' || name === '兄弟紹介' || name === '苦手発見！質問対応') {
                    bias -= 1.4;
                }
                if (isProSpike12) {
                    if (name === '学力確認＆向上 公開模試') bias += 1.4;
                    if (name === '締切間近の書類リマインド' && needs.accountingNeed <= 0 && turnIndex >= 4) bias -= 0.8;
                    if (name === '保護者説明会' && needs.experienceNeed > 0) bias += 1.1;
                    if (name === '入塾後の未来へ 進路説明会' && turnIndex >= 4) bias += 0.7;
                    if (name === 'プロジェクター授業' && needs.accountingNeed <= 1) bias += 0.55;
                    if (name === '休み時間トーク' && needs.satisfactionNeed <= 1 && turnIndex >= 4) bias -= 0.9;
                }
            }
            if (isProExpand) {
                if (name === '人気の秘密は？他塾研究') bias += 2.2;
                if (name === '設問の急所は？教材研究') bias += 1.7;
                if (name === '友人紹介') bias += 1.0;
                if (name === '進学相談フェア出展') bias += 0.95;
                if (name === '締切間近の書類リマインド') bias += turnIndex <= 5 ? 0.9 : 0.3;
                if (name === '学力確認＆向上 公開模試' && turnIndex >= 4) bias += 1.3;
            }

            if (isProStable && turnIndex >= 4 && needs.satisfactionNeed <= 0 && card.category === '応対') {
                bias -= 0.3;
            }
            if (isProAdaptive && turnIndex >= 4 && needs.satisfactionNeed <= 0 && card.category === '応対') {
                bias -= 0.2;
            }
            if (isProUpside && card.rarity === 'SSR') {
                bias += 0.25;
            }

            return bias;
        }

        function scoreProTrainingCard(card, state, turnIndex = game.gameState.turn) {
            const needs = buildProNeeds(state.player);
            const tokenCtx = getTokenSynergyContext(state, turnIndex);
            let score = estimateCardBestSlotValue(card, state, turnIndex);
            score += getCategoryNeedBonus(card, state, turnIndex);
            const thresholdDelta = estimateProThresholdDelta(card, state, turnIndex);
            if (isProCompress) score += thresholdDelta * 0.0;
            else if (isProStrategic1) score += thresholdDelta * 0.0;
            else if (isProExpand) score += thresholdDelta * 0.0;
            else if (isProStable || isProAdaptive || isProSmax || isProHybrid) score += thresholdDelta * 0.0;

            if (card.rarity === 'SSR') score += isProUpside ? 1.1 : isProSmax ? 1.05 : isProAdaptive ? 0.92 : isProHybrid ? 0.95 : isProCompress ? 1.25 : isProExpand ? 1.0 : 0.8;
            else if (card.rarity === 'SR') score += isProSmax ? 0.55 : isProAdaptive ? 0.52 : isProHybrid ? 0.5 : isProCompress ? 0.75 : isProExpand ? 0.6 : 0.45;
            else if (card.rarity === 'N' && turnIndex >= 3) score -= 0.8;
            if (isProStrategic1 && card.rarity === 'SSR') {
                if (card.category === '動員' || card.category === '教務') score += 1.15;
                else score += 0.2;
            }
            if (isProCompress && card.rarity === 'N' && turnIndex >= 2) score -= 1.0;
            if (isProExpand && card.rarity === 'N' && turnIndex >= 5) score -= 0.45;

            if (hasParallelEffect(card)) {
                let parallelBonus = 0.55;
                if (isProStrategic1) {
                    parallelBonus += Math.min(tokenCtx.passionCards * 0.1, 0.75);
                    parallelBonus += Math.max(tokenCtx.tokenPressure, 0) * 0.2;
                    if (turnIndex >= 5) parallelBonus += 0.18;
                    if (tokenCtx.parallelPressure > 0) parallelBonus += 0.2;
                }
                if (isProExpand) {
                    parallelBonus += 1.15;
                    parallelBonus += Math.min(tokenCtx.passionCards * 0.16, 1.2);
                    parallelBonus += Math.max(tokenCtx.tokenPressure, 0) * 0.35;
                }
                if (isProCompress) {
                    parallelBonus -= 0.2;
                }
                score += parallelBonus;
            }

            const text = card.effect || '';
            const passionCount = countKeyword(text, '情熱');
            const inspirationCount = countKeyword(text, '発想');
            const organizeCount = countKeyword(text, '整理');
            const fatigueCount = countKeyword(text, '疲労');
            let passionValue = turnIndex <= 4 ? 1.2 : 0.8;
            let inspirationValue = 1.35;
            let organizeValue = turnIndex >= 3 ? 0.9 : 0.4;
            let fatiguePenalty = isProUpside ? 0.8 : 1.15;
            if (isProStrategic1) {
                passionValue += Math.min(tokenCtx.parallelCards * 0.08, 0.55);
                passionValue += Math.min(tokenCtx.fatigueCards * 0.05, 0.35);
                inspirationValue += Math.min((tokenCtx.ssrCards * 0.08) + (tokenCtx.srCards * 0.04), 0.65);
                organizeValue += Math.min(tokenCtx.nCards * 0.05, 0.5);
                if (turnIndex >= 6) fatiguePenalty *= 0.45;
                if (tokenCtx.passionCards > tokenCtx.fatigueCards) fatiguePenalty *= 0.7;
                if (tokenCtx.tokenPressure > 0) fatiguePenalty *= 0.68;
            }
            if (isProCompress) {
                inspirationValue += 0.45;
                organizeValue += 1.0;
                passionValue *= 0.75;
                fatiguePenalty *= turnIndex >= 6 ? 0.8 : 1.08;
            }
            if (isProExpand) {
                passionValue += 0.85;
                inspirationValue += 0.35;
                organizeValue += 0.2;
                fatiguePenalty *= turnIndex >= 6 ? 0.52 : 0.78;
                if (tokenCtx.passionCards > tokenCtx.fatigueCards) fatiguePenalty *= 0.72;
            }
            score += passionCount * passionValue;
            score += inspirationCount * inspirationValue;
            score += organizeCount * organizeValue;
            score -= fatigueCount * fatiguePenalty;
            if (isProStrategic1) {
                score += inspirationCount * 1.25;
                score += organizeCount * 1.0;
            }
            if (isProCompress) {
                score += inspirationCount * 0.65;
                score += organizeCount * 1.2;
            }
            if (isProExpand) {
                score += passionCount * 0.95;
                score += (hasParallelEffect(card) ? 0.45 : 0);
            }

            if (needs.withdrawal >= 2 && (card.category === '庶務' || card.category === '応対')) score += 1.0;
            const stableBridgeMode = isProStable &&
                needs.withdrawal <= 1 &&
                needs.satisfactionBridgeNeed > 0 &&
                needs.satisfactionBridgeNeed <= 8 &&
                (needs.experienceNeed <= 15 || needs.enrollmentDiffNeed <= 10);
            const adaptiveAttackMode =
                isProAdaptive &&
                needs.withdrawal <= 1 &&
                needs.accountingNeed <= 1 &&
                needs.satisfactionNeed <= 1 &&
                needs.enrollmentDiffNeed > 0;
            if (needs.satisfactionNeed <= 0 && card.category === '応対' && !isProUpside) {
                score -= isProStable
                    ? (stableBridgeMode ? 0.35 : 1.35)
                    : isProSmax ? 0.5 : isProAdaptive ? 0.8 : isProHybrid ? 0.65 : 0.95;
            }
            if (stableBridgeMode && card.category === '応対') {
                score += 1.0;
            }
            if (
                isProStable &&
                needs.withdrawal <= 1 &&
                needs.accountingNeed <= 1 &&
                needs.satisfactionBridgeNeed > 0 &&
                needs.satisfactionBridgeNeed <= 10 &&
                (needs.enrollmentDiffNeed <= 12 || needs.experienceNeed <= 18) &&
                card.category === '応対'
            ) {
                score += 0.45;
            }
            if (adaptiveAttackMode) {
                if (card.category === '教務') score += 0.95;
                if (card.category === '動員') score += 0.45;
                if (card.category === '応対' && needs.satisfactionBridgeNeed <= 0) score -= 0.55;
            }
            if (
                isProHybrid &&
                card.category === '応対' &&
                needs.withdrawal <= 1 &&
                needs.satisfactionBridgeNeed > 0 &&
                (needs.experienceNeed <= 18 || needs.enrollmentDiffNeed <= 14)
            ) {
                score += 0.9 + Math.min(needs.satisfactionBridgeNeed / 6, 1.0);
            }
            if (isProHybrid && card.category === '応対' && needs.satisfactionBridgeNeed <= 0) {
                score -= 0.8;
            }
            if (needs.satisfactionExcess > 0 && card.category === '応対' && !isProUpside) {
                score -= Math.min(0.35 * needs.satisfactionExcess, 2.0);
            }
            if (needs.accountingNeed <= 0 && card.category === '庶務' && !isProStable && !isProAdaptive) score -= 0.55;
            if (needs.accountingExcess > 0 && card.category === '庶務' && !isProStable && !isProAdaptive) {
                score -= Math.min(0.22 * needs.accountingExcess, 1.0);
            }
            if (needs.accountingNeed > 0) {
                const accountingNow = state.player.accounting || 0;
                const accountingPenaltyScale = isProStrategic1
                    ? (isProStrategic1Stable
                        ? 0.78
                        : (turnIndex >= 5 && accountingNow >= 17 ? 0.5 : 0.72))
                    : 1;
                if (text.includes('経-2')) score -= (isProStable ? 1.3 : isProSmax ? 0.9 : isProAdaptive ? 1.0 : 1.05) * accountingPenaltyScale;
                else if (text.includes('経-1')) score -= (isProStable ? 0.85 : isProSmax ? 0.45 : isProAdaptive ? 0.55 : 0.6) * accountingPenaltyScale;
            }
            if (isProCompress) {
                if (card.cardName === '学力確認＆向上 公開模試') score += 2.2;
                if (card.cardName === '締切間近の書類リマインド') score += turnIndex <= 5 ? 1.9 : 0.7;
                if (card.cardName === '提出書類ファイリング' && turnIndex <= 4) score += 0.9;
                if (card.cardName === '私も載ったよ！成績UP掲示') score += 1.1;
                if (card.cardName === '機材故障は本部に相談') score += 0.8;
                if (card.cardName === '未入金家庭へ電話') score += 0.65;
                if (card.cardName === '今だけ！体験生特典') score += 1.0;
                if (card.cardName === '保護者説明会' && needs.experienceNeed > 0) score += 0.85;
                if (card.cardName === 'ごほうび差し入れスイーツ' || card.cardName === '卒業生からの手紙' || card.cardName === '兄弟紹介' || card.cardName === '苦手発見！質問対応') {
                    score -= 1.1;
                }
                if (isProSpike12) {
                    if (card.category === '動員') score += 0.7 + (turnIndex >= 3 ? 0.4 : 0);
                    if (card.category === '教務') score += 1.0 + (turnIndex >= 4 ? 0.7 : 0.2);
                    if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0 && card.category === '教務') score += 1.0;
                    if (needs.accountingNeed <= 1 && (text.includes('経-2') || text.includes('経-1'))) score += 0.55;
                    if (needs.satisfactionNeed <= 1 && card.category === '応対' && turnIndex >= 4) score -= 1.2;
                    if (turnIndex >= 4 && card.rarity === 'N') score -= 0.8;
                }
            }
            if (isProExpand) {
                if (hasParallelEffect(card)) score += 1.0;
                if (text.includes('情熱')) score += 1.25;
                if (text.includes('発想')) score += 0.6;
                if (turnIndex >= 5 && card.category === '教務') score += 0.9;
                if (card.cardName === '学力確認＆向上 公開模試') score += 1.25;
                if (card.cardName === '締切間近の書類リマインド' && turnIndex <= 5) score += 0.6;
            }
            if (isProStrategic1) {
                if (turnIndex <= 2 && card.category === '動員') score += 1.35;
                if (turnIndex >= 2 && turnIndex <= 4 && card.category === '応対') {
                    score += needs.satisfactionNeed > 0 ? 1.2 : -0.4;
                }
                if (turnIndex >= 5 && card.category === '教務') score += 1.4;
                if (turnIndex >= 5 && needs.enrollmentDiffNeed40 > 0 && card.category === '教務') score += 0.85;
                if (turnIndex <= 2 && card.category === '教務') score -= 0.3;
                if (card.cardName === '締切間近の書類リマインド' && turnIndex <= 5) score += 0.9;
                if (card.cardName === '提出書類ファイリング' && turnIndex <= 4) score += 0.7;
                if (card.cardName === '笑顔伝わる教室通信' && turnIndex >= 2 && turnIndex <= 5 && needs.satisfactionNeed > 0) score += 0.85;
                if (card.cardName === '人気の秘密は？他塾研究' && turnIndex <= 4) score += 1.0;
                if (card.cardName === '設問の急所は？教材研究' && turnIndex >= 2) score += 0.95;
                if (card.cardName === '季節のデコレーション' && turnIndex <= 5) score += 0.65;
                if (card.cardName === '質問対応の基本' && turnIndex <= 3) score -= 1.0;
            }
            if (fatigueCount > 0 && turnIndex >= 6) {
                // 終盤は疲労の実害が小さくなるため、評価減を一部打ち消す
                score += fatigueCount * 0.9;
            }
            if (card.category === '支障') score -= 1.4;
            score += getProCardNameBias(card, needs, turnIndex, state);

            return score;
        }

        function pickTrainingCards(cards, count = 1) {
            if (strategyPolicy === 'random') {
                return randomPick(cards, count);
            }

            const turn = game.gameState.turn;
            const scored = cards
                .map((card) => ({
                    card,
                    score: (() => {
                        let score = isProStrategy
                            ? scoreProTrainingCard(card, game.gameState, turn)
                            : estimateCardStaticValue(card, game.gameState, 'leader', turn);
                        if (isFreshAdaptive) {
                            const needs = buildFreshNeeds(game.gameState.player);
                            score += getCategoryNeedBonus(card, game.gameState, turn);

                            // 序盤は体験/入塾に寄せる、中盤以降は退塾抑制も重視
                            if (turn <= 2 && (card.category === '動員' || card.category === '教務')) {
                                score += 1.0;
                            }
                            if (turn >= 4 && (card.category === '庶務' || card.category === '応対')) {
                                score += 0.8;
                            }
                            if (needs.safetyRisk && (card.category === '庶務' || card.category === '応対')) {
                                score += 1.1;
                            }

                            if (needs.satisfactionNeed <= 0 && card.category === '応対') {
                                score -= 0.7 + Math.min(needs.satisfactionExcess * 0.12, 1.4);
                            }
                            if (needs.accountingNeed <= 0 && card.category === '庶務' && needs.enrollmentNeedForS > 0) {
                                score -= 0.35;
                            }

                            // 終盤でS条件未達なら、閾値不足カテゴリをさらに強化
                            if (turn >= 5) {
                                if (needs.experienceNeed > 0 && card.category === '動員') score += 0.8;
                                if (needs.enrollmentNeedForS > 0 && card.category === '教務') score += 1.0;
                                if (needs.withdrawal > 1 && (card.category === '庶務' || card.category === '応対')) score += 1.2;
                                if (needs.accountingNeed > needs.satisfactionNeed && card.category === '庶務') score += 0.7;
                                if (needs.satisfactionNeed > needs.accountingNeed && card.category === '応対') score += 0.4;
                            }

                            if (isDeepBeam) {
                                if (card.rarity === 'SSR') score += 0.55;
                                if (card.rarity === 'SR') score += 0.3;
                            }
                            if (isDeepBeamSatCap && needs.satisfactionNeed <= 0 && card.category === '応対') {
                                score -= 1.1;
                            }
                            if (isFreshS50) {
                                score += estimateObjectiveDelta(card, game.gameState, 'leader') * 2.2;
                                if (card.rarity === 'SSR') score += 0.55;
                                else if (card.rarity === 'SR') score += 0.3;
                                else if (card.rarity === 'N' && turn >= 3) score -= 1.0;
                                if (needs.satisfactionNeed <= 0 && card.category === '応対') {
                                    score -= 1.7;
                                }
                                if (needs.accountingNeed <= 0 && card.category === '庶務' && needs.enrollmentNeedForS > 0) {
                                    score -= 0.6;
                                }
                                if (needs.accountingNeed > 0 && card.category === '庶務') {
                                    score += 1.25;
                                }
                                if (needs.accountingNeed > needs.satisfactionNeed && card.category === '応対' && needs.satisfactionNeed <= 1) {
                                    score -= 0.9;
                                }
                                if (turn >= 5 && needs.enrollmentNeedForS > 0 && card.category === '教務') {
                                    score += 1.4;
                                }
                                if (turn >= 5 && needs.experienceNeed > 0 && card.category === '動員') {
                                    score += 1.0;
                                }
                            }
                            if (isFreshStable) {
                                score += estimateObjectiveDelta(card, game.gameState, 'leader') * 1.75;
                                if (needs.withdrawal > 1 && (card.category === '庶務' || card.category === '応対')) score += 1.2;
                                if (needs.accountingNeed > 0 && card.category === '庶務') score += 1.0;
                                if (needs.satisfactionNeed > 0 && card.category === '応対') score += 0.9;
                                if (needs.satisfactionNeed <= 0 && card.category === '応対') score -= 0.6;
                                if (needs.enrollmentNeedForS > 0 && card.category === '教務') score += 1.1;
                                if (needs.experienceNeed > 0 && card.category === '動員') score += 0.6;
                                if (needs.accountingNeed <= 0 && card.category === '庶務' && needs.enrollmentNeedForS > 0) score -= 0.8;
                                if (card.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) {
                                    score -= 0.6;
                                }
                            }
                            if (isFreshStableClassic) {
                                score += estimateObjectiveDelta(card, game.gameState, 'leader') * 1.75;
                                if (needs.withdrawal > 1 && (card.category === '庶務' || card.category === '応対')) score += 1.2;
                                if (needs.accountingNeed > 0 && card.category === '庶務') score += 1.0;
                                if (needs.satisfactionNeed > 0 && card.category === '応対') score += 0.9;
                                if (needs.satisfactionNeed <= 0 && card.category === '応対') score -= 0.6;
                                if (card.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) {
                                    score -= 0.6;
                                }
                            }
                            if (isFreshStablePush) {
                                score += estimateObjectiveDelta(card, game.gameState, 'leader') * 1.85;
                                if (needs.withdrawal > 1 && (card.category === '庶務' || card.category === '応対')) score += 1.1;
                                if (needs.accountingNeed > 0 && card.category === '庶務') score += 1.0;
                                if (needs.satisfactionNeed > 0 && card.category === '応対') score += 0.8;
                                if (needs.satisfactionNeed <= 0 && card.category === '応対') score -= 0.9;
                                if (needs.enrollmentNeedForS > 0 && card.category === '教務') score += 1.0;
                                if (needs.experienceNeed > 0 && card.category === '動員') score += 0.55;
                                if (needs.accountingNeed <= 0 && card.category === '庶務' && needs.enrollmentNeedForS > 0) score -= 0.7;
                                if (card.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) {
                                    score -= 0.7;
                                }
                            }
                            if (isFreshUpside) {
                                score += estimateObjectiveDelta(card, game.gameState, 'leader') * 1.95;
                                if (card.rarity === 'SSR') score += 0.9;
                                if (card.rarity === 'SR') score += 0.5;
                                if (turn >= 4 && card.rarity === 'N') score -= 1.0;
                                if (needs.enrollmentNeedForS > 0 && card.category === '教務') score += 1.4;
                                if (needs.experienceNeed > 0 && card.category === '動員') score += 1.0;
                                if (needs.satisfactionNeed <= 0 && card.category === '応対') score -= 1.15;
                                if (needs.accountingNeed <= 0 && card.category === '庶務' && needs.enrollmentNeedForS > 0) score -= 0.6;
                            }
                        }
                        return score;
                    })()
                }))
                .sort((a, b) => b.score - a.score);

            return scored.slice(0, count).map((x) => x.card);
        }

        function scoreTrainingCardByPolicy(card, turnIndex = game.gameState.turn) {
            return isProStrategy
                ? scoreProTrainingCard(card, game.gameState, turnIndex)
                : estimateCardStaticValue(card, game.gameState, 'leader', turnIndex);
        }

        function evaluateTrainingPackScore(cards, pickCount, turnIndex = game.gameState.turn) {
            if (!Array.isArray(cards) || cards.length === 0) return -999;
            const picked = pickTrainingCards(cards, pickCount);
            if (picked.length === 0) return -999;
            return picked.reduce((acc, card) => acc + scoreTrainingCardByPolicy(card, turnIndex), 0);
        }

        function estimateRarityTopScore(rarity, pickCount, turnIndex = game.gameState.turn) {
            const deck = game.cardManager.trainingDecks?.[rarity] || [];
            if (deck.length === 0) return -999;
            const uniqueByName = new Map();
            deck.forEach((card) => {
                if (!card?.cardName) return;
                if (!uniqueByName.has(card.cardName)) uniqueByName.set(card.cardName, card);
            });
            const scores = [...uniqueByName.values()]
                .map((card) => scoreTrainingCardByPolicy(card, turnIndex))
                .sort((a, b) => b - a);
            if (scores.length === 0) return -999;
            const take = Math.max(1, Math.min(pickCount, scores.length));
            let total = 0;
            for (let i = 0; i < take; i += 1) total += scores[i];
            return total;
        }

        function estimateRarityReferenceScore(rarity, pickCount, turnIndex = game.gameState.turn) {
            const deck = game.cardManager.trainingDecks?.[rarity] || [];
            if (deck.length === 0) return -999;
            const uniqueByName = new Map();
            deck.forEach((card) => {
                if (!card?.cardName) return;
                if (!uniqueByName.has(card.cardName)) uniqueByName.set(card.cardName, card);
            });
            const scores = [...uniqueByName.values()]
                .map((card) => scoreTrainingCardByPolicy(card, turnIndex))
                .sort((a, b) => b - a);
            if (scores.length === 0) return -999;

            // 上位平均を基準にし、常時リフレッシュを避ける
            const topRatio = isProUpside ? 0.22 : isProSpike12 ? 0.16 : isProCompress ? 0.2 : isProExpand ? 0.25 : isProStable ? 0.35 : isProAdaptive ? 0.3 : 0.28;
            const take = Math.max(2, Math.min(scores.length, Math.ceil(scores.length * topRatio)));
            let sum = 0;
            for (let i = 0; i < take; i += 1) sum += scores[i];
            const perPickRef = sum / take;
            return perPickRef * Math.max(1, pickCount);
        }

        function maybeRefreshTrainingCandidates({ rarity, candidates, drawCount, pickCount, phaseTag }) {
            if (!isProStrategy || rarity === 'N') {
                return candidates;
            }
            if (isProRefreshless) {
                return candidates;
            }

            const turnIndex = game.gameState.turn;
            const refreshCapsByPhase = isProUpside
                ? { initial: 2, main: 1, inspiration: 1 }
                : isProSpike12
                    ? { initial: 2, main: 6, inspiration: 2 }
                : isProCompress
                    ? { initial: 1, main: 5, inspiration: 2 }
                : isProExpand
                    ? { initial: 1, main: 4, inspiration: 2 }
                : isProStrategic1
                    ? (isProStrategic1Upside
                        ? { initial: 1, main: 4, inspiration: 2 }
                        : isProStrategic1Stable
                            ? { initial: 1, main: 4, inspiration: 2 }
                            : { initial: 1, main: 3, inspiration: 1 })
                : isProRefreshInit
                    ? { initial: 1, main: 0, inspiration: 0 }
                    : isProStable
                        ? { initial: 1, main: 1, inspiration: 0 }
                    : isProAdaptive
                        ? { initial: 1, main: 1, inspiration: 0 }
                : isProSmax
                    ? { initial: 2, main: 1, inspiration: 1 }
                    : isProHybrid
                        ? { initial: 1, main: 1, inspiration: 1 }
                    : { initial: 1, main: 1, inspiration: 1 };
            const allowedByPhase = refreshCapsByPhase[phaseTag] ?? 0;
            const usedByPhase = episodeRefreshUsage[phaseTag] || 0;
            if (usedByPhase >= allowedByPhase) {
                return candidates;
            }

            let current = candidates;
            while ((game.gameState.trainingRefreshRemaining || 0) > 0 && (episodeRefreshUsage[phaseTag] || 0) < allowedByPhase) {
                const currentScore = evaluateTrainingPackScore(current, pickCount);
                const expectedRefScore = estimateRarityReferenceScore(rarity, pickCount, turnIndex);
                const expectedTopScore = estimateRarityTopScore(rarity, pickCount, turnIndex);
                const turnTighten = turnIndex >= 5 ? 0.4 : 0;
                const strategicMargin = isProStrategic1Upside
                    ? (phaseTag === 'initial' ? 0.3 : phaseTag === 'main' ? 0.05 : 0.12)
                    : isProStrategic1Stable
                        ? (phaseTag === 'initial' ? 0.34 : phaseTag === 'main' ? 0.07 : 0.14)
                        : (phaseTag === 'initial' ? 0.45 : phaseTag === 'main' ? 0.1 : 0.2);
                const margin = (isProUpside ? 0.45 : isProSpike12 ? -0.08 : isProCompress ? 0.08 : isProExpand ? 0.16 : isProStrategic1 ? strategicMargin : isProStable ? 0.32 : isProAdaptive ? 0.5 : isProSmax ? 0.4 : isProHybrid ? 0.34 : 0.36) + turnTighten;
                const refGap = expectedRefScore - currentScore;
                const topGap = expectedTopScore - currentScore;
                if (refGap <= margin && topGap <= (margin + 1.2)) break;

                const refreshed = game.cardManager.refreshTrainingCards(rarity, current, drawCount);
                if (!Array.isArray(refreshed) || refreshed.length === 0) break;
                current = refreshed;
                game.gameState.trainingRefreshRemaining -= 1;
                episodeRefreshUsage[phaseTag] = (episodeRefreshUsage[phaseTag] || 0) + 1;
                decisionTelemetry.training.refreshUsed += 1;
                decisionTelemetry.training.refreshByPhase[phaseTag] = (decisionTelemetry.training.refreshByPhase[phaseTag] || 0) + 1;
            }
            return current;
        }

        function planPlacementsBeamLike(mode) {
            const handCards = [...game.gameState.player.hand];
            if (handCards.length === 0) return [];

            let maxDepth = 3;
            let beamWidth = 1;
            if (mode === 'beam') {
                maxDepth = 5;
                beamWidth = 88;
            } else if (mode === 'deep_beam') {
                maxDepth = 7;
                beamWidth = 240;
            } else if (mode === 'deep_beam_satcap') {
                maxDepth = 7;
                beamWidth = 220;
            } else if (mode === 'fresh_s50') {
                maxDepth = 7;
                beamWidth = 280;
            } else if (mode === 'fresh_stable') {
                maxDepth = 7;
                beamWidth = 240;
            } else if (mode === 'fresh_stable_classic') {
                maxDepth = 7;
                beamWidth = 240;
            } else if (mode === 'fresh_stable_push') {
                maxDepth = 7;
                beamWidth = 280;
            } else if (mode === 'fresh_upside') {
                maxDepth = 7;
                beamWidth = 300;
            } else if (mode === 'fresh_adaptive') {
                maxDepth = 7;
                beamWidth = 220;
            } else if (mode === 'fresh_rule_nonly') {
                maxDepth = 5;
                beamWidth = 56;
            } else if (mode === 'pro_foundation') {
                maxDepth = 7;
                beamWidth = 320;
            } else if (mode === 'pro_stable') {
                maxDepth = 8;
                beamWidth = 520;
            } else if (mode === 'pro_stable_refreshless') {
                maxDepth = 8;
                beamWidth = 520;
            } else if (mode === 'pro_stable_refresh_init') {
                maxDepth = 8;
                beamWidth = 520;
            } else if (mode === 'pro_nonly') {
                maxDepth = 8;
                beamWidth = 520;
            } else if (mode === 'pro_nonly_refreshless') {
                maxDepth = 8;
                beamWidth = 520;
            } else if (mode === 'pro_strategic1') {
                maxDepth = 8;
                beamWidth = 620;
            } else if (mode === 'pro_strategic1_stable') {
                maxDepth = 8;
                beamWidth = 640;
            } else if (mode === 'pro_strategic1_upside') {
                maxDepth = 8;
                beamWidth = 760;
            } else if (mode === 'pro_compress') {
                maxDepth = 8;
                beamWidth = 980;
            } else if (mode === 'pro_spike12') {
                maxDepth = 8;
                beamWidth = 1200;
            } else if (mode === 'pro_expand') {
                maxDepth = 8;
                beamWidth = 820;
            } else if (mode === 'pro_adaptive') {
                maxDepth = 8;
                beamWidth = 540;
            } else if (mode === 'pro_adaptive_nonly') {
                maxDepth = 8;
                beamWidth = 540;
            } else if (mode === 'pro_smax') {
                maxDepth = 8;
                beamWidth = 540;
            } else if (mode === 'pro_hybrid') {
                maxDepth = 7;
                beamWidth = 350;
            } else if (mode === 'pro_upside') {
                maxDepth = 7;
                beamWidth = 360;
            }
            maxDepth = Math.min(maxDepth, handCards.length);
            const baseState = cloneForSimulation(game.gameState);
            const initialPlacedCounts = {
                leader: game.gameState.player.placed.leader?.length || 0,
                teacher: game.gameState.player.placed.teacher?.length || 0,
                staff: game.gameState.player.placed.staff?.length || 0
            };

            let frontier = [{
                score: 0,
                seq: [],
                used: Array(handCards.length).fill(false),
                simState: baseState,
                recommendedByStaff: { leader: false, teacher: false, staff: false },
                placedCounts: initialPlacedCounts
            }];

            for (let depth = 0; depth < maxDepth; depth += 1) {
                const expanded = [];

                frontier.forEach((node) => {
                    // 途中停止も許容
                    expanded.push(node);
                    const options = enumeratePlacementOptions(handCards, node.placedCounts)
                        .filter((option) => !node.used[option.cardIndex]);

                    options.forEach(({ cardIndex, card, slot }) => {
                        const moved = transitionPlacement(
                            node.simState,
                            card,
                            slot,
                            node.recommendedByStaff,
                            node.placedCounts
                        );
                        if (!moved) return;

                        const nextUsed = [...node.used];
                        nextUsed[cardIndex] = true;

                        expanded.push({
                            score: node.score + moved.stepScore + (
                                mode === 'deep_beam' ? 0.18
                                    : mode === 'deep_beam_satcap' ? 0.16
                                    : mode === 'fresh_s50' ? 0.22
                                    : mode === 'fresh_stable' ? 0.17
                                    : mode === 'fresh_stable_classic' ? 0.17
                                    : mode === 'fresh_stable_push' ? 0.19
                                    : mode === 'fresh_upside' ? 0.24
                                    : mode === 'pro_strategic1' ? 0.2
                                    : mode === 'pro_strategic1_stable' ? 0.19
                                    : mode === 'pro_strategic1_upside' ? 0.24
                                    : mode === 'pro_compress' ? 0.22
                                    : mode === 'pro_expand' ? 0.26
                                    : mode === 'pro_upside' ? 0.2
                                    : mode === 'pro_smax' ? 0.21
                                    : mode === 'pro_adaptive' ? 0.17
                                    : mode === 'pro_hybrid' ? 0.18
                                    : mode === 'pro_stable' ? 0.14
                                    : mode === 'beam' ? 0.12
                                        : mode === 'fresh_adaptive' ? 0.25 : 0.16
                            ),
                            seq: [...node.seq, { cardIndex, slot }],
                            used: nextUsed,
                            simState: moved.simState,
                            recommendedByStaff: moved.recommendedByStaff,
                            placedCounts: moved.placedCounts
                        });
                    });
                });

                expanded.sort((a, b) => b.score - a.score);
                frontier = expanded.slice(0, beamWidth);
                if (frontier.length === 0) break;
            }

            frontier.sort((a, b) => b.score - a.score);
            return frontier[0]?.seq || [];
        }

        function performActionPlacement() {
            const placements = [];
            const startCounts = {
                leader: game.gameState.player.placed.leader?.length || 0,
                teacher: game.gameState.player.placed.teacher?.length || 0,
                staff: game.gameState.player.placed.staff?.length || 0
            };
            const startOptions = enumeratePlacementOptions([...game.gameState.player.hand], startCounts).length;
            decisionTelemetry.action.phaseCount += 1;
            decisionTelemetry.action.optionCountTotal += startOptions;

            if (strategyPolicy === 'random') {
                let guard = 0;
                while (guard < 24) {
                    guard += 1;
                    const currentCounts = {
                        leader: game.gameState.player.placed.leader?.length || 0,
                        teacher: game.gameState.player.placed.teacher?.length || 0,
                        staff: game.gameState.player.placed.staff?.length || 0
                    };
                    const options = enumeratePlacementOptions([...game.gameState.player.hand], currentCounts)
                        .map((opt) => ({ card: opt.card, slot: opt.slot }));

                    if (options.length === 0) break;
                    const selected = options[Math.floor(Math.random() * options.length)];
                    game.gameState.placeCard(selected.card, selected.slot);
                    game.gameState.removeFromHand(selected.card);
                    placements.push({ cardName: selected.card.cardName, slot: selected.slot });
                    if (hasParallelEffect(selected.card)) decisionTelemetry.action.parallelPlacements += 1;

                    if (Math.random() < 0.35) break;
                }
                decisionTelemetry.action.placedCards += placements.length;
                return placements;
            }

            const seq = planPlacementsBeamLike(strategyPolicy);
            const handCards = [...game.gameState.player.hand];

            seq.forEach((step) => {
                const card = handCards[step.cardIndex];
                if (!card) return;
                if (!game.gameState.player.hand.includes(card)) return;
                if (!canPlaceCurrent(card, step.slot)) return;

                game.gameState.placeCard(card, step.slot);
                game.gameState.removeFromHand(card);
                placements.push({ cardName: card.cardName, slot: step.slot });
                if (hasParallelEffect(card)) decisionTelemetry.action.parallelPlacements += 1;
            });

            decisionTelemetry.action.placedCards += placements.length;
            return placements;
        }

        function performMeetingDeletion() {
            const deleteMax = game.turnManager.getCurrentDeleteMax();
            decisionTelemetry.meeting.phaseCount += 1;
            if (deleteMax <= 0 || game.gameState.player.deck.length === 0) {
                game.gameState.tokens.organize = 0;
                return [];
            }

            let candidates = [...game.gameState.player.deck];
            decisionTelemetry.meeting.optionCountTotal += candidates.length + 1;
            if (isRuleNOnly) {
                candidates = candidates.filter((card) => card.rarity === 'N');
                if (candidates.length === 0) {
                    game.gameState.tokens.organize = 0;
                    return [];
                }
            }
            const turn = game.gameState.turn;
            if (strategyPolicy === 'random') {
                candidates = randomPick(candidates, candidates.length);
            } else {
                candidates.sort((a, b) => {
                    let va = estimateCardStaticValue(a, game.gameState, 'leader', turn);
                    let vb = estimateCardStaticValue(b, game.gameState, 'leader', turn);

                    if (isFreshAdaptive) {
                        const needs = buildFreshNeeds(game.gameState.player);
                        if (a.rarity === 'N') va -= 1.0;
                        if (b.rarity === 'N') vb -= 1.0;
                        if (a.rarity === 'SR' || a.rarity === 'SSR') va += 0.5;
                        if (b.rarity === 'SR' || b.rarity === 'SSR') vb += 0.5;
                        if (turn >= 5 && (a.category === '動員')) va -= 0.4;
                        if (turn >= 5 && (b.category === '動員')) vb -= 0.4;
                        if (needs.safetyRisk && (a.category === '庶務' || a.category === '応対')) va += 0.9;
                        if (needs.safetyRisk && (b.category === '庶務' || b.category === '応対')) vb += 0.9;
                        if (needs.satisfactionNeed <= 0 && a.category === '応対') va -= 0.7;
                        if (needs.satisfactionNeed <= 0 && b.category === '応対') vb -= 0.7;
                        if (isFreshS50) {
                            if (a.rarity === 'SSR') va += 0.9;
                            if (b.rarity === 'SSR') vb += 0.9;
                            if (a.rarity === 'SR') va += 0.4;
                            if (b.rarity === 'SR') vb += 0.4;
                            if (turn >= 4 && a.rarity === 'N') va -= 0.8;
                            if (turn >= 4 && b.rarity === 'N') vb -= 0.8;
                            if (needs.satisfactionNeed <= 0 && a.category === '応対') va -= 1.2;
                            if (needs.satisfactionNeed <= 0 && b.category === '応対') vb -= 1.2;
                            if (needs.accountingNeed <= 0 && a.category === '庶務') va -= 0.55;
                            if (needs.accountingNeed <= 0 && b.category === '庶務') vb -= 0.55;
                            if (needs.accountingNeed > 0 && a.category === '庶務') va += 1.0;
                            if (needs.accountingNeed > 0 && b.category === '庶務') vb += 1.0;
                            if (needs.enrollmentNeedForS > 0 && a.category === '教務') va += 1.0;
                            if (needs.enrollmentNeedForS > 0 && b.category === '教務') vb += 1.0;
                            if (needs.experienceNeed > 0 && a.category === '動員') va += 0.7;
                            if (needs.experienceNeed > 0 && b.category === '動員') vb += 0.7;
                        }
                        if (isFreshStable) {
                            if (needs.withdrawal > 1 && (a.category === '庶務' || a.category === '応対')) va += 1.2;
                            if (needs.withdrawal > 1 && (b.category === '庶務' || b.category === '応対')) vb += 1.2;
                            if (needs.accountingNeed > 0 && a.category === '庶務') va += 1.0;
                            if (needs.accountingNeed > 0 && b.category === '庶務') vb += 1.0;
                            if (needs.satisfactionNeed > 0 && a.category === '応対') va += 0.9;
                            if (needs.satisfactionNeed > 0 && b.category === '応対') vb += 0.9;
                            if (needs.satisfactionNeed <= 0 && a.category === '応対') va -= 0.8;
                            if (needs.satisfactionNeed <= 0 && b.category === '応対') vb -= 0.8;
                            if (needs.enrollmentNeedForS > 0 && a.category === '教務') va += 0.9;
                            if (needs.enrollmentNeedForS > 0 && b.category === '教務') vb += 0.9;
                            if (needs.accountingNeed <= 0 && a.category === '庶務' && needs.enrollmentNeedForS > 0) va -= 0.7;
                            if (needs.accountingNeed <= 0 && b.category === '庶務' && needs.enrollmentNeedForS > 0) vb -= 0.7;
                            if (a.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) va -= 0.6;
                            if (b.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) vb -= 0.6;
                        }
                        if (isFreshStableClassic) {
                            if (needs.withdrawal > 1 && (a.category === '庶務' || a.category === '応対')) va += 1.2;
                            if (needs.withdrawal > 1 && (b.category === '庶務' || b.category === '応対')) vb += 1.2;
                            if (needs.accountingNeed > 0 && a.category === '庶務') va += 1.0;
                            if (needs.accountingNeed > 0 && b.category === '庶務') vb += 1.0;
                            if (needs.satisfactionNeed > 0 && a.category === '応対') va += 0.9;
                            if (needs.satisfactionNeed > 0 && b.category === '応対') vb += 0.9;
                            if (needs.satisfactionNeed <= 0 && a.category === '応対') va -= 0.8;
                            if (needs.satisfactionNeed <= 0 && b.category === '応対') vb -= 0.8;
                            if (a.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) va -= 0.6;
                            if (b.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) vb -= 0.6;
                        }
                        if (isFreshStablePush) {
                            if (needs.withdrawal > 1 && (a.category === '庶務' || a.category === '応対')) va += 1.1;
                            if (needs.withdrawal > 1 && (b.category === '庶務' || b.category === '応対')) vb += 1.1;
                            if (needs.accountingNeed > 0 && a.category === '庶務') va += 1.0;
                            if (needs.accountingNeed > 0 && b.category === '庶務') vb += 1.0;
                            if (needs.satisfactionNeed > 0 && a.category === '応対') va += 0.8;
                            if (needs.satisfactionNeed > 0 && b.category === '応対') vb += 0.8;
                            if (needs.satisfactionNeed <= 0 && a.category === '応対') va -= 1.0;
                            if (needs.satisfactionNeed <= 0 && b.category === '応対') vb -= 1.0;
                            if (needs.enrollmentNeedForS > 0 && a.category === '教務') va += 0.9;
                            if (needs.enrollmentNeedForS > 0 && b.category === '教務') vb += 0.9;
                            if (needs.accountingNeed <= 0 && a.category === '庶務' && needs.enrollmentNeedForS > 0) va -= 0.7;
                            if (needs.accountingNeed <= 0 && b.category === '庶務' && needs.enrollmentNeedForS > 0) vb -= 0.7;
                            if (a.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) va -= 0.7;
                            if (b.rarity === 'N' && turn >= 4 && needs.accountingNeed <= 0 && needs.satisfactionNeed <= 0) vb -= 0.7;
                        }
                        if (isFreshUpside) {
                            if (a.rarity === 'SSR') va += 1.1;
                            if (b.rarity === 'SSR') vb += 1.1;
                            if (a.rarity === 'SR') va += 0.6;
                            if (b.rarity === 'SR') vb += 0.6;
                            if (turn >= 4 && a.rarity === 'N') va -= 1.0;
                            if (turn >= 4 && b.rarity === 'N') vb -= 1.0;
                            if (needs.enrollmentNeedForS > 0 && a.category === '教務') va += 1.3;
                            if (needs.enrollmentNeedForS > 0 && b.category === '教務') vb += 1.3;
                            if (needs.experienceNeed > 0 && a.category === '動員') va += 0.9;
                            if (needs.experienceNeed > 0 && b.category === '動員') vb += 0.9;
                            if (needs.satisfactionNeed <= 0 && a.category === '応対') va -= 1.2;
                            if (needs.satisfactionNeed <= 0 && b.category === '応対') vb -= 1.2;
                        }
                    }

                    return va - vb; // 低価値を先に削除
                });
            }

            let toDelete = candidates.slice(0, deleteMax);
            if (isProStrategy && strategyPolicy !== 'random') {
                const needs = buildProNeeds(game.gameState.player);
                const tokenCtx = getTokenSynergyContext(game.gameState, turn);
                const threshold = isProSpike12 ? 3.6 : isProCompress ? 3.1 : isProExpand ? 1.6 : isProStable ? 1.25 : isProAdaptive ? 1.35 : isProUpside ? 1.8 : isProSmax ? 1.7 : isProHybrid ? 1.55 : isProStrategic1 ? 2.1 : 1.45;
                const scoredForDeletion = candidates.map((card) => {
                    let value = scoreProTrainingCard(card, game.gameState, turn);
                    const accountingNow = game.gameState.player.accounting || 0;
                    if (card.rarity === 'N') value -= 0.8;
                    if (card.rarity === 'R') value -= 0.25;
                    if (needs.satisfactionNeed <= 0 && card.category === '応対') value -= 1.2;
                    if (needs.satisfactionExcess > 2 && card.category === '応対') value -= 0.9;
                    if (needs.accountingNeed <= 0 && card.category === '庶務') value -= 0.8;
                    if (needs.accountingExcess > 2 && card.category === '庶務') value -= 0.55;
                    if (needs.enrollmentDiffNeed > 0 && card.category === '動員' && card.rarity === 'N') value -= 0.4;
                    value += getProCardNameBias(card, needs, turn, game.gameState);
                    if (card.cardName === '生徒面談の基本') value -= 2.0;
                    if (card.cardName === '休み時間トーク' && needs.satisfactionNeed <= 0) value -= 0.8;
                    if (card.cardName === '日々の出迎え' && needs.satisfactionNeed <= 0) value -= 0.7;
                    if (card.cardName === 'プロジェクター授業' && (needs.accountingNeed > 0 || accountingNow < 16 || needs.enrollmentDiffNeed < 6)) value -= 1.1;
                    if (card.cardName === '入塾手続きのご案内' && (needs.enrollmentDiffNeed > 0 || needs.accountingNeed > 0)) value += 0.5;
                    if (isProCompress) {
                        const text = card.effect || '';
                        const isMock = card.cardName === '学力確認＆向上 公開模試';
                        const isReminder = card.cardName === '締切間近の書類リマインド';
                        if (isMock) value += 5.0;
                        if (isReminder) value += 3.9;
                        if (card.cardName === '提出書類ファイリング') value += 1.9;
                        if (card.cardName === '私も載ったよ！成績UP掲示') value += 2.4;
                        if (card.cardName === '機材故障は本部に相談') value += 1.5;
                        if (card.cardName === '未入金家庭へ電話') value += 1.1;
                        if (text.includes('整理')) value += 2.0;
                        if (text.includes('発想')) value += 1.1;
                        if (text.includes('並行')) value -= 0.35;
                        if (card.cardName === 'ごほうび差し入れスイーツ' || card.cardName === '卒業生からの手紙' || card.cardName === '兄弟紹介' || card.cardName === '苦手発見！質問対応') {
                            value -= 2.1;
                        }
                        if (!isMock && !isReminder && !text.includes('整理') && !text.includes('発想')) {
                            value -= card.rarity === 'SSR' ? 0.4 : card.rarity === 'SR' ? 0.8 : 1.3;
                        }
                        if (turn >= 3 && card.category === '応対' && needs.satisfactionNeed <= 0) value -= 1.2;
                        if (isProSpike12) {
                            if (turn >= 4 && card.category === '応対' && needs.satisfactionNeed <= 1) value -= 1.4;
                            if (card.category === '教務') value += 0.7;
                            if (card.category === '動員' && turn <= 4) value += 0.35;
                            if (!isMock && !isReminder && card.category !== '教務' && card.category !== '動員' && !text.includes('整理')) {
                                value -= 0.8;
                            }
                        }
                    }
                    if (isProExpand) {
                        const text = card.effect || '';
                        if (hasParallelEffect(card)) value += 2.3;
                        if (text.includes('情熱')) value += 2.0;
                        if (text.includes('発想')) value += 0.9;
                        if (text.includes('整理')) value += 0.3;
                        if (!hasParallelEffect(card) && !text.includes('情熱') && !text.includes('発想')) {
                            value -= card.rarity === 'N' ? 0.9 : card.rarity === 'R' ? 0.4 : 0;
                        }
                    }
                    if (isProStrategic1) {
                        const text = card.effect || '';
                        if (turn <= 2 && card.category === '教務') value -= card.rarity === 'N' ? 2.1 : 0.8;
                        if (turn <= 3 && card.category === '動員') value += 0.45;
                        if (turn >= 3 && turn <= 5 && card.category === '応対' && needs.satisfactionNeed > 0) value += 0.55;
                        if (turn >= 5 && card.category === '教務') value += 0.75;
                        if (turn >= 5 && needs.enrollmentDiffNeed40 > 0 && card.category === '教務') value += 0.8;
                        if (card.cardName === '学力確認＆向上 公開模試' && turn >= 4 && needs.enrollmentDiffNeed > 0 && needs.accountingNeed <= 1) value += 1.5;
                        if (turn >= 5 && card.category === '応対' && needs.satisfactionNeed <= 0) value -= 0.75;
                        if (text.includes('発想') || text.includes('整理')) value += 1.25;
                        if (card.cardName === '質問対応の基本' && turn <= 3) value -= 2.2;
                        if (card.cardName === '経理精算の基本' && turn >= 5 && needs.accountingNeed <= 0) value -= 0.9;
                        if (card.cardName === '生徒面談の基本' && needs.satisfactionNeed <= 0) value -= 1.5;
                        if (card.rarity === 'N' && turn >= 2) value -= 0.4;
                        if (text.includes('情熱') && tokenCtx.parallelCards > 0) value += 0.9;
                        if (text.includes('疲労')) {
                            if (turn >= 6 || tokenCtx.passionCards > tokenCtx.fatigueCards || tokenCtx.tokenPressure > 0) value += 0.7;
                            else if (turn <= 3) value -= 1.1;
                        }
                    }
                    if (card.category === '支障') value -= 2.0;
                    return { card, value };
                }).sort((a, b) => a.value - b.value);

                const filtered = [];
                for (const { card, value } of scoredForDeletion) {
                    if (filtered.length >= deleteMax) break;
                    const keepHighRarity = (card.rarity === 'SSR' || card.rarity === 'SR') && value >= (threshold - 0.15);
                    if (value < threshold && !keepHighRarity) {
                        filtered.push(card);
                    }
                }
                if (isProCompress && filtered.length < deleteMax) {
                    for (const { card } of scoredForDeletion) {
                        if (filtered.length >= deleteMax) break;
                        if (filtered.includes(card)) continue;
                        if (card.cardName === '学力確認＆向上 公開模試') continue;
                        if (card.cardName === '締切間近の書類リマインド') continue;
                        filtered.push(card);
                    }
                }
                toDelete = filtered;
            }
            toDelete.forEach((card) => {
                game.gameState.removeFromDeck(card);
            });
            decisionTelemetry.meeting.deletedCards += toDelete.length;

            game.gameState.tokens.organize = 0;
            return toDelete.map((card) => card.cardName);
        }

        function ensureCardStat(map, cardName) {
            if (!map[cardName]) {
                map[cardName] = {
                    plays: 0,
                    totalDelta: {
                        experience: 0,
                        enrollment: 0,
                        satisfaction: 0,
                        accounting: 0
                    },
                    appearedEpisodes: 0,
                    totalEpisodeScore: 0
                };
            }
            return map[cardName];
        }

        function calcQuantile(sortedArr, ratio) {
            if (sortedArr.length === 0) return 0;
            const idx = Math.max(0, Math.min(sortedArr.length - 1, Math.floor((sortedArr.length - 1) * ratio)));
            return sortedArr[idx];
        }

        function bumpCounter(map, key, delta = 1) {
            if (!key) return;
            map[key] = (map[key] || 0) + delta;
        }

        function collectFinalHoldingCards(player) {
            const holdings = [];
            (player.deck || []).forEach((card) => holdings.push(card));
            (player.hand || []).forEach((card) => holdings.push(card));
            SLOT_KEYS.forEach((slot) => {
                (player.placed?.[slot] || []).forEach((card) => holdings.push(card));
            });
            return holdings;
        }

        function buildBalanceRows(observedCounts, baselineCounts) {
            const keys = new Set([...Object.keys(baselineCounts || {}), ...Object.keys(observedCounts || {})]);
            const observedTotal = Object.values(observedCounts || {}).reduce((acc, v) => acc + v, 0);
            const baselineTotal = Object.values(baselineCounts || {}).reduce((acc, v) => acc + v, 0);
            return [...keys]
                .map((key) => {
                    const observed = observedCounts?.[key] || 0;
                    const baseline = baselineCounts?.[key] || 0;
                    const observedShare = observedTotal > 0 ? observed / observedTotal : 0;
                    const baselineShare = baselineTotal > 0 ? baseline / baselineTotal : 0;
                    return {
                        key,
                        observed,
                        observedShare,
                        baseline,
                        baselineShare,
                        lift: baselineShare > 0 ? observedShare / baselineShare : null
                    };
                })
                .sort((a, b) => {
                    if ((b.lift ?? -Infinity) !== (a.lift ?? -Infinity)) return (b.lift ?? -Infinity) - (a.lift ?? -Infinity);
                    return b.observed - a.observed;
                });
        }

        const cardCatalog = {};
        const poolUniqueByRarity = {};
        const poolUniqueByCategory = {};
        const supplyByRarity = {};
        const supplyByCategory = {};
        const trainingRarities = new Set(['R', 'SR', 'SSR']);
        const allCards = Array.isArray(game.cardManager.allCards) ? game.cardManager.allCards : [];
        allCards.forEach((card) => {
            if (!card?.cardName) return;
            if (!cardCatalog[card.cardName]) {
                cardCatalog[card.cardName] = {
                    rarity: card.rarity || 'UNKNOWN',
                    category: card.category || 'UNKNOWN'
                };
                bumpCounter(poolUniqueByRarity, card.rarity || 'UNKNOWN', 1);
                bumpCounter(poolUniqueByCategory, card.category || 'UNKNOWN', 1);
            }
            if (trainingRarities.has(card.rarity)) {
                bumpCounter(supplyByRarity, card.rarity, 2);
                bumpCounter(supplyByCategory, card.category || 'UNKNOWN', 2);
            }
        });
        const basicCardsForSupply = game.cardManager.getBasicCards() || [];
        basicCardsForSupply.forEach((card) => {
            bumpCounter(supplyByRarity, card.rarity || 'UNKNOWN', 1);
            bumpCounter(supplyByCategory, card.category || 'UNKNOWN', 1);
        });

        const scoreSamples = [];
        const rankDist = {};
        const cardStats = {};
        const finalStatusSums = { experience: 0, enrollment: 0, satisfaction: 0, accounting: 0 };
        const finalExcessSums = { satisfactionExcess: 0, accountingExcess: 0 };
        const sPlusHoldingRaw = {
            episodes: 0,
            totalCards: 0,
            totalDisplayScore: 0,
            byCard: {},
            byCardEpisode: {},
            byRarity: {},
            byCategory: {}
        };
        const lowHoldingRaw = {
            episodes: 0,
            totalCards: 0,
            totalDisplayScore: 0,
            byCard: {},
            byCardEpisode: {},
            byRarity: {},
            byCategory: {}
        };
        const milestones = {
            exp10: 0,
            exp12: 0,
            exp25: 0,
            exp40: 0,
            exp50: 0,
            diff8: 0,
            diff10: 0,
            diff12: 0,
            diff20: 0,
            diff32: 0,
            diff40: 0,
            withdrawal0: 0,
            lowWithdrawal: 0,
            satOver15: 0,
            satOver18: 0,
            sat25: 0,
            sat35: 0,
            comboExp40Diff32: 0,
            comboExp40Diff32Sat25: 0,
            sClear: 0,
            sRank: 0,
            sPlusLike: 0,
            sPlus: 0,
            sClearWithSatOver15: 0,
            sClearWithSatControlled: 0,
            a: 0,
            aStrict: 0,
            aPlus: 0,
            aPlusLike: 0,
            aPlusStrict: 0
        };
        const decisionTelemetry = {
            training: {
                rounds: 0,
                inspirationRounds: 0,
                refreshUsed: 0,
                refreshByPhase: { initial: 0, main: 0, inspiration: 0 },
                candidateCountTotal: 0
            },
            action: {
                phaseCount: 0,
                optionCountTotal: 0,
                placedCards: 0,
                parallelPlacements: 0
            },
            meeting: {
                phaseCount: 0,
                optionCountTotal: 0,
                deletedCards: 0
            }
        };
        const episodeTraces = [];

        function listCardNames(cards) {
            return (cards || []).map((card) => card?.cardName || 'UNKNOWN');
        }

        let episodeRefreshUsage = { initial: 0, main: 0, inspiration: 0 };

        for (let episode = 0; episode < epCount; episode += 1) {
            const episodeTrace = traceSampleCount > 0
                ? {
                    episode: episode + 1,
                    initialTraining: null,
                    turns: [],
                    final: null
                }
                : null;
            episodeRefreshUsage = { initial: 0, main: 0, inspiration: 0 };
            game.gameState.reset(diff);
            game.cardManager.initTrainingPool();
            game.gameState.phase = 'start';
            game.gameState.turn = 0;
            game.gameState.currentTrainingCards = null;
            game.gameState.lastDrawNotification = null;
            game.gameState.clearPlaced();

            // 初期デッキ
            const basicCards = game.cardManager.getBasicCards();
            basicCards.forEach((card) => {
                game.gameState.player.deck.push({ ...card });
            });
            game.gameState.recordStartTime();

            // 初回研修（R4枚から2枚）
            let initialCandidates = game.cardManager.drawTrainingCards('R', 4);
            const initialCandidatesBeforeRefresh = [...initialCandidates];
            decisionTelemetry.training.rounds += 1;
            decisionTelemetry.training.candidateCountTotal += initialCandidates.length;
            initialCandidates = maybeRefreshTrainingCandidates({
                rarity: 'R',
                candidates: initialCandidates,
                drawCount: 4,
                pickCount: 2,
                phaseTag: 'initial'
            });
            decisionTelemetry.training.candidateCountTotal += initialCandidates.length;
            const initialPicks = pickTrainingCards(initialCandidates, 2);
            initialPicks.forEach((card) => {
                game.gameState.addToDeck({ ...card });
            });
            if (episodeTrace) {
                episodeTrace.initialTraining = {
                    rarity: 'R',
                    beforeRefresh: listCardNames(initialCandidatesBeforeRefresh),
                    afterRefresh: listCardNames(initialCandidates),
                    picked: listCardNames(initialPicks),
                    statusAfterPick: snapshotStatus(game.gameState.player)
                };
            }

            // training -> action
            game.gameState.phase = 'training';
            game.turnManager.advancePhase();

            const playedCardsInEpisode = new Set();
            let phaseGuard = 0;

            while (game.gameState.phase !== 'end' && phaseGuard < 200) {
                phaseGuard += 1;

                if (game.gameState.phase === 'action') {
                    const actionTurn = game.gameState.turn + 1;
                    const actionStatusBefore = snapshotStatus(game.gameState.player);
                    const handBefore = listCardNames(game.gameState.player.hand);
                    const placements = performActionPlacement();
                    const actionInfo = game.turnManager.executeActions();
                    const actionStatusAfter = snapshotStatus(game.gameState.player);

                    Object.values(actionInfo.cardEffects || {}).forEach((staffInfo) => {
                        (staffInfo.cards || []).forEach((cardEffect) => {
                            const delta = calcStatusDelta(cardEffect.beforeStats, cardEffect.afterStats);
                            const stat = ensureCardStat(cardStats, cardEffect.cardName);
                            stat.plays += 1;
                            STATUS_KEYS.forEach((k) => {
                                stat.totalDelta[k] += delta[k] || 0;
                            });
                            playedCardsInEpisode.add(cardEffect.cardName);
                        });
                    });
                    if (episodeTrace) {
                        episodeTrace.turns.push({
                            turn: actionTurn,
                            phase: 'action',
                            handBefore,
                            placements,
                            statusBefore: actionStatusBefore,
                            statusAfter: actionStatusAfter
                        });
                    }

                    game.turnManager.advancePhase();
                    continue;
                }

                if (game.gameState.phase === 'meeting') {
                    const meetingTurn = game.gameState.turn + 1;
                    const meetingStatusBefore = snapshotStatus(game.gameState.player);
                    const deckBefore = listCardNames(game.gameState.player.deck);
                    const deletedCards = performMeetingDeletion();
                    const meetingStatusAfter = snapshotStatus(game.gameState.player);
                    if (episodeTrace) {
                        episodeTrace.turns.push({
                            turn: meetingTurn,
                            phase: 'meeting',
                            deckBefore,
                            deletedCards,
                            statusBefore: meetingStatusBefore,
                            statusAfter: meetingStatusAfter
                        });
                    }
                    game.turnManager.advancePhase();
                    continue;
                }

                if (game.gameState.phase === 'training') {
                    const cfg = game.turnManager.getCurrentTurnConfig();
                    if (!cfg) {
                        game.gameState.phase = 'end';
                        break;
                    }

                    const trainingTurn = game.gameState.turn + 1;
                    const trainingStatusBefore = snapshotStatus(game.gameState.player);
                    decisionTelemetry.training.rounds += 1;
                    let candidates = game.cardManager.drawTrainingCards(cfg.training, 3);
                    const candidatesBeforeRefresh = [...candidates];
                    decisionTelemetry.training.candidateCountTotal += candidates.length;
                    candidates = maybeRefreshTrainingCandidates({
                        rarity: cfg.training,
                        candidates,
                        drawCount: 3,
                        pickCount: 1,
                        phaseTag: 'main'
                    });
                    decisionTelemetry.training.candidateCountTotal += candidates.length;
                    const picked = pickTrainingCards(candidates, 1);
                    if (picked[0]) {
                        game.gameState.addToDeck({ ...picked[0] });
                    }
                    const inspirationLogs = [];

                    while ((game.gameState.tokens?.inspiration || 0) > 0) {
                        decisionTelemetry.training.inspirationRounds += 1;
                        let extraCandidates = game.cardManager.drawTrainingCards('SR', 3);
                        const extraCandidatesBeforeRefresh = [...extraCandidates];
                        decisionTelemetry.training.candidateCountTotal += extraCandidates.length;
                        if (extraCandidates.length === 0) break;
                        extraCandidates = maybeRefreshTrainingCandidates({
                            rarity: 'SR',
                            candidates: extraCandidates,
                            drawCount: 3,
                            pickCount: 1,
                            phaseTag: 'inspiration'
                        });
                        decisionTelemetry.training.candidateCountTotal += extraCandidates.length;
                        const extraPicked = pickTrainingCards(extraCandidates, 1);
                        if (extraPicked[0]) {
                            game.gameState.addToDeck({ ...extraPicked[0] });
                        }
                        inspirationLogs.push({
                            rarity: 'SR',
                            beforeRefresh: listCardNames(extraCandidatesBeforeRefresh),
                            afterRefresh: listCardNames(extraCandidates),
                            picked: listCardNames(extraPicked)
                        });
                        game.gameState.tokens.inspiration -= 1;
                    }
                    if (episodeTrace) {
                        episodeTrace.turns.push({
                            turn: trainingTurn,
                            phase: 'training',
                            rarity: cfg.training,
                            candidatesBeforeRefresh: listCardNames(candidatesBeforeRefresh),
                            candidatesAfterRefresh: listCardNames(candidates),
                            picked: listCardNames(picked),
                            inspiration: inspirationLogs,
                            statusBefore: trainingStatusBefore,
                            statusAfter: snapshotStatus(game.gameState.player)
                        });
                    }

                    game.gameState.phase = 'training';
                    game.turnManager.advancePhase();
                    continue;
                }

                game.gameState.phase = 'end';
            }

            const score = game.scoreManager.calculateScore(game.gameState);
            const displayScore = Number(score.displayScore ?? score.points ?? 0);
            const scorePoints = Number(score.points ?? 0);
            const thresholdMetric = diff === 'pro' ? scorePoints : displayScore;
            scoreSamples.push(displayScore);

            const finalPlayer = game.gameState.player;
            const finalWithdrawal = calcWithdrawalFromPlayer(finalPlayer);
            const finalEnrollmentDiff = (finalPlayer.enrollment || 0) - finalWithdrawal;
            if (episodeTrace) {
                episodeTrace.final = {
                    points: scorePoints,
                    displayScore,
                    rank: score.rank?.grade || 'UNKNOWN',
                    finalStatus: snapshotStatus(finalPlayer),
                    withdrawal: finalWithdrawal,
                    enrollmentDiff: finalEnrollmentDiff
                };
            }

            finalStatusSums.experience += finalPlayer.experience || 0;
            finalStatusSums.enrollment += finalPlayer.enrollment || 0;
            finalStatusSums.satisfaction += finalPlayer.satisfaction || 0;
            finalStatusSums.accounting += finalPlayer.accounting || 0;
            finalExcessSums.satisfactionExcess += Math.max((finalPlayer.satisfaction || 0) - 15, 0);
            finalExcessSums.accountingExcess += Math.max((finalPlayer.accounting || 0) - 15, 0);

            if ((finalPlayer.experience || 0) >= 10) milestones.exp10 += 1;
            if ((finalPlayer.experience || 0) >= 12) milestones.exp12 += 1;
            if ((finalPlayer.experience || 0) >= 25) milestones.exp25 += 1;
            if ((finalPlayer.experience || 0) >= 40) milestones.exp40 += 1;
            if ((finalPlayer.experience || 0) >= 50) milestones.exp50 += 1;
            if (finalEnrollmentDiff >= 8) milestones.diff8 += 1;
            if (finalEnrollmentDiff >= 10) milestones.diff10 += 1;
            if (finalEnrollmentDiff >= 12) milestones.diff12 += 1;
            if (finalEnrollmentDiff >= 20) milestones.diff20 += 1;
            if (finalEnrollmentDiff >= 32) milestones.diff32 += 1;
            if (finalEnrollmentDiff >= 40) milestones.diff40 += 1;
            if (finalWithdrawal <= 0) milestones.withdrawal0 += 1;
            if (finalWithdrawal <= 1) milestones.lowWithdrawal += 1;
            if ((finalPlayer.satisfaction || 0) > 15) milestones.satOver15 += 1;
            if ((finalPlayer.satisfaction || 0) > 18) milestones.satOver18 += 1;
            if ((finalPlayer.satisfaction || 0) >= 25) milestones.sat25 += 1;
            if ((finalPlayer.satisfaction || 0) >= 35) milestones.sat35 += 1;
            if ((finalPlayer.experience || 0) >= 40 && finalEnrollmentDiff >= 32) milestones.comboExp40Diff32 += 1;
            if ((finalPlayer.experience || 0) >= 40 && finalEnrollmentDiff >= 32 && (finalPlayer.satisfaction || 0) >= 25) {
                milestones.comboExp40Diff32Sat25 += 1;
            }
            if (scorePoints >= scoreTargets.sClearPoints) {
                milestones.sClear += 1;
                if ((finalPlayer.satisfaction || 0) > 15) milestones.sClearWithSatOver15 += 1;
                else milestones.sClearWithSatControlled += 1;
            }
            if (score.rank?.grade === 'S' || score.rank?.grade === 'S+') milestones.sRank += 1;
            if (score.rank?.grade === 'A' || score.rank?.grade === 'A+' || score.rank?.grade === 'S' || score.rank?.grade === 'S+') {
                milestones.aStrict += 1;
            }
            if (score.rank?.grade === 'A+' || score.rank?.grade === 'S' || score.rank?.grade === 'S+') {
                milestones.aPlusStrict += 1;
            }
            if (thresholdMetric >= scoreTargets.aPoints) {
                milestones.a += 1;
            }
            if (thresholdMetric >= scoreTargets.aPlusPoints) {
                milestones.aPlus += 1;
                milestones.aPlusLike += 1;
            }
            if ((finalPlayer.experience || 0) >= 15 && (finalPlayer.enrollment || 0) >= 15 && finalWithdrawal <= 1) {
                milestones.sPlusLike += 1;
            }
            if (thresholdMetric >= scoreTargets.sPlusPoints) {
                milestones.sPlus += 1;
                sPlusHoldingRaw.episodes += 1;
                sPlusHoldingRaw.totalDisplayScore += displayScore;
                const holdings = collectFinalHoldingCards(finalPlayer);
                const seenNames = new Set();
                holdings.forEach((card) => {
                    const cardName = card?.cardName || 'UNKNOWN';
                    const meta = cardCatalog[cardName] || {};
                    const rarity = card?.rarity || meta.rarity || 'UNKNOWN';
                    const category = card?.category || meta.category || 'UNKNOWN';
                    bumpCounter(sPlusHoldingRaw.byCard, cardName, 1);
                    bumpCounter(sPlusHoldingRaw.byRarity, rarity, 1);
                    bumpCounter(sPlusHoldingRaw.byCategory, category, 1);
                    if (!seenNames.has(cardName)) {
                        bumpCounter(sPlusHoldingRaw.byCardEpisode, cardName, 1);
                        seenNames.add(cardName);
                    }
                });
                sPlusHoldingRaw.totalCards += holdings.length;
            }
            if (displayScore <= 0) {
                lowHoldingRaw.episodes += 1;
                lowHoldingRaw.totalDisplayScore += displayScore;
                const holdings = collectFinalHoldingCards(finalPlayer);
                const seenNames = new Set();
                holdings.forEach((card) => {
                    const cardName = card?.cardName || 'UNKNOWN';
                    const meta = cardCatalog[cardName] || {};
                    const rarity = card?.rarity || meta.rarity || 'UNKNOWN';
                    const category = card?.category || meta.category || 'UNKNOWN';
                    bumpCounter(lowHoldingRaw.byCard, cardName, 1);
                    bumpCounter(lowHoldingRaw.byRarity, rarity, 1);
                    bumpCounter(lowHoldingRaw.byCategory, category, 1);
                    if (!seenNames.has(cardName)) {
                        bumpCounter(lowHoldingRaw.byCardEpisode, cardName, 1);
                        seenNames.add(cardName);
                    }
                });
                lowHoldingRaw.totalCards += holdings.length;
            }

            const grade = score.rank?.grade || 'UNKNOWN';
            rankDist[grade] = (rankDist[grade] || 0) + 1;

            playedCardsInEpisode.forEach((cardName) => {
                const stat = ensureCardStat(cardStats, cardName);
                stat.appearedEpisodes += 1;
                stat.totalEpisodeScore += displayScore;
            });

            if (episodeTrace && scorePoints >= scoreTargets.sClearPoints && episodeTraces.length < traceSampleCount) {
                episodeTraces.push(episodeTrace);
            }
        }

        const sortedScores = [...scoreSamples].sort((a, b) => a - b);
        const total = scoreSamples.reduce((acc, x) => acc + x, 0);
        const scoreSummary = {
            mean: scoreSamples.length > 0 ? total / scoreSamples.length : 0,
            min: sortedScores.length > 0 ? sortedScores[0] : 0,
            max: sortedScores.length > 0 ? sortedScores[sortedScores.length - 1] : 0,
            p50: calcQuantile(sortedScores, 0.5),
            p90: calcQuantile(sortedScores, 0.9)
        };

        const cardSummary = Object.entries(cardStats)
            .map(([cardName, stat]) => {
                const avgDelta = {
                    experience: stat.plays > 0 ? stat.totalDelta.experience / stat.plays : 0,
                    enrollment: stat.plays > 0 ? stat.totalDelta.enrollment / stat.plays : 0,
                    satisfaction: stat.plays > 0 ? stat.totalDelta.satisfaction / stat.plays : 0,
                    accounting: stat.plays > 0 ? stat.totalDelta.accounting / stat.plays : 0
                };

                return {
                    cardName,
                    plays: stat.plays,
                    episodesPlayed: stat.appearedEpisodes,
                    avgEpisodeScoreWhenPlayed: stat.appearedEpisodes > 0
                        ? stat.totalEpisodeScore / stat.appearedEpisodes
                        : 0,
                    avgDelta
                };
            })
            .sort((a, b) => {
                if (b.plays !== a.plays) return b.plays - a.plays;
                return b.avgEpisodeScoreWhenPlayed - a.avgEpisodeScoreWhenPlayed;
            });

        const sPlusCardRanking = Object.entries(sPlusHoldingRaw.byCard)
            .map(([cardName, heldCount]) => {
                const meta = cardCatalog[cardName] || {};
                const presentEpisodes = sPlusHoldingRaw.byCardEpisode[cardName] || 0;
                return {
                    cardName,
                    rarity: meta.rarity || 'UNKNOWN',
                    category: meta.category || 'UNKNOWN',
                    heldCount,
                    presentEpisodes,
                    presentRate: sPlusHoldingRaw.episodes > 0 ? presentEpisodes / sPlusHoldingRaw.episodes : 0,
                    avgCopiesWhenPresent: presentEpisodes > 0 ? heldCount / presentEpisodes : 0
                };
            })
            .sort((a, b) => {
                if (b.presentEpisodes !== a.presentEpisodes) return b.presentEpisodes - a.presentEpisodes;
                if (b.heldCount !== a.heldCount) return b.heldCount - a.heldCount;
                return b.avgCopiesWhenPresent - a.avgCopiesWhenPresent;
            });
        const lowCardRanking = Object.entries(lowHoldingRaw.byCard)
            .map(([cardName, heldCount]) => {
                const meta = cardCatalog[cardName] || {};
                const presentEpisodes = lowHoldingRaw.byCardEpisode[cardName] || 0;
                return {
                    cardName,
                    rarity: meta.rarity || 'UNKNOWN',
                    category: meta.category || 'UNKNOWN',
                    heldCount,
                    presentEpisodes,
                    presentRate: lowHoldingRaw.episodes > 0 ? presentEpisodes / lowHoldingRaw.episodes : 0,
                    avgCopiesWhenPresent: presentEpisodes > 0 ? heldCount / presentEpisodes : 0
                };
            })
            .sort((a, b) => {
                if (b.presentEpisodes !== a.presentEpisodes) return b.presentEpisodes - a.presentEpisodes;
                if (b.heldCount !== a.heldCount) return b.heldCount - a.heldCount;
                return b.avgCopiesWhenPresent - a.avgCopiesWhenPresent;
            });

        const sPlusRarityBalance = buildBalanceRows(sPlusHoldingRaw.byRarity, supplyByRarity);
        const sPlusCategoryBalance = buildBalanceRows(sPlusHoldingRaw.byCategory, supplyByCategory);
        const lowRarityBalance = buildBalanceRows(lowHoldingRaw.byRarity, supplyByRarity);
        const lowCategoryBalance = buildBalanceRows(lowHoldingRaw.byCategory, supplyByCategory);
        const sClearRate = epCount > 0 ? milestones.sClear / epCount : 0;
        const sPlusRate = epCount > 0 ? milestones.sPlus / epCount : 0;
        const decisionSummary = {
            training: {
                rounds: decisionTelemetry.training.rounds,
                inspirationRounds: decisionTelemetry.training.inspirationRounds,
                refreshUsed: decisionTelemetry.training.refreshUsed,
                refreshByPhase: decisionTelemetry.training.refreshByPhase,
                avgCandidatesPerRound: (decisionTelemetry.training.rounds + decisionTelemetry.training.inspirationRounds) > 0
                    ? decisionTelemetry.training.candidateCountTotal / (decisionTelemetry.training.rounds + decisionTelemetry.training.inspirationRounds)
                    : 0
            },
            action: {
                phases: decisionTelemetry.action.phaseCount,
                avgOptionsPerPhase: decisionTelemetry.action.phaseCount > 0
                    ? decisionTelemetry.action.optionCountTotal / decisionTelemetry.action.phaseCount
                    : 0,
                avgPlacedPerPhase: decisionTelemetry.action.phaseCount > 0
                    ? decisionTelemetry.action.placedCards / decisionTelemetry.action.phaseCount
                    : 0,
                parallelPlacementRate: decisionTelemetry.action.placedCards > 0
                    ? decisionTelemetry.action.parallelPlacements / decisionTelemetry.action.placedCards
                    : 0
            },
            meeting: {
                phases: decisionTelemetry.meeting.phaseCount,
                avgOptionsPerPhase: decisionTelemetry.meeting.phaseCount > 0
                    ? decisionTelemetry.meeting.optionCountTotal / decisionTelemetry.meeting.phaseCount
                    : 0,
                avgDeletedPerPhase: decisionTelemetry.meeting.phaseCount > 0
                    ? decisionTelemetry.meeting.deletedCards / decisionTelemetry.meeting.phaseCount
                    : 0
            }
        };

        return {
            policy,
            effectivePolicy: strategyPolicy,
            difficulty: diff,
            scoreTargets,
            episodes: epCount,
            scoreSummary,
            finalStatusAverages: {
                experience: epCount > 0 ? finalStatusSums.experience / epCount : 0,
                enrollment: epCount > 0 ? finalStatusSums.enrollment / epCount : 0,
                satisfaction: epCount > 0 ? finalStatusSums.satisfaction / epCount : 0,
                accounting: epCount > 0 ? finalStatusSums.accounting / epCount : 0
            },
            finalExcessAverages: {
                satisfactionExcess: epCount > 0 ? finalExcessSums.satisfactionExcess / epCount : 0,
                accountingExcess: epCount > 0 ? finalExcessSums.accountingExcess / epCount : 0
            },
            milestones: {
                exp10Rate: epCount > 0 ? milestones.exp10 / epCount : 0,
                exp12Rate: epCount > 0 ? milestones.exp12 / epCount : 0,
                exp25Rate: epCount > 0 ? milestones.exp25 / epCount : 0,
                exp40Rate: epCount > 0 ? milestones.exp40 / epCount : 0,
                exp50Rate: epCount > 0 ? milestones.exp50 / epCount : 0,
                diff8Rate: epCount > 0 ? milestones.diff8 / epCount : 0,
                diff10Rate: epCount > 0 ? milestones.diff10 / epCount : 0,
                diff12Rate: epCount > 0 ? milestones.diff12 / epCount : 0,
                diff20Rate: epCount > 0 ? milestones.diff20 / epCount : 0,
                diff32Rate: epCount > 0 ? milestones.diff32 / epCount : 0,
                diff40Rate: epCount > 0 ? milestones.diff40 / epCount : 0,
                withdrawal0Rate: epCount > 0 ? milestones.withdrawal0 / epCount : 0,
                lowWithdrawalRate: epCount > 0 ? milestones.lowWithdrawal / epCount : 0,
                satOver15Rate: epCount > 0 ? milestones.satOver15 / epCount : 0,
                satOver18Rate: epCount > 0 ? milestones.satOver18 / epCount : 0,
                sat25Rate: epCount > 0 ? milestones.sat25 / epCount : 0,
                sat35Rate: epCount > 0 ? milestones.sat35 / epCount : 0,
                comboExp40Diff32Rate: epCount > 0 ? milestones.comboExp40Diff32 / epCount : 0,
                comboExp40Diff32Sat25Rate: epCount > 0 ? milestones.comboExp40Diff32Sat25 / epCount : 0,
                sClearRate,
                sRankRate: epCount > 0 ? milestones.sRank / epCount : 0,
                aRate: epCount > 0 ? milestones.a / epCount : 0,
                aStrictRate: epCount > 0 ? milestones.aStrict / epCount : 0,
                aPlusRate: epCount > 0 ? milestones.aPlus / epCount : 0,
                aPlusLikeRate: epCount > 0 ? milestones.aPlusLike / epCount : 0,
                aPlusStrictRate: epCount > 0 ? milestones.aPlusStrict / epCount : 0,
                sPlusLikeRate: epCount > 0 ? milestones.sPlusLike / epCount : 0,
                sPlusRate,
                satOver15GivenSClearRate: milestones.sClear > 0 ? milestones.sClearWithSatOver15 / milestones.sClear : 0,
                sClearSatControlledRate: milestones.sClear > 0 ? milestones.sClearWithSatControlled / milestones.sClear : 0,
                sClearGapTo50: Math.max(0, 0.5 - sClearRate)
            },
            rankDist,
            topCards: cardSummary.slice(0, 30),
            decisionTelemetry: decisionSummary,
            sPlusHoldings: {
                episodes: sPlusHoldingRaw.episodes,
                rate: sPlusRate,
                averageDisplayScore: sPlusHoldingRaw.episodes > 0 ? sPlusHoldingRaw.totalDisplayScore / sPlusHoldingRaw.episodes : 0,
                averageHeldCards: sPlusHoldingRaw.episodes > 0 ? sPlusHoldingRaw.totalCards / sPlusHoldingRaw.episodes : 0,
                topCards: sPlusCardRanking.slice(0, 40),
                rarityBalance: sPlusRarityBalance,
                categoryBalance: sPlusCategoryBalance
            },
            lowHoldings: {
                episodes: lowHoldingRaw.episodes,
                rate: epCount > 0 ? lowHoldingRaw.episodes / epCount : 0,
                averageDisplayScore: lowHoldingRaw.episodes > 0 ? lowHoldingRaw.totalDisplayScore / lowHoldingRaw.episodes : 0,
                averageHeldCards: lowHoldingRaw.episodes > 0 ? lowHoldingRaw.totalCards / lowHoldingRaw.episodes : 0,
                topCards: lowCardRanking.slice(0, 40),
                rarityBalance: lowRarityBalance,
                categoryBalance: lowCategoryBalance
            },
            episodeTraces,
            cardPool: {
                uniqueByRarity: poolUniqueByRarity,
                uniqueByCategory: poolUniqueByCategory,
                supplyByRarity,
                supplyByCategory
            }
        };
    }, { episodes, difficulty, policyName, traceSampleCount: traceSamples || 0 });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const server = await createStaticServer(gameRoot, args.port);
    const browser = await chromium.launch({ headless: !args.headful });

    try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${args.port}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.game && !!window.game.cardManager && window.game.cardManager.allCards.length > 0, null, { timeout: 30000 });

        const simulations = [];
        for (const policyName of args.policies) {
            const normalized = normalizePolicyName(policyName);
            const result = await runPolicy(page, {
                episodes: args.episodes,
                difficulty: args.difficulty,
                policyName: normalized,
                traceSamples: args.traceSamples
            });
            simulations.push(result);
        }

        const outputAbs = path.resolve(repoRoot, args.output);
        const reportJson = {
            generatedAt: new Date().toISOString(),
            settings: {
                episodes: args.episodes,
                difficulty: args.difficulty,
                scoreTargets: getScoreTargets(args.difficulty),
                policies: args.policies.map(normalizePolicyName)
            },
            simulations
        };

        await writeFile(outputAbs, `${JSON.stringify(reportJson, null, 2)}\n`, 'utf-8');

        let reportAbs = null;
        if (args.report) {
            reportAbs = path.resolve(repoRoot, args.report);
            const markdown = buildNaturalLanguageReport(reportJson);
            await writeFile(reportAbs, markdown, 'utf-8');
        }

        console.log('=== Simulation Summary ===');
        simulations.forEach((sim) => {
            const s = sim.scoreSummary;
            const m = sim.milestones || {};
            const targets = sim.scoreTargets || getScoreTargets(args.difficulty);
            console.log(
                `[${sim.policy}${sim.effectivePolicy !== sim.policy ? `->${sim.effectivePolicy}` : ''}] mean=${s.mean.toFixed(3)} p50=${s.p50.toFixed(3)} p90=${s.p90.toFixed(3)} min=${s.min.toFixed(3)} max=${s.max.toFixed(3)} a>=${targets.aPoints}=${((m.aRate || 0) * 100).toFixed(1)}% s>=${targets.sClearPoints}=${((m.sClearRate || 0) * 100).toFixed(1)}% a+>=${targets.aPlusPoints}=${((m.aPlusRate || 0) * 100).toFixed(1)}% s+>=${targets.sPlusPoints}=${((m.sPlusRate || 0) * 100).toFixed(1)}% sat>15=${((m.satOver15Rate || 0) * 100).toFixed(1)}% gap50=${((m.sClearGapTo50 || 0) * 100).toFixed(1)}%`
            );
        });
        console.log(`Result JSON: ${outputAbs}`);
        if (reportAbs) {
            console.log(`Natural Language Report: ${reportAbs}`);
        }
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
