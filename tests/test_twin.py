"""Tests for engine/twin.py and api/main.py.

Run from the project root:  python -m pytest   (or: python -m unittest discover -s tests -t .)

The integration tests use the cached Kedah demo field, so they never touch the
network. They are skipped if that cache file is missing.
"""

import contextlib
import io
import json
import math
import unittest
from pathlib import Path

from engine import twin
from engine.power_client import cache_path, HISTORY_START, HISTORY_END
from engine.signature import SIGNATURE_KEYS

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_CONTRACT = ROOT / "frontend" / "contract.json"
KEDAH_LAT, KEDAH_LON = 6.12, 100.37
KEDAH_CACHED = cache_path(KEDAH_LAT, KEDAH_LON, HISTORY_START, HISTORY_END).exists()

PADDY = {
    "name": "Test rice", "note": "n", "source": "s",
    "gdd_required": 2000, "rain_min_mm": 1000, "rain_max_mm": 4000,
    "max_heat_days": 60, "min_cold_month_c": 18,
}
WARM_WET = {
    "mean_temp": 27, "gdd": 6000, "rain_mm": 2500, "wet_share": 0.4,
    "dry_spell_days": 20, "heat_days": 10, "solar": 18, "cold_month": 25,
}
SCATTER = {"mean_temp": 0.5, "heat_days": 2.0, "dry_spell_days": 4.0}


class GeographyTests(unittest.TestCase):
    def test_one_degree_of_latitude_is_about_111_km(self):
        self.assertAlmostEqual(twin.haversine_km(0, 0, 1, 0), 111.19, delta=0.1)

    def test_same_point_is_zero(self):
        self.assertEqual(twin.haversine_km(6.12, 100.37, 6.12, 100.37), 0)

    def test_nearest_place_and_coordinate_fallback(self):
        places = [{"name": "Near", "lat": 10, "lon": 100}]
        self.assertEqual(twin.nearest_place(10.5, 100.5, places), "Near")
        self.assertIsNone(twin.nearest_place(-40, -70, places))
        self.assertEqual(twin.place_label(-40, -70, places), "40.0°S, 70.0°W")


class TrendTests(unittest.TestCase):
    def test_exact_line_extrapolates_exactly(self):
        # mean_temp = 20 + 0.1 * (year - 1984); at 2045 that is 26.1
        yearly = {y: {**WARM_WET, "mean_temp": 20 + 0.1 * (y - 1984)} for y in range(1984, 2025)}
        trends = twin.fit_trends(yearly)
        self.assertAlmostEqual(twin.predict_signature(trends, 2045)["mean_temp"], 26.1, places=6)

    def test_prediction_is_clamped_to_physical_range(self):
        yearly = {y: {**WARM_WET, "heat_days": 5 + 2.0 * (y - 1984), "wet_share": 0.9 + 0.01 * (y - 1984)}
                  for y in range(1984, 2025)}
        predicted = twin.predict_signature(twin.fit_trends(yearly), 2045)
        self.assertEqual(predicted["wet_share"], 1.0)
        yearly = {y: {**WARM_WET, "heat_days": max(0.0, 50 - 3.0 * (y - 1984))} for y in range(1984, 2025)}
        self.assertGreaterEqual(twin.predict_signature(twin.fit_trends(yearly), 2045)["heat_days"], 0.0)

    def test_scatter_of_a_perfect_line_falls_back_to_the_floor(self):
        yearly = {y: {**WARM_WET, "mean_temp": 20 + 0.1 * (y - 1984)} for y in range(1984, 2025)}
        scatter = twin.trend_scatter(yearly, twin.fit_trends(yearly))
        self.assertEqual(scatter, twin.SCATTER_FLOOR)

    def test_scatter_measures_noise_around_the_line(self):
        # +-2 C alternating noise (well above the 0.8 floor): residual std is about 2 * sqrt(41 / 39)
        yearly = {y: {**WARM_WET, "mean_temp": 20 + 2.0 * (-1) ** y} for y in range(1984, 2025)}
        scatter = twin.trend_scatter(yearly, twin.fit_trends(yearly))
        self.assertAlmostEqual(scatter["mean_temp"], 2.05, delta=0.1)

    def test_small_scatter_is_widened_to_the_temperature_floor(self):
        # +-0.25 C noise is typical of the tropics; the penalty scale must not shrink below 0.8 C
        yearly = {y: {**WARM_WET, "mean_temp": 20 + 0.25 * (-1) ** y} for y in range(1984, 2025)}
        scatter = twin.trend_scatter(yearly, twin.fit_trends(yearly))
        self.assertEqual(scatter["mean_temp"], 0.8)

    def test_scatter_needs_three_years(self):
        yearly = {y: dict(WARM_WET) for y in (2023, 2024)}
        with self.assertRaises(ValueError):
            twin.trend_scatter(yearly, {k: (0.0, 0.0) for k in SIGNATURE_KEYS})

    def test_interpolation_hits_both_ends_and_the_middle(self):
        now = dict(WARM_WET)
        future = {**WARM_WET, "mean_temp": 29, "rain_mm": 2000}
        self.assertEqual(twin.interpolate_signature(now, future, twin.PRESENT_MID_YEAR), now)
        self.assertEqual(twin.interpolate_signature(now, future, twin.TARGET_YEAR), future)
        middle_year = (twin.PRESENT_MID_YEAR + twin.TARGET_YEAR) / 2
        middle = twin.interpolate_signature(now, future, middle_year)
        self.assertAlmostEqual(middle["mean_temp"], 28.0)
        self.assertAlmostEqual(middle["rain_mm"], 2250.0)


