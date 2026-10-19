// Zero-dependency regression tests for the Quick Fix engine.
// Run: node tests/regression.mjs   (exit code 1 on any failure)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { quickFix, DEEP_REWRITE_MODELS } from '../js/humaniser.js';
import {
  transformHumaniser,
  fixEnglishArticlesAndGrammar,
  highlightChangedTerms,
  analyzeAIProbabilities,
  VOICE_MODES,
  INTENSITIES,
} from '../js/workbench.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
}

// Same corpus as test.mjs (3 paragraphs of typical LLM prose).
const CORPUS = `In today's rapidly evolving technological landscape, artificial intelligence has emerged as a truly transformative force that is fundamentally reshaping how organizations operate. It is crucial to understand that leveraging these cutting-edge innovations requires a comprehensive and holistic approach. Furthermore, the seamless integration of machine learning into existing workflows serves as a testament to the innovative spirit that drives modern enterprises forward.

Moreover, it is worth noting that the multifaceted nature of this transformative technology underscores the need for meticulous planning and robust infrastructure. Stakeholders must navigate the intricate challenges that arise when embarking on such unprecedented endeavors. The pivotal role of data cannot be overstated — it is the cornerstone upon which all meaningful insights are built.

Additionally, organizations that harness the full potential of artificial intelligence are poised to gain a significant competitive advantage. This groundbreaking paradigm shift has the potential to revolutionize everything from customer engagement to operational efficiency. In conclusion, it is essential to foster a culture of continuous learning and adaptability in order to thrive in this ever-changing realm of technological advancement. Without a doubt, the future belongs to those who embrace innovation wholeheartedly.`;

const MODES = VOICE_MODES.map((m) => m.id);
const combos = [];
for (const style of MODES) for (const intensity of INTENSITIES) for (const variationSeed of [0, 1, 2, 3]) combos.push({ style, intensity, variationSeed });

