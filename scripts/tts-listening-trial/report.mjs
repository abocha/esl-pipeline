import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = resolve(
  process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) ??
    join(root, 'tmp/tts-listening-trial'),
);
const samples = JSON.parse(readFileSync(join(here, 'samples.json'), 'utf8'));
const models = ['gemini-3.8-flash-tts', 'inworld-tts-2', 'gemini-3.8-flash-lite-tts'];
const results = [];
const allowed = new Set(['index.html']);
const escapeHtml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const money = (n) => `$${n.toFixed(4)}`;
const sections = samples
  .map((sample, index) => {
    const inputSha256 = createHash('sha256').update(JSON.stringify(sample.turns)).digest('hex');
    const cards = models
      .map((model) => {
        const path = join(out, `${sample.id}-${model}.json`);
        if (!existsSync(path)) {
          const failurePath = join(out, `${sample.id}-${model}.failure.json`);
          if (!existsSync(failurePath))
            return `<article><h3>${escapeHtml(model)}</h3><p>Not generated yet.</p></article>`;
          const failure = JSON.parse(readFileSync(failurePath, 'utf8'));
          if (failure.inputSha256 && failure.inputSha256 !== inputSha256)
            throw new Error(
              `Input changed: ${sample.id}/${model}. Refusing mismatched attempt evidence.`,
            );
          return `<article><h3>${escapeHtml(model)}</h3><p><strong>${failure.status === 'incomplete' ? 'Incomplete attempt' : 'Failed attempt'}</strong> · ${escapeHtml(failure.completedRequestCount ?? 'unknown')} confirmed successful provider requests</p><p>Stage: ${escapeHtml(failure.stage ?? 'provider_response')} · request outcome: ${escapeHtml(failure.requestOutcome ?? 'unknown')}</p><p>${escapeHtml(failure.errorSummary ?? 'Historical failed attempt; confirmed request progress unavailable.')}</p><p>Explicit reruns can repeat charges; no automatic retry or turn-level resume.</p></article>`;
        }
        const result = JSON.parse(readFileSync(path, 'utf8'));
        if (result.inputSha256 !== inputSha256)
          throw new Error(
            `Input changed: ${sample.id}/${model}. Refusing a mismatched comparison.`,
          );
        if (!existsSync(join(out, result.listeningFile)))
          throw new Error(`Missing audio: ${result.listeningFile}`);
        // Derive costs from modality-specific usage, including older trial metadata.
        if (result.provider === 'google') {
          const tokens =
            result.usage?.candidatesTokensDetails?.find((detail) => detail.modality === 'AUDIO')
              ?.tokenCount ?? result.durationSeconds * 25;
          result.estimatedUsd2026 =
            (tokens * (model.includes('lite') ? 6 : 9)) / 1e6 +
            ((result.usage?.promptTokenCount ?? 0) * 0.5) / 1e6;
          result.estimatedUsd2027 = result.estimatedUsd2026 * 2;
        }
        results.push(result);
        allowed.add(result.listeningFile);
        allowed.add(result.originalFile);
        return `<article><h3>${escapeHtml(model)}</h3><p class="voices">${[...new Set(sample.turns.map((turn) => result.voices[turn.speaker]))].join(' / ')} · plain text</p><audio controls preload="metadata" src="${escapeHtml(result.listeningFile)}"></audio><p class="metrics">${result.durationSeconds.toFixed(1)} seconds · ${(result.generationMs / 1000).toFixed(1)}s generation · ${result.requestCount} request${result.requestCount === 1 ? '' : 's'}<br>Estimated ${money(result.estimatedUsd2026)} now · ${money(result.estimatedUsd2027)} at 2027 rates</p><a href="${escapeHtml(result.originalFile)}" download>Original WAV</a></article>`;
      })
      .join('');
    return `<section><div class="heading"><span class="number">0${index + 1}</span><div><h2>${escapeHtml(sample.title)}</h2><p>${escapeHtml(sample.focus)}</p></div></div><div class="cards">${cards || '<p>Not generated yet.</p>'}</div><details><summary>Read the exact shared transcript</summary>${sample.turns.map((turn) => `<p><strong>${escapeHtml(turn.speaker)}:</strong> ${escapeHtml(turn.text)}</p>`).join('')}</details><label class="notes">Your listening notes<textarea placeholder="Naturalness, clarity, pacing, speaker consistency, missing or changed words…" data-sample="${escapeHtml(sample.id)}" rows="3"></textarea></label></section>`;
  })
  .join('');
