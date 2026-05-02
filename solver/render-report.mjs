#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { buildNaturalLanguageReport } from './reportBuilder.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
    const args = {
        input: 'solver/latest-simulation.json',
        output: 'solver/latest-report.md'
    };

    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const next = argv[i + 1];

        if (key === '--input' && next) {
            args.input = next;
            i += 1;
        } else if (key === '--output' && next) {
            args.output = next;
            i += 1;
        }
    }

    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputAbs = path.resolve(repoRoot, args.input);
    const outputAbs = path.resolve(repoRoot, args.output);

    const raw = await readFile(inputAbs, 'utf-8');
    const payload = JSON.parse(raw);

    const markdown = buildNaturalLanguageReport(payload);
    await writeFile(outputAbs, markdown, 'utf-8');

    console.log(`Input JSON: ${inputAbs}`);
    console.log(`Natural Language Report: ${outputAbs}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
