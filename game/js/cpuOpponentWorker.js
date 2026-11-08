import { createCpuReplay } from './cpuOpponent.js?v=20261107-0062';

self.onmessage = async event => {
    const { difficulty, seed, buildVersion } = event.data;
    globalThis.window = { BUILD_VERSION: buildVersion };
    try {
        const record = await createCpuReplay({ difficulty, seed, onProgress: progress => self.postMessage({ progress }) });
        self.postMessage({ record });
    } catch (error) { self.postMessage({ error: error.message }); }
};