class TwinLookupTests(unittest.TestCase):
    def setUp(self):
        self.weights = {k: 1.0 for k in SIGNATURE_KEYS}
        self.points = [
            {"lat": 0, "lon": 0, "signature": {k: float(i) for i, k in enumerate(SIGNATURE_KEYS)}},
            {"lat": 1, "lon": 1, "signature": {k: float(i) + 10 for i, k in enumerate(SIGNATURE_KEYS)}},
            {"lat": 2, "lon": 2, "signature": {k: float(i) + 20 for i, k in enumerate(SIGNATURE_KEYS)}},
        ]
        self.stats = twin.grid_stats([p["signature"] for p in self.points], SIGNATURE_KEYS)

    def test_identical_signature_has_zero_distance_and_score_one(self):
        sig = self.points[1]["signature"]
        self.assertEqual(twin.twin_distance(sig, sig, self.weights, self.stats), 0)
        self.assertEqual(twin.match_score(0), 1)

    def test_finds_closest_point(self):
        target = {k: v + 1 for k, v in self.points[1]["signature"].items()}
        point, distance = twin.find_twin(target, self.points, self.weights, self.stats)
        self.assertEqual((point["lat"], point["lon"]), (1, 1))
        self.assertGreater(distance, 0)

    def test_weight_changes_the_answer(self):
        # Point A matches on mean_temp but is off on rain_mm; point B is the reverse.
        # Both are off by the same z-score (2.0), so only the weights decide.
        a = {**WARM_WET, "rain_mm": WARM_WET["rain_mm"] + 20}
        b = {**WARM_WET, "mean_temp": WARM_WET["mean_temp"] + 20}
        target = dict(WARM_WET)
        points = [{"lat": 0, "lon": 0, "signature": a}, {"lat": 1, "lon": 1, "signature": b}]
        stats = {k: (float(WARM_WET[k]), 10.0) for k in SIGNATURE_KEYS}
        heavy_temp = {**{k: 0.0 for k in SIGNATURE_KEYS}, "mean_temp": 5.0, "rain_mm": 1.0}
        heavy_rain = {**{k: 0.0 for k in SIGNATURE_KEYS}, "mean_temp": 1.0, "rain_mm": 5.0}
        self.assertEqual(twin.find_twin(target, points, heavy_temp, stats)[0]["lat"], 0)
        self.assertEqual(twin.find_twin(target, points, heavy_rain, stats)[0]["lat"], 1)

    def test_constant_column_fails_loudly(self):
        flat = [{k: 1.0 for k in SIGNATURE_KEYS}, {k: 1.0 for k in SIGNATURE_KEYS}]
        with self.assertRaises(ValueError):
            twin.grid_stats(flat, SIGNATURE_KEYS)

    def test_real_weights_cover_all_eight_keys(self):
        self.assertEqual(sorted(twin.load_weights()), sorted(SIGNATURE_KEYS))


