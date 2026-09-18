/**
 * Diagnostico de conexoes.
 *
 * Responde uma pergunta so: o que ainda falta ligar para o KroniLab funcionar?
 * Cada linha diz o estado REAL (testado na rede, nao "a variavel existe") e,
 * quando falha, o proximo passo concreto.
 *
 *   npm run doctor
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// .env — sem dependencia: o doctor tem que rodar num repo recem-clonado
// ---------------------------------------------------------------------------
function loadEnv() {
  const path = resolve(root, '.env');
  const env = { ...process.env };
  if (!existsSync(path)) return { env, hasFile: false };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (value) env[match[1]] = value;
  }
  return { env, hasFile: true };
}

const { env, hasFile } = loadEnv();
const results = [];

function record(name, status, detail, next) {
  results.push({ name, status, detail, next });
}

async function head(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
async function checkSupabase() {
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    record('Supabase', 'falta', 'URL ou anon key ausente',
      'Painel do projeto -> Settings -> API. Preencha EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env');
    return;
  }

  try {
    const response = await head(`${url}/rest/v1/`, { headers: { apikey: key } });
    if (response.status === 401) {
      record('Supabase', 'erro', 'Projeto responde, mas a anon key foi recusada',
        'Confira se a chave e a do MESMO projeto da URL');
      return;
    }
    record('Supabase', 'ok', `Projeto respondendo (HTTP ${response.status})`);
  } catch (e) {
    record('Supabase', 'erro', `Nao alcancei o projeto: ${e.message}`,
      'Confira a URL e se o projeto nao esta pausado');
    return;
  }

  // O schema esta aplicado? E o erro mais comum: projeto de pe, banco vazio.
  try {
    const response = await head(`${url}/rest/v1/songs?limit=1`, { headers: { apikey: key } });
    if (response.ok) {
      record('Schema', 'ok', 'Tabelas do KroniLab presentes');
    } else {
      const body = await response.text();
      const missing = body.includes('does not exist') || response.status === 404;
      record('Schema', missing ? 'falta' : 'erro',
        missing ? 'As tabelas ainda nao existem' : `HTTP ${response.status}`,
        'Abra o SQL Editor do projeto e rode supabase/migrations/0001_init.sql');
    }
  } catch (e) {
    record('Schema', 'erro', e.message);
  }
}

// ---------------------------------------------------------------------------
// Worker de audio
// ---------------------------------------------------------------------------
async function checkWorker() {
  const url = env.EXPO_PUBLIC_WORKER_URL;
  if (!url) {
    record('Worker de audio', 'falta', 'EXPO_PUBLIC_WORKER_URL nao definida',
      'Suba o worker: cd services/audio-worker && uvicorn app.main:app');
    return;
  }
  try {
    const response = await head(`${url}/health`);
    const body = await response.json();
    record('Worker de audio', 'ok',
      `Provider "${body.provider}", ${body.queue_depth} job(s) na fila`);
  } catch (e) {
    record('Worker de audio', 'falta', `Sem resposta em ${url}`,
      'cd services/audio-worker && pip install -r requirements.txt && uvicorn app.main:app');
  }
}

// ---------------------------------------------------------------------------
// Cloudflare (R2 e conta)
// ---------------------------------------------------------------------------
async function checkR2() {
  const missing = ['KRONILAB_R2_ENDPOINT', 'KRONILAB_R2_ACCESS_KEY', 'KRONILAB_R2_SECRET_KEY']
    .filter((name) => !env[name]);
  if (missing.length) {
    record('R2 (arquivos)', 'falta', `${missing.length} variavel(is) faltando`,
      'Painel Cloudflare -> R2 -> Manage API tokens. Sem isso o worker guarda os stems em disco local');
    return;
  }
  // Credencial de R2 se valida assinando a requisicao (SigV4); o doctor nao
  // carrega SDK so para isso. Aqui confirmamos que o endpoint existe.
  try {
    await head(env.KRONILAB_R2_ENDPOINT, { method: 'HEAD' });
    record('R2 (arquivos)', 'ok', 'Endpoint alcancavel e credenciais preenchidas');
  } catch (e) {
    record('R2 (arquivos)', 'erro', `Endpoint nao respondeu: ${e.message}`);
  }
}

async function checkCloudflareToken() {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    record('Cloudflare (conta)', 'opcional', 'Sem token de API',
      'So e preciso para automatizar o Pages. Conectar pelo painel nao exige token');
    return;
  }
  try {
    const response = await head('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    record('Cloudflare (conta)', body.success ? 'ok' : 'erro',
      body.success ? `Token ${body.result.status}` : 'Token recusado',
      body.success ? undefined : 'Gere outro em My Profile -> API Tokens');
  } catch (e) {
    record('Cloudflare (conta)', 'erro', e.message);
  }
}

// ---------------------------------------------------------------------------
// Arquivos locais
// ---------------------------------------------------------------------------
function checkFiles() {
  record('.env', hasFile ? 'ok' : 'falta',
    hasFile ? 'Encontrado' : 'Nao existe',
    hasFile ? undefined : 'cp .env.example .env e preencha');

  const mcp = resolve(root, '.mcp.json');
  record('Conectores MCP', existsSync(mcp) ? 'ok' : 'falta',
    existsSync(mcp) ? 'Definidos em .mcp.json' : 'Ausente',
    existsSync(mcp) ? 'Abra o projeto no Claude Code para conectar' : undefined);
}

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------
const SYMBOL = { ok: '\x1b[32mok  \x1b[0m', falta: '\x1b[33mfalta\x1b[0m', erro: '\x1b[31merro\x1b[0m', opcional: '\x1b[90mopc \x1b[0m' };

checkFiles();
await Promise.all([checkSupabase(), checkWorker(), checkR2(), checkCloudflareToken()]);

console.log('\n  KroniLab — o que esta conectado\n');
for (const r of results) {
  console.log(`  ${SYMBOL[r.status] ?? r.status}  ${r.name.padEnd(18)} ${r.detail}`);
  if (r.next) console.log(`        ${'\x1b[90m'}-> ${r.next}${'\x1b[0m'}`);
}

const pending = results.filter((r) => r.status === 'falta' || r.status === 'erro');
console.log(
  pending.length === 0
    ? '\n  Tudo conectado.\n'
    : `\n  ${pending.length} item(ns) faltando: ${pending.map((r) => r.name).join(', ')}\n`,
);
