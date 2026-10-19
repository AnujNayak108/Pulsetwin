import random

from predictor import DigitalTwinPredictor


def build_counterfactual_comparison(
    profile: dict,
    seed: int = 2026,
    sample_count: int = 12,
) -> dict:
    if not 6 <= sample_count <= 24:
        raise ValueError("sample_count must be between 6 and 24")

    rng = random.Random(seed)
    predictor = DigitalTwinPredictor()
    baseline = []
    rising_signal = []
    previous_baseline_glucose = None
    previous_rising_glucose = None

    for index in range(sample_count):
        baseline_glucose = round(112.0 + rng.uniform(-2.0, 2.0), 1)
        heart_rate = round(72.0 + rng.uniform(-2.0, 2.0), 1)
        glucose_offset = min(index * 8.0, 72.0)
        rising_glucose = round(baseline_glucose + glucose_offset, 1)

        baseline_prediction = predictor.calculate_risk_score(
            baseline_glucose,
            profile,
            previous_glucose=previous_baseline_glucose,
            heart_rate=heart_rate,
        )
        baseline_prediction["forecast"] = predictor.calculate_glucose_excursion_forecast(
            [point["glucose"] for point in baseline] + [baseline_glucose],
            profile,
            heart_rate=heart_rate,
        )
        rising_prediction = predictor.calculate_risk_score(
            rising_glucose,
            profile,
            previous_glucose=previous_rising_glucose,
            heart_rate=heart_rate,
        )
        rising_prediction["forecast"] = predictor.calculate_glucose_excursion_forecast(
            [point["glucose"] for point in rising_signal] + [rising_glucose],
            profile,
            heart_rate=heart_rate,
        )
        elapsed_minutes = index * 5

        baseline.append({
            "sample": index + 1,
            "elapsed_minutes": elapsed_minutes,
            "glucose": baseline_glucose,
            "heart_rate": heart_rate,
            "prediction": baseline_prediction,
        })
        rising_signal.append({
            "sample": index + 1,
            "elapsed_minutes": elapsed_minutes,
            "glucose": rising_glucose,
            "heart_rate": heart_rate,
            "prediction": rising_prediction,
        })

        previous_baseline_glucose = baseline_glucose
        previous_rising_glucose = rising_glucose

    baseline_scores = [point["prediction"]["score"] for point in baseline]
    rising_scores = [point["prediction"]["score"] for point in rising_signal]
    final_baseline = baseline[-1]["prediction"]
    final_rising = rising_signal[-1]["prediction"]

    return {
        "data_notice": "Synthetic counterfactual demonstration only; not for clinical decision-making.",
        "model_type": "transparent_rule_based_demo",
        "clinically_validated": False,
        "seed": seed,
        "sample_count": sample_count,
        "interval_minutes": 5,
        "controlled_factors": [
            "Same synthetic patient profile in both scenarios.",
            "Same seeded heart-rate sequence in both scenarios.",
        ],
        "changed_factor": "Only the glucose trajectory changes; the rising scenario adds a deterministic upward offset.",
        "interpretation_note": (
            "This controlled comparison shows how the demonstration heuristic responds to changed synthetic "
            "glucose inputs. The trend extrapolations are not clinically validated forecasts, probabilities, "
            "treatment effects, or medical advice."
        ),
        "scenarios": [
            {
                "id": "steady",
                "label": "Steady glucose (synthetic)",
                "readings": baseline,
                "summary": {
                    "mean_index": round(sum(baseline_scores) / sample_count, 3),
                    "final_index": final_baseline["score"],
                    "final_level": final_baseline["level"],
                    "final_components": final_baseline["components"],
                    "final_forecast": baseline[-1]["prediction"]["forecast"],
                },
            },
            {
                "id": "rising",
                "label": "Rising glucose (synthetic)",
                "readings": rising_signal,
                "summary": {
                    "mean_index": round(sum(rising_scores) / sample_count, 3),
                    "final_index": final_rising["score"],
                    "final_level": final_rising["level"],
                    "final_components": final_rising["components"],
                    "final_forecast": rising_signal[-1]["prediction"]["forecast"],
                },
            },
        ],
        "comparison": {
            "mean_index_delta": round(
                sum(rising_scores) / sample_count - sum(baseline_scores) / sample_count,
                3,
            ),
            "final_index_delta": round(
                final_rising["score"] - final_baseline["score"],
                3,
            ),
            "final_component_deltas": {
                name: round(
                    final_rising["components"][name] - final_baseline["components"][name],
                    3,
                )
                for name in final_baseline["components"]
            },
        },
    }