class GeographicConstraintTests(unittest.TestCase):
    """Two grid cells: 'near' is 157 km from the origin, 'far' is about 16,700 km away."""

    def setUp(self):
        self.weights = {k: 1.0 for k in SIGNATURE_KEYS}
        self.target = dict(WARM_WET)
        self.stats = {k: (float(WARM_WET[k]), 10.0) for k in SIGNATURE_KEYS}
        self.origin = (0.0, 0.0)

    def cell(self, lat: float, lon: float, mean_temp_offset: float) -> dict:
        """A grid cell whose climate differs from the target on mean_temp only (z = offset / 10)."""
        return {"lat": lat, "lon": lon, "signature": {**WARM_WET, "mean_temp": WARM_WET["mean_temp"] + mean_temp_offset}}

    def test_radius_excludes_a_better_cell_that_is_too_far(self):
        near = self.cell(1, 1, 3.0)    # distance 0.3 * sqrt(2)... weight 1 on mean_temp: 0.3
        far = self.cell(0, 150, 0.0)   # perfect match, 16,700 km away
        pts = [near, far]
        unconstrained, _ = twin.find_twin(self.target, pts, self.weights, self.stats)
        constrained, _ = twin.find_twin(self.target, pts, self.weights, self.stats, origin=self.origin, max_km=2500)
        self.assertEqual(unconstrained["lon"], 150)
        self.assertEqual(constrained["lon"], 1)

    def test_radius_with_no_cell_inside_falls_back_loudly(self):
        far = self.cell(0, 150, 0.0)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            point, _ = twin.find_twin(self.target, [far], self.weights, self.stats, origin=self.origin, max_km=2500)
        self.assertEqual(point["lon"], 150)
        self.assertIn("WARNING", out.getvalue())

    def test_penalty_breaks_a_near_tie_towards_the_nearer_cell(self):
        near = self.cell(1, 1, 1.0)     # climate distance 0.100
        far = self.cell(0, 150, 0.99)   # climate distance 0.099, marginally better
        pts = [far, near]
        plain, _ = twin.find_twin(self.target, pts, self.weights, self.stats)
        penalised, distance = twin.find_twin(
            self.target, pts, self.weights, self.stats,
            origin=self.origin, geo_penalty_per_1000_km=twin.GEO_PENALTY_PER_1000_KM)
        self.assertEqual(plain["lon"], 150)
        self.assertEqual(penalised["lon"], 1)
        self.assertAlmostEqual(distance, 0.1, places=6)  # reported distance has no penalty in it

    def test_penalty_does_not_override_a_clearly_better_climate(self):
        near = self.cell(1, 1, 5.0)    # climate distance 0.5
        far = self.cell(0, 150, 1.0)   # climate distance 0.1
        point, _ = twin.find_twin(
            self.target, [near, far], self.weights, self.stats,
            origin=self.origin, geo_penalty_per_1000_km=twin.GEO_PENALTY_PER_1000_KM)
        self.assertEqual(point["lon"], 150)


CENTERED = {**PADDY, "name": "Centered", "rain_min_mm": 2000, "rain_max_mm": 3000}  # midpoint 2500
WIDE = {**PADDY, "name": "Wide", "rain_min_mm": 500, "rain_max_mm": 5000}           # midpoint 2750, huge band


