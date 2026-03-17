#!/usr/bin/env node

/**
 * TOBD Prompt Eval Loop
 *
 * Runs test items through the processTOBD prompt, scores outputs against
 * 6 binary criteria using Claude Sonnet as judge, and iteratively improves
 * the prompt until pass rate >= 0.80 or 5 loops complete.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node eval-tobd-prompt.js
 */

import { readFileSync, writeFileSync } from 'fs';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ERROR: Set ANTHROPIC_API_KEY environment variable.');
  process.exit(1);
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';
const MAX_LOOPS = 5;
const PASS_THRESHOLD = 0.80;

// ─── Current processTOBD prompt (from tobd-newsfeed-worker.js) ─────────────────
const REVERSALS = `
Reversal #1 — Life & Operations: Life enables biology; not the other way around.
Reversal #2 — Agency & Purpose: Organisms are active agents, not passive products of external forces.
Reversal #3 — Adaptation & Environment: Organisms track and respond to environments via innate CET systems; the environment does nothing to them.
Reversal #4 — Causation & Design: Engineering causality (designed internal systems) explains adaptation; randomness + selection does not.
Reversal #5 — Externalism vs. Internalism: Innate internal systems drive all adaptation; external forces are merely triggers.
Reversal #6 — Common Design vs. Common Ancestry: Similar features across organisms reflect a common Designer, not common descent.
`;

function buildPrompt(currentPromptTemplate, item) {
  return currentPromptTemplate
    .replace('${item.source}', item.input.source)
    .replace("${item.type === 'secular' ? 'secular science' : 'creation science'}", item.input.type === 'secular' ? 'secular science' : 'creation science')
    .replace('${item.headline}', item.input.headline)
    .replace('${item.description || \'(no summary available)\'}', item.input.description || '(no summary available)')
    .replace('${articleText || \'(not available)\'}', item.input.articleText || '(not available)')
    .replace('${REVERSALS}', REVERSALS);
}

let CURRENT_PROMPT = `You are analyzing a science news article through the TOBD (Theory of Biological Design) lens developed by Dr. Randy Guliuzza of the Institute for Creation Research.

STEP 1: Determine if this article is biologically relevant. If not, return ONLY: {"skip": true}

STEP 2: If biologically relevant, analyze through the TOBD lens.

TOBD Reversals:
\${REVERSALS}

Article:
Source: \${item.source} (\${item.type === 'secular' ? 'secular science' : 'creation science'})
Headline: "\${item.headline}"
Summary: \${item.description || '(no summary available)'}
Full article text: \${articleText || '(not available)'}

Return ONLY a JSON object with these exact fields, no other text:
{
  "tobd": "2-4 sentence TOBD interpretation. Connect to the relevant reversal. Clear and accessible.",
  "reversal": "Reversal #N",
  "reversalTitle": "Title of the reversal",
  "shareText": "X post. Four lines exactly:\\nLine 1: Paraphrased headline in double quotes — max 60 characters\\nLine 2: 'TOBD Reversal #N in action:' then one tight engineering insight clause — entire line max 120 characters\\nLine 3: '#TOBD #Biology @ICRscience'\\nNo URL. No extra text.",
  "linkedInText": "A LinkedIn post. Format exactly as follows with Unicode bold headers:\\n Line 1: A clever question hook that gets to the point — one sentence ending in em dash or question mark\\n\\n𝗪𝗵𝗮𝘁 𝘁𝗵𝗲𝘆 𝗳𝗼𝘂𝗻𝗱:\\n• [factual finding from the study]\\n• [factual finding from the study]\\n• [factual finding from the study]\\n(3-5 bullets of actual evidence from the article. Facts only, no quotes, no interpretation yet.)\\n\\n𝗧𝗵𝗲 𝗲𝘃𝗼𝗹𝘂𝘁𝗶𝗼𝗻𝗮𝗿𝘆 𝗰𝗹𝗮𝗶𝗺:\\n• [their interpretation of the evidence — 1-2 bullets]\\n\\n𝗧𝗢𝗕𝗗 𝗥𝗲𝘃𝗲𝗿𝘀𝗮𝗹 #𝗡 — 𝘁𝗵𝗲 𝗲𝗻𝗴𝗶𝗻𝗲𝗲𝗿𝗶𝗻𝗴 𝘃𝗶𝗲𝘄:\\n• [TOBD insight bullet]\\n• [TOBD insight bullet]\\n• [TOBD insight bullet]\\n\\nOne closing sentence connecting the evidence to design.\\n\\n#TOBD #Biology #CreationScience"
}`;

// ─── Anthropic API caller ──────────────────────────────────────────────────────
async function callAnthropic(model, messages, maxTokens = 2000) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ─── Run Haiku to generate output for a test item ──────────────────────────────
async function generateOutput(promptTemplate, item) {
  const prompt = buildPrompt(promptTemplate, item);
  const text = await callAnthropic(HAIKU_MODEL, [{ role: 'user', content: prompt }], 800);
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    console.error(`  Failed to parse JSON for ${item._id}:`, text.slice(0, 200));
    return null;
  }
}

