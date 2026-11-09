import { analyzeReplayScene } from './replaySceneAnalysis.js?v=20261110-0065';
import { createCpuReplay } from './cpuOpponent.js?v=20261110-0065';
import { validateBattleReplay } from './battleReplay.js?v=20261110-0065';
import { encodeReplay, decodeReplay } from './replayCodec.js?v=20261110-0065';

self.onmessage = async event => {
    const { type, id, buildVersion } = event.data;
    globalThis.window = { BUILD_VERSION: buildVersion };
    try {
        if (type === 'scene') {
            const decision = await analyzeReplayScene(event.data.source, event.data.scene);
            self.postMessage({ id, decision });
        } else if (type === 'example') {
            const source = validateBattleReplay(event.data.record);
            if (!source.definitions.ranks.length) throw new Error('お手本の生成に必要な評価データがありません');
            const record = await createCpuReplay({ difficulty: source.metadata.difficulty, seed: source.metadata.seed,
                eventId: source.metadata.eventId,
                resources: { cards: source.definitions.cards, ranks: source.definitions.ranks,
                    cardVersion: source.metadata.cardVersion, rankVersion: source.metadata.rankVersion },
                onProgress: progress => self.postMessage({ id, progress }) });
            record.metadata.exampleOf = source.metadata.runId;
            const text = await encodeReplay(record);
            const restored = await decodeReplay(text, { currentBuildVersion: buildVersion });
            self.postMessage({ id, record: restored, text });
        } else throw new Error('リプレイ処理の種類が不正です');
    } catch (error) { self.postMessage({ id, error: error.message }); }
};