console.log('Corpus artefacts & paragraphs');
test('no "(that is" / "(which is" parentheticals in any mode/intensity/variation', () => {
  for (const o of combos) {
    const out = quickFix(CORPUS, [], o.style, o).text;
    assert.ok(!/\((?:that|which) is\b/i.test(out), `${JSON.stringify(o)} produced: ${out.match(/.{0,30}\((?:that|which) is.{0,30}/i)?.[0]}`);
  }
});
test('no leaked regex back-references ($1..$9) in any output', () => {
  for (const o of combos) {
    const out = quickFix(CORPUS, [], o.style, o).text;
    assert.ok(!/\$\d/.test(out), `${JSON.stringify(o)} leaked: ${out.match(/.{0,20}\$\d.{0,20}/)?.[0]}`);
  }
});
test('paragraph breaks (\\n\\n) preserved: 3 paragraphs in -> 3 out', () => {
  for (const o of combos) {
    const out = quickFix(CORPUS, [], o.style, o).text;
    assert.equal(out.split('\n\n').length, 3, `${JSON.stringify(o)}`);
    assert.ok(!/\n{3,}/.test(out), 'no triple newlines');
  }
});
test('5-paragraph chat paste: wrapper + sign-off stripped, inner \\n\\n kept', () => {
  const text = 'Certainly! Here is a breakdown for your team:\n\nFirst paragraph about testing.\n\nSecond paragraph about deployment.\n\nThird paragraph about monitoring.\n\nLet me know if you\'d like any further adjustments!';
  const out = transformHumaniser(text, { style: 'chat' }).text;
  assert.equal(out, 'First paragraph about testing.\n\nSecond paragraph about deployment.\n\nThird paragraph about monitoring.');
});
test('"It is not just about X, it is about Y" rewritten without literal "$3"', () => {
  for (const style of MODES) {
    const out = transformHumaniser('It is not just about speed, it is about building a foundation.', { style }).text;
    assert.ok(!out.includes('$'), out);
    assert.ok(/speed/.test(out) && /building a foundation/.test(out), out);
  }
});

console.log('a/an phonetic healer');
const KEEP = ['an hour', 'a unique', 'a user', 'an LLM', 'an API', 'a one-time', 'a URL', 'an honest', 'a European', 'an SQL', 'an 8-hour'];
const FIX = {
  'a hour': 'an hour',
  'an unique': 'a unique',
  'an user': 'a user',
  'a LLM': 'an LLM',
  'a API': 'an API',
  'an one-time': 'a one-time',
  'an URL': 'a URL',
  'a apple': 'an apple',
  'an banana': 'a banana',
  'A hour': 'An hour',
};
test('correct articles are left unchanged', () => {
  for (const s of KEEP) assert.equal(fixEnglishArticlesAndGrammar(`It was ${s} thing.`), `It was ${s} thing.`);
});
test('wrong articles are corrected', () => {
  for (const [bad, good] of Object.entries(FIX)) assert.equal(fixEnglishArticlesAndGrammar(`${bad} thing`), `${good} thing`);
});
test('a/an cases survive the full pipeline in every mode', () => {
  const text = 'We booked an hour for a unique demo with a user, an LLM, an API and a one-time token.';
  for (const style of MODES) {
    const out = transformHumaniser(text, { style }).text;
    for (const s of ['an hour', 'a unique', 'a user', 'an LLM', 'an API', 'a one-time']) assert.ok(out.includes(s), `${style}: missing "${s}" in: ${out}`);
  }
});

console.log('Watermarks');
test('zero-width chars U+200B/200C/200D/FEFF/2060 stripped in every mode', () => {
  const zw = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u2060'];
  const text = `Hel${zw[0]}lo the${zw[1]}re.\uFEFF This is${zw[2]} a tes${zw[4]}t of hidden marks.\n\nSecond${zw[0]} para.`;
  for (const style of MODES) {
    const r = transformHumaniser(text, { style });
    for (const c of zw) assert.ok(!r.text.includes(c), `${style}: U+${c.codePointAt(0).toString(16).toUpperCase()} survived`);
    assert.equal(r.watermarksStripped, 6);
    assert.ok(r.text.includes('\n\n'));
  }
});

console.log('Voice modes');
test('every voice mode returns non-empty output for the corpus', () => {
  for (const style of MODES) {
    const out = quickFix(CORPUS, [], style).text;
    assert.ok(out.trim().length > 200, `${style} returned "${out.slice(0, 40)}"`);
  }
});
test('every pair of voice modes produces different output (no aliases)', () => {
  const probe = 'Furthermore, we ship weekly. However, tests do not run — they are skipped — and builds break.\n\n- **Speed:** we must go faster.\n\nIn conclusion, it is what it is.';
  const outs = Object.fromEntries(MODES.map((s) => [s, transformHumaniser(probe, { style: s }).text]));
  for (let i = 0; i < MODES.length; i++) {
    for (let j = i + 1; j < MODES.length; j++) {
      assert.notEqual(outs[MODES[i]], outs[MODES[j]], `${MODES[i]} and ${MODES[j]} are identical`);
    }
  }
});
test('academic mode expands n\'t contractions and never inserts them', () => {
  const out = transformHumaniser("We don't know. It is unclear and we can't say.", { style: 'academic' }).text;
  assert.ok(!/n't\b/.test(out), out);
  assert.ok(/do not/.test(out) && /cannot/.test(out) && /It is unclear/.test(out), out);
});
test('intensity changes behaviour (light skips severity<4 words and clause splitting)', () => {
  const text = 'This is a crucial step, ensuring that teams stay aligned.';
  const light = transformHumaniser(text, { intensity: 'light' }).text;
  const balanced = transformHumaniser(text, { intensity: 'balanced' }).text;
  assert.ok(/crucial/.test(light), light);
  assert.ok(!/crucial/.test(balanced) && !/ensuring that/.test(balanced), balanced);
});

console.log('Protected content');
const FENCE = '```js\n// Furthermore, we leverage a robust API — it is crucial\nconst re = s.replace(/x/g, "$&$1");\nconst a = "an user";\n```';
const INLINE = '`utilize(it is) — $1`';
const URL = 'https://example.com/delve/robust--landscape?it=is&a=hour';
test('fenced code, inline code and URLs pass through byte-identical (all modes/intensities)', () => {
  const text = `Furthermore, it is crucial to leverage this — see below.\n\n${FENCE}\n\nCall ${INLINE} or visit ${URL} for a robust guide.`;
  for (const o of combos) {
    const out = quickFix(text, [], o.style, o).text;
    assert.ok(out.includes(FENCE), `${JSON.stringify(o)}: fenced block changed`);
    assert.ok(out.includes(INLINE), `${JSON.stringify(o)}: inline code changed`);
    assert.ok(out.includes(URL), `${JSON.stringify(o)}: URL changed`);
  }
});

console.log('Highlight changes & detector');
test('highlightChangedTerms segments re-join to the exact output and mark inserted terms', () => {
  const r = transformHumaniser(CORPUS, { style: 'chat' });
  const segs = highlightChangedTerms(r.text, r.changedTerms);
  assert.ok(segs && segs.some((s) => s.isMatch));
  assert.equal(segs.map((s) => s.part).join(''), r.text);
});
test('analyzeAIProbabilities never returns NaN (e.g. "constructor", "toString")', () => {
  const r = analyzeAIProbabilities('The constructor calls toString and hasOwnProperty. Then it returns.');
  assert.ok(Number.isFinite(r.rawAIScore) && Number.isFinite(r.humanScore), JSON.stringify(r));
});

console.log('README / code agreement');
test('every Deep Rewrite model ID in code appears in README, and no retired/unknown Claude IDs are listed', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const id of Object.values(DEEP_REWRITE_MODELS)) assert.ok(readme.includes(`\`${id}\``), `README missing ${id}`);
  const claudeIds = readme.match(/claude-[a-z0-9-]+/g) || [];
  for (const id of claudeIds) assert.equal(id, DEEP_REWRITE_MODELS.anthropic, `README lists ${id} which the code does not use`);
});
test('README lists exactly the voice modes the engine implements', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const m of VOICE_MODES) assert.ok(readme.includes(m.label), `README missing mode "${m.label}"`);
  for (const gone of ['Conversational', 'Creative']) assert.ok(!new RegExp(`\\*\\*${gone}\\*\\*`).test(readme), `README still lists "${gone}"`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