// ─── Score output with Sonnet as judge ─────────────────────────────────────────
async function scoreOutput(item, output) {
  if (!output) {
    return {
      tobdLength: { pass: false, reason: 'No output generated' },
      tobdHitsReversal: { pass: false, reason: 'No output generated' },
      creationArticleMode: { pass: false, reason: 'No output generated' },
      shareTextUnder250: { pass: false, reason: 'No output generated' },
      shareTextNoVerbatimHeadline: { pass: false, reason: 'No output generated' },
      linkedInHasBoldHeaders: { pass: false, reason: 'No output generated' },
    };
  }

  const judgePrompt = `You are a strict eval judge. Score the following AI output against 6 binary criteria. Return ONLY a JSON object, no other text.

INPUT CONTEXT:
- Source: ${item.input.source} (${item.input.type})
- Headline: "${item.input.headline}"
- Expected reversal: ${item._passCriteria.tobdHitsReversal}
- Is creation article: ${item.input.type === 'creation'}

AI OUTPUT:
${JSON.stringify(output, null, 2)}

CRITERIA:

1. tobdLength: The "tobd" field must be 2, 3, or 4 sentences. Count sentences by terminal punctuation (. ! ?). Fail if 1 sentence or 5+ sentences.

2. tobdHitsReversal: The "tobd" text must explicitly name or clearly reference "${item._passCriteria.tobdHitsReversal}". Fail if it names the wrong reversal or is vague about design without connecting to the specific reversal.

3. creationArticleMode: ${item.input.type === 'creation' ? 'This is a creation science article. The "tobd" text must HIGHLIGHT the engineering insight the article already makes — it must NOT reinterpret it as if it were secular. Fail if tobd opens with "Through the TOBD lens..." or treats the article as needing correction. Pass if tobd opens with what the author/article argues, then connects to the reversal.' : 'This is a secular article. Auto-pass (score = true).'}

4. shareTextUnder250: The entire "shareText" field must be 250 characters or fewer (raw string length including newlines). Count the characters precisely. Fail if over 250.

5. shareTextNoVerbatimHeadline: The first line of "shareText" must NOT be identical to the headline "${item.input.headline}" (ignoring case/punctuation differences). Fail if it copies the headline verbatim.

6. linkedInHasBoldHeaders: The "linkedInText" field must contain at least 3 of these Unicode bold strings: "𝗪𝗵𝗮𝘁", "𝗧𝗵𝗲", "𝗧𝗢𝗕𝗗". Fail if plain text headers are used instead of Unicode bold.

Return ONLY this JSON (no markdown, no explanation):
{
  "tobdLength": { "pass": true/false, "reason": "..." },
  "tobdHitsReversal": { "pass": true/false, "reason": "..." },
  "creationArticleMode": { "pass": true/false, "reason": "..." },
  "shareTextUnder250": { "pass": true/false, "reason": "..." },
  "shareTextNoVerbatimHeadline": { "pass": true/false, "reason": "..." },
  "linkedInHasBoldHeaders": { "pass": true/false, "reason": "..." }
}

For each criterion, provide a one-sentence reason ONLY if it fails. If it passes, reason can be empty string.`;

  const text = await callAnthropic(SONNET_MODEL, [{ role: 'user', content: judgePrompt }], 1000);
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    console.error(`  Failed to parse judge JSON for ${item._id}:`, text.slice(0, 200));
    return {
      tobdLength: { pass: false, reason: 'Judge parse error' },
      tobdHitsReversal: { pass: false, reason: 'Judge parse error' },
      creationArticleMode: { pass: false, reason: 'Judge parse error' },
      shareTextUnder250: { pass: false, reason: 'Judge parse error' },
      shareTextNoVerbatimHeadline: { pass: false, reason: 'Judge parse error' },
      linkedInHasBoldHeaders: { pass: false, reason: 'Judge parse error' },
    };
  }
}

// ─── Ask Sonnet to rewrite the prompt ──────────────────────────────────────────
async function rewritePrompt(currentPrompt, failures) {
  const failureDetails = failures.map(f => {
    const failedCriteria = Object.entries(f.scores)
      .filter(([, v]) => !v.pass)
      .map(([k, v]) => `  - ${k}: ${v.reason}`)
      .join('\n');
    return `Item "${f.headline}" (expected ${f.expectedReversal}):\n${failedCriteria}`;
  }).join('\n\n');

  const rewriteRequest = `Here is the current processTOBD prompt used to analyze science articles through the TOBD (Theory of Biological Design) lens:

--- CURRENT PROMPT ---
${currentPrompt}
--- END PROMPT ---

The prompt was tested against golden test cases and FAILED on these items:

${failureDetails}

Rewrite the processTOBD prompt to fix the failures listed above without breaking the items that already passed. Do not change the output JSON schema. The prompt should work for both secular and creation science articles — for creation science articles, the model should highlight the engineering insight the author is already making, not reinterpret it as if it were a secular source. Return only the new prompt text, nothing else.

IMPORTANT: The prompt must contain these exact template placeholders (they get substituted at runtime):
- \${REVERSALS}
- \${item.source}
- \${item.type === 'secular' ? 'secular science' : 'creation science'}
- \${item.headline}
- \${item.description || '(no summary available)'}
- \${articleText || '(not available)'}`;

  const text = await callAnthropic(SONNET_MODEL, [{ role: 'user', content: rewriteRequest }], 3000);
  return text.trim();
}

