import re

with open("/Users/guilhermearke/.gemini/antigravity-ide/brain/f4c286e2-4923-4e5b-82a5-2962d2b7339f/task.md", "r") as f:
    code = f.read()

code = code.replace("- [ ] import-ui.ts: input multiple + chips de stem + status detalhado", "- [x] import-ui.ts: input multiple + chips de stem + status detalhado")
code = code.replace("- [ ] engine.ts: loadStemBuffers (um AudioBufferSourceNode por stem)", "- [x] engine.ts: loadStemBuffers (um AudioBufferSourceNode por stem)")
code = code.replace("- [ ] data.ts: DemoSong.stems + songFromStored com beats", "- [x] data.ts: DemoSong.stems + songFromStored com beats")
code = code.replace("- [ ] Commit Fase 2", "- [x] Commit Fase 2")
code = code.replace("- [ ] npm install && npm run build (sem erros TS)", "- [x] npm install && npm run build (sem erros TS)")

with open("/Users/guilhermearke/.gemini/antigravity-ide/brain/f4c286e2-4923-4e5b-82a5-2962d2b7339f/task.md", "w") as f:
    f.write(code)
