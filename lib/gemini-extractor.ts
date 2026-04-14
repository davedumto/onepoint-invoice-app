import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Structured types returned by Gemini ─────────────────────────────────────

export type CoverageItem = {
  name: string;
  limits: string | null;
  deductible: string | null;
  premium: number | null;
};

export type PaymentPlanRow = {
  planType: string;
  totalPremium: string;
  initialPayment: string;
  payments: string;
};

export type PaymentPlanGroup = {
  description: string;
  rows: PaymentPlanRow[];
};

export type DriverInfo = {
  name: string;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  driverStatus: string | null;
  licenseType: string | null;
};

export type VehicleInfo = {
  description: string;
  vin: string | null;
  garagingZip: string | null;
  primaryUse: string | null;
  annualMiles: string | null;
};

export type StructuredQuote = {
  customerName: string;
  insuranceType: string;
  quoteDate: string;
  carrierName: string;
  originalQuote: number;
  paidInFullQuote: number;
  paidInFullDiscount: number;
  vehicles: VehicleInfo[];
  coverageItems: CoverageItem[];
  paymentPlanGroups: PaymentPlanGroup[];
  drivers: DriverInfo[];
  discounts: string[];
};

// ── Prompt ───────────────────────────────────────────────────────────────────

const PROMPT_TEMPLATE = `You are parsing raw text extracted from an insurance quote PDF.
The text extractor merged table columns together, so you will see things like:
  "ComprehensiveActual Cash Value$100144"
  → coverage="Comprehensive", limits="Actual Cash Value", deductible="$100", premium=144

  "CollisionActual Cash Value$500343"
  → coverage="Collision", limits="Actual Cash Value", deductible="$500", premium=343

  "LimitsDeductiblePremium" → table header row, ignore it

  "Liability To Others $672" → coverage="Liability To Others", premium=672

  "Uninsured Motorist - Added On 246" → coverage="Uninsured Motorist", premium=246

  "Medical Payments$2,000 each person91"
  → coverage="Medical Payments", limits="$2,000 each person", premium=91

  Payment rows like "6 Payments$1,812.00$302.065 payments of $302.99":
  → planType="6 Payments", totalPremium="$1,812.00", initialPayment="$302.06", payments="5 payments of $302.99"

For payment plan groups, identify each distinct group by its payment method description
(e.g. "EFT / Electronic Funds Transfer", "Card", "Paid in full").

Return ONLY valid JSON — no markdown fences, no explanation — matching this exact schema:

{
  "customerName": "string",
  "insuranceType": "string e.g. Auto Insurance",
  "quoteDate": "string e.g. April 13, 2026",
  "carrierName": "string — the insurance carrier/underwriter name",
  "originalQuote": number,
  "paidInFullQuote": number,
  "paidInFullDiscount": number,
  "vehicles": [
    {
      "description": "string",
      "vin": "string or null",
      "garagingZip": "string or null",
      "primaryUse": "string or null",
      "annualMiles": "string or null"
    }
  ],
  "coverageItems": [
    {
      "name": "string",
      "limits": "string or null",
      "deductible": "string or null",
      "premium": number or null
    }
  ],
  "paymentPlanGroups": [
    {
      "description": "string — payment method name",
      "rows": [
        {
          "planType": "string",
          "totalPremium": "string",
          "initialPayment": "string",
          "payments": "string"
        }
      ]
    }
  ],
  "drivers": [
    {
      "name": "string",
      "dateOfBirth": "string or null",
      "gender": "string or null",
      "maritalStatus": "string or null",
      "driverStatus": "string or null",
      "licenseType": "string or null"
    }
  ],
  "discounts": ["array of discount name strings"]
}

PDF TEXT:
{TEXT}`;

// ── Extractor ────────────────────────────────────────────────────────────────

export async function extractStructuredQuote(
  rawText: string
): Promise<StructuredQuote> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your environment variables."
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = PROMPT_TEMPLATE.replace("{TEXT}", rawText);
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // Strip markdown code fences if Gemini wraps the JSON anyway
  const json = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(json) as StructuredQuote;
}