// ─── Print results table ───────────────────────────────────────────────────────
function printTable(results) {
  const CRITERIA = ['tobdLength', 'tobdHitsReversal', 'creationArticleMode', 'shareTextUnder250', 'shareTextNoVerbatimHeadline', 'linkedInHasBoldHeaders'];

  console.log('\n┌────────────────┬───────────┬─────────────────────────────────────────────┐');
  console.log('│ Item ID        │ Pass Rate │ Failed Criteria                             │');
  console.log('├────────────────┼───────────┼─────────────────────────────────────────────┤');

  for (const r of results) {
    const passed = CRITERIA.filter(c => r.scores[c]?.pass).length;
    const rate = (passed / 6).toFixed(2);
    const failed = CRITERIA.filter(c => !r.scores[c]?.pass);
    const failedStr = failed.length === 0 ? '(none)' : failed.join(', ');
    const id = r.id.padEnd(14);
    const rateStr = rate.padEnd(9);
    const failStr = failedStr.length > 43 ? failedStr.slice(0, 40) + '...' : failedStr.padEnd(43);
    console.log(`│ ${id} │ ${rateStr} │ ${failStr} │`);
  }

  console.log('└────────────────┴───────────┴─────────────────────────────────────────────┘');
}

// ─── Main eval loop ────────────────────────────────────────────────────────────
async function main() {
  const testSet = JSON.parse(readFileSync('eval-test-set.json', 'utf-8'));
  console.log(`Loaded ${testSet.length} test items.`);

  let currentPrompt = CURRENT_PROMPT;
  let bestPrompt = currentPrompt;
  let bestScore = 0;

  for (let loop = 1; loop <= MAX_LOOPS; loop++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`LOOP ${loop}/${MAX_LOOPS}`);
    console.log('='.repeat(60));

    const results = [];

    for (const item of testSet) {
      console.log(`  Processing ${item._id}...`);
      const output = await generateOutput(currentPrompt, item);
      console.log(`  Scoring ${item._id}...`);
      const scores = await scoreOutput(item, output);
      results.push({
        id: item._id,
        headline: item.input.headline,
        expectedReversal: item._passCriteria.tobdHitsReversal,
        output,
        scores,
      });
      // Small delay between API calls
      await new Promise(r => setTimeout(r, 500));
    }

    // Calculate overall pass rate
    const CRITERIA = ['tobdLength', 'tobdHitsReversal', 'creationArticleMode', 'shareTextUnder250', 'shareTextNoVerbatimHeadline', 'linkedInHasBoldHeaders'];
    let totalPassed = 0;
    let totalCriteria = 0;

    for (const r of results) {
      for (const c of CRITERIA) {
        totalCriteria++;
        if (r.scores[c]?.pass) totalPassed++;
      }
    }

    const overallRate = totalPassed / totalCriteria;

    printTable(results);
    console.log(`\nOverall pass rate: ${(overallRate * 100).toFixed(1)}% (${totalPassed}/${totalCriteria})`);

    if (overallRate > bestScore) {
      bestScore = overallRate;
      bestPrompt = currentPrompt;
    }

    if (overallRate >= PASS_THRESHOLD) {
      writeFileSync('improved-prompt.txt', currentPrompt);
      console.log(`\n✓ Pass rate ${(overallRate * 100).toFixed(1)}% >= ${PASS_THRESHOLD * 100}% — prompt saved to improved-prompt.txt`);
      return;
    }

    if (loop < MAX_LOOPS) {
      console.log(`\nPass rate ${(overallRate * 100).toFixed(1)}% < ${PASS_THRESHOLD * 100}% — asking Sonnet to rewrite prompt...`);

      const failures = results.filter(r => {
        return CRITERIA.some(c => !r.scores[c]?.pass);
      });

      const newPrompt = await rewritePrompt(currentPrompt, failures);
      currentPrompt = newPrompt;
      console.log('Prompt rewritten. Retesting...');
    }
  }

  // After 5 loops, write best prompt
  writeFileSync('improved-prompt.txt', bestPrompt);
  console.log(`\nMax loops reached. Best score: ${(bestScore * 100).toFixed(1)}%. Best prompt saved to improved-prompt.txt`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
