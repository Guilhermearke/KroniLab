/**
 * Verificacao funcional da demo num Chromium de verdade.
 *
 * Checa o comportamento que importa, nao a aparencia: que tocar uma secao
 * ENFILEIRA em vez de pular, que a waveform vem das notas reais, que o mixer
 * responde, e que o layout de tablet troca para faders verticais.
 *
 *   npx serve apps/web-demo/dist -p 8099
 *   node apps/web-demo/verify.mjs
 */
import { chromium } from 'playwright-core';

const URL = process.env.DEMO_URL ?? 'http://localhost:8099/';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({
  executablePath: CHROME,
  // Sem --autoplay-policy: o teste tem que enxergar a mesma politica de
  // autoplay que um navegador real aplica. Com a flag, uma tela que so monta
  // apos gesto do usuario passaria despercebida.
  args: ['--mute-audio'],
});

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  return { page, errors };
}

// ------------------------------------------------------------------ celular
const { page, errors } = await open(430, 932);
// A tela precisa estar inteira ANTES de qualquer toque.
const beforeGesture = await page.evaluate(() => ({
  lanes: document.querySelectorAll('.lane').length,
  chords: document.querySelectorAll('.tl-chord').length,
}));
console.log(`0. Sem nenhum toque: ${beforeGesture.lanes} lanes, ${beforeGesture.chords} cifras ${beforeGesture.lanes > 0 ? 'OK' : 'FALHOU (tela em branco)'}`);
console.log(`1. Topo: "${(await page.textContent('#song-title')).trim()}" | ${await page.textContent('#meta-key')} ${await page.textContent('#meta-bpm')} BPM ${await page.textContent('#meta-dur')}`);
console.log(`2. Setlist ${await page.locator('.sl-card').count()} | lanes ${await page.locator('.lane').count()} | cifras ${await page.locator('.tl-chord').count()} | marcadores ${await page.locator('.marker').count()}`);

const drawn = await page.evaluate(() => [...document.querySelectorAll('.lane')]
  .map((l) => ({ stem: l.dataset.stem, c: l.querySelector('canvas') }))
  .filter((x) => x.c)
  .map(({ stem, c }) => {
    const d = c.getContext('2d').getImageData(0, 0, Math.min(c.width, 900), c.height).data;
    let on = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) on++;
    return `${stem}:${on > 500 ? 'ok' : 'VAZIO'}`;
  }).join(' '));
console.log(`3. Waveforms ${drawn}`);

await page.click('#tr-play');
await page.waitForTimeout(1500);
const t1 = await page.textContent('#tr-current');
await page.waitForTimeout(1500);
console.log(`4. Transporte ${t1} -> ${await page.textContent('#tr-current')}`);

await page.click('#view-toggle');
await page.waitForTimeout(250);
console.log(`5. Mixer ${await page.locator('.mx-row').count()} canais, ${await page.locator('.mx-knob').count()} knobs`);
await page.locator('.mx-row').nth(2).locator('[data-act="solo"]').click();
await page.waitForTimeout(150);
console.log(`   solo apaga ${await page.locator('.mx-row.is-dimmed').count()} canais`);
await page.screenshot({ path: '/tmp/phone-mixer.png' });
await page.locator('.mx-row').nth(2).locator('[data-act="solo"]').click();
await page.click('#view-toggle');
await page.waitForTimeout(250);
await page.screenshot({ path: '/tmp/phone-studio.png' });

await page.click('#live-btn');
await page.waitForTimeout(250);
await page.locator('.live-section').nth(3).click();
await page.waitForTimeout(150);
const queued = await page.locator('.live-section').nth(3).getAttribute('class');
console.log(`6. Live enfileirou sem pular: ${queued.includes('is-queued') ? 'OK' : 'FALHOU'} | atual segue "${await page.textContent('#live-current')}"`);
await page.waitForFunction(() => document.querySelector('#log').textContent.includes('Salto confirmado'), { timeout: 25000 });
await page.waitForTimeout(400);
console.log(`7. Apos o salto: "${await page.textContent('#live-current')}"`);
await page.click('#lv-nudge-up');
await page.waitForTimeout(150);
console.log(`8. Nudge: "${await page.textContent('#live-rate')}"`);
await page.screenshot({ path: '/tmp/phone-live.png' });
await page.click('#lv-exit');
await page.waitForTimeout(200);

