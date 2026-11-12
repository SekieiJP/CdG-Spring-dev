import { createCpuReplay } from './cpuOpponent.js?v=20261110-0066';

self.onmessage = async event => {
    const { difficulty, seed, buildVersion } = event.data;
    globalThis.window = { BUILD_VERSION: buildVersion };
    try {
        const record = await createCpuReplay({ difficulty, seed, onProgress: progress => self.postMessage({ progress }) });
        self.postMessage({ record });
    } catch (error) { self.postMessage({ error: error.message }); }
};
