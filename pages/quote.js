import { useState } from "react";

export default function QuotePage() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [downloadReady, setDownloadReady] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setDownloadReady(false);
    setMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append("bundle", file);

    setMessage("⏳ Processing...");

    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Failed to process quote");

      const result = await res.json();
      setDownloadReady(true);
      setMessage("✅ Quote ready for download");
    } catch (err) {
      console.error(err);
      setMessage("❌ Error processing quote");
    }
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = "/quote/output/quote_results.csv"; // served statically
    link.download = "quote_results.csv";
    link.click();
  };

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-xl mx-auto mt-16 px-4">
        <div className="border rounded-xl p-6 shadow-lg bg-white">
          <h2 className="text-2xl font-bold mb-4">Upload Quote Bundle</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="w-full border rounded px-4 py-2"
            />
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Generate Quote
            </button>
          </form>

          {message && <p className="mt-4 text-sm text-gray-700">{message}</p>}

          {downloadReady && (
            <button
              onClick={handleDownload}
              className="mt-4 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Download Results
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