const total = results.reduce((sum, result) => sum + result.estimatedUsd2026, 0);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ESL Pipeline · TTS listening trial</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#202b29;font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:48px 28px}header{max-width:850px;margin-bottom:36px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:12px;font-weight:700;color:#487061}h1{font-size:clamp(32px,5vw,56px);line-height:1.1;letter-spacing:-.04em;margin:14px 0 22px}h2{font-size:25px;line-height:1.2;margin:0 0 8px}h3{font-size:17px;margin:0}.intro{font-size:19px}.notice{padding:18px 22px;background:#e6ebe4;border-left:4px solid #52725d;border-radius:4px}.heading{display:flex;gap:22px}.heading p{margin:0;color:#56615b}.number{color:#688472;font-size:22px}section{border-top:1px solid #ccd4c9;padding:30px 0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin:22px 0}article{padding:24px;background:#fff;border:1px solid #d7ddd4;border-radius:12px}audio{width:100%;margin:10px 0}.voices,.metrics{font-size:14px;color:#56615b}a{color:#215842}summary{cursor:pointer;font-weight:600}details{padding:16px 0}.notes{display:block;font-weight:600;margin-top:12px}textarea{display:block;width:100%;margin-top:8px;padding:12px;border:1px solid #b4c1b4;border-radius:7px;background:#fbfcf8;font:inherit;resize:vertical}footer{font-size:14px;color:#56615b;margin-top:24px}button{border:1px solid #487061;background:#fff;color:#215842;padding:9px 14px;border-radius:6px;cursor:pointer;margin:12px 0}button:focus-visible,a:focus-visible,summary:focus-visible,textarea:focus-visible{outline:3px solid #a76b13;outline-offset:3px}@media(max-width:600px){main{padding:28px 18px}.heading{gap:12px}article{padding:18px}}
</style></head><body><main><header><p class="eyebrow">ESL Pipeline / listening trial / 20–21 October 2026</p><h1>How does the same text sound?</h1><p class="intro">Four synthetic English passages. Fixed voices. No speech planner, voice ranker or style prompts. Start with the short dialogue, then compare narration and pronunciation.</p><div class="notice"><strong>Listen for meaning, not just a pleasant voice.</strong> Are questions and contrasts clear? Is the pace comfortable for a learner? Do the speakers stay distinct? Check the transcript for dropped or changed words. Listening copies use the same loudness target; original WAVs are retained.</div><p>This is a provider listening comparison. It does not reproduce the current pipeline's planner/ranker stack or establish that those stages can be removed. Inworld uses separate turns with 320 ms speaker-switch gaps; Gemini generates each passage in one request.</p><button id="hide-metrics">Hide timing and cost</button></header>${sections}<footer><p>${results.length} clips · estimated combined provider cost ${money(total)}. Google estimates use audio-modality tokens plus text input; ancillary text output has no listed rate here. Inworld estimates use $25/million authored characters. These are list-price estimates, not billing receipts or confirmed trial-credit deductions. Generation timings include assembly for Inworld and exclude the final loudness conversion; runs are sequential and not a latency benchmark.</p><p>Cloud credits page: available trial credit expires January 19, 2027. Billing report had not posted the first request when checked; specific SKU credit application is pending. No production routing was changed.</p><p>Notes stay in this browser's local storage. <button id="export-notes">Download my notes</button></p><p><a href="https://cloud.google.com/text-to-speech/pricing">Google pricing</a> · <a href="https://linear.app/abocha/issue/ABO-33">ABO-33</a> · <a href="https://linear.app/abocha/issue/ABO-59">ABO-59</a></p></footer></main><script>
const notesKey='esl-tts-listening-trial-2026-10-20';let notes={};try{notes=JSON.parse(localStorage.getItem(notesKey)||'{}')}catch{}for(const field of document.querySelectorAll('textarea')){field.value=notes[field.dataset.sample]||'';field.addEventListener('input',()=>{notes[field.dataset.sample]=field.value;try{localStorage.setItem(notesKey,JSON.stringify(notes))}catch{}})}document.addEventListener('play',event=>{if(event.target.tagName==='AUDIO')for(const audio of document.querySelectorAll('audio'))if(audio!==event.target)audio.pause()},true);document.getElementById('hide-metrics').onclick=event=>{const hide=event.target.textContent.startsWith('Hide');for(const metric of document.querySelectorAll('.metrics'))metric.hidden=hide;event.target.textContent=hide?'Show timing and cost':'Hide timing and cost'};document.getElementById('export-notes').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(notes,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='tts-listening-notes.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
</script></body></html>`;
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log(
  `Listening page: ${join(out, 'index.html')} (${results.length} clips; estimate ${money(total)})`,
);
if (process.argv.includes('--serve')) {
  const server = createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['GET', 'HEAD'].includes(request.method) || !allowed.has(name)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      extname(name) === '.html'
        ? 'text/html; charset=utf-8'
        : extname(name) === '.mp3'
          ? 'audio/mpeg'
          : 'audio/wav',
    );
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(join(out, name)).pipe(response);
  });
  server.listen(8794, '127.0.0.1', () =>
    console.log('Open http://127.0.0.1:8794 (loopback only; Ctrl+C to stop).'),
  );
}
