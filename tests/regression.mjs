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
  applyEnglishDialect,
  conjugateParticipleToPresent3rd,
  conjugateParticipleToInfinitive,
  highlightChangedTerms,
  analyzeAIProbabilities,
  computeWordLevelDiff,
  analyzeSentenceHeatmap,
  computeReadabilityAndDetectors,
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

console.log('v2.5 Academic Shield, LaTeX, Currency & Abbreviations');
test('APA/Harvard/IEEE citations, DOIs, arXiv IDs, and LaTeX math survive byte-identical', () => {
  const academicSample =
    'In the contemporary academic landscape, prior literature delves into attention scaling (Vaswani et al., 2017, pp. 142–158; Smith & Jones, 2024) and [1–3]. Furthermore, we evaluate $$\\mathcal{L}(\\theta) = \\sum_{i=1}^N x_i$$ and inline $E = mc^2$ across doi:10.1038/s41586-024-07998-x and arXiv:2401.12345v2.';
  const out = transformHumaniser(academicSample, { style: 'academic' }).text;
  assert.ok(out.includes('(Vaswani et al., 2017, pp. 142–158; Smith & Jones, 2024)'), out);
  assert.ok(out.includes('[1–3]'), out);
  assert.ok(out.includes('$$\\mathcal{L}(\\theta) = \\sum_{i=1}^N x_i$$'), out);
  assert.ok(out.includes('$E = mc^2$'), out);
  assert.ok(out.includes('doi:10.1038/s41586-024-07998-x'), out);
  assert.ok(out.includes('arXiv:2401.12345v2'), out);
});
test('Currency amounts ($20 ... $50) on the same line are never mistaken for LaTeX math', () => {
  const priceSample = 'Furthermore, teams paid $20 for the starter tier to delve into analytics and $50 for the enterprise tier.';
  const out = transformHumaniser(priceSample, { style: 'chat' }).text;
  assert.ok(out.includes('$20') && out.includes('$50'), out);
  assert.ok(!/\bdelve\b/i.test(out), out);
});
test('Scholarly abbreviations (et al., e.g., i.e., cf., vs., Fig.) do not trigger false mid-sentence capitalisation', () => {
  const abbrSample = 'Prior studies (e.g. reward modelling vs. direct preference optimisation, cf. Fig. 4) delve into alignment.';
  const out = transformHumaniser(abbrSample, { style: 'academic' }).text;
  assert.ok(out.includes('e.g. reward') && out.includes('vs. direct'), out);
});

console.log('v2.5 Context-Aware Semantic Collocation Shield (13 domains)');
test('Domain-specific literal compound terms are preserved 100% intact while surrounding AI clichés are rewritten', () => {
  const domainCases = [
    { input: 'Furthermore, stochastic gradient descent navigates the non-convex loss landscape to delve into minima.', mustKeep: 'loss landscape' },
    { input: 'Moreover, the CFO reduced financial leverage and leverage ratios to bolster the balance sheet.', mustKeep: 'financial leverage' },
    { input: 'Additionally, the heterogeneous platinum catalyst bed accelerates ammonia synthesis in the realm of industrial chemistry.', mustKeep: 'platinum catalyst' },
    { input: 'In conclusion, the medieval Bayeux Tapestry and tapestry weavers serve as a testament to Norman craftsmanship.', mustKeep: 'Bayeux Tapestry' },
    { input: 'Furthermore, the testator signed his Last Will and Testament and read the Old Testament.', mustKeep: 'Last Will and Testament' },
    { input: 'Moreover, as a Peer of the Realm, he utilized statutory authority.', mustKeep: 'Peer of the Realm' },
    { input: 'Additionally, the autopilot navigated the aircraft through the strait using Bluetooth beacons and beacon frames.', mustKeep: 'Bluetooth beacons' },
    { input: 'Furthermore, engineers utilized the automated test harness and wiring harness to validate the orbital trajectory across the electromagnetic spectrum.', mustKeep: 'test harness' },
    { input: 'Moreover, the shopping center signed an anchor tenant and updated its HTML anchor text.', mustKeep: 'anchor tenant' },
  ];
  for (const tc of domainCases) {
    const out = transformHumaniser(tc.input, { style: 'executive' }).text;
    assert.ok(out.includes(tc.mustKeep), `Lost collocation "${tc.mustKeep}" in: ${out}`);
  }
});

