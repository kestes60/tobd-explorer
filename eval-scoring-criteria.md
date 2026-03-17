# TOBD Prompt Eval — Scoring Criteria & Claude Code Briefing

## What this system does

A Node.js eval script (`eval-tobd-prompt.js`) that:
1. Takes each item in `eval-test-set.json`
2. Runs the current `processTOBD` prompt (from the worker) against it using claude-haiku
3. Scores the output against 6 binary criteria using claude-sonnet as the judge
4. If overall pass rate < 80%, asks claude-sonnet to rewrite the prompt and retests
5. Loops up to 5 iterations
6. Writes the winning prompt to `improved-prompt.txt`

---

## The 6 Scoring Criteria (ALL binary: pass = 1, fail = 0)

### Criterion 1 — `tobdLength`
**Rule:** The `tobd` field must be 2, 3, or 4 sentences. No more. No less.  
**Fail if:** 1 sentence (too shallow) or 5+ sentences (too long, loses focus).  
**Why it matters:** The app card shows this text in a compact space. Anything longer overwhelms; shorter feels dismissive.

---

### Criterion 2 — `tobdHitsReversal`
**Rule:** The `tobd` text must explicitly name or clearly reference the correct reversal (the one listed in `_passCriteria.tobdHitsReversal`).  
**Fail if:** The text is generically about "design" or "engineering" without connecting to the specific reversal. Also fail if it names the WRONG reversal.  
**Why it matters:** The whole point of the app is connecting news to the TOBD framework. Vague design-talk doesn't do that.

---

### Criterion 3 — `creationArticleMode`
**Rule:** Only applies to items where `input.type === "creation"` and `_passCriteria.creationArticleMode === true`.  
For these items, the `tobd` text must **highlight** the engineering insight the article already makes — it must NOT reinterpret the article through the TOBD lens as if it were a secular article.  
**Pass signal:** `tobd` opens with what the author/article argues, then connects it to the reversal.  
**Fail signal:** `tobd` opens with "Through the TOBD lens..." or "While the article claims..." or treats the creation science article as if it needs correction.  
**For secular articles:** Criterion 3 auto-passes (score = 1) — it doesn't apply.  
**Why it matters:** Creation science articles are already TOBD-aligned. Treating them like secular articles makes the app look confused about its own sources.

---

### Criterion 4 — `shareTextUnder250`
**Rule:** The entire `shareText` field — including all newlines — must be 250 characters or fewer.  
**How to count:** `shareText.length <= 250` (raw string length including newlines).  
**Fail if:** Over 250 characters. No exceptions.  
**Why it matters:** X (Twitter) enforces a character limit. Posts that exceed it silently fail or get truncated.

---

### Criterion 5 — `shareTextNoVerbatimHeadline`
**Rule:** The first line of `shareText` must paraphrase the headline — it must NOT copy it word-for-word.  
**Fail if:** The first line of `shareText` is identical to `input.headline`, or differs only in capitalization/punctuation.  
**Pass if:** The first line captures the story in different words, even if it conveys the same meaning.  
**Why it matters:** Verbatim headlines are lazy and feel automated. A paraphrase shows voice and editorial judgment.

---

### Criterion 6 — `linkedInHasBoldHeaders`
**Rule:** The `linkedInText` field must contain at least 3 of the expected Unicode bold section headers.  
**Required headers (Unicode bold):**  
- `𝗪𝗵𝗮𝘁` (appears in "What they found" or "What the study shows" etc.)
- `𝗧𝗵𝗲` (appears in "The evolutionary claim" or "The engineering insight" etc.)  
- `𝗧𝗢𝗕𝗗` (appears in "TOBD Reversal #N")  
**Fail if:** Plain text headers like "**What they found:**" are used instead of Unicode bold.  
**Why it matters:** LinkedIn strips markdown bold. The Unicode bold characters are the only way to get visual hierarchy on LinkedIn. If these aren't present, the post looks like a wall of text.

---

## Scoring logic

```
itemScore = (sum of 6 criterion scores) / 6
overallPassRate = (sum of all itemScores) / totalItems
```

Target: `overallPassRate >= 0.80` to accept the prompt.

---

## What to tell claude-sonnet when a run fails

When asking Sonnet to rewrite the prompt, give it:
1. The current prompt text
2. Each failing item: `{ headline, criterion that failed, what the output was, what was expected }`
3. This instruction:

> "Rewrite the processTOBD prompt to fix the failures listed above without breaking the items that already passed. Do not change the output JSON schema. The prompt should work for both secular and creation science articles — for creation science articles, the model should highlight the engineering insight the author is already making, not reinterpret it as if it were a secular source. Return only the new prompt text, nothing else."

---

## Files needed in the repo

| File | Purpose |
|------|---------|
| `eval-test-set.json` | Golden test cases (already written) |
| `eval-scoring-criteria.md` | This file |
| `eval-tobd-prompt.js` | The eval loop script (Claude Code writes this) |
| `improved-prompt.txt` | Output — the winning prompt after eval loop |

---

## Claude Code prompt to build `eval-tobd-prompt.js`

> Create a Node.js script called `eval-tobd-prompt.js` in the repo root.
>
> It should:
> 1. Read `eval-test-set.json`
> 2. Read the current processTOBD prompt from a variable at the top of the file (paste it in as a string called `CURRENT_PROMPT`)
> 3. For each test item, call the Anthropic API (claude-haiku-4-5-20251001) with the current prompt, substituting the item's `input` fields
> 4. Score each output against the 6 binary criteria in `eval-scoring-criteria.md` — use claude-sonnet-4-5 as the judge, passing it the criteria and the output, asking for a JSON object with each criterion's pass/fail and a one-sentence reason for each failure
> 5. Calculate overall pass rate. If >= 0.80, write the current prompt to `improved-prompt.txt` and exit with a success message.
> 6. If < 0.80, ask claude-sonnet-4-5 to rewrite the prompt (see briefing above), replace `CURRENT_PROMPT` with the new prompt, and repeat from step 3
> 7. Loop up to 5 times. After 5 loops, write the best-scoring prompt to `improved-prompt.txt` regardless.
> 8. Print a table to the console after each loop showing: item ID, pass rate, which criteria failed.
>
> Use the ANTHROPIC_API_KEY environment variable for auth. No hardcoded keys.
> Use `node-fetch` or native fetch (Node 18+). No other dependencies.

---

## Notes on running it

```bash
ANTHROPIC_API_KEY=your_key_here node eval-tobd-prompt.js
```

The initial `CURRENT_PROMPT` in the script is the prompt text currently inside `processTOBD()` in `tobd-newsfeed-worker.js`. Copy it in verbatim before running.

Once you have an `improved-prompt.txt` you're happy with, Keith pastes it back into the worker and deploys.
