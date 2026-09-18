"""
Testes da logica musical do worker. Rodam sem GPU, sem librosa e sem rede —
e essa e a ideia: a decisao musical mora em codigo puro.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pipeline.grid import (  # noqa: E402
    build_grid, click_events, detect_downbeat_index, guide_cues,
    nearest_downbeat_bar, snap_sections, tempo_map, average_bpm,
)
from app.pipeline.analysis import detect_key_from_chroma, guess_time_signature  # noqa: E402
from app.pipeline.fingerprint import sha256_bytes  # noqa: E402


def beats_at(bpm=120.0, count=64, start=0.0):
    step = 60.0 / bpm
    return [round(start + i * step, 4) for i in range(count)]


class TestGrid(unittest.TestCase):
    def test_grid_counts_bars_and_downbeats(self):
        grid = build_grid(beats_at(), beats_per_bar=4)
        self.assertEqual(grid[0].bar, 1)
        self.assertEqual(grid[4].bar, 2)
        self.assertTrue(grid[4].downbeat)
        self.assertFalse(grid[5].downbeat)
        self.assertEqual(grid[4].beat, 1)

    def test_downbeat_offset_shifts_the_whole_bar_count(self):
        # A musica comeca com 2 beats de anacruse: o tempo 1 e o terceiro beat.
        grid = build_grid(beats_at(), beats_per_bar=4, downbeat_index=2)
        self.assertTrue(grid[2].downbeat)
        self.assertEqual(grid[2].bar, 1)
        self.assertFalse(grid[0].downbeat)

    def test_detect_downbeat_picks_the_strongest_phase(self):
        # Acento a cada 4 beats, comecando no indice 1.
        onsets = [(3.0 if i % 4 == 1 else 1.0) for i in range(64)]
        self.assertEqual(detect_downbeat_index(beats_at(), onsets, 4), 1)

    def test_average_and_variable_tempo(self):
        grid = build_grid(beats_at(bpm=72, count=32))
        self.assertAlmostEqual(average_bpm(grid), 72.0, places=1)
        # Acelera na metade: o tempo map tem que registrar a mudanca.
        times = beats_at(bpm=72, count=16)
        times += [round(times[-1] + (i + 1) * (60 / 80), 4) for i in range(16)]
        segments = tempo_map(build_grid(times))
        self.assertGreaterEqual(len(segments), 2)
        self.assertAlmostEqual(segments[0]["bpm"], 72.0, places=0)
        self.assertAlmostEqual(segments[-1]["bpm"], 80.0, places=0)


class TestSections(unittest.TestCase):
    def setUp(self):
        self.grid = build_grid(beats_at(bpm=120, count=160))  # 2s por compasso

    def test_sections_snap_to_downbeats_not_raw_timestamps(self):
        # Fronteiras "sujas", como saem do analisador.
        raw = [("Intro", 0.1), ("Verse", 7.9), ("Chorus", 24.3)]
        sections = snap_sections(raw, self.grid)
        self.assertEqual([s.start_bar for s in sections], [1, 5, 13])
        # Cada secao termina onde a proxima comeca: sem buraco.
        self.assertEqual(sections[0].end_bar, sections[1].start_bar)

    def test_repeated_types_get_numbered_in_pt_br(self):
        raw = [("Verse", 0.0), ("Chorus", 16.0), ("Verse", 32.0), ("Chorus", 48.0)]
        labels = [s.label for s in snap_sections(raw, self.grid)]
        self.assertEqual(labels, ["Verso", "Refrao", "Verso 2", "Refrao 2"])

    def test_tiny_section_is_absorbed_instead_of_creating_junk(self):
        raw = [("Intro", 0.0), ("Break", 16.0), ("Chorus", 17.9)]
        sections = snap_sections(raw, self.grid, min_bars=2)
        self.assertNotIn("Break", [s.type for s in sections])
        self.assertEqual(sections[0].end_bar, sections[1].start_bar)

    def test_nearest_downbeat(self):
        self.assertEqual(nearest_downbeat_bar(self.grid, 7.9), 5)
        self.assertEqual(nearest_downbeat_bar(self.grid, 8.1), 5)


class TestClickAndGuide(unittest.TestCase):
    def test_click_accents_the_first_beat_of_each_bar(self):
        grid = build_grid(beats_at(count=8))
        events = click_events(grid)
        self.assertEqual([e["accent"] for e in events], [True, False, False, False] * 2)

    def test_guide_speaks_one_bar_before_the_section(self):
        grid = build_grid(beats_at(bpm=120, count=64))
        sections = snap_sections([("Intro", 0.0), ("Chorus", 16.0)], grid)
        cues = guide_cues(sections, grid)
        chorus = next(c for c in cues if c["text"] == "Refrao")
        # Refrao comeca no compasso 9; a guia avisa no 8.
        self.assertEqual(chorus["bar"], 8)

    def test_count_in_numbers_come_first(self):
        grid = build_grid(beats_at(count=32))
        cues = guide_cues(snap_sections([("Intro", 0.0)], grid), grid, count_in_beats=4)
        self.assertEqual([c["text"] for c in cues[:4]], ["1", "2", "3", "4"])


class TestAnalysisHelpers(unittest.TestCase):
    def test_key_detection_on_a_clean_c_major_chroma(self):
        chroma = [0.0] * 12
        for pc, weight in ((0, 1.0), (4, 0.8), (7, 0.9), (2, 0.5), (5, 0.6), (9, 0.5), (11, 0.4)):
            chroma[pc] = weight
        key, mode, conf = detect_key_from_chroma(chroma)
        self.assertEqual(key, "C")
        self.assertEqual(mode, "major")
        self.assertGreater(conf, 0.5)

    def test_time_signature_defaults_to_four_when_unsure(self):
        self.assertEqual(guess_time_signature([1.0] * 100, list(range(8))), 4)

    def test_three_four_is_detected_when_the_accent_says_so(self):
        onsets = [(5.0 if i % 3 == 0 else 1.0) for i in range(120)]
        self.assertEqual(guess_time_signature(onsets, list(range(0, 120, 1))[:60]), 3)


class TestDedup(unittest.TestCase):
    def test_same_bytes_same_hash(self):
        self.assertEqual(sha256_bytes(b"audio"), sha256_bytes(b"audio"))
        self.assertNotEqual(sha256_bytes(b"audio"), sha256_bytes(b"audio!"))


if __name__ == "__main__":
    unittest.main()