class CropTests(unittest.TestCase):
    def test_rain_fit_is_one_at_the_midpoint_and_falls_off_both_sides(self):
        self.assertEqual(twin.rain_midpoint_fit(PADDY, WARM_WET), 1.0)  # 2500 is the middle of 1000-4000
        below = twin.rain_midpoint_fit(PADDY, {**WARM_WET, "rain_mm": 2500 * (1 - twin.RAIN_FIT_WIDTH)})
        above = twin.rain_midpoint_fit(PADDY, {**WARM_WET, "rain_mm": 2500 * (1 + twin.RAIN_FIT_WIDTH)})
        self.assertAlmostEqual(below, math.exp(-0.5))  # one sigma off
        self.assertAlmostEqual(above, math.exp(-0.5))

    def test_wide_band_is_not_automatically_the_better_fit(self):
        # This is why Cassava used to rank first everywhere: a 500-5000 mm band always looked "central".
        self.assertGreater(twin.rain_midpoint_fit(CENTERED, WARM_WET), twin.rain_midpoint_fit(WIDE, WARM_WET))
        self.assertGreater(twin.crop_match_score(CENTERED, WARM_WET), twin.crop_match_score(WIDE, WARM_WET))

    def test_limit_margins(self):
        m = twin.limit_margins(PADDY, WARM_WET)
        self.assertAlmostEqual(m["gdd"], (6000 / 2000 - 1) / twin.COMFORT_HEADROOM)
        self.assertAlmostEqual(m["heat"], (60 - 10) / (60 * twin.COMFORT_HEADROOM))
        self.assertAlmostEqual(m["cold"], (25 - 18) / twin.COLD_COMFORT_C)
        self.assertEqual(set(m), {"gdd", "heat", "cold"})

    def test_comfort_is_half_at_the_limit_and_monotonic(self):
        self.assertAlmostEqual(twin.comfort(0.0), 0.5)
        values = [twin.comfort(m / 10) for m in range(-30, 31)]
        self.assertEqual(values, sorted(values))
        self.assertTrue(all(0 < v < 1 for v in values))

    def test_comfort_stays_finite_far_outside_the_range(self):
        self.assertGreater(twin.comfort(-1e9), 0)
        self.assertLess(twin.comfort(1e9), 1)

    def test_score_is_high_at_the_midpoint_and_low_far_from_it(self):
        self.assertGreater(twin.crop_match_score(PADDY, WARM_WET), 0.95)
        far = {**WARM_WET, "rain_mm": 1100}  # inside the band, but 1.87 sigma from its 2500 mm midpoint
        self.assertAlmostEqual(twin.crop_match_score(PADDY, far), math.exp(-0.5 * 1.8667 ** 2), places=2)
        self.assertLess(twin.crop_match_score(PADDY, far), 0.2)

    def test_one_sided_limit_at_its_edge_halves_the_score(self):
        at_heat_limit = {**WARM_WET, "heat_days": PADDY["max_heat_days"]}
        self.assertAlmostEqual(twin.crop_match_score(PADDY, at_heat_limit), 0.5, places=3)

    def test_weakest_one_sided_limit_sets_the_score(self):
        hot = {**WARM_WET, "heat_days": 90}  # heat margin (60 - 90) / 15 = -2, rain exactly at the midpoint
        self.assertAlmostEqual(twin.crop_match_score(PADDY, hot), twin.comfort(-2.0))

    def test_within_tolerance(self):
        self.assertTrue(twin.within_tolerance(PADDY, WARM_WET))
        self.assertTrue(twin.within_tolerance(PADDY, {**WARM_WET, "rain_mm": PADDY["rain_min_mm"]}))  # edge counts
        self.assertFalse(twin.within_tolerance(PADDY, {**WARM_WET, "rain_mm": 8000}))
        self.assertFalse(twin.within_tolerance(PADDY, {**WARM_WET, "cold_month": 10}))
        self.assertFalse(twin.within_tolerance(PADDY, {**WARM_WET, "heat_days": 61}))
        self.assertFalse(twin.within_tolerance(PADDY, {**WARM_WET, "gdd": 1500}))

    def test_crops_there_are_sorted_best_first_and_only_suitable(self):
        excluded = {**PADDY, "name": "Excluded", "rain_min_mm": 5000, "rain_max_mm": 9000}
        result = twin.crops_for_climate([WIDE, excluded, CENTERED], WARM_WET, WARM_WET)
        self.assertEqual([c["name"] for c in result], ["Centered", "Wide"])
        self.assertTrue(all("match_score" in c for c in result))
        self.assertGreater(result[0]["match_score"], result[1]["match_score"])

    def test_sorting_ignores_file_order(self):
        off_centre = {**PADDY, "name": "Off", "rain_min_mm": 2000, "rain_max_mm": 5000}  # midpoint 3500, rain 2500 fits
        names = [c["name"] for c in twin.crops_for_climate([off_centre, PADDY], WARM_WET, WARM_WET)]
        self.assertEqual(names, [PADDY["name"], "Off"])

    def test_real_crops_give_different_winners_in_different_climates(self):
        crops = twin.load_json(twin.CROPS_PATH)
        wet_lowland = {**WARM_WET, "rain_mm": 3300, "gdd": 6200, "heat_days": 1, "cold_month": 25.5}
        drier_cooler = {**WARM_WET, "rain_mm": 1150, "gdd": 5000, "heat_days": 10, "cold_month": 22}
        wet = twin.crops_for_climate(crops, wet_lowland, wet_lowland)
        drier = twin.crops_for_climate(crops, drier_cooler, drier_cooler)
        self.assertTrue(wet and drier)
        self.assertNotEqual(wet[0]["name"], drier[0]["name"])

    def test_scored_on_the_2045_climate_not_the_twin(self):
        # Fits at the twin, but the field's 2045 climate is near the crop's rain limit.
        crop = {**PADDY, "name": "Edge", "rain_min_mm": 1000, "rain_max_mm": 4000}
        near_edge = {**WARM_WET, "rain_mm": 1100}
        result = twin.crops_for_climate([crop], WARM_WET, near_edge)
        self.assertAlmostEqual(result[0]["match_score"], round(twin.crop_match_score(crop, near_edge), 2))

    def test_unknown_crop_raises(self):
        with self.assertRaises(twin.UnknownCropError):
            twin.pick_current_crop([PADDY], WARM_WET, "Quinoa")

    def test_named_crop_is_case_insensitive(self):
        self.assertIs(twin.pick_current_crop([PADDY], WARM_WET, " test RICE "), PADDY)

    def test_default_falls_back_to_best_crop_when_paddy_cannot_grow(self):
        paddy = {**PADDY, "name": twin.DEFAULT_CROP}
        hardy = {**PADDY, "name": "Hardy", "rain_min_mm": 0, "rain_max_mm": 9000, "min_cold_month_c": -50}
        freezing = {**WARM_WET, "cold_month": -30, "rain_mm": 300}
        self.assertEqual(twin.pick_current_crop([paddy, hardy], freezing, None)["name"], "Hardy")

    def test_default_is_paddy_when_it_can_grow(self):
        paddy = {**PADDY, "name": twin.DEFAULT_CROP}
        other = {**PADDY, "name": "Other", "rain_min_mm": 0, "rain_max_mm": 5000}
        self.assertEqual(twin.pick_current_crop([other, paddy], WARM_WET, None)["name"], twin.DEFAULT_CROP)


