/** FRESH分析の従来の入口。共通集計の既定難易度はFRESH。 */
export { summarize, pairedComparison } from './acquisition-analysis.mjs';
import { main } from './acquisition-analysis.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
