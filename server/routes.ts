import type { Express } from "express";
import type { Server } from 'node:http';

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // === AI Photo Analysis endpoint ===
  // Kept server-side because it uses the ANTHROPIC_API_KEY secret, which must
  // never be exposed in the browser bundle. All other data access now goes
  // directly from the browser to Supabase (see lib/supabase.ts).
  app.post("/api/analyze-photo", async (req: any, res: any) => {
    const { image, fileName } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image provided" });
    }

    const base64Match = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      return res.status(400).json({ error: "Invalid image format" });
    }

    const mediaType = base64Match[1] === "jpg" ? "image/jpeg" : `image/${base64Match[1]}`;
    const base64Data = base64Match[2];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey });

        const message = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType as any, data: base64Data },
                },
                {
                  type: "text",
                  text: "You are an HVAC technician reviewing a photo from a customer's property. Analyze this image and provide a concise note (2-3 sentences) for the customer record. Focus on: equipment type, condition, any visible issues, and recommended next steps. If you cannot see HVAC equipment, describe what you see and note it may not be HVAC-related. Keep it professional and brief.",
                },
              ],
            },
          ],
        });

        const note = message.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join(" ");

        return res.json({ note: note || "Analysis completed but no text returned." });
      } catch (err: any) {
        console.error("Anthropic API error:", err.message);
      }
    }

    // Fallback: simulated analysis (used when no API key is configured, e.g. pplx.app sandbox)
    const lowerName = (fileName || "").toLowerCase();
    let simulatedNote = "";

    if (lowerName.includes("ac") || lowerName.includes("condenser") || lowerName.includes("outdoor")) {
      simulatedNote = "Outdoor condenser unit visible. Unit appears to be in moderate condition with some weathering on the cabinet. Recommend cleaning coils and checking refrigerant levels during next service visit. No immediate concerns visible.";
    } else if (lowerName.includes("furnace") || lowerName.includes("indoor") || lowerName.includes("attic")) {
      simulatedNote = "Indoor furnace/air handler visible. Unit appears older — check heat exchanger and filter condition. Recommend scheduling a fall tune-up to verify safe operation before heating season.";
    } else if (lowerName.includes("duct") || lowerName.includes("vent")) {
      simulatedNote = "Ductwork visible in the image. Check for proper sealing at joints and adequate insulation. Visible ductwork appears serviceable — recommend duct cleaning if not done within the last 3-5 years.";
    } else if (lowerName.includes("thermostat") || lowerName.includes("control")) {
      simulatedNote = "Thermostat/control panel visible. Appears to be a standard model — consider upgrading to a Wi-Fi smart thermostat for improved efficiency and remote control capabilities.";
    } else if (lowerName.includes("coil") || lowerName.includes("evap")) {
      simulatedNote = "Evaporator coil visible. Check for frost buildup and cleanliness. Recommend coil cleaning if dirty — impacts efficiency and air quality.";
    } else {
      simulatedNote = "Photo uploaded for customer record. Review image for equipment type, condition, and any visible issues. Schedule a follow-up visit if equipment appears to need service or replacement.";
    }

    return res.json({ note: simulatedNote, source: "simulated" });
  });

  return httpServer;
}
