// Local-only synthetic fixtures for visual QA. Never mounted by the production server.
import express from "express";
const app = express();
app.use(express.json());
let status = "Quote Sent";
app.get("/api/public/documents/:token", (req, res) => {
  const kind = req.params.token === "invoice-test" ? "invoice" : "quote";
  res.json({
    kind,
    company: "Air King Mechanical Services LLC",
    payments_enabled: false,
    payments: [
      {
        source: "manual",
        method: "Check",
        amount_cents: 200000,
        paid_at: "2026-09-09T12:00:00Z",
      },
    ],
    document:
      kind === "invoice"
        ? {
            number: "INV-TEST",
            customerName: "Test Customer",
            amount: 5000,
            paidAmount: 2000,
            status: "Partial",
            dueDate: "2026-10-01",
            items: [
              {
                description: "Champion heating and cooling installation",
                amount: 5000,
              },
            ],
          }
        : {
            number: "Q-TEST",
            customerName: "Test Customer",
            title: "Home Comfort System — TEST ONLY",
            scope:
              "Synthetic test quote. Not an offer or contract. Install and commission the selected heating and cooling system.",
            status,
            options: ["Good", "Better", "Best"].map((tier, i) => ({
              tier,
              label: [
                "Reliable Comfort",
                "Enhanced Comfort",
                "Premium Comfort",
              ][i],
              equipment: "Champion AC + Furnace",
              efficiency: ["13.4 SEER2", "14.3 SEER2", "16 SEER2"][i],
              features: [
                "Professional installation",
                "Startup and airflow checks",
                "Warranty registration",
              ],
              customerPrice: 5000 + i * 1000,
            })),
          },
  });
});
app.post("/api/public/documents/:token/decision", (req, res) => {
  status = req.body.decision === "accepted" ? "Won" : "Lost";
  res.json({ decision: req.body.decision });
});
app.use(express.static("dist/public"));
app.get("/{*path}", (_q, r) =>
  r.sendFile(process.cwd() + "/dist/public/index.html"),
);
app.listen(5001, "0.0.0.0", () =>
  console.log("Synthetic preview listening on port 5001"),
);
