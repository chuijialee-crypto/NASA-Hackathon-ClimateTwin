"""The front end keeps copies of some data/ files so it also works when served
from frontend/ (where ../data/ is out of reach). These tests fail if a copy is
missing or has drifted from data/.

Fix a failure by re-running `python -m engine.export_presets`, or by copying the
file from data/ into frontend/.

Standard library only, so it runs without the engine's dependencies.
"""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_COPIES = ("demo_field.json", "malaysia_states.json", "ui_copy.json", "crops.json")


class FrontendDataCopies(unittest.TestCase):
    def test_copies_match_data(self):
        for name in FRONTEND_COPIES:
            with self.subTest(file=name):
                copy = ROOT / "frontend" / name
                self.assertTrue(copy.exists(), f"frontend/{name} is missing")
                self.assertEqual(
                    copy.read_bytes(), (ROOT / "data" / name).read_bytes(),
                    f"frontend/{name} differs from data/{name}",
                )

    def test_copies_are_valid_json(self):
        for name in FRONTEND_COPIES:
            with self.subTest(file=name):
                json.loads((ROOT / "frontend" / name).read_text(encoding="utf-8"))

    def test_export_script_keeps_the_same_list(self):
        script = (ROOT / "engine" / "export_presets.py").read_text(encoding="utf-8")
        match = re.search(r"FRONTEND_COPIES = \(([^)]*)\)", script)
        self.assertIsNotNone(match, "engine/export_presets.py has no FRONTEND_COPIES")
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', match.group(1))), FRONTEND_COPIES)

    def test_app_loads_every_copy_from_both_places(self):
        app = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
        for name in FRONTEND_COPIES:
            with self.subTest(file=name):
                self.assertIn(f"'../data/{name}'", app)
                self.assertIn(f"'./{name}'", app)


if __name__ == "__main__":
    unittest.main()
