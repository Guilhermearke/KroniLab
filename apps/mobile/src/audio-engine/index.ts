/**
 * Fabrica da engine.
 *
 * Nativa quando existe (palco), JS quando nao (Expo Go, estudo, dev).
 * Nenhuma tela decide isso — elas so pedem `getAudioEngine()`.
 */
import type { AudioEngine } from './AudioEngine.ts';
import { ExpoAudioEngine } from './ExpoAudioEngine.ts';
import { NativeAudioEngine, isNativeEngineAvailable } from './NativeAudioEngine.ts';

let instance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!instance) {
    instance = isNativeEngineAvailable() ? new NativeAudioEngine() : new ExpoAudioEngine();
  }
  return instance;
}

/** O Live Mode avisa o operador quando esta rodando sem engine nativa. */
export function engineKind(): 'native' | 'js' {
  return isNativeEngineAvailable() ? 'native' : 'js';
}

export * from './AudioEngine.ts';
export { ExpoAudioEngine } from './ExpoAudioEngine.ts';
export { NativeAudioEngine, isNativeEngineAvailable } from './NativeAudioEngine.ts';
