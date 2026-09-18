import re

with open("apps/web-demo/src/engine.ts", "r") as f:
    code = f.read()

# Add stemBuffers to class fields
code = code.replace(
    "  private mixSource: AudioBufferSourceNode | null = null;",
    "  private mixSource: AudioBufferSourceNode | null = null;\n\n  /** Stems separados, quando existem. */\n  private stemBuffers = new Map<StemKey, AudioBuffer>();\n  private stemSources = new Map<StemKey, AudioBufferSourceNode>();"
)

# Update load method
old_load = """    this.duration = song.durationSec;
    this.mixBuffer = song.audio?.buffer ?? null;
    this.baseRate = 1;"""

new_load = """    this.duration = song.durationSec;
    this.mixBuffer = song.audio?.buffer ?? null;
    this.stemBuffers.clear();
    if (song.stems) {
      for (const [key, val] of Object.entries(song.stems)) {
        this.stemBuffers.set(key as StemKey, val.buffer);
      }
    }
    this.baseRate = 1;"""

code = code.replace(old_load, new_load)

# Update startMix
old_startMix = """  private startMix(atCtxTime: number, offsetSongTime: number): void {
    if (!this.mixBuffer || !this.ctx) return;
    this.stopMix();
    const src = this.ctx.createBufferSource();
    src.buffer = this.mixBuffer;
    src.playbackRate.value = this.rate;
    src.connect(this.ensureChannel('mix').gain);
    src.start(Math.max(atCtxTime, this.ctx.currentTime), Math.max(0, offsetSongTime));
    this.mixSource = src;
  }"""

new_startMix = """  private startMix(atCtxTime: number, offsetSongTime: number): void {
    if (!this.ctx) return;
    this.stopMix();
    const startAt = Math.max(atCtxTime, this.ctx.currentTime);
    const offset = Math.max(0, offsetSongTime);

    if (this.mixBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.mixBuffer;
      src.playbackRate.value = this.rate;
      src.connect(this.ensureChannel('mix').gain);
      src.start(startAt, offset);
      this.mixSource = src;
    }

    for (const [key, buffer] of this.stemBuffers.entries()) {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = this.rate;
      src.connect(this.ensureChannel(key).gain);
      src.start(startAt, offset);
      this.stemSources.set(key, src);
    }
  }"""

code = code.replace(old_startMix, new_startMix)

# Update stopMix
old_stopMix = """  private stopMix(atCtxTime?: number): void {
    const src = this.mixSource;
    if (!src) return;
    this.mixSource = null;
    try { src.stop(atCtxTime ?? 0); } catch { /* ja parado */ }
    window.setTimeout(() => src.disconnect(), ((atCtxTime ?? 0) - (this.ctx?.currentTime ?? 0)) * 1000 + 100);
  }"""

new_stopMix = """  private stopMix(atCtxTime?: number): void {
    const time = atCtxTime ?? 0;
    const delayMs = (time - (this.ctx?.currentTime ?? 0)) * 1000 + 100;

    const mix = this.mixSource;
    if (mix) {
      this.mixSource = null;
      try { mix.stop(time); } catch {}
      window.setTimeout(() => mix.disconnect(), delayMs);
    }

    for (const [key, src] of this.stemSources.entries()) {
      try { src.stop(time); } catch {}
      window.setTimeout(() => src.disconnect(), delayMs);
    }
    this.stemSources.clear();
  }"""

code = code.replace(old_stopMix, new_stopMix)

# Update applyTempoRamp
old_ramp1 = "this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);"
new_ramp1 = "this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);\n    for (const src of this.stemSources.values()) src.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);"

old_ramp2 = "this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx!.currentTime, 0.02);"
new_ramp2 = "this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx!.currentTime, 0.02);\n      for (const src of this.stemSources.values()) src.playbackRate.setTargetAtTime(this.rate, this.ctx!.currentTime, 0.02);"

code = code.replace(old_ramp1, new_ramp1)
code = code.replace(old_ramp2, new_ramp2)

# Update setBaseRate
old_base_rate = "this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.05);"
new_base_rate = "this.mixSource?.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.05);\n    for (const src of this.stemSources.values()) src.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.05);"
code = code.replace(old_base_rate, new_base_rate)


with open("apps/web-demo/src/engine.ts", "w") as f:
    f.write(code)

print("engine.ts patched successfully")
