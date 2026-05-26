#!/usr/bin/env node
/**
 * rephrase.js — Rephrase all SIE exam questions using the Anthropic API.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/rephrase.js
 *
 * Progress is saved to scripts/rephrase-progress.json so the script
 * can be restarted after interruption without re-processing completed batches.
 * Final output is written to js/questions-rephrased.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// ── Configuration ─────────────────────────────────────────────────────────────
const BATCH_SIZE = 20;
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

const ROOT = path.resolve(__dirname, '..');
const QUESTIONS_FILE = path.join(ROOT, 'js', 'questions.js');
const PROGRESS_FILE = path.join(__dirname, 'rephrase-progress.json');
const OUTPUT_FILE = path.join(ROOT, 'js', 'questions-rephrased.js');

// Exponential-backoff settings
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;
const MAX_RETRIES = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse questions.js which contains: const DB=[...];
 * Returns a plain JS array of question objects.
 */
function loadQuestions() {
  const src = fs.readFileSync(QUESTIONS_FILE, 'utf8');
  // Strip "const DB=" prefix and trailing ";" so we can JSON-parse-ish it.
  // The file uses JS object literals (unquoted keys), so we evaluate it safely.
  const match = src.match(/const\s+DB\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) {
    throw new Error('Could not locate DB array in ' + QUESTIONS_FILE);
  }
  // Use Function constructor to evaluate the array literal (keys are unquoted JS).
  // This is intentional — the file is trusted local data.
  // eslint-disable-next-line no-new-func
  const db = new Function('return ' + match[1])();
  if (!Array.isArray(db)) {
    throw new Error('DB is not an array');
  }
  return db;
}

/**
 * Load (or initialise) progress state from disk.
 * Shape: { completedBatches: number[], results: object[] }
 */
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const raw = fs.readFileSync(PROGRESS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      console.warn('Warning: could not parse progress file — starting fresh.');
    }
  }
  return { completedBatches: [], results: [] };
}

/** Persist progress to disk. */
function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

/** Sleep for `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the Anthropic API with exponential backoff on rate-limit / server errors.
 * Returns the parsed array of rephrased questions, or the original batch on
 * unrecoverable parse failure.
 */
async function rephraseWithBackoff(client, batch, batchIndex, totalBatches) {
  const systemPrompt =
    'You are an expert securities exam writer. Rephrase each SIE exam question using different wording while:\n' +
    '- Preserving the exact same concept being tested\n' +
    '- Keeping the same correct answer index (a field)\n' +
    '- Keeping the same topic (t field) and section (s field)\n' +
    '- Keeping the same number (n field)\n' +
    '- Updating the rationale (r field) to match the new wording\n' +
    '- Making the question sound natural and professional\n' +
    'Return ONLY a JSON array of rephrased question objects, no other text.';

  const userMessage =
    'Rephrase the following SIE exam questions. Return ONLY a valid JSON array.\n\n' +
    JSON.stringify(batch, null, 2);

  let delay = INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock) {
        throw new Error('No text block in response');
      }

      // Strip potential markdown code fences
      let raw = textBlock.text.trim();
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

      const rephrased = JSON.parse(raw);

      if (!Array.isArray(rephrased) || rephrased.length !== batch.length) {
        throw new Error(
          `Expected array of length ${batch.length}, got ${Array.isArray(rephrased) ? rephrased.length : typeof rephrased}`
        );
      }

      return rephrased;
    } catch (err) {
      const isRateLimit =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        (err.status && err.status >= 500);

      const isParseError = err instanceof SyntaxError || (err.message && err.message.includes('Expected array'));

      if (isParseError) {
        console.warn(
          `  Batch ${batchIndex + 1}/${totalBatches}: JSON parse error on attempt ${attempt} — keeping originals.`
        );
        return batch; // fall back to original questions
      }

      if (!isRateLimit || attempt === MAX_RETRIES) {
        console.error(
          `  Batch ${batchIndex + 1}/${totalBatches}: Unrecoverable error after ${attempt} attempt(s): ${err.message}`
        );
        console.warn('  Keeping original questions for this batch.');
        return batch;
      }

      console.warn(
        `  Batch ${batchIndex + 1}/${totalBatches}: Rate-limit/server error (attempt ${attempt}/${MAX_RETRIES}). ` +
          `Retrying in ${delay / 1000}s…`
      );
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }

  // Should not reach here, but return originals as safety net
  return batch;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log('Loading questions from', QUESTIONS_FILE);
  const questions = loadQuestions();
  console.log(`Loaded ${questions.length} questions.`);

  // Split into batches
  const batches = [];
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    batches.push(questions.slice(i, i + BATCH_SIZE));
  }
  const totalBatches = batches.length;
  console.log(`Split into ${totalBatches} batches of up to ${BATCH_SIZE} questions each.`);

  // Load existing progress
  const progress = loadProgress();
  const completedSet = new Set(progress.completedBatches);

  // Build result array; pre-fill with any already-processed questions
  // Keep a map from question number to result for easy lookup
  const resultMap = new Map();
  for (const q of progress.results) {
    resultMap.set(q.n, q);
  }

  let processed = progress.results.length;
  console.log(`Resuming from progress: ${completedSet.size} batches already completed (${processed} questions).`);

  // Process each batch
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    if (completedSet.has(batchIdx)) {
      // Already done
      continue;
    }

    const batch = batches[batchIdx];
    process.stdout.write(`Processing batch ${batchIdx + 1}/${totalBatches}… `);

    const rephrased = await rephraseWithBackoff(client, batch, batchIdx, totalBatches);

    // Merge rephrased results into resultMap
    for (const q of rephrased) {
      resultMap.set(q.n, q);
    }

    processed += batch.length;
    completedSet.add(batchIdx);
    progress.completedBatches = Array.from(completedSet);
    progress.results = Array.from(resultMap.values());
    saveProgress(progress);

    console.log(`Batch ${batchIdx + 1}/${totalBatches} complete (${processed} questions processed)`);

    // Small courtesy delay between requests to avoid bursting the rate limit
    if (batchIdx < totalBatches - 1) {
      await sleep(500);
    }
  }

  // Reconstruct final sorted array (by question number)
  const finalQuestions = Array.from(resultMap.values()).sort((a, b) => a.n - b.n);

  // Write output file in the same format as questions.js
  const lines = finalQuestions.map((q) => JSON.stringify(q));
  const outputContent = 'const DB=[\n' + lines.join(',\n') + '\n];\n';
  fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf8');

  console.log(`\nDone! ${finalQuestions.length} rephrased questions written to ${OUTPUT_FILE}`);
  console.log('Progress file retained at', PROGRESS_FILE);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
