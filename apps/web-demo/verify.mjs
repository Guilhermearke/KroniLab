import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8099/', { waitUntil: 'networkidle' });

const title = await page.textContent('#song-title');
const sections = await page.locator('.section').count();
console.log(`1. Carregou: "${title}" com ${sections} secoes`);

await page.click('#play');
await page.waitForTimeout(1200);
const bar1 = await page.textContent('#bar');
await page.waitForTimeout(1200);
const bar2 = await page.textContent('#bar');
console.log(`2. Playhead andando: ${bar1} -> ${bar2} ${bar1 !== bar2 ? 'OK' : 'FALHOU'}`);

// Salta para o Refrao (indice 3) e confirma que ENFILEIRA antes de executar
await page.locator('.section').nth(3).click();
await page.waitForTimeout(120);
const queuedClass = await page.locator('.section').nth(3).getAttribute('class');
const queuedLog = await page.textContent('.log-line');
console.log(`3. Enfileirou (nao pulou): ${queuedClass.includes('is-queued') ? 'OK' : 'FALHOU'} | log: ${queuedLog.replace(/\s+/g,' ').trim().slice(11, 80)}`);
const currentDuringQueue = await page.textContent('#current');
console.log(`   secao atual ainda e "${currentDuringQueue}" durante a fila`);

// Espera a execucao no compasso
await page.waitForFunction(() => document.querySelector('#log').textContent.includes('Salto confirmado'), { timeout: 15000 });
const doneLog = await page.textContent('.log-done');
await page.waitForTimeout(400); // deixa o playhead cruzar o ponto agendado
const afterJump = await page.textContent('#current');
console.log(`4. ${doneLog.replace(/\s+/g,' ').trim().slice(11, 70)}`);
console.log(`   secao atual apos cruzar o ponto: "${afterJump}" ${afterJump === 'REFRAO' ? 'OK' : 'INESPERADO'}`);

// Nudge
await page.click('#nudge-up');
await page.waitForTimeout(200);
const rate = await page.textContent('#rate');
const nudgeLog = await page.textContent('.log-line');
console.log(`5. Nudge: taxa "${rate}" | ${nudgeLog.replace(/\s+/g,' ').trim().slice(11, 70)}`);

// Tap tempo: 4 toques a 500ms = 120 BPM
for (let i = 0; i < 4; i++) { await page.click('#tap'); await page.waitForTimeout(500); }
const tapLabel = await page.textContent('#tap');
console.log(`6. Tap tempo: "${tapLabel}"`);

// Loop por pressao longa
await page.locator('.section').nth(3).click({ delay: 700 });
await page.waitForTimeout(150);
const loopClass = await page.locator('.section').nth(3).getAttribute('class');
console.log(`7. Loop (segurar): ${loopClass.includes('is-loop') ? 'OK' : 'FALHOU'}`);

await page.screenshot({ path: '/tmp/demo.png', fullPage: false });
console.log(`\nerros de console: ${errors.length ? errors.join(' | ') : 'nenhum'}`);
await browser.close();
