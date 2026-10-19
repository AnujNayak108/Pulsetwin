import unittest

from predictor import DigitalTwinPredictor
from scenarios import build_counterfactual_comparison


class DigitalTwinPredictorTests(unittest.TestCase):
    def setUp(self):
        self.predictor = DigitalTwinPredictor()
        self.profile = {"baseline_hba1c": 7.2, "bmi": 28.5}

    def test_returns_documented_demo_output_shape(self):
        result = self.predictor.calculate_risk_score(
            120.0, self.profile, previous_glucose=118.0, heart_rate=72.0
        )

        self.assertEqual(
            set(result["components"]),
            {"glucose", "short_term_trend", "baseline_hba1c", "bmi", "heart_rate"},
        )
        self.assertEqual(result["model_type"], "transparent_rule_based_demo")
        self.assertFalse(result["clinically_validated"])
        self.assertIn("not medical advice", result["interpretation_note"])
        self.assertNotIn("use_case_horizon_hours", result)

    def test_rising_excursion_increases_index(self):
        baseline = self.predictor.calculate_risk_score(
            112.0, self.profile, previous_glucose=112.0, heart_rate=72.0
        )
        excursion = self.predictor.calculate_risk_score(
            230.0, self.profile, previous_glucose=190.0, heart_rate=110.0
        )

        self.assertGreater(excursion["score"], baseline["score"])
        self.assertEqual(baseline["level"], "Low")
        self.assertEqual(excursion["level"], "High")
        self.assertTrue(excursion["alert"])

    def test_moderate_band_is_reported_without_high_alert(self):
        result = self.predictor.calculate_risk_score(
            180.0,
            {"baseline_hba1c": 9.0, "bmi": 40.0},
            previous_glucose=180.0,
            heart_rate=90.0,
        )

        self.assertEqual(result["level"], "Moderate")
        self.assertFalse(result["alert"])

    def test_score_is_clamped_and_severity_bands_are_consistent(self):
        result = self.predictor.calculate_risk_score(
            1000.0,
            {"baseline_hba1c": 9.0, "bmi": 40.0},
            previous_glucose=0.0,
            heart_rate=1000.0,
        )

        self.assertEqual(result["score"], 1.0)
        self.assertEqual(result["level"], "High")
        self.assertTrue(result["alert"])

    def test_no_prior_sample_has_no_trend_contribution(self):
        result = self.predictor.calculate_risk_score(150.0, self.profile, heart_rate=80.0)

        self.assertEqual(result["components"]["short_term_trend"], 0.0)

    def test_forecast_waits_for_three_sensor_samples(self):
        result = self.predictor.calculate_glucose_excursion_forecast(
            [110.0, 112.0], self.profile, heart_rate=72.0
        )

        self.assertEqual(result["event_state"], "collecting_history")
        self.assertIsNone(result["projected_glucose_mg_dl"])
        self.assertIsNone(result["event_within_horizon"])

    def test_forecast_flags_a_rising_excursion_within_two_hours(self):
        result = self.predictor.calculate_glucose_excursion_forecast(
            [120.0, 130.0, 140.0, 150.0], self.profile, heart_rate=80.0
        )

        self.assertEqual(result["horizon_minutes"], 120)
        self.assertEqual(result["projected_glucose_mg_dl"], 390.0)
        self.assertTrue(result["event_within_horizon"])
        self.assertEqual(result["event_state"], "projected_within_horizon")
        self.assertEqual(result["estimated_minutes_to_threshold"], 15.0)
        self.assertIsNotNone(result["contextual_index"])
        self.assertFalse(result["clinically_validated"])

    def test_stable_samples_do_not_predict_an_excursion(self):
        result = self.predictor.calculate_glucose_excursion_forecast(
            [110.0, 111.0, 109.0, 110.0], self.profile, heart_rate=72.0
        )

        self.assertFalse(result["event_within_horizon"])
        self.assertEqual(result["event_state"], "not_projected_within_horizon")

    def test_forecast_contextual_index_uses_static_ehr_context(self):
        history = [120.0, 130.0, 140.0]
        baseline_context = self.predictor.calculate_glucose_excursion_forecast(
            history, {"baseline_hba1c": 5.5, "bmi": 22.0}
        )
        elevated_context = self.predictor.calculate_glucose_excursion_forecast(
            history, {"baseline_hba1c": 8.0, "bmi": 32.0}
        )

        self.assertEqual(
            baseline_context["projected_glucose_mg_dl"],
            elevated_context["projected_glucose_mg_dl"],
        )
        self.assertLess(
            baseline_context["contextual_index"],
            elevated_context["contextual_index"],
        )


class CounterfactualComparisonTests(unittest.TestCase):
    def setUp(self):
        self.profile = {
            "id": "DEMO-10023",
            "data_source": "synthetic",
            "baseline_hba1c": 7.2,
            "bmi": 28.5,
        }

    def test_comparison_is_repeatable_for_same_seed(self):
        first = build_counterfactual_comparison(self.profile, seed=33, sample_count=8)
        second = build_counterfactual_comparison(self.profile, seed=33, sample_count=8)

        self.assertEqual(first, second)

    def test_only_glucose_changes_and_other_factors_are_held_constant(self):
        result = build_counterfactual_comparison(self.profile, seed=2026, sample_count=12)
        steady, rising = result["scenarios"]

        self.assertEqual(len(steady["readings"]), 12)
        for steady_reading, rising_reading in zip(steady["readings"], rising["readings"]):
            self.assertEqual(steady_reading["heart_rate"], rising_reading["heart_rate"])
            self.assertGreaterEqual(rising_reading["glucose"], steady_reading["glucose"])
            self.assertEqual(steady_reading["elapsed_minutes"], rising_reading["elapsed_minutes"])

        self.assertEqual(result["model_type"], "transparent_rule_based_demo")
        self.assertFalse(result["clinically_validated"])
        self.assertGreater(result["comparison"]["final_index_delta"], 0)
        self.assertTrue(any(
            reading["prediction"]["forecast"]["event_within_horizon"]
            for reading in rising["readings"]
        ))
        self.assertEqual(
            rising["summary"]["final_forecast"]["event_state"],
            "already_above_demo_threshold",
        )
        self.assertFalse(
            steady["summary"]["final_forecast"]["event_within_horizon"]
        )
        self.assertEqual(result["comparison"]["final_component_deltas"]["heart_rate"], 0.0)
        self.assertEqual(result["comparison"]["final_component_deltas"]["bmi"], 0.0)
        self.assertEqual(result["comparison"]["final_component_deltas"]["baseline_hba1c"], 0.0)

    def test_sample_count_is_bounded_by_endpoint_contract(self):
        with self.assertRaises(ValueError):
            build_counterfactual_comparison(self.profile, seed=5, sample_count=0)


if __name__ == "__main__":
    unittest.main()
