#!/usr/bin/env node
/**
 * update-questions.js — Periodic question bank maintenance report.
 *
 * Usage:
 *   node scripts/update-questions.js
 *
 * What it does:
 *  1. Reads questions from js/questions.js
 *  2. Reports statistics (total count, per-section, per-topic)
 *  3. Checks whether js/questions-rephrased.js is in sync
 *  4. Reads source URLs from scripts/question-sources.json
 *  5. Writes a report to scripts/update-report.json
 *  6. Prints a summary to the console
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const QUESTIONS_FILE = path.join(ROOT, 'js', 'questions.js');
const REPHRASED_FILE = path.join(ROOT, 'js', 'questions-rephrased.js');
const SOURCES_FILE = path.join(__dirname, 'question-sources.json');
const REPORT_FILE = path.join(__dirname, 'update-report.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a questions file that contains: const DB=[...];
 * Returns a plain JS array.
 */
function loadQuestionsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const src = fs.readFileSync(filePath, 'utf8');
  const match = src.match(/const\s+DB\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!match) {
    throw new Error('Could not locate DB array in ' + filePath);
  }
  // eslint-disable-next-line no-new-func
  const db = new Function('return ' + match[1])();
  if (!Array.isArray(db)) {
    throw new Error('DB is not an array in ' + filePath);
  }
  return db;
}

/**
 * Build a frequency map from an array of values.
 * Returns { value: count } sorted by value.
 */
function frequencyMap(values) {
  const map = {};
  for (const v of values) {
    map[v] = (map[v] || 0) + 1;
  }
  // Return sorted by key
  return Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  );
}

/** Right-pad a string to a given width. */
function pad(str, width) {
  return String(str).padEnd(width);
}

/** Left-pad a number to a given width. */
function lpad(num, width) {
  return String(num).padStart(width);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const now = new Date().toISOString();

  // ── 1. Load primary question bank ─────────────────────────────────────────
  console.log('Loading question bank from', QUESTIONS_FILE);
  let questions;
  try {
    questions = loadQuestionsFile(QUESTIONS_FILE);
  } catch (err) {
    console.error('Error loading questions.js:', err.message);
    process.exit(1);
  }
  const totalQuestions = questions.length;

  // ── 2. Compute statistics ─────────────────────────────────────────────────
  const sections = frequencyMap(questions.map((q) => q.s));
  const topics = frequencyMap(questions.map((q) => q.t));

  // ── 3. Load rephrased file and check sync ─────────────────────────────────
  let rephrasedStatus = 'not_found';
  let rephrasedCount = 0;
  let syncDetails = null;

  const rephrasedQuestions = loadQuestionsFile(REPHRASED_FILE);
  if (rephrasedQuestions !== null) {
    rephrasedCount = rephrasedQuestions.length;

    if (rephrasedCount === totalQuestions) {
      // Check that question numbers match
      const originalNums = new Set(questions.map((q) => q.n));
      const rephrasedNums = new Set(rephrasedQuestions.map((q) => q.n));

      const missingFromRephrased = [...originalNums].filter((n) => !rephrasedNums.has(n));
      const extraInRephrased = [...rephrasedNums].filter((n) => !originalNums.has(n));

      if (missingFromRephrased.length === 0 && extraInRephrased.length === 0) {
        rephrasedStatus = 'in_sync';
        syncDetails = 'All question numbers match.';
      } else {
        rephrasedStatus = 'out_of_sync';
        syncDetails = {
          missingFromRephrased: missingFromRephrased.slice(0, 20),
          extraInRephrased: extraInRephrased.slice(0, 20),
        };
      }
    } else {
      rephrasedStatus = 'out_of_sync';
      syncDetails = `Count mismatch: original=${totalQuestions}, rephrased=${rephrasedCount}`;
    }
  }

  // ── 4. Load source URLs ───────────────────────────────────────────────────
  let sourcesData = null;
  if (fs.existsSync(SOURCES_FILE)) {
    try {
      sourcesData = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    } catch (err) {
      console.warn('Warning: could not parse question-sources.json:', err.message);
    }
  } else {
    console.warn('Warning: question-sources.json not found at', SOURCES_FILE);
  }

  // Date last updated: from metadata in sources file, or file mtime
  let lastUpdated = null;
  if (sourcesData && sourcesData.metadata && sourcesData.metadata.lastUpdated) {
    lastUpdated = sourcesData.metadata.lastUpdated;
  } else {
    try {
      const stat = fs.statSync(QUESTIONS_FILE);
      lastUpdated = stat.mtime.toISOString();
    } catch {
      lastUpdated = 'unknown';
    }
  }

  // ── 5. Build and write report ─────────────────────────────────────────────
  const report = {
    generatedAt: now,
    questionsFile: QUESTIONS_FILE,
    lastUpdated,
    totalQuestions,
    sections,
    topics,
    rephrasedFile: {
      path: REPHRASED_FILE,
      exists: rephrasedQuestions !== null,
      count: rephrasedCount,
      status: rephrasedStatus,
      details: syncDetails,
    },
    sources: sourcesData
      ? {
          lastChecked: sourcesData.lastChecked,
          count: sourcesData.sources ? sourcesData.sources.length : 0,
          entries: sourcesData.sources || [],
        }
      : null,
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');

  // ── 6. Print summary ──────────────────────────────────────────────────────
  const SEP = '─'.repeat(60);

  console.log('\n' + SEP);
  console.log('  SIE Quiz — Question Bank Update Report');
  console.log(SEP);
  console.log(`  Generated:      ${now}`);
  console.log(`  Last Updated:   ${lastUpdated || 'unknown'}`);
  console.log(`  Total Questions: ${totalQuestions}`);
  console.log('');

  // Per-section table
  console.log('  Questions by Section:');
  for (const [section, count] of Object.entries(sections)) {
    const bar = '█'.repeat(Math.round((count / totalQuestions) * 30));
    console.log(`    ${pad(section, 4)}  ${lpad(count, 5)}  ${bar}`);
  }
  console.log('');

  // Per-topic table (sorted by count desc)
  console.log('  Questions by Topic:');
  const topicsSorted = Object.entries(topics).sort(([, a], [, b]) => b - a);
  for (const [topic, count] of topicsSorted) {
    console.log(`    ${pad(topic, 28)}  ${lpad(count, 5)}`);
  }
  console.log('');

  // Sync status
  console.log('  Rephrased File Status:');
  if (!report.rephrasedFile.exists) {
    console.log('    questions-rephrased.js  NOT FOUND');
    console.log('    Run: npm run rephrase   to generate it.');
  } else if (rephrasedStatus === 'in_sync') {
    console.log(`    questions-rephrased.js  IN SYNC  (${rephrasedCount} questions)`);
  } else {
    console.log(`    questions-rephrased.js  OUT OF SYNC`);
    console.log(`    Details: ${JSON.stringify(syncDetails)}`);
    console.log('    Run: npm run rephrase   to regenerate.');
  }
  console.log('');

  // Sources
  if (sourcesData && sourcesData.sources) {
    console.log('  Content Sources to Check:');
    for (const src of sourcesData.sources) {
      console.log(`    • ${src.name}`);
      console.log(`      ${src.url}`);
      if (src.notes) console.log(`      Note: ${src.notes}`);
    }
    if (sourcesData.lastChecked) {
      console.log(`  Last checked: ${sourcesData.lastChecked}`);
    } else {
      console.log('  Sources have not been checked yet.');
    }
    console.log('');
  }

  console.log(`  Report written to: ${REPORT_FILE}`);
  console.log(SEP + '\n');
}

main();
