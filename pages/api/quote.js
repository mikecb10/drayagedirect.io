// pages/api/quote.js

import formidable from "formidable";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createObjectCsvWriter } from "csv-writer";

import firms from "../../public/data/firms_codes_with_coordinates.json";
import zips from "../../public/data/zip_lat_lon.json";
import clientConfig from "../../quote/clientConfig.json";
import { haversineDistance } from "../../utils/haversine";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  console.log("📥 Received request: POST");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const form = formidable({ multiples: false });

  let fields, files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });
  } catch (err) {
    console.error("❌ Error parsing form:", err);
    return res.status(400).json({ error: "Invalid form data" });
  }

  const uploaded = files.bundle;
const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;

if (!file || !file.filepath) {
  console.error("❌ Uploaded file missing or malformed:", files);
  return res.status(400).json({ error: "File not found in upload" });
}


  console.log(`📄 Uploaded file: ${file.originalFilename}`);
  console.log(`📁 Temp path: ${file.filepath}`);

  let contents = "";
  try {
    contents = fs.readFileSync(file.filepath, "utf-8");
  } catch (err) {
    console.error("❌ Failed to read file contents:", err);
    return res.status(500).json({ error: "Failed to read uploaded file" });
  }

  let rows = [];
  try {
    rows = parse(contents, {
      columns: true,
      skip_empty_lines: true,
    });
    console.log(`✅ Parsed CSV rows: ${rows.length}`);
  } catch (err) {
    console.error("❌ Error parsing CSV:", err);
    return res.status(500).json({ error: "Invalid CSV format" });
  }

  const outputDir = path.join(process.cwd(), "public", "quote");
  const outputPath = path.join(outputDir, "quote_results.csv");

  try {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    console.error("❌ Failed to create output directory:", err);
    return res.status(500).json({ error: "Failed to prepare output directory" });
  }

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "OriginFIRMS", title: "Origin FIRMS" },
      { id: "DestinationZIP", title: "Destination ZIP" },
      { id: "ContainerType", title: "Container Type" },
      { id: "Miles", title: "Miles" },
      { id: "BaseRate", title: "Base Rate" },
      { id: "Labor", title: "Labor" },
      { id: "Accessorials", title: "Accessorials" },
      { id: "TotalQuote", title: "Total Quote" },
      { id: "ValidUntil", title: "Valid Until" },
    ],
  });

  const results = [];
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + clientConfig.quoteValidityDays);

  for (const row of rows) {
    const firmsCode = row["FIRMS Code"].trim().toUpperCase();
    const zip = row["ZIP Code"].trim();
    const container = row["Container Type"].trim();
    const clientAccessorials = row["Accessorials"]?.split(";").map(a => a.trim()) || [];

    const firm = firms.find(f => f.firmsCode === firmsCode);
    const dest = zips.find(z => z.zip === zip);

    if (!firm || !dest) {
      console.warn("⚠️ Missing data: firm or destination not found for", {
        firmsCode,
        zip,
      });
      continue;
    }

    const miles = haversineDistance(firm.latitude, firm.longitude, dest.latitude, dest.longitude);
    const perMileRate = clientConfig.ratePerMile[container] || 0;
    const baseRate = miles * perMileRate;
    const accessorialTotal = clientAccessorials.reduce(
      (sum, item) => sum + (clientConfig.accessorials[item] || 0),
      0
    );
    const totalCost = baseRate + clientConfig.laborFee + accessorialTotal;

    results.push({
      OriginFIRMS: firmsCode,
      DestinationZIP: zip,
      ContainerType: container,
      Miles: miles.toFixed(2),
      BaseRate: baseRate.toFixed(2),
      Labor: clientConfig.laborFee.toFixed(2),
      Accessorials: `$${accessorialTotal.toFixed(2)}`,
      TotalQuote: `$${totalCost.toFixed(2)}`,
      ValidUntil: validUntil.toISOString().split("T")[0],
    });
  }

  try {
    await csvWriter.writeRecords(results);
    console.log("✅ Successfully wrote CSV to:", outputPath);
    return res.status(200).json({
      message: "Quote processed",
      downloadPath: "/quote/quote_results.csv",
    });
  } catch (err) {
    console.error("❌ Failed to write CSV output:", err);
    return res.status(500).json({ error: "Failed to write quote output" });
  }
}