class ViabilityTests(unittest.TestCase):
    def test_gaussian_penalty_values(self):
        self.assertEqual(twin.stress_penalty(0.0, 1.0), 1.0)
        self.assertEqual(twin.stress_penalty(-5.0, 1.0), 1.0)       # cooling costs nothing
        self.assertAlmostEqual(twin.stress_penalty(1.0, 1.0), math.exp(-0.5))
        self.assertAlmostEqual(twin.stress_penalty(2.0, 1.0), math.exp(-2.0))
        self.assertAlmostEqual(twin.stress_penalty(1.0, 0.5), math.exp(-2.0))  # smaller scatter, harsher

    def test_curve_years_are_2025_to_2045_every_5(self):
        curve = twin.viability_curve(PADDY, WARM_WET, WARM_WET, SCATTER)
        self.assertEqual([v["year"] for v in curve], [2025, 2030, 2035, 2040, 2045])

    def test_no_change_in_climate_gives_a_flat_curve(self):
        scores = [v["score"] for v in twin.viability_curve(PADDY, WARM_WET, WARM_WET, SCATTER)]
        self.assertEqual(len(set(scores)), 1)
        self.assertAlmostEqual(scores[0], round(twin.crop_match_score(PADDY, WARM_WET), 2))

    def test_warming_slopes_the_curve_down(self):
        future = {**WARM_WET, "mean_temp": WARM_WET["mean_temp"] + 1.0}  # 2 scatters of warming
        scores = [v["score"] for v in twin.viability_curve(PADDY, WARM_WET, future, SCATTER)]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertGreater(scores[0] - scores[-1], 0.3)
        self.assertAlmostEqual(scores[-1], round(math.exp(-2.0), 2), places=2)  # z = 2 in 2045

    def test_more_heat_days_slopes_the_curve_down(self):
        future = {**WARM_WET, "heat_days": WARM_WET["heat_days"] + 6}  # 3 scatters, still inside the crop limit
        scores = [v["score"] for v in twin.viability_curve(PADDY, WARM_WET, future, SCATTER)]
        self.assertLess(scores[-1], scores[0])

    def test_longer_dry_spell_slopes_the_curve_down(self):
        future = {**WARM_WET, "dry_spell_days": WARM_WET["dry_spell_days"] + 8}  # 2 scatters
        scores = [v["score"] for v in twin.viability_curve(PADDY, WARM_WET, future, SCATTER)]
        self.assertLess(scores[-1], scores[0])

    def test_cooler_drier_spell_does_not_add_a_penalty(self):
        future = {**WARM_WET, "mean_temp": 25.0, "heat_days": 0, "dry_spell_days": 10}
        scores = [v["score"] for v in twin.viability_curve(PADDY, WARM_WET, future, SCATTER)]
        self.assertAlmostEqual(scores[-1], round(twin.crop_match_score(PADDY, future), 2), places=2)

    def test_scores_stay_between_zero_and_one(self):
        future = {**WARM_WET, "mean_temp": 40, "heat_days": 300, "dry_spell_days": 200, "rain_mm": 100}
        for v in twin.viability_curve(PADDY, WARM_WET, future, SCATTER):
            self.assertTrue(0 <= v["score"] <= 1)


