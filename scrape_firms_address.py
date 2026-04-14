import requests
import json
import time
from bs4 import BeautifulSoup

# Load input file
with open("C:/Users/bento/app-drayagedirect/public/data/firms_codes_with_urls.json", "r") as f:


    firms = json.load(f)

def extract_address_from_html(html):
    soup = BeautifulSoup(html, "html.parser")
    address_tag = soup.find("td", id="firmloc")
    if address_tag:
        return address_tag.text.strip()
    return "Not found"


# Loop through all FIRMS codes and enrich with address
for i, firm in enumerate(firms):
    url = firm["detailsUrl"]
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            address = extract_address_from_html(response.text)
            firm["address"] = address if address else "Not found"
        else:
            firm["address"] = f"Error: {response.status_code}"
    except Exception as e:
        firm["address"] = f"Error: {str(e)}"

    print(f"[{i+1}/{len(firms)}] {firm['firmsCode']} → {firm['address']}")
    time.sleep(1.5)  # Be polite to the server

# Save result
with open("C:/Users/bento/app-drayagedirect/public/data/firms_codes_with_addresses.json", "w") as f:

    json.dump(firms, f, indent=2)

print("✅ Done! File saved to data/firms_codes_with_addresses.json")
