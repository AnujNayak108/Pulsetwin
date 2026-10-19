import asyncio
import json
import os
import random
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from websockets.exceptions import ConnectionClosed

from predictor import DigitalTwinPredictor
from scenarios import build_counterfactual_comparison

app = FastAPI(title="Digital Twin Health Predictor PoC")

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Load static EHR data
EHR_PATH = os.path.join(os.path.dirname(__file__), "data", "ehr.json")
with open(EHR_PATH, "r") as f:
    EHR_DATA = json.load(f)

predictor = DigitalTwinPredictor()

class AnomalyRequest(BaseModel):
    inject: bool


class CounterfactualRequest(BaseModel):
    seed: int = Field(default=2026, ge=0, le=2_147_483_647)
    sample_count: int = Field(default=12, ge=6, le=24)


# Global state for simulation
simulation_state = {
    "inject_anomaly": False
}

@app.get("/api/patient")
def get_patient_profile():
    return EHR_DATA


@app.post("/api/counterfactual")
def compare_synthetic_scenarios(req: CounterfactualRequest):
    return build_counterfactual_comparison(
        EHR_DATA,
        seed=req.seed,
        sample_count=req.sample_count,
    )


@app.post("/api/inject-anomaly")
def trigger_anomaly(req: AnomalyRequest):
    simulation_state["inject_anomaly"] = req.inject
    return {"message": "Anomaly status updated", "injecting": req.inject}

@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # The accelerated synthetic stream advances five simulated minutes per second.
    simulated_time = datetime.now(timezone.utc)
    current_glucose = 110.0
    previous_glucose = None
    current_hr = 70.0
    glucose_history = [108.5, 110.3, 109.1, 111.2, 109.8, current_glucose]

    try:
        while True:
            # Simulate real-time updates
            if simulation_state["inject_anomaly"]:
                # Rapid increase in glucose and heart rate to simulate an anomaly (e.g. meal spike or stress)
                current_glucose += random.uniform(5.0, 15.0)
                current_hr += random.uniform(1.0, 3.0)
            else:
                # Normal fluctuations
                current_glucose += random.uniform(-2.0, 2.0)
                current_hr += random.uniform(-1.0, 1.0)
                
            # Clamp values to somewhat realistic ranges
            current_glucose = max(70.0, min(300.0, current_glucose))
            current_hr = max(50.0, min(150.0, current_hr))
            
            # Predict risk
            prediction = predictor.calculate_risk_score(
                current_glucose,
                EHR_DATA,
                previous_glucose=previous_glucose,
                heart_rate=current_hr,
            )
            glucose_history.append(current_glucose)
            glucose_history = glucose_history[-predictor.forecast_sample_count :]
            prediction["forecast"] = predictor.calculate_glucose_excursion_forecast(
                glucose_history,
                EHR_DATA,
                heart_rate=current_hr,
            )
            previous_glucose = current_glucose
            simulated_time += timedelta(minutes=predictor.forecast_interval_minutes)

            data_point = {
                "timestamp": simulated_time.isoformat(),
                "glucose": round(current_glucose, 1),
                "heart_rate": round(current_hr, 1),
                "prediction": prediction
            }
            
            await websocket.send_json(data_point)
            await asyncio.sleep(1.0)
            
    except (WebSocketDisconnect, ConnectionClosed):
        print("Client disconnected")
