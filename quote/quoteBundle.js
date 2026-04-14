const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

const { haversineDistance } = require("../utils/haversine");
const firms = require("../public/data/firms_codes_with_coordinates.json");
const zips = require("../public/data/zip_lat_lon.json");
const config = require("./clientConfig.json");

const inputFile = path.join(__dirname, "sample_bundle.csv");
const outputFile = path.join(__dirname, "output", "quote_results.csv");

const quoteDate = new Date();
const validUntil = new Date(quoteDate.getTime() + config.quoteValidityDays * 24 * 60 * 60 * 1000);

const results = [];

fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", row => {
    const firmsCode = row["FIRMS Code"].trim().toUpperCase();
    const zip = row["ZIP Code"].trim();
    const container = row["Container Type"].trim();
    const clientAccessorials = row["Accessorials"]?.split(";").map(a => a.trim()) || [];

    const firm = firms.find(f => f.firmsCode === firmsCode);
    const dest = zips.find(z => z.zip === zip);
    if (!firm || !dest) return;

    const miles = haversineDistance(firm.latitude, firm.longitude, dest.latitude, dest.longitude);
    const perMileRate = config.ratePerMile[container] || 0;
    const baseRate = miles * perMileRate;
    const accessorialTotal = clientAccessorials.reduce(
      (sum, item) => sum + (config.accessorials[item] || 0),
      0
    );
    const totalCost = baseRate + config.laborFee + accessorialTotal;

    console.log(`[QUOTE] ${firmsCode} → ${zip} | $${totalCost.toFixed(2)}`);

    results.push({
      OriginFIRMS: firmsCode,
      DestinationZIP: zip,
      ContainerType: container,
      Miles: miles.toFixed(2),
      BaseRate: baseRate.toFixed(2),
      Labor: config.laborFee.toFixed(2),
      Accessorials: `$${accessorialTotal.toFixed(2)}`,
      TotalQuote: `$${totalCost.toFixed(2)}`,
      ValidUntil: validUntil.toISOString().split("T")[0]
    });
  })
  .on("end", () => {
    const csvWriter = createCsvWriter({
      path: outputFile,
      header: [
        { id: "OriginFIRMS", title: "Origin FIRMS" },
        { id: "DestinationZIP", title: "Destination ZIP" },
        { id: "ContainerType", title: "Container Type" },
        { id: "Miles", title: "Miles" },
        { id: "BaseRate", title: "Base Rate" },
        { id: "Labor", title: "Labor" },
        { id: "Accessorials", title: "Accessorials" },
        { id: "TotalQuote", title: "Total Quote" },
        { id: "ValidUntil", title: "Valid Until" }
      ]
    });

    csvWriter.writeRecords(results)
      .then(() => {
        console.log("✅ Quotes written to", outputFile);

        // Log the run
        const logEntry = {
          timestamp: new Date().toISOString(),
          input: inputFile,
          output: outputFile,
          quoteCount: results.length
        };

        const logPath = path.join(__dirname, "output", "quote_runs.log.json");
        let existingLogs = [];

        if (fs.existsSync(logPath)) {
          existingLogs = JSON.parse(fs.readFileSync(logPath, "utf8"));
        }

        existingLogs.push(logEntry);
        fs.writeFileSync(logPath, JSON.stringify(existingLogs, null, 2));
      });
  });