@unittest.skipUnless(KEDAH_CACHED, "Kedah POWER cache file not present; skipping offline integration tests")
class ResponseShapeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = twin.climate_twin(KEDAH_LAT, KEDAH_LON)
        cls.contract = json.loads(FRONTEND_CONTRACT.read_text(encoding="utf-8"))

    def assert_same_keys(self, got: dict, want: dict, path: str):
        self.assertTrue(set(want) <= set(got), f"{path}: missing {set(want) - set(got)}")

    def test_every_contract_key_is_present(self):
        self.assert_same_keys(self.result, self.contract, "root")
        for section in ("field", "twin", "twin_now", "twin_1995"):
            self.assert_same_keys(self.result[section], self.contract[section], section)
        for section in ("signature_now", "signature_2045"):
            self.assertEqual(sorted(self.result[section]), sorted(SIGNATURE_KEYS))
        self.assertEqual(sorted(self.result["twin"]["signature"]), sorted(SIGNATURE_KEYS))

    def test_list_item_keys(self):
        for item in self.result["crops_there"]:
            self.assertEqual(sorted(item), ["match_score", "name", "note", "source"])
        for item in self.result["current_crop_viability"]:
            self.assertEqual(sorted(item), ["score", "year"])

    def test_crops_there_sorted_by_score_descending(self):
        scores = [c["match_score"] for c in self.result["crops_there"]]
        self.assertTrue(scores)
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0 <= s <= 1 for s in scores))

    def test_viability_years_and_score_range(self):
        years = [v["year"] for v in self.result["current_crop_viability"]]
        self.assertEqual(years, [2025, 2030, 2035, 2040, 2045])
        self.assertTrue(all(0 <= v["score"] <= 1 for v in self.result["current_crop_viability"]))

    def test_viability_slopes_down_for_kedah(self):
        scores = [v["score"] for v in self.result["current_crop_viability"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertGreater(scores[0], scores[-1])

    def test_backtest_twins_are_regional(self):
        field = self.result["field"]
        for key in ("twin_now", "twin_1995"):
            km = twin.haversine_km(field["lat"], field["lon"], self.result[key]["lat"], self.result[key]["lon"])
            self.assertLessEqual(km, twin.BACKTEST_MAX_KM, key)

    def test_demo_field_and_value_ranges(self):
        self.assertEqual(self.result["field"]["name"], twin.DEMO_FIELD_NAME)
        self.assertTrue(0 < self.result["twin"]["match_score"] <= 1)
        self.assertGreater(self.result["twin"]["distance_km"], 0)
        self.assertGreaterEqual(self.result["twin_1995"]["drift_km"], 0)
        self.assertLessEqual(self.result["twin_1995"]["drift_km"], 2 * twin.BACKTEST_MAX_KM)

    def test_result_is_json_serialisable(self):
        json.dumps(self.result)


@unittest.skipUnless(KEDAH_CACHED, "Kedah POWER cache file not present; skipping offline integration tests")
class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        from api.main import app
        cls.client = TestClient(app)

    def test_twin_returns_contract_shape_with_cors(self):
        res = self.client.get("/twin", params={"lat": KEDAH_LAT, "lon": KEDAH_LON},
                              headers={"Origin": "http://localhost:3000"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("access-control-allow-origin"), "*")
        body = res.json()
        for key in ("field", "signature_now", "signature_2045", "twin", "twin_now", "twin_1995",
                    "crops_there", "current_crop_viability", "caveats"):
            self.assertIn(key, body)

    def test_out_of_range_coordinates_are_rejected(self):
        self.assertEqual(self.client.get("/twin", params={"lat": 91, "lon": 0}).status_code, 422)
        self.assertEqual(self.client.get("/twin", params={"lat": 0, "lon": 181}).status_code, 422)

    def test_missing_coordinates_are_rejected(self):
        self.assertEqual(self.client.get("/twin", params={"lat": 6.12}).status_code, 422)

    def test_unknown_crop_is_rejected(self):
        res = self.client.get("/twin", params={"lat": KEDAH_LAT, "lon": KEDAH_LON, "crop": "Quinoa"})
        self.assertEqual(res.status_code, 422)


if __name__ == "__main__":
    unittest.main()
