# Demo web do Live Mode

Demonstra o coracao do produto em qualquer navegador: saltos quantizados, loop,
nudge e tap tempo.

Nao ha stems nem gravacao envolvida — a VS e **sintetizada**: click, nota de
baixo por secao (e o que torna o salto audivel) e guia falada em pt-BR pelo
`SpeechSynthesis`.

O ponto da demo: ela nao reimplementa nada. O esbuild empacota o proprio
`@kronilab/core`, entao o que decide o momento do salto aqui e o mesmo codigo
coberto pelos testes do app.

## Rodar

```bash
npm install          # na raiz do repo (workspaces)
npm run build        # gera apps/web-demo/dist
npx serve apps/web-demo/dist
```

## Verificacao funcional

`verify.mjs` dirige um Chromium de verdade e checa o comportamento que importa:
que tocar uma secao **enfileira** em vez de pular, que a troca acontece no
compasso, e que nudge, tap e loop respondem.

```bash
npm i -D playwright-core           # navegador nao incluso
node apps/web-demo/verify.mjs      # requer a demo servida em :8099
```

## Deploy (Cloudflare Pages)

| Campo | Valor |
|---|---|
| Root directory | *(raiz do repo)* |
| Build command | `npm run build` |
| Output directory | `apps/web-demo/dist` |

A raiz precisa ser a do repo por causa dos workspaces do npm: o build importa
`packages/core`, que nao existe dentro de `apps/web-demo`.
