import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";

export type ExtractedQuote = {
  customerName: string;
  insuranceType: string;
  originalQuote: number | null;
  carrierName: string;
  quoteDate: string;
  sourceText: string;
  sourceLines: string[];
};

const INSURANCE_TYPES = [
  "auto insurance",
  "home insurance",
  "life insurance",
  "health insurance",
  "renters insurance",
  "business insurance",
  "travel insurance",
  "motorcycle insurance",
  "commercial auto insurance",
  "pet insurance",
];

// Patterns are intentionally broad — the real guard against cross-line spillover
// (e.g. agent "Vera O Orji" on the next line bleeding into the customer name)
// is that extractCustomerName searches line-by-line, not over normalized text.
const NAME_PATTERNS = [
  /(?:insured|applicant|customer|client|name)\s*[:\-]\s*([A-Za-z'.,-]+(?:\s+[A-Za-z'.,-]+){0,2})/i,
  /(?:policyholder|driver)\s*[:\-]\s*([A-Za-z'.,-]+(?:\s+[A-Za-z'.,-]+){0,2})/i,
];

const TYPE_PATTERNS = [
  /(?:insurance requested|coverage requested|coverage type|policy type|insurance type)\s*[:\-]\s*([A-Za-z /-]+)/i,
];

const CARRIER_PATTERNS = [
  /underwritten by:\s*([A-Za-z0-9&.,' -]+)/i,
  /carrier\s*[:\-]\s*([A-Za-z0-9&.,' -]+)/i,
];

const DATE_PATTERNS = [
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
];

const PRIORITY_QUOTE_PATTERNS = [
  /policy premium if paid in full[\s.]*\$([\d,]+(?:\.\d{2})?)/i,
  /total \d+ month policy premium, with paid in full discount[\s.]*\$([\d,]+(?:\.\d{2})?)/i,
  /if paid in full[\s.]*\$([\d,]+(?:\.\d{2})?)/i,
];

const QUOTE_PATTERNS = [
  /(?:quote|quoted premium|premium|total premium|amount due|estimated premium|annual premium)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/gi,
  /\$([\d,]+(?:\.\d{2})?)/g,
];

function normalizeText(text: string) {
  return text.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeLines(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseCurrencyValue(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCustomerName(lines: string[]) {
  // Search line-by-line so an agent name on the *next* physical line
  // ("Vera O Orji") can never bleed into the same regex match as the
  // customer name ("Kimberly Adams") after text normalisation collapses
  // all newlines into spaces.
  for (const line of lines) {
    for (const pattern of NAME_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return toTitleCase(match[1].replace(/[.,]+$/g, "").trim());
      }
    }
  }

  return "Unknown Client";
}

function extractInsuranceType(text: string) {
  const lowerText = text.toLowerCase();

  for (const type of INSURANCE_TYPES) {
    if (lowerText.includes(type)) {
      return toTitleCase(type);
    }
  }

  for (const pattern of TYPE_PATTERNS) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return toTitleCase(match[1].trim());
    }
  }

  return "Insurance Quote";
}

function extractOriginalQuote(text: string) {
  for (const pattern of PRIORITY_QUOTE_PATTERNS) {
    const match = text.match(pattern);
    const value = match?.[1] ? parseCurrencyValue(match[1]) : null;

    if (value !== null) {
      return value;
    }
  }

  const matches: number[] = [];

  for (const pattern of QUOTE_PATTERNS) {
    const results = text.matchAll(pattern);

    for (const match of results) {
      const value = match[1] ? parseCurrencyValue(match[1]) : null;

      if (value !== null) {
        matches.push(value);
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  return Math.max(...matches);
}

function extractCarrierName(text: string) {
  for (const pattern of CARRIER_PATTERNS) {
    const match = text.match(pattern);

    if (match?.[1]) {
      const raw = match[1];
      // Stop at the first month name so we don't consume the rest of the document
      const stopAt = raw.search(
        /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i
      );
      const name = (stopAt > 0 ? raw.slice(0, stopAt) : raw)
        .trim()
        .replace(/[.,\s]+$/, "");
      if (name.length > 3) return name;
    }
  }

  return "Carrier quote";
}

function extractQuoteDate(text: string) {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);

    if (match?.[0]) {
      return match[0];
    }
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export function extractQuoteDetails(text: string): ExtractedQuote {
  const normalized = normalizeText(text);
  const sourceLines = sanitizeLines(text);

  return {
    customerName: extractCustomerName(sourceLines),
    insuranceType: extractInsuranceType(normalized),
    originalQuote: extractOriginalQuote(normalized),
    carrierName: extractCarrierName(normalized),
    quoteDate: extractQuoteDate(normalized),
    sourceText: normalized,
    sourceLines,
  };
}

export function formatCurrency(amount: number | null) {
  if (amount === null) {
    return "Needs review";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function buildDownloadFilename(
  customerName: string,
  insuranceType: string
) {
  const slugify = (value: string) =>
    value
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");

  const titleKebab = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => {
        const cleaned = part.replace(/[^a-z0-9]/gi, "");
        return cleaned
          ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase()
          : "";
      })
      .filter(Boolean)
      .join("-");

  const name = titleKebab(customerName) || "Unknown-Client";
  const type = slugify(insuranceType.toLowerCase()) || "insurance-quote";

  return `${name}-${type}-quote.pdf`;
}

function wrapText(text: string, limit = 92) {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length > limit) {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

export async function buildBrandedQuotePdf({
  extracted,
  markupPercent,
}: {
  extracted: ExtractedQuote;
  markupPercent: number;
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoPath = path.join(process.cwd(), "public", "onepoint-logo.png");
  const logoBytes = await readFile(logoPath);
  const logoImage = await pdf.embedPng(logoBytes);

  // Page dimensions and margin
  const W = 612;
  const H = 792;
  const M = 48;

  // Brand palette
  const navy  = rgb(0.08, 0.16, 0.27);
  const gold  = rgb(0.84, 0.67, 0.31);
  const white = rgb(1, 1, 1);
  const ink   = rgb(0.12, 0.14, 0.18);
  const muted = rgb(0.37, 0.41, 0.47);
  const paper = rgb(0.98, 0.97, 0.95);
  const bdr   = rgb(0.88, 0.86, 0.82);
  const cream = rgb(0.99, 0.97, 0.92);
  const slate = rgb(0.60, 0.68, 0.78);

  // Computed financials
  const originalQuote = extracted.originalQuote;
  const markupAmount  = originalQuote === null ? null : originalQuote * (markupPercent / 100);
  const finalQuote    = originalQuote === null ? null : originalQuote + (markupAmount ?? 0);

  // Scale font down when text would overflow its container.
  // charW=0.56 is a reasonable approximation for Helvetica.
  const fitSize = (text: string, maxW: number, maxSize: number): number => {
    const naturalW = text.length * maxSize * 0.56;
    return naturalW <= maxW ? maxSize : Math.max(9, Math.floor(maxW / (text.length * 0.56)));
  };

  // Draw the branded header band and gold accent on any page.
  // White/paper background keeps the logo (dark ink) visible.
  // Returns the y-coordinate at the bottom of the gold accent bar.
  const drawHeader = (page: PDFPage, compact = false): number => {
    const hH    = compact ? 62 : 90;
    const goldH = 3;
    const dims  = logoImage.scale(compact ? 0.18 : 0.22);

    // White header so the dark logo is always legible
    page.drawRectangle({ x: 0, y: H - hH, width: W, height: hH, color: white });
    // Thin navy bar at the very top for brand weight
    page.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: navy });
    // Gold accent at the bottom of the header area
    page.drawRectangle({ x: 0, y: H - hH - goldH, width: W, height: goldH, color: gold });

    page.drawImage(logoImage, {
      x: M,
      y: H - hH + Math.round((hH - dims.height) / 2),
      width: dims.width,
      height: dims.height,
    });

    return H - hH - goldH;
  };

  // Draw the navy footer. Shows page number on detail pages, tagline on summary.
  const drawFooter = (page: PDFPage, pageNum?: number) => {
    page.drawRectangle({ x: 0, y: 0, width: W, height: 50, color: navy });
    page.drawText("Prepared by OnePoint Insurance Agency", {
      x: M, y: 19, size: 9, font: boldFont, color: white,
    });
    if (pageNum !== undefined) {
      page.drawText(`Page ${pageNum}`, {
        x: W - M - 42, y: 19, size: 9, font: boldFont, color: slate,
      });
    } else {
      page.drawText("Client-ready pricing  •  Confidential", {
        x: W - M - 196, y: 19, size: 8, font, color: slate,
      });
    }
  };

  // ─────────────────────────────────────────────────────────
  // PAGE 1: EXECUTIVE SUMMARY
  //
  // Layout (y=0 is page bottom):
  //   y=702–792  Navy header (90px)
  //   y=699–702  Gold accent (3px)
  //   y=622–699  Hero: customer name, type, date (77px)
  //   y=538–622  Price banner (84px)
  //   y=326–530  Quote details card (204px) — 8px gap above
  //   y=062–317  Carrier notes preview (255px) — 9px gap above
  //   y=000–050  Navy footer (50px) — 12px gap above
  // ─────────────────────────────────────────────────────────
  const p1 = pdf.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });

  drawHeader(p1, false);

  // Header right-side labels (dark text on white header background)
  p1.drawText("INSURANCE QUOTE", {
    x: W - M - 118, y: H - 42, size: 10, font: boldFont, color: navy,
  });
  p1.drawText("OnePoint Insurance Agency", {
    x: W - M - 118, y: H - 58, size: 8, font, color: muted,
  });

  // ── Hero ──────────────────────────────────────────────────
  p1.drawText("PREPARED FOR", {
    x: M, y: 684, size: 8, font: boldFont, color: muted,
  });

  const nameFontSize = fitSize(extracted.customerName, W - 2 * M - 8, 28);
  p1.drawText(extracted.customerName, {
    x: M, y: 652, size: nameFontSize, font: boldFont, color: ink,
  });

  p1.drawText(extracted.insuranceType, {
    x: M, y: 632, size: 11, font, color: navy,
  });

  p1.drawText(`Date: ${extracted.quoteDate}`, {
    x: W - M - 162, y: 632, size: 10, font, color: muted,
  });

  // ── Price banner ──────────────────────────────────────────
  p1.drawRectangle({ x: 0, y: 538, width: W, height: 84, color: navy });

  p1.drawText("YOUR ONEPOINT QUOTE", {
    x: M, y: 599, size: 8, font: boldFont, color: gold,
  });

  p1.drawText(formatCurrency(finalQuote), {
    x: M, y: 563, size: 32, font: boldFont, color: white,
  });

  // Vertical rule separating price from the three metrics
  p1.drawLine({
    start: { x: 310, y: 596 }, end: { x: 310, y: 548 },
    thickness: 0.75, color: rgb(0.2, 0.3, 0.45),
  });

  // Derived pricing shown to client — no markup breakdown exposed
  const monthlyEst = finalQuote === null ? null : finalQuote / 6;
  const annualEst  = finalQuote === null ? null : finalQuote * 2;

  const trios = [
    { label: "POLICY PERIOD", value: "6 Months" },
    { label: "MONTHLY EST.",  value: formatCurrency(monthlyEst) },
    { label: "ANNUAL EST.",   value: formatCurrency(annualEst) },
  ];

  // Three metric columns from x=318, each 82px wide, right edge at 318+3×82=564=W-M ✓
  for (let i = 0; i < trios.length; i++) {
    const mx = 318 + i * 82;
    if (i > 0) {
      p1.drawLine({
        start: { x: mx - 2, y: 596 }, end: { x: mx - 2, y: 548 },
        thickness: 0.5, color: rgb(0.2, 0.3, 0.45),
      });
    }
    p1.drawText(trios[i].label, {
      x: mx + 6, y: 599, size: 7, font: boldFont, color: slate,
    });
    p1.drawText(trios[i].value, {
      x: mx + 6, y: 578, size: 10, font: boldFont, color: white,
    });
  }

  // ── Quote details card ─────────────────────────────────────
  // Three rows with generous spacing in the same 204px card
  p1.drawRectangle({
    x: M, y: 326, width: W - 2 * M, height: 204,
    color: white, borderColor: bdr, borderWidth: 1,
  });

  p1.drawText("QUOTE DETAILS", {
    x: M + 20, y: 507, size: 8, font: boldFont, color: muted,
  });

  const detailRows: [string, string][] = [
    ["Customer",      extracted.customerName],
    ["Coverage Type", extracted.insuranceType],
    ["Quote Date",    extracted.quoteDate],
  ];

  // Three rows: start higher so they sit centered in the card
  let drY = 468;
  for (const [lbl, val] of detailRows) {
    p1.drawText(lbl, { x: M + 20, y: drY, size: 10, font, color: muted });
    p1.drawText(val, {
      x: M + 158, y: drY,
      size: fitSize(val, W - 2 * M - 160, 10),
      font: boldFont, color: ink,
    });
    p1.drawLine({
      start: { x: M + 20, y: drY - 10 }, end: { x: W - M - 20, y: drY - 10 },
      thickness: 0.5, color: bdr,
    });
    drY -= 44;
  }

  // ── Next steps block ──────────────────────────────────────
  // Cream card with gold accent — OnePoint's own voice, no carrier mention
  p1.drawRectangle({
    x: M, y: 62, width: W - 2 * M, height: 255,
    color: cream, borderColor: gold, borderWidth: 0.75,
  });
  p1.drawRectangle({ x: M, y: 62, width: 4, height: 255, color: gold });

  p1.drawText("NEXT STEPS", {
    x: M + 20, y: 296, size: 8, font: boldFont, color: navy,
  });

  const nextStepsLines = [
    "Your personalized insurance quote has been prepared by OnePoint Insurance",
    "Agency. Please review the coverage details and pricing above.",
    "",
    "To confirm your coverage and begin your policy, contact your OnePoint agent.",
    "Your coverage will begin once your initial payment has been received.",
    "",
    "Questions or ready to proceed?",
    "Call us: (770) 884-8117",
    "OnePoint Insurance Agency",
    "555 North Point Center E, Alpharetta, GA 30022",
  ];

  let nsY = 278;
  for (const line of nextStepsLines) {
    if (nsY < 72) break;
    if (line === "") {
      nsY -= 8;
      continue;
    }
    p1.drawText(line, { x: M + 20, y: nsY, size: 9.5, font, color: ink });
    nsY -= 15;
  }

  drawFooter(p1);

  // ─────────────────────────────────────────────────────────
  // DETAIL PAGES
  // Reproduce the full quote content with OnePoint branding.
  // Carrier name / brand / underwriter lines are stripped.
  // Separator dot-lines are converted to drawn rules.
  // Lines are classified and rendered with appropriate hierarchy.
  // ─────────────────────────────────────────────────────────
  const carrierNameLower = extracted.carrierName.toLowerCase();
  // Carrier brand = longest single word of the carrier name (e.g. "progressive")
  const carrierBrandLower =
    carrierNameLower
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .sort((a, b) => b.length - a.length)[0] ?? "";

  // Skip the mailing-address block that appears before the actual quote content.
  // Find the first line that looks like the document body (quote title, greeting, etc.)
  // and start rendering from there — this drops agent names, addresses, carrier header.
  const contentStartIdx = extracted.sourceLines.findIndex((l) =>
    /^(auto insurance|thank you for|quote for a|if you pay|coverage summary|your quote|outline of coverage)/i.test(l)
  );
  const contentLines =
    contentStartIdx > 0
      ? extracted.sourceLines.slice(contentStartIdx)
      : extracted.sourceLines;

  const filteredLines = contentLines.filter((l) => {
    if (/^Form_/i.test(l))                          return false;
    if (/^Form QUOTE/i.test(l))                     return false;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(l))     return false;
    if (/^Page \d+ of \d+/i.test(l))               return false;
    if (/^Page of/i.test(l))                        return false;
    if (/^4?Continued$/i.test(l))                   return false;
    if (/^[•\s]+$/.test(l))                        return false;
    if (/^Customer:/i.test(l))                       return false;
    if (/underwritten by/i.test(l))                return false;
    if (carrierBrandLower && l.toLowerCase().includes(carrierBrandLower)) return false;
    if (carrierNameLower !== "carrier quote" &&
        l.toLowerCase().includes(carrierNameLower)) return false;
    // Keep dot-separator lines — they become drawn rules
    return true;
  });

  // ── Section headings (get the navy accent-band treatment) ──
  const sectionHeadings = new Set([
    "Payment plans",
    "To purchase insurance",
    "Drivers and household residents",
    "Outline of coverage",
    "Premium discounts",
  ]);

  // ── Line classifier ────────────────────────────────────────
  type LineKind =
    | "rule"         // ……… → thin drawn rule
    | "major"        // sectionHeadings → navy accent band
    | "doc-title"    // "Auto Insurance Quote" → large bold title
    | "sub-heading"  // short bold sub-section line
    | "grand-total"  // "Total N month policy premium…" → highlighted row
    | "financial"    // "Total policy premium", "Paid in full…" → bold
    | "amount"       // standalone "$1,562.00" → bold, right-aligned
    | "table-header" // "Payment plan  Total premium  Initial payment  Payments"
    | "table-row"    // rows with 2+ dollar amounts
    | "body";

  const classifyLine = (l: string): LineKind => {
    if (/^[.…\s]{10,}$/.test(l))                          return "rule";
    if (sectionHeadings.has(l))                            return "major";
    if (/^auto insurance(?: quote)?$/i.test(l.trim()))     return "doc-title";
    if (/^total \d+ month policy premium/i.test(l))        return "grand-total";
    if (/^-?\$[\d,]+(\.\d{2})?$/.test(l.trim()))          return "amount";
    if (/^(payment plan|total premium|initial payment)/i.test(l)) return "table-header";
    if ((l.match(/\$/g) ?? []).length >= 2)               return "table-row";
    if (/^(total|paid in full|policy premium if)/i.test(l)) return "financial";
    // Short lines with no punctuation that look like bold sub-titles
    if (
      l.length < 55 &&
      /^[A-Z]/.test(l) &&
      !/[.?!]$/.test(l) &&
      !/\d{4,}/.test(l)
    ) return "sub-heading";
    return "body";
  };

  // ── Detail page factory ────────────────────────────────────
  let pageNum = 2;

  const newDetailPage = () => {
    const dp = pdf.addPage([W, H]);
    dp.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });
    const hBottom = drawHeader(dp, true);

    dp.drawText("Coverage Details", {
      x: M, y: hBottom - 22, size: 18, font: boldFont, color: ink,
    });
    dp.drawText(
      `${extracted.customerName}  •  ${extracted.insuranceType}  •  ${extracted.quoteDate}`,
      { x: M, y: hBottom - 41, size: 9, font, color: muted },
    );
    dp.drawText(`Page ${pageNum}`, {
      x: W - M - 44, y: hBottom - 22, size: 9, font: boldFont, color: navy,
    });
    dp.drawLine({
      start: { x: M, y: hBottom - 52 }, end: { x: W - M, y: hBottom - 52 },
      thickness: 0.5, color: bdr,
    });
    drawFooter(dp, pageNum);
    pageNum++;
    return { dp, contentY: hBottom - 68 };
  };

  // ── Pre-process: merge "label + dot-leader + $amount" triplets ──────────
  // The source PDF uses dot leaders between label and amount on separate lines,
  // e.g.: "Total policy premium" / "............" / "$1,909.00".
  // After line-splitting these become three disconnected elements. We collapse
  // them into a single label-amount pair so they render on the same row.
  const isAmountStr = (s: string) => /^-?\$[\d,]+(\.\d{2})?$/.test(s.trim());
  const isDotLeaderStr = (s: string) => /^[.…\s]{10,}$/.test(s);

  type RenderItem =
    | { isLabelAmount: false; text: string }
    | { isLabelAmount: true; label: string; amount: string; labelKind: LineKind };

  const renderItems: RenderItem[] = [];
  for (let idx = 0; idx < filteredLines.length; idx++) {
    const cur  = filteredLines[idx];
    const nxt1 = filteredLines[idx + 1] ?? "";
    const nxt2 = filteredLines[idx + 2] ?? "";

    if (isDotLeaderStr(nxt1) && isAmountStr(nxt2)) {
      // label + dot-leader + amount → two-column inline row
      renderItems.push({
        isLabelAmount: true,
        label: cur,
        amount: nxt2.trim(),
        labelKind: classifyLine(cur),
      });
      idx += 2;
    } else {
      renderItems.push({ isLabelAmount: false, text: cur });
    }
  }

  // ── Render loop ────────────────────────────────────────────
  let detailPage: PDFPage | null = null;
  let cursorY = 0;

  const ensurePage = () => {
    if (detailPage === null) {
      const r = newDetailPage();
      detailPage = r.dp;
      cursorY = r.contentY;
    }
  };

  const maybeNewPage = (neededH: number) => {
    if (detailPage === null || cursorY - neededH < 64) {
      const r = newDetailPage();
      detailPage = r.dp;
      cursorY = r.contentY;
    }
  };

  for (const item of renderItems) {
    // ── Two-column label-amount row ───────────────────────────
    if (item.isLabelAmount) {
      const { label, amount, labelKind } = item;
      const isGrand = labelKind === "grand-total";
      const rowSize  = isGrand ? 11.5 : 11;
      const rowH     = (isGrand ? 14 : 10) + 18 + 8;  // topPad + lineH + botPad

      maybeNewPage(rowH);
      cursorY -= isGrand ? 14 : 10;

      if (isGrand) {
        // Blue-tinted highlight for the grand-total row
        detailPage!.drawRectangle({
          x: M - 4, y: cursorY - 14, width: W - 2 * M + 8, height: 24,
          color: rgb(0.94, 0.97, 1.0),
          borderColor: rgb(0.75, 0.82, 0.95),
          borderWidth: 0.75,
        });
      }

      // Label (left)
      detailPage!.drawText(label, {
        x: M + 12, y: cursorY,
        size: rowSize, font: boldFont,
        color: isGrand ? navy : ink,
      });

      // Amount (right-aligned)
      const amtW = amount.length * rowSize * 0.58;
      detailPage!.drawText(amount, {
        x: W - M - amtW, y: cursorY,
        size: rowSize, font: boldFont,
        color: isGrand ? navy : ink,
      });

      // Thin separator below the row
      cursorY -= 18;
      detailPage!.drawLine({
        start: { x: M, y: cursorY },
        end:   { x: W - M, y: cursorY },
        thickness: 0.5, color: bdr,
      });
      cursorY -= 8;
      continue;
    }

    // ── Single-line items ─────────────────────────────────────
    const lineText = item.text;
    const kind = classifyLine(lineText);

    let topPad: number, botPad: number, fontSize: number, leading: number;
    let wrapped: string[] = [];

    if (kind === "rule") {
      topPad = 4; botPad = 4; fontSize = 0; leading = 0;
      wrapped = [];
    } else if (kind === "major") {
      topPad = 16; botPad = 12; fontSize = 13; leading = 18;
      wrapped = wrapText(lineText, 52);
    } else if (kind === "doc-title") {
      topPad = 20; botPad = 18; fontSize = 22; leading = 28;
      wrapped = wrapText(lineText, 38);
    } else if (kind === "sub-heading") {
      topPad = 12; botPad = 6; fontSize = 12; leading = 17;
      wrapped = wrapText(lineText, 68);
    } else if (kind === "grand-total") {
      topPad = 12; botPad = 8; fontSize = 11.5; leading = 16;
      wrapped = wrapText(lineText, 80);
    } else if (kind === "financial") {
      topPad = 8; botPad = 6; fontSize = 11; leading = 16;
      wrapped = wrapText(lineText, 80);
    } else if (kind === "amount") {
      // Standalone amount — should be rare after pre-processing
      topPad = 2; botPad = 2; fontSize = 12; leading = 16;
      wrapped = [lineText.trim()];
    } else if (kind === "table-header") {
      topPad = 10; botPad = 4; fontSize = 9.5; leading = 14;
      wrapped = wrapText(lineText, 90);
    } else if (kind === "table-row") {
      topPad = 3; botPad = 3; fontSize = 10; leading = 14;
      wrapped = wrapText(lineText, 88);
    } else {
      // body
      topPad = 3; botPad = 3; fontSize = 11; leading = 16;
      wrapped = wrapText(lineText, 83);
    }

    const blockH = kind === "rule"
      ? topPad + 6 + botPad
      : topPad + wrapped.length * leading + botPad;

    maybeNewPage(blockH);
    cursorY -= topPad;

    // ── Draw decorations ─────────────────────────────────────
    if (kind === "rule") {
      detailPage!.drawLine({
        start: { x: M, y: cursorY - 3 },
        end:   { x: W - M, y: cursorY - 3 },
        thickness: 0.5, color: bdr,
      });
      cursorY -= 6 + botPad;
      continue;
    }

    if (kind === "major") {
      const bandY = cursorY - (wrapped.length - 1) * leading - 4;
      const bandH = wrapped.length * leading + 18;
      detailPage!.drawRectangle({
        x: M, y: bandY, width: W - 2 * M, height: bandH,
        color: rgb(0.93, 0.92, 0.89), borderColor: bdr, borderWidth: 0.5,
      });
      detailPage!.drawRectangle({ x: M, y: bandY, width: 4, height: bandH, color: navy });
    }

    if (kind === "doc-title") {
      const underY = cursorY - wrapped.length * leading - 8;
      detailPage!.drawLine({
        start: { x: M, y: underY }, end: { x: M + 280, y: underY },
        thickness: 3, color: gold,
      });
    }

    if (kind === "grand-total") {
      const bandY = cursorY - (wrapped.length - 1) * leading - botPad;
      const bandH = wrapped.length * leading + topPad + botPad;
      detailPage!.drawRectangle({
        x: M - 4, y: bandY, width: W - 2 * M + 8, height: bandH,
        color: rgb(0.95, 0.97, 1.0), borderColor: rgb(0.75, 0.82, 0.95), borderWidth: 0.75,
      });
    }

    if (kind === "table-header") {
      const rowY = cursorY - (wrapped.length - 1) * leading - botPad;
      const rowH = wrapped.length * leading + topPad + botPad;
      detailPage!.drawRectangle({
        x: M, y: rowY, width: W - 2 * M, height: rowH,
        color: rgb(0.93, 0.92, 0.89),
      });
    }

    // ── Draw text ────────────────────────────────────────────
    for (let i = 0; i < wrapped.length; i++) {
      const lineY = cursorY - i * leading;
      let drawX: number;
      let drawFont: typeof font | typeof boldFont;
      let drawColor: ReturnType<typeof rgb>;

      if (kind === "major") {
        drawX = M + 14; drawFont = boldFont; drawColor = navy;
      } else if (kind === "doc-title") {
        drawX = M; drawFont = boldFont; drawColor = ink;
      } else if (kind === "sub-heading") {
        drawX = M + 12; drawFont = boldFont; drawColor = ink;
      } else if (kind === "grand-total") {
        drawX = M + 8; drawFont = boldFont; drawColor = navy;
      } else if (kind === "financial") {
        drawX = M + 12; drawFont = boldFont; drawColor = ink;
      } else if (kind === "amount") {
        const estW = wrapped[i].length * fontSize * 0.58;
        drawX = W - M - estW;
        drawFont = boldFont; drawColor = ink;
      } else if (kind === "table-header") {
        drawX = M + 8; drawFont = boldFont; drawColor = muted;
      } else if (kind === "table-row") {
        drawX = M + 12; drawFont = font; drawColor = ink;
      } else {
        drawX = M + 12; drawFont = font; drawColor = ink;
      }

      detailPage!.drawText(wrapped[i], {
        x: drawX, y: lineY,
        size: fontSize, font: drawFont, color: drawColor,
      });
    }

    cursorY -= wrapped.length * leading + botPad;
  }

  ensurePage(); // ensure at least one detail page was created

  return pdf.save();
}
