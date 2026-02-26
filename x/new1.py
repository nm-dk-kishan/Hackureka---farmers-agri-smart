from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
import json
import os
import re

app = Flask(__name__)
CORS(app)

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", "AIzaSyB1OEAf50aIGHxEoJqHu7qO_3CK3W5wrzo"))
ALLOWED_CROPS = ["Wheat", "Millet", "Sunflower", "Cotton", "Maize"]


def to_number(value, default=0):
    try:
        return float(value)
    except Exception:
        return float(default)


def extract_json(text):
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Empty Gemini response")
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found")
    return json.loads(match.group(0))


def normalize_payload(payload, selected_crop="Wheat"):
    raw_suit = payload.get("crop_suitability")
    if not isinstance(raw_suit, list):
        raw_suit = []

    crop_pct_by_name = {}
    for item in raw_suit:
        if not isinstance(item, dict):
            continue
        crop_raw = str(item.get("crop", "")).strip().lower()
        if not crop_raw:
            continue
        crop = next((c for c in ALLOWED_CROPS if c.lower() == crop_raw), "")
        if not crop:
            continue
        try:
            pct = int(round(float(item.get("percentage", 0))))
        except Exception:
            pct = 0
        pct = max(0, min(100, pct))
        crop_pct_by_name[crop] = pct

    crop_suitability = []
    for crop in ALLOWED_CROPS:
        crop_suitability.append({
            "crop": crop,
            "percentage": crop_pct_by_name.get(crop, 0)
        })
    crop_suitability.sort(key=lambda x: x["percentage"], reverse=True)

    raw_seeds = payload.get("recommended_seeds")
    if not isinstance(raw_seeds, list):
        raw_seeds = []

    recommended_seeds = []
    selected_crop_norm = str(selected_crop).strip().lower()
    for seed in raw_seeds:
        if not isinstance(seed, dict):
            continue
        name = str(seed.get("name", "")).strip()
        if not name:
            continue
        seed_crop = str(seed.get("crop", "")).strip()
        if seed_crop.lower() != selected_crop_norm:
            continue
        recommended_seeds.append({
            "name": name,
            "crop": seed_crop,
            "season": str(seed.get("season", "")).strip(),
            "yield_type": str(seed.get("yield_type", "")).strip()
        })
    recommended_seeds = recommended_seeds[:4]

    advice = str(payload.get("advice", "")).strip() or "No advice available."

    return {
        "crop_suitability": crop_suitability,
        "recommended_seeds": recommended_seeds,
        "advice": advice
    }


@app.route("/ask", methods=["POST"])
def ask():
    data = request.get_json() or {}
    soil_data = data.get("soil_data") or {}

    nitrogen = to_number(data.get("nitrogen", soil_data.get("Nitrogen", 0)))
    phosphorus = to_number(data.get("phosphorus", soil_data.get("Phosphorus", 0)))
    potassium = to_number(data.get("potassium", soil_data.get("Potassium", 0)))
    selected_crop_raw = str(data.get("crop", "")).strip()
    selected_crop = next((c for c in ALLOWED_CROPS if c.lower() == selected_crop_raw.lower()), "Wheat")

    prompt = f"""
You are an experienced Indian agricultural scientist.

Soil Data:
- Nitrogen: {nitrogen} kg/ha
- Phosphorus: {phosphorus} kg/ha
- Potassium: {potassium} kg/ha
- Preferred Crop: {selected_crop}

Return strictly and only valid JSON in this exact schema:
{{
  "crop_suitability": [
    {{"crop": "Wheat", "percentage": 92}},
    {{"crop": "Millet", "percentage": 78}},
    {{"crop": "Sunflower", "percentage": 85}},
    {{"crop": "Cotton", "percentage": 60}},
    {{"crop": "Maize", "percentage": 74}}
  ],
  "recommended_seeds": [
    {{
      "name": "Variety-1",
      "crop": "{selected_crop}",
      "season": "Kharif or Rabi or Zaid",
      "yield_type": "Short trait label based on NPK suitability"
    }},
    {{
      "name": "Variety-2",
      "crop": "{selected_crop}",
      "season": "Kharif or Rabi or Zaid",
      "yield_type": "Short trait label based on NPK suitability"
    }},
    {{
      "name": "Variety-3",
      "crop": "{selected_crop}",
      "season": "Kharif or Rabi or Zaid",
      "yield_type": "Short trait label based on NPK suitability"
    }},
    {{
      "name": "Variety-4",
      "crop": "{selected_crop}",
      "season": "Kharif or Rabi or Zaid",
      "yield_type": "Short trait label based on NPK suitability"
    }}
  ],
  "advice": "Short agronomic advice in 1-3 sentences."
}}
Rules:
- Use only N, P, K values to decide recommendations.
- crop_suitability must contain exactly 5 items and only these crops: Wheat, Millet, Sunflower, Cotton, Maize.
- Sort crop_suitability by percentage in descending order (highest first).
- Percentages must vary according to N, P, K and should not repeat the same values across all crops.
- recommended_seeds must contain 3 or 4 items.
- Every recommended seed must belong to the selected crop "{selected_crop}".
- Seed names must be realistic, distinct varieties for the selected crop and must be generated by model reasoning from NPK.
- season must be chosen by the model for each seed (Kharif, Rabi, or Zaid) based on suitability.
- yield_type must be generated by the model for each seed (not copied/static) and reflect expected performance from NPK context.
- Return JSON only. No markdown/code fences/extra explanation.
"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        result_json = normalize_payload(
            extract_json(getattr(response, "text", "")),
            selected_crop=selected_crop
        )
    except Exception as e:
        # Keep API shape stable for frontend even when model/API fails.
        result_json = {
            "crop_suitability": [],
            "recommended_seeds": [],
            "advice": f"Error generating advice: {str(e)}"
        }

    return jsonify(result_json)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)
