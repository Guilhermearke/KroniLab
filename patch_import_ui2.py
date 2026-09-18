import re

with open("apps/web-demo/src/import-ui.ts", "r") as f:
    code = f.read()

# Fix import
code = code.replace(
    """import {
  analyzeTempo, computeBufferPeaks, decodeAudioFile, refineDownbeat, titleFromFileName,
  importStemFiles, trackBeats, detectSections,
  type ImportedAudio, type TempoAnalysis, type StemImportResult
} from './importer.ts';""",
    """import {
  analyzeTempo, computeBufferPeaks, decodeAudioFile, refineDownbeat, titleFromFileName,
  importStemFiles, trackBeats,
  type ImportedAudio, type TempoAnalysis, type StemImportResult
} from './importer.ts';
import { detectSections } from './structure.ts';"""
)

with open("apps/web-demo/src/import-ui.ts", "w") as f:
    f.write(code)

