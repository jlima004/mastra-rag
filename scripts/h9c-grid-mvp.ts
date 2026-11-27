import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256 } from '../src/mastra/rag/contracts/ids.ts';
import { estimateMvpGridCosts } from '../src/mastra/rag/embeddings/mvp-grid-cost.ts';
import {
  MVP_EXPERIMENTAL_CORPUS, MvpAdmissionError, validateMvpSnapshot,
} from '../src/mastra/rag/processing/mvp-corpus.ts';
import { aggregateMvpGrid, measureMvpGrid } from '../src/mastra/rag/processing/mvp-grid-metrics.ts';
import {
  H9_TOKEN_GRID_PROFILES, renderH9TokenChunksOffline,
} from '../src/mastra/rag/processing/token-grid.ts';

export function calibrateMvpDocuments(documents: readonly ReturnType<typeof validateMvpSnapshot>[]) {
  const peakRssBeforeKiB = process.resourceUsage().maxRSS;
  const profiles = H9_TOKEN_GRID_PROFILES.map(config => {
    const profile = config.strategy === 'legal-structure' ? 'S' + config.maxTokens : 'R400';
    const runs = documents.map(({ normalized, fetched, source }) => {
      const started = performance.now();
      const set = renderH9TokenChunksOffline(normalized, fetched, source, config);
      const chunkingIncludingTokenizerMs = performance.now() - started;

      const measurement = measureMvpGrid(normalized, fetched, source, set);
      if (!measurement.metrics.verified) throw new Error('MVP_GRID_INVARIANT_FAILED');
      const repeat = renderH9TokenChunksOffline(normalized, fetched, source, config);
      // Compare complete rendering, metadata and IDs while retaining only a verdict.
      if (canonicalJson(set) !== canonicalJson(repeat)) throw new Error('MVP_RENDER_NOT_REPEATABLE');
      return {
        sourceId: source.sourceId,
        measurement,
        chunks: set.chunks,
        performance: {
          chunkingIncludingTokenizerMs,
          renderedTokenizationMs: measurement.tokenizationMs,
          cumulativeMaxRssKiB: process.resourceUsage().maxRSS,
        },
      };
    });
    const { documents: documentCosts, corpus: corpusCost, ...costPolicy } =
      estimateMvpGridCosts(runs.map(run => run.chunks));
    const aggregate = aggregateMvpGrid(runs.map(run => run.measurement));
    return {
      result: {
        profile,
        config,
        documents: runs.map((run, index) => ({
          sourceId: run.sourceId,
          ...run.measurement.metrics,
          cost: documentCosts[index],
        })),
        ...aggregate,
        cost: { ...costPolicy, ...corpusCost },
        renderingRepeatable: true,
      },
      performance: {
        profile,
        documents: runs.map(run => ({ sourceId: run.sourceId, ...run.performance })),
        chunkingIncludingTokenizerMs: runs.reduce(
          (sum, run) => sum + run.performance.chunkingIncludingTokenizerMs, 0),
        renderedTokenizationMs: runs.reduce((sum, run) => sum + run.performance.renderedTokenizationMs, 0),
        cumulativeMaxRssKiB: process.resourceUsage().maxRSS,
      },
    };
  });
  return {
    profiles: profiles.map(profile => profile.result),
    performance: {
      peakRssBeforeKiB,
      peakRssAfterKiB: process.resourceUsage().maxRSS,
      profiles: profiles.map(profile => profile.performance),
    },
  };
}

export function runMvpGrid(directory: string) {
  const corpus = MVP_EXPERIMENTAL_CORPUS;
  const documents = corpus.snapshots.map(pin => validateMvpSnapshot(directory, pin));
  const calibration = calibrateMvpDocuments(documents);
  const result = {
    corpus,
    corpusManifestSha256: sha256(canonicalJson(corpus)),
    validation: documents.map(document => document.validation),
    tokenizer: 'cl100k_base/js-tiktoken@1.0.21',
    profiles: calibration.profiles,
  };
  return {
    result,
    resultSha256: sha256(canonicalJson(result)),
    performance: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      documents: documents.map(({ validation, performance: timings }) =>
        ({ sourceId: validation.sourceId, ...timings })),
      extractionMs: documents.reduce((sum, doc) => sum + doc.performance.extractionMs, 0),
      normalizationMs: documents.reduce((sum, doc) => sum + doc.performance.normalizationMs, 0),
      ...calibration.performance,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [directory] = process.argv.slice(2);
  if (process.argv.length !== 3 || !directory) {
    process.stderr.write('H9C_MVP_GRID_USAGE_INVALID\n');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(JSON.stringify(runMvpGrid(directory), null, 2) + '\n');
    } catch (error) {
      const code = error instanceof MvpAdmissionError ? error.code : 'H9C_MVP_GRID_FAILED';
      process.stderr.write(code + '\n');
      process.exitCode = 1;
    }
  }
}
