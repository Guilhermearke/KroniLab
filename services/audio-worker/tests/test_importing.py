"""
Testes do parser de link. Sem rede: as funcoes puras sao o que pode errar.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.importing import split_title, video_id  # noqa: E402


class TestVideoId(unittest.TestCase):
    def test_accepts_the_usual_link_shapes(self):
        self.assertEqual(video_id('https://www.youtube.com/watch?v=abc123XYZ_-'), 'abc123XYZ_-')
        self.assertEqual(video_id('https://youtu.be/abc123XYZ_-'), 'abc123XYZ_-')
        self.assertEqual(video_id('https://www.youtube.com/shorts/abc123XYZ_-'), 'abc123XYZ_-')
        self.assertEqual(video_id('https://music.youtube.com/watch?v=abc123XYZ_-&list=RD'), 'abc123XYZ_-')

    def test_rejects_other_links_instead_of_guessing(self):
        self.assertIsNone(video_id('https://example.com/watch?v=abc'))
        self.assertIsNone(video_id('nao e um link'))


class TestSplitTitle(unittest.TestCase):
    def test_splits_artist_and_song(self):
        self.assertEqual(split_title('Fulano de Tal - Nome da Musica', 'Canal'),
                         ('Nome da Musica', 'Fulano de Tal'))

    def test_drops_the_usual_noise_in_the_title(self):
        title, artist = split_title('Fulano - Nome da Musica (Ao Vivo)', 'Canal')
        self.assertEqual(title, 'Nome da Musica')
        self.assertEqual(artist, 'Fulano')
        self.assertEqual(split_title('Fulano - Cancao (Clipe Oficial)', None)[0], 'Cancao')

    def test_without_a_separator_it_does_not_invent_an_artist(self):
        # Chutar errado e pior do que nao chutar: fica o canal.
        self.assertEqual(split_title('Nome Da Musica', 'Canal Oficial'),
                         ('Nome Da Musica', 'Canal Oficial'))

    def test_handles_dash_variants(self):
        self.assertEqual(split_title('A – B', None), ('B', 'A'))
        self.assertEqual(split_title('A — B', None), ('B', 'A'))
        self.assertEqual(split_title('A | B', None), ('B', 'A'))
