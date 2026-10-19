from typing import Optional


class DigitalTwinPredictor:
    """Transparent, unvalidated demonstration heuristic; the score is not a probability."""

    forecast_interval_minutes = 5
    forecast_horizon_minutes = 120
    forecast_sample_count = 12
    forecast_minimum_samples = 3
    glucose_excursion_threshold = 180.0

    def calculate_risk_score(
        self,
        current_glucose: float,
        ehr_data: dict,
        previous_glucose: Optional[float] = None,
        heart_rate: Optional[float] = None,
    ) -> dict:
        hba1c = float(ehr_data.get("baseline_hba1c", 5.5))
        bmi = float(ehr_data.get("bmi", 22.0))

        glucose_component = min(max(current_glucose - 110.0, 0.0) / 140.0, 1.0) * 0.45
        trend_component = (
            min(max(current_glucose - previous_glucose, 0.0) / 20.0, 1.0) * 0.25
            if previous_glucose is not None
            else 0.0
        )
        hba1c_component = min(max(hba1c - 5.7, 0.0) / 3.3, 1.0) * 0.25
        bmi_component = min(max(bmi - 25.0, 0.0) / 15.0, 1.0) * 0.1
        heart_rate_component = (
            min(max(heart_rate - 90.0, 0.0) / 60.0, 1.0) * 0.1
            if heart_rate is not None
            else 0.0
        )

        score = min(
            1.0,
            glucose_component
            + trend_component
            + hba1c_component
            + bmi_component
            + heart_rate_component,
        )
        level = "High" if score >= 0.65 else ("Moderate" if score >= 0.35 else "Low")
        interpretation_note = "Demonstration-only heuristic output; not medical advice."

        return {
            "score": round(score, 2),
            "level": level,
            "alert": level == "High",
            "model_type": "transparent_rule_based_demo",
            "clinically_validated": False,
            "interpretation_note": interpretation_note,
            "components": {
                "glucose": round(glucose_component, 3),
                "short_term_trend": round(trend_component, 3),
                "baseline_hba1c": round(hba1c_component, 3),
                "bmi": round(bmi_component, 3),
                "heart_rate": round(heart_rate_component, 3),
            },
        }

    def calculate_glucose_excursion_forecast(
        self,
        glucose_history: list[float],
        ehr_data: dict,
        heart_rate: Optional[float] = None,
    ) -> dict:
        history = [float(value) for value in glucose_history[-self.forecast_sample_count :]]
        samples_used = len(history)
        lookback_minutes = max(0, samples_used - 1) * self.forecast_interval_minutes

        forecast = {
            "horizon_minutes": self.forecast_horizon_minutes,
            "interval_minutes": self.forecast_interval_minutes,
            "threshold_mg_dl": self.glucose_excursion_threshold,
            "samples_used": samples_used,
            "lookback_minutes": lookback_minutes,
            "projected_glucose_mg_dl": None,
            "slope_mg_dl_per_hour": None,
            "estimated_minutes_to_threshold": None,
            "event_within_horizon": None,
            "event_state": "collecting_history",
            "contextual_index": None,
            "contextual_level": None,
            "model_type": "linear_trend_extrapolation_demo",
            "clinically_validated": False,
            "interpretation_note": (
                "Synthetic five-minute samples are linearly extrapolated; the threshold and forecast "
                "are demonstration choices, not a clinical alert or medical advice."
            ),
        }
        if samples_used < self.forecast_minimum_samples:
            return forecast

        x_values = [
            index * self.forecast_interval_minutes
            for index in range(samples_used)
        ]
        mean_x = sum(x_values) / samples_used
        mean_glucose = sum(history) / samples_used
        denominator = sum((value - mean_x) ** 2 for value in x_values)
        slope_per_minute = sum(
            (x_value - mean_x) * (glucose - mean_glucose)
            for x_value, glucose in zip(x_values, history)
        ) / denominator

        current_glucose = history[-1]
        projected_glucose = (
            current_glucose
            + slope_per_minute * self.forecast_horizon_minutes
        )
        estimated_minutes_to_threshold = (
            (self.glucose_excursion_threshold - current_glucose) / slope_per_minute
            if current_glucose < self.glucose_excursion_threshold and slope_per_minute > 0
            else None
        )
        event_within_horizon = (
            estimated_minutes_to_threshold is not None
            and estimated_minutes_to_threshold <= self.forecast_horizon_minutes
        )

        if current_glucose >= self.glucose_excursion_threshold:
            event_state = "already_above_demo_threshold"
        elif event_within_horizon:
            event_state = "projected_within_horizon"
        else:
            event_state = "not_projected_within_horizon"

        contextual_prediction = self.calculate_risk_score(
            projected_glucose,
            ehr_data,
            heart_rate=heart_rate,
        )
        forecast.update({
            "projected_glucose_mg_dl": round(projected_glucose, 1),
            "slope_mg_dl_per_hour": round(slope_per_minute * 60, 2),
            "estimated_minutes_to_threshold": (
                round(estimated_minutes_to_threshold, 1)
                if estimated_minutes_to_threshold is not None
                else None
            ),
            "event_within_horizon": event_within_horizon,
            "event_state": event_state,
            "contextual_index": contextual_prediction["score"],
            "contextual_level": contextual_prediction["level"],
        })
        return forecast