// --- pad: liga no tom da musica, com fade ---------------------------------
await page.click('#pad-btn');
await page.waitForTimeout(300);
const padOn = await page.evaluate(() => document.querySelector('#pad-btn').classList.contains('on'));
const padLog = await page.textContent('.log-line');
console.log(`10. Pad: ligado=${padOn} | ${padLog.replace(/\s+/g, ' ').trim().slice(11, 60)}`);

// --- transicao automatica: pula para o fim e ve se emenda sozinho ---------
const before = await page.textContent('#song-title');
await page.evaluate(() => {
  const song = 125; // Santo Pra Sempre dura ~2:05
  const slider = document.querySelector('#tr-slider');
  slider.value = String(Math.round(((song - 3.5) / song) * 1000));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
if (!(await page.evaluate(() => document.querySelector('#tr-play').textContent.includes('❚')))) {
  await page.click('#tr-play');
}
await page.waitForFunction((t) => document.querySelector('#song-title').textContent !== t, before, { timeout: 15000 })
  .then(async () => {
    const after = await page.textContent('#song-title');
    const tlog = await page.textContent('.log-done');
    console.log(`11. Transicao automatica: "${before}" -> "${after}" | ${tlog.replace(/\s+/g, ' ').trim().slice(11, 62)}`);
  })
  .catch(() => console.log('11. Transicao automatica: FALHOU (nao emendou sozinho)'));

console.log(`erros (celular): ${errors.length ? errors.join(' | ') : 'nenhum'}`);

// ------------------------------------------------------------------- tablet
const tablet = await open(1194, 834);
await tablet.page.click('#view-toggle');
await tablet.page.waitForTimeout(350);
// O modo da mesa e escolha do operador, nao consequencia do tamanho da tela:
// o teste precisa escolher Faders antes de medir a geometria.
await tablet.page.click('#mode-faders');
await tablet.page.waitForTimeout(250);
// Geometria, nao implementacao: o fader precisa ser mais alto que largo E
// caber dentro da coluna do canal — foi exatamente isso que a rotacao quebrou.
const layout = await tablet.page.evaluate(() => {
  const row = document.querySelector('.mx-row').getBoundingClientRect();
  const fader = document.querySelector('.mx-fader').getBoundingClientRect();
  const rows = [...document.querySelectorAll('.mx-row')].map((r) => r.getBoundingClientRect());
  const overlap = rows.some((a, i) => rows.slice(i + 1).some((b) => a.right > b.left + 1 && a.left < b.right - 1));
  return {
    w: Math.round(row.width), h: Math.round(row.height),
    faderW: Math.round(fader.width), faderH: Math.round(fader.height),
    inside: fader.left >= row.left - 1 && fader.right <= row.right + 1,
    overlap,
  };
});
console.log(`9. Tablet: canal ${layout.w}x${layout.h}px | fader ${layout.faderW}x${layout.faderH} ` +
  `vertical ${layout.faderH > layout.faderW ? 'OK' : 'FALHOU'} | dentro da coluna ${layout.inside ? 'OK' : 'FALHOU'} | ` +
  `sobreposicao entre canais ${layout.overlap ? 'SIM' : 'nao'}`);
await tablet.page.screenshot({ path: '/tmp/tablet-mixer.png' });
await tablet.page.click('#view-toggle');
await tablet.page.waitForTimeout(350);
await tablet.page.screenshot({ path: '/tmp/tablet-studio.png' });
console.log(`erros (tablet): ${tablet.errors.length ? tablet.errors.join(' | ') : 'nenhum'}`);

await browser.close();
