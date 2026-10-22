# Hardware Studio project JSON

Use this format when handing a Codex-designed project to the browser app. The app imports JSON, assigns a new local ID, and resets review marks. Keep IDs stable within the file and unique for each part. A connection's `from` and `to` must match part IDs. Costs are per unit in USD and should be marked as estimates unless checked against current listings. Write useful part details, not just generic names.

```json
{
  "title": "USB temperature display",
  "brief": "A desk display for room temperature powered by USB.",
  "summary": "Concept design awaiting component and enclosure review.",
  "parts": [
    {
      "id": "controller",
      "name": "Exact controller model to select",
      "category": "Control",
      "qty": 1,
      "unitCost": 0,
      "detail": "Select a board with documented I2C pins; add the manufacturer datasheet URL and revision here.",
      "voltage": "unknown",
      "sourceUrl": "",
      "verified": false
    }
  ],
  "wires": [],
  "steps": [
    {
      "phase": "Prepare",
      "title": "Choose exact controller",
      "detail": "Confirm USB power, pinout and physical dimensions against the manufacturer's documentation.",
      "done": false
    }
  ],
  "notes": "Open: display choice, power budget, enclosure dimensions.",
  "review": { "electrical": false, "mechanical": false, "sourcing": false }
}
```

The sample demonstrates the carrier only; it is deliberately incomplete as a build plan. For a real deliverable, include every physical part and required connection, pin and voltage notes, a stepwise bring-up sequence, exact source URLs and dates where verified, and unresolved decisions. Do not mark `verified` or `review` true on a generated draft. If a price is unknown, use `0` and explain in `detail` that it is unpriced; do not present the zero as a quote.

The app accepts additional fields but does not use them. Keep full calculations, datasheet links and dimensioned CAD sources beside the JSON when they cannot be represented faithfully in these fields.
