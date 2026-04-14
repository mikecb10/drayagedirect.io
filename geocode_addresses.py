import json
import time
import requests
from dotenv import load_dotenv
import os

# Load API key from .env
load_dotenv()
API_KEY = os.getenv("OPENCAGE_API_KEY")
BASE_URL = "https://api.opencagedata.com/geocode/v1/json"

# Load address file
with open("public/data/firms_codes_with_addresses.json", "r") as f:
    firms = json.load(f)

enriched = []

for i, firm in enumerate(firms):
    address = firm.get("address")
    if not address:
        firm["latitude"] = None
        firm["longitude"] = None
        enriched.append(firm)
        continue

    params = {
        "q": address,
        "key": API_KEY,
        "limit": 1,
        "countrycode": "us"
    }

    try:
        response = requests.get(BASE_URL, params=params)
        data = response.json()
        if data["results"]:
            coords = data["results"][0]["geometry"]
            firm["latitude"] = coords["lat"]
            firm["longitude"] = coords["lng"]
        else:
            firm["latitude"] = None
            firm["longitude"] = None

        print(f"[{i+1}/{len(firms)}] {firm['firmsCode']} → {address} ✅")
    except Exception as e:
        print(f"[{i+1}/{len(firms)}] {firm['firmsCode']} → Error: {e}")
        firm["latitude"] = None
        firm["longitude"] = None

    enriched.append(firm)
    time.sleep(1.2)  # OpenCage free tier rate limit

# Save to new file
with open("public/data/firms_codes_with_coordinates.json", "w") as f:
    json.dump(enriched, f, indent=2)

print("✅ Done geocoding!")