console.log('v2.5 Poetic Verse, Contractions, Dialect & Morphology');
test('Poetic verse stanzas with trailing em-dashes preserve every single \\n line break', () => {
  const poem = 'Across the quiet realm of winter skies —\nA tapestry of silver starlight lies,\nFurthermore, the morning beacon glows —\nAnd delves into the valley where it flows.';
  const out = transformHumaniser(poem, { style: 'casual' }).text;
  assert.equal(out.split('\n').length, 4, `Line breaks lost:\n${out}`);
});
test('Smart "it\'s" disambiguation ("it has been" vs "it is") and modal "have to" guard', () => {
  const text = "It's been a long journey and it's clear that you have to test carefully.";
  const acad = transformHumaniser(text, { style: 'academic' }).text;
  assert.ok(acad.includes('It has been') && acad.includes('it is clear'), acad);
  const casual = transformHumaniser('You have to verify that they have to pass.', { style: 'casual', useContractions: true }).text;
  assert.ok(!/you've to|they've to/i.test(casual), casual);
});
test('UK (en-GB) and US (en-US) dialect calibration converts spelling accurately', () => {
  const uk = applyEnglishDialect('We optimize and analyze organization behavior at the center.', 'uk');
  assert.equal(uk, 'We optimise and analyse organisation behaviour at the centre.');
  const us = applyEnglishDialect(uk, 'us');
  assert.equal(us, 'We optimize and analyze organization behavior at the center.');
});
test('Morphological participle converter handles irregular, -y, -e, and consonant-doubling verbs', () => {
  assert.equal(conjugateParticipleToPresent3rd('reducing'), 'reduces');
  assert.equal(conjugateParticipleToPresent3rd('amplifying'), 'amplifies');
  assert.equal(conjugateParticipleToPresent3rd('creating'), 'creates');
  assert.equal(conjugateParticipleToPresent3rd('fostering'), 'fosters');
  assert.equal(conjugateParticipleToInfinitive('reducing'), 'reduce');
  assert.equal(conjugateParticipleToInfinitive('amplifying'), 'amplify');
});
test('Visual Word Diff, Sentence Heatmap, and Multi-Detector Radar return valid structures', () => {
  const out = transformHumaniser(CORPUS, { style: 'chat' });
  const diff = computeWordLevelDiff(CORPUS, out.text);
  assert.ok(diff.length > 0 && diff.some((d) => d.type === 'added') && diff.some((d) => d.type === 'removed'));
  const heatmap = analyzeSentenceHeatmap(out.text, 'chat');
  assert.ok(heatmap.length >= 6 && heatmap.every((h) => ['high', 'moderate', 'human'].includes(h.tier)));
  const afterStats = analyzeAIProbabilities(out.text, 'chat');
  const radar = computeReadabilityAndDetectors(out.text, afterStats.rawAIScore, afterStats.burstinessCV, afterStats.lexicalDiversityTTR, afterStats.emDashCount);
  assert.equal(radar.detectors.length, 4);
  assert.ok(Number.isFinite(radar.fkGrade));
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

console.log('Client-Side Security Hardening (CSP, BYOK Storage, DOM-XSS Immunity)');
test('index.html enforces strict CSP connect-src, no-referrer policy, and session-default key storage', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('http-equiv="Content-Security-Policy"'), 'Missing CSP meta tag');
  assert.ok(html.includes("connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.deepseek.com"), 'Missing locked connect-src');
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'), 'Missing no-referrer meta tag');
  assert.ok(html.includes('id="api-storage-mode"') && html.includes('<option value="session" selected>'), 'Missing sessionStorage default selector');
});
test('app.js and highlighter.js eliminate unescaped innerHTML sinks in history, toast, legend, and tooltips', () => {
  const appJs = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const highlighterJs = readFileSync(join(ROOT, 'js', 'highlighter.js'), 'utf8');
  assert.ok(!appJs.includes('toast.innerHTML'), 'showToast must use textContent, not innerHTML');
  assert.ok(!appJs.includes('div.innerHTML ='), 'openHistory must construct DOM nodes safely without div.innerHTML');
  assert.ok(!appJs.includes('item.innerHTML ='), 'legendItems must construct DOM nodes safely without item.innerHTML');
  assert.ok(highlighterJs.includes('const safeCategory = escapeHtml(') && highlighterJs.includes('const safeMessage = escapeHtml('), 'highlighter.js tooltip must escape category/message/suggestion');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
