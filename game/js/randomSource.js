/** 名前付き乱数系列。別ターンや研修と山札で乱数消費を分離し、保存から続ける。 */
export class RandomSource {
    static algorithm = 'split-mulberry32-v1';
    constructor(seed, streams = {}) { this.seed = String(seed); this.streams = structuredClone(streams); }
    hash(key) {
        let value = 2166136261;
        for (const char of `${this.seed}:${key}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
        return value >>> 0;
    }
    next(key = 'default') {
        const stream = this.streams[key] ||= { state: this.hash(key), calls: 0 };
        stream.state = (stream.state + 0x6D2B79F5) >>> 0; stream.calls++;
        let value = stream.state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    }
    snapshot() { return { algorithm: RandomSource.algorithm, seed: this.seed, streams: structuredClone(this.streams) }; }
    static restore(data) { return new RandomSource(data.seed, data.streams); }
}
