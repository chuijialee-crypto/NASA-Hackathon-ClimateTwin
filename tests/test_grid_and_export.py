"""Tests for the regional grid (engine/grid.py) and the preset export (engine/export_presets.py).

Run from the project root:  python -m unittest discover -s tests -t . -v
No network needed.
"""

import json
import unittest
from pathlib import Path

from engine import export_presets, grid

ROOT = Path(__file__).resolve().parent.parent
APP_JS = ROOT / "frontend" / "app.js"
GRID_JSON = ROOT / "data" / "global_grid.json"
PLACES_JSON = ROOT / "data" / "places.json"


class RegionalGridTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = grid.land_points()
        cls.regional = grid.regional_land_points(cls.base)

    def test_frange_steps_cleanly(self):
        values = grid.frange(-10.0, 25.0, 1.5)
        self.assertEqual(values[0], -10.0)
        self.assertEqual(values[1], -8.5)
        self.assertEqual(values[-1], 24.5)
        self.assertEqual(len(values), 24)

    def test_regional_points_stay_inside_the_region(self):
        for lat, lon in self.regional:
            self.assertTrue(grid.REGION_LAT_MIN <= lat <= grid.REGION_LAT_MAX, (lat, lon))
            self.assertTrue(grid.REGION_LON_MIN <= lon <= grid.REGION_LON_MAX, (lat, lon))

    def test_regional_points_do_not_repeat_global_points(self):
        base = {(float(a), float(b)) for a, b in self.base}
        self.assertFalse(base & set(self.regional))
        self.assertEqual(len(self.regional), len(set(self.regional)))

    def test_peninsular_malaysia_has_land_points(self):
        # The 5 degree grid had none; this one must put a point next to Kedah.
        near_kedah = [(a, b) for a, b in self.regional if abs(a - 6.12) < 1 and abs(b - 100.37) < 1]
        self.assertTrue(near_kedah)

    def test_all_points_is_global_plus_regional(self):
        self.assertEqual(len(grid.all_points()), len(self.base) + len(self.regional))


class BuiltGridFileTests(unittest.TestCase):
    def test_grid_file_has_regional_points_and_no_failures(self):
        data = json.loads(GRID_JSON.read_text(encoding="utf-8"))
        self.assertEqual(data["meta"]["failed_points"], [])
        self.assertEqual(data["meta"]["point_count"], len(data["points"]))
        self.assertEqual(data["meta"]["regional_step_deg"], grid.REGION_STEP_DEG)
        coords = {(p["lat"], p["lon"]) for p in data["points"]}
        self.assertEqual(len(coords), len(data["points"]), "duplicate grid points")

    def test_places_file_is_well_formed(self):
        places = json.loads(PLACES_JSON.read_text(encoding="utf-8"))
        names = [p["name"] for p in places]
        self.assertEqual(len(names), len(set(names)), "duplicate place names")
        for p in places:
            self.assertTrue(-90 <= p["lat"] <= 90 and -180 <= p["lon"] <= 180, p)


class ExportPresetTests(unittest.TestCase):
    def test_parses_all_ten_presets_from_app_js(self):
        presets = export_presets.parse_presets(APP_JS.read_text(encoding="utf-8"))
        self.assertEqual(len(presets), 10)
        self.assertEqual(presets[0], {"name": "Kedah: padi (demo field)", "lat": 6.12, "lon": 100.37})
        self.assertEqual(presets[-1]["name"], "Sarawak: oil palm (Miri)")

    def test_parser_fails_loudly_without_the_list(self):
        with self.assertRaises(ValueError):
            export_presets.parse_presets("const OTHER = [];")

    def test_crop_label_is_read_from_the_preset_name(self):
        read = export_presets.baseline_crop_label
        self.assertEqual(read("Kedah: padi (demo field)"), "padi")
        self.assertEqual(read("Pahang: tea and vegetables (Cameron Highlands)"), "tea and vegetables")
        self.assertEqual(read("Johor: oil palm (Kluang)"), "oil palm")
        self.assertEqual(read("Pahang: durian (Raub)"), "durian")
        self.assertEqual(read("Perak: Padi"), "padi")  # no brackets, any case

    def test_every_real_preset_maps_to_a_crop_in_crops_json(self):
        crop_names = {c["name"] for c in json.loads((ROOT / "data" / "crops.json").read_text(encoding="utf-8"))}
        presets = export_presets.parse_presets(APP_JS.read_text(encoding="utf-8"))
        mapped = {p["name"]: export_presets.baseline_crop(p["name"]) for p in presets}
        self.assertTrue(set(mapped.values()) <= crop_names, mapped)
        self.assertEqual(mapped["Kedah: padi (demo field)"], "Paddy rice")
        self.assertEqual(mapped["Pahang: durian (Raub)"], "Durian")
        self.assertEqual(mapped["Johor: oil palm (Kluang)"], "Oil palm")
        self.assertEqual(mapped["Sabah: oil palm (Lahad Datu)"], "Oil palm")
        self.assertEqual(mapped["Sarawak: oil palm (Miri)"], "Oil palm")

    def test_unmapped_crop_label_fails_loudly(self):
        with self.assertRaises(ValueError):
            export_presets.baseline_crop("Sabah: cocoa (Tawau)")
        with self.assertRaises(ValueError):
            export_presets.baseline_crop("no colon here")

    def test_top_crop_label(self):
        crop = {"name": "Paddy rice", "note": "n", "source": "s", "match_score": 0.95}
        self.assertEqual(export_presets.top_crop_label({"crops_there": [crop, crop, crop]}), "Paddy rice 0.95 (+2)")
        self.assertEqual(export_presets.top_crop_label({"crops_there": [crop]}), "Paddy rice 0.95")
        self.assertEqual(export_presets.top_crop_label({"crops_there": []}), "none fit")


if __name__ == "__main__":
    unittest.main()
