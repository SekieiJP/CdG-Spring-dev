import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sourceCommit = '04d200e157156837a7bb326920ecd641707a90c6';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = path => execFileSync('git', ['show', `${sourceCommit}:${path}`]);
const actorFiles = [
    'solver/autoplay-agent.mjs', 'solver/browser/pro-strategy-research.js', 'solver/browser/pro-risk-research.js',
    'solver/browser/pro-value-model.js', 'solver/browser/pro-learned-research.js', 'solver/browser/pro-public-action-kernel.js',
    'solver/pro-card-scene-input.mjs', 'solver/browser/pro-intrinsic-recovery.js', 'solver/browser/pro-action-candidates.js',
    'solver/browser/pro-opening-table.js', 'solver/pro-opening-table-input.mjs'
];
const strategyVersion = hash(Buffer.concat(actorFiles.map(source)));
if (strategyVersion !== '8196136e4d19da110d40ee9187a98e97dfe7b64adacf53a2a51c25bd1904ad59') throw new Error('固定方略の識別値が異なります');
const root = 'game/js/cpu';
await mkdir(root, { recursive: true }); await mkdir('game/data/cpu', { recursive: true });
const modules = new Map();
function collect(path) {
    if (modules.has(path)) return;
    const bytes = source(path); modules.set(path, bytes);
    for (const match of bytes.toString().matchAll(/from\s*['"]\.\/([^'"]+)['"]/g)) collect(`solver/browser/${match[1]}`);
}
collect('solver/browser/pro-strategy-research.js');
for (const [path, bytes] of modules) await writeFile(`${root}/${path.split('/').at(-1)}`, bytes);

const autoplay = source('solver/autoplay-agent.mjs').toString();
const from = autoplay.indexOf('        const freshOnlyPolicies =');
const until = autoplay.indexOf('        // 分析中の純粋な効果文の解析だけをキャッシュ');
let settings = autoplay.slice(from, until);
settings = settings.replace(/const proFormula = isProDifficulty \? await import\([^\n]+\) : null;/, 'const proFormula = isProDifficulty ? formula : null;');
if (settings.includes('await import')) throw new Error('方略のimportを接続できません');
const begin = autoplay.indexOf('        const STATUS_KEYS =', until);
const end = autoplay.indexOf('        function ensureCardStat(', begin);
if ([from, until, begin, end].some(index => index < 0)) throw new Error('固定方略の抽出位置が見つかりません');
const researchInit = `
    const researchPolicy = research ? researchModule.createResearchPolicy({
        projectDeck: formula.projectProDeck, score: formula.proGoal, cloneState: cloneForSimulation,
        resolve: (card, slot, state) => game.turnManager.resolveCardAction(card, slot, state),
        enumerateOptions: enumeratePlacementOptions, catalog: game.cardManager.allCards,
        turns: game.gameState.config.turns, publicActionParser: new game.cardManager.constructor(null),
        config: research, valueModel, refreshAdvice: observation => acquisitionAdvisor.recommendAcquisition(observation, {profile: effectiveRefreshModel})
    }) : null;
`;
const prelude = `export function createCpuPolicyKernel(game, {difficulty:diff, acquisitionAdvisor, formula, researchModule, research=null, valueModel=null}) {
    const policy = diff === 'fresh' ? 'fresh_stable' : 'pro_goal';
    const acquisitionModel = diff === 'fresh' ? 'reach' : 'pro_splus';
    const acquisitionAblation = null, refreshPolicy = 'auto', refreshModel = null;
    let meetingIntervention = null;
    const episodeRefreshUsage = {initial:0,main:0,inspiration:0};
    const decisionTelemetry = {training:{refreshUsed:0,refreshByPhase:{initial:0,main:0,inspiration:0}},
        action:{phaseCount:0,optionCountTotal:0,placedCards:0,parallelPlacements:0},
        meeting:{phaseCount:0,optionCountTotal:0,deletedCards:0}};
`;
const tail = `
    return {
        training({rarity, candidates, drawCount, pickCount, phaseTag, allowSkip=false}) {
            const offered = maybeRefreshTrainingCandidates({rarity,candidates,drawCount,pickCount,phaseTag});
            return {candidates:offered, selected:pickTrainingCards(offered,pickCount,allowSkip)};
        },
        place: performActionPlacement,
        delete: performMeetingDeletion
    };
}
`;
const kernel = prelude + settings + researchInit + autoplay.slice(begin, end) + tail;
await writeFile(`${root}/policyKernel.js`, kernel);
const model = await readFile('solver/models/pro-public-value-v1.json');
const modelSha256 = hash(model);
if (modelSha256 !== 'c07e7fe747c66aeebb345a2f3100ae6b6fc4609605ea58680230e6ac94be9bba') throw new Error('固定モデルの識別値が異なります');
await writeFile('game/data/cpu/pro-public-value-v1.json', model);
const config = JSON.parse(source('solver/research-scenarios/ahiru-pro-stability-configs.json')).baseline;
await writeFile('game/data/cpu/pro-policy-v1.json', JSON.stringify(config, null, 2) + '\n');
await writeFile('game/data/cpu/provenance.json', JSON.stringify({sourceCommit, policy:'fixed-pro-v1',
    strategyVersion, actorFiles,
    modelSha256, kernelSha256:hash(kernel), autoplaySha256:hash(source('solver/autoplay-agent.mjs')),
    modules:Object.fromEntries([...modules].map(([path, bytes]) => [path.split('/').at(-1),hash(bytes)]))}, null, 2) + '\n');
console.log(`固定方略V1の${modules.size}モジュールと共通の配置・削除処理を生成しました`);
