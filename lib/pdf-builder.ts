import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";

import type { StructuredQuote } from "./gemini-extractor";
import { formatCurrency } from "./quote-workflow";

// ── Page constants ───────────────────────────────────────────────────────────
const W = 612;
const H = 792;
const M = 48; // horizontal margin

// ── Brand palette ────────────────────────────────────────────────────────────
const navy  = rgb(0.08, 0.16, 0.27);
const gold  = rgb(0.84, 0.67, 0.31);
const white = rgb(1, 1, 1);
const ink   = rgb(0.12, 0.14, 0.18);
const muted = rgb(0.37, 0.41, 0.47);
const paper = rgb(0.98, 0.97, 0.95);
const bdr   = rgb(0.88, 0.86, 0.82);
const cream = rgb(0.99, 0.97, 0.92);
const slate = rgb(0.60, 0.68, 0.78);
const rowAlt = rgb(0.97, 0.97, 0.96);
const hlBlue = rgb(0.94, 0.97, 1.0);
const hlBlueBdr = rgb(0.75, 0.82, 0.95);

// Coverage table column x-positions and widths
const COV = {
  name:       { x: M + 12,  w: 172 },
  limits:     { x: M + 184, w: 172 },
  deductible: { x: M + 356, w: 72  },
  premium:    { x: M + 428, w: 80  },
};

// Payment plan table column x-positions and widths
const PP = {
  planType:       { x: M + 12,  w: 88  },
  totalPremium:   { x: M + 100, w: 96  },
  initialPayment: { x: M + 196, w: 96  },
  payments:       { x: M + 292, w: 224 },
};

export async function buildBrandedQuotePdf({
  structured,
  markupPercent,
}: {
  structured: StructuredQuote;
  markupPercent: number;
}) {
  const pdf  = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const logoPath  = path.join(process.cwd(), "public", "onepoint-logo.png");
  const logoBytes = await readFile(logoPath);
  const logo      = await pdf.embedPng(logoBytes);

  // Financials
  const base       = structured.paidInFullQuote;
  const markup     = base * (markupPercent / 100);
  const finalQuote = base + markup;

  // ── Shared helpers ─────────────────────────────────────────────────────────

  /** White header with thin navy top bar + gold accent. Returns y at bottom of gold bar. */
  const drawHeader = (page: PDFPage, compact = false): number => {
    const hH    = compact ? 62 : 90;
    const goldH = 3;
    const dims  = logo.scale(compact ? 0.18 : 0.22);

    page.drawRectangle({ x: 0, y: H - hH, width: W, height: hH, color: white });
    page.drawRectangle({ x: 0, y: H - 3,  width: W, height: 3,  color: navy  });
    page.drawRectangle({ x: 0, y: H - hH - goldH, width: W, height: goldH, color: gold });
    page.drawImage(logo, {
      x: M, y: H - hH + Math.round((hH - dims.height) / 2),
      width: dims.width, height: dims.height,
    });
    return H - hH - goldH;
  };

  /** Navy footer. Shows tagline on p1, page number on detail pages. */
  const drawFooter = (page: PDFPage, pageNum?: number) => {
    page.drawRectangle({ x: 0, y: 0, width: W, height: 50, color: navy });
    page.drawText("Prepared by OnePoint Insurance Agency", {
      x: M, y: 19, size: 9, font: bold, color: white,
    });
    if (pageNum !== undefined) {
      page.drawText(`Page ${pageNum}`, {
        x: W - M - 44, y: 19, size: 9, font: bold, color: slate,
      });
    } else {
      page.drawText("Client-ready pricing  •  Confidential", {
        x: W - M - 196, y: 19, size: 8, font, color: slate,
      });
    }
  };

  let pageNum = 2;

  /** Start a new branded detail page. Returns the y-cursor for content. */
  const newDetailPage = (): { page: PDFPage; y: number } => {
    const dp     = pdf.addPage([W, H]);
    const hBot   = drawHeader(dp, true);
    dp.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });
    // Re-draw header over paper background
    drawHeader(dp, true);

    dp.drawText("Coverage Details", {
      x: M, y: hBot - 22, size: 18, font: bold, color: ink,
    });
    dp.drawText(
      `${structured.customerName}  •  ${structured.insuranceType}  •  ${structured.quoteDate}`,
      { x: M, y: hBot - 41, size: 9, font, color: muted },
    );
    dp.drawText(`Page ${pageNum}`, {
      x: W - M - 44, y: hBot - 22, size: 9, font: bold, color: navy,
    });
    dp.drawLine({
      start: { x: M, y: hBot - 52 }, end: { x: W - M, y: hBot - 52 },
      thickness: 0.5, color: bdr,
    });
    drawFooter(dp, pageNum);
    pageNum++;
    return { page: dp, y: hBot - 68 };
  };

  /** Navy band with gold left bar and white uppercase title. Returns y below band. */
  const drawSectionBand = (page: PDFPage, y: number, title: string): number => {
    const bandH = 28;
    page.drawRectangle({
      x: M, y: y - bandH, width: W - 2 * M, height: bandH,
      color: rgb(0.93, 0.92, 0.89), borderColor: bdr, borderWidth: 0.5,
    });
    page.drawRectangle({ x: M, y: y - bandH, width: 4, height: bandH, color: navy });
    page.drawText(title, {
      x: M + 14, y: y - 18, size: 9, font: bold, color: navy,
    });
    return y - bandH - 6;
  };

  /** Two-column label → value row with optional highlight. Returns y below row. */
  const drawLabelValue = (
    page: PDFPage,
    y: number,
    label: string,
    value: string,
    opts: { highlight?: boolean; bold?: boolean; large?: boolean } = {}
  ): number => {
    const rowH = opts.large ? 26 : 22;
    const fs   = opts.large ? 11 : 10;

    if (opts.highlight) {
      page.drawRectangle({
        x: M, y: y - rowH + 2, width: W - 2 * M, height: rowH,
        color: hlBlue, borderColor: hlBlueBdr, borderWidth: 0.5,
      });
    }

    page.drawText(label, {
      x: M + 12, y: y - (rowH / 2) - (fs / 2) + 2,
      size: fs, font: opts.bold ? bold : font, color: opts.bold ? ink : muted,
    });

    const valW = value.length * fs * 0.58;
    page.drawText(value, {
      x: W - M - valW - 12, y: y - (rowH / 2) - (fs / 2) + 2,
      size: fs, font: bold, color: opts.highlight ? navy : ink,
    });

    if (!opts.highlight) {
      page.drawLine({
        start: { x: M, y: y - rowH + 2 }, end: { x: W - M, y: y - rowH + 2 },
        thickness: 0.4, color: bdr,
      });
    }
    return y - rowH;
  };

  /** Draw a coverage table header row. Returns y below row. */
  const drawCovHeader = (page: PDFPage, y: number): number => {
    const rowH = 22;
    page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: navy });
    const headers: [string, keyof typeof COV][] = [
      ["COVERAGE",   "name"],
      ["LIMITS",     "limits"],
      ["DEDUCTIBLE", "deductible"],
      ["PREMIUM",    "premium"],
    ];
    for (const [label, col] of headers) {
      const isRight = col === "premium" || col === "deductible";
      const x = isRight
        ? COV[col].x + COV[col].w - label.length * 8 * 0.56 - 4
        : COV[col].x;
      page.drawText(label, { x, y: y - 14, size: 8, font: bold, color: white });
    }
    return y - rowH;
  };

  /** Draw one coverage data row. Returns y below row. */
  const drawCovRow = (
    page: PDFPage,
    y: number,
    name: string,
    limits: string,
    deductible: string,
    premium: string,
    isEven: boolean,
    isTotalRow = false
  ): number => {
    const rowH = 20;

    if (isTotalRow) {
      page.drawRectangle({
        x: M, y: y - rowH, width: W - 2 * M, height: rowH,
        color: hlBlue, borderColor: hlBlueBdr, borderWidth: 0.5,
      });
    } else if (isEven) {
      page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: rowAlt });
    }

    page.drawLine({
      start: { x: M, y: y - rowH }, end: { x: W - M, y: y - rowH },
      thickness: 0.4, color: bdr,
    });

    const textY  = y - 13;
    const fnt    = isTotalRow ? bold : font;
    const clr    = isTotalRow ? navy : ink;
    const sz     = 9;

    // Coverage name — truncate to fit column
    const maxNameChars = Math.floor(COV.name.w / (sz * 0.56));
    const nameText = name.length > maxNameChars ? name.slice(0, maxNameChars - 1) + "…" : name;
    page.drawText(nameText, { x: COV.name.x, y: textY, size: sz, font: fnt, color: clr });

    // Limits — may be longer; use smaller font if needed
    const maxLimChars = Math.floor(COV.limits.w / (sz * 0.56));
    const limText = limits.length > maxLimChars ? limits.slice(0, maxLimChars - 1) + "…" : limits;
    page.drawText(limText, { x: COV.limits.x, y: textY, size: sz, font, color: ink });

    // Deductible — right-aligned
    if (deductible) {
      const dedW = deductible.length * sz * 0.56;
      page.drawText(deductible, {
        x: COV.deductible.x + COV.deductible.w - dedW - 4, y: textY,
        size: sz, font, color: ink,
      });
    }

    // Premium — right-aligned
    if (premium) {
      const premW = premium.length * sz * 0.58;
      page.drawText(premium, {
        x: COV.premium.x + COV.premium.w - premW - 4, y: textY,
        size: sz, font: isTotalRow ? bold : font, color: clr,
      });
    }

    return y - rowH;
  };

  /** Draw a payment-plan table header. Returns y below row. */
  const drawPPHeader = (page: PDFPage, y: number): number => {
    const rowH = 22;
    page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: navy });
    const cols: [string, keyof typeof PP][] = [
      ["PLAN",            "planType"],
      ["TOTAL PREMIUM",   "totalPremium"],
      ["INITIAL PAYMENT", "initialPayment"],
      ["INSTALLMENTS",    "payments"],
    ];
    for (const [label, col] of cols) {
      page.drawText(label, { x: PP[col].x, y: y - 14, size: 7.5, font: bold, color: white });
    }
    return y - rowH;
  };

  /** Draw one payment-plan data row. Returns y below row. */
  const drawPPRow = (
    page: PDFPage,
    y: number,
    row: { planType: string; totalPremium: string; initialPayment: string; payments: string },
    isEven: boolean
  ): number => {
    const rowH = 20;
    if (isEven) {
      page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: rowAlt });
    }
    page.drawLine({
      start: { x: M, y: y - rowH }, end: { x: W - M, y: y - rowH },
      thickness: 0.4, color: bdr,
    });
    const textY = y - 13;
    const sz    = 9;
    page.drawText(row.planType,       { x: PP.planType.x,       y: textY, size: sz, font, color: ink });
    page.drawText(row.totalPremium,   { x: PP.totalPremium.x,   y: textY, size: sz, font, color: ink });
    page.drawText(row.initialPayment, { x: PP.initialPayment.x, y: textY, size: sz, font, color: ink });
    page.drawText(row.payments,       { x: PP.payments.x,       y: textY, size: sz, font, color: ink });
    return y - rowH;
  };

  // ── PAGE 1: EXECUTIVE SUMMARY ────────────────────────────────────────────
  const p1 = pdf.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });
  drawHeader(p1, false);

  p1.drawText("INSURANCE QUOTE", { x: W - M - 118, y: H - 42, size: 10, font: bold, color: navy });
  p1.drawText("OnePoint Insurance Agency", { x: W - M - 118, y: H - 58, size: 8,  font, color: muted });

  // Hero
  const fitSize = (text: string, maxW: number, maxSz: number) => {
    const natW = text.length * maxSz * 0.56;
    return natW <= maxW ? maxSz : Math.max(9, Math.floor(maxW / (text.length * 0.56)));
  };

  p1.drawText("PREPARED FOR", { x: M, y: 684, size: 8, font: bold, color: muted });
  const nameSz = fitSize(structured.customerName, W - 2 * M - 8, 28);
  p1.drawText(structured.customerName, { x: M, y: 652, size: nameSz, font: bold, color: ink });
  p1.drawText(structured.insuranceType, { x: M, y: 632, size: 11, font, color: navy });
  p1.drawText(`Date: ${structured.quoteDate}`, { x: W - M - 162, y: 632, size: 10, font, color: muted });

  // Price banner
  p1.drawRectangle({ x: 0, y: 538, width: W, height: 84, color: navy });
  p1.drawText("YOUR ONEPOINT QUOTE", { x: M, y: 599, size: 8, font: bold, color: gold });
  p1.drawText(formatCurrency(finalQuote), { x: M, y: 563, size: 32, font: bold, color: white });

  p1.drawLine({ start: { x: 310, y: 596 }, end: { x: 310, y: 548 }, thickness: 0.75, color: rgb(0.2, 0.3, 0.45) });

  const trios = [
    { label: "POLICY PERIOD", value: "6 Months" },
    { label: "MONTHLY EST.",  value: formatCurrency(finalQuote / 6) },
    { label: "ANNUAL EST.",   value: formatCurrency(finalQuote * 2) },
  ];
  for (let i = 0; i < trios.length; i++) {
    const mx = 318 + i * 82;
    if (i > 0) {
      p1.drawLine({ start: { x: mx - 2, y: 596 }, end: { x: mx - 2, y: 548 }, thickness: 0.5, color: rgb(0.2, 0.3, 0.45) });
    }
    p1.drawText(trios[i].label, { x: mx + 6, y: 599, size: 7, font: bold, color: slate });
    p1.drawText(trios[i].value, { x: mx + 6, y: 578, size: 10, font: bold, color: white });
  }

  // Quote details card
  p1.drawRectangle({ x: M, y: 326, width: W - 2 * M, height: 204, color: white, borderColor: bdr, borderWidth: 1 });
  p1.drawText("QUOTE DETAILS", { x: M + 20, y: 507, size: 8, font: bold, color: muted });

  const detailRows: [string, string][] = [
    ["Customer",      structured.customerName],
    ["Coverage Type", structured.insuranceType],
    ["Quote Date",    structured.quoteDate],
  ];
  let drY = 468;
  for (const [lbl, val] of detailRows) {
    p1.drawText(lbl, { x: M + 20, y: drY, size: 10, font, color: muted });
    p1.drawText(val, { x: M + 158, y: drY, size: fitSize(val, W - 2 * M - 160, 10), font: bold, color: ink });
    p1.drawLine({ start: { x: M + 20, y: drY - 10 }, end: { x: W - M - 20, y: drY - 10 }, thickness: 0.5, color: bdr });
    drY -= 44;
  }

  // Next steps block
  p1.drawRectangle({ x: M, y: 62, width: W - 2 * M, height: 255, color: cream, borderColor: gold, borderWidth: 0.75 });
  p1.drawRectangle({ x: M, y: 62, width: 4, height: 255, color: gold });
  p1.drawText("NEXT STEPS", { x: M + 20, y: 296, size: 8, font: bold, color: navy });

  const nextLines = [
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
  for (const line of nextLines) {
    if (nsY < 72) break;
    if (line === "") { nsY -= 8; continue; }
    p1.drawText(line, { x: M + 20, y: nsY, size: 9.5, font, color: ink });
    nsY -= 15;
  }

  drawFooter(p1);

  // ── PAGE 2: PRICING OVERVIEW & PAYMENT PLANS ────────────────────────────
  {
    const { page: p2, y: startY } = newDetailPage();
    let y = startY;

    // Pricing summary
    y = drawSectionBand(p2, y, "PRICING SUMMARY");
    y = drawLabelValue(p2, y, "Total policy premium",      formatCurrency(structured.originalQuote));
    y = drawLabelValue(p2, y, "Paid in full discount",     `-${formatCurrency(structured.paidInFullDiscount)}`);
    y = drawLabelValue(p2, y, "Policy premium if paid in full", formatCurrency(structured.paidInFullQuote), { highlight: true, bold: true });
    y -= 4;

    // Payment plans
    if (structured.paymentPlanGroups.length > 0) {
      y -= 12;
      y = drawSectionBand(p2, y, "PAYMENT PLANS");

      for (const group of structured.paymentPlanGroups) {
        if (group.rows.length === 0) continue;

        // Check if we need a new page
        const needed = 16 + 22 + group.rows.length * 20 + 8;
        let page = p2;
        if (y - needed < 64) {
          const r = newDetailPage();
          page = r.page;
          y = r.y;
          y = drawSectionBand(page, y, "PAYMENT PLANS (CONTINUED)");
        }

        // Group description
        if (group.description) {
          page.drawText(group.description, {
            x: M + 12, y: y - 12, size: 9, font, color: muted,
          });
          y -= 20;
        }

        y = drawPPHeader(page, y);
        group.rows.forEach((row, i) => {
          y = drawPPRow(page, y, row, i % 2 === 0);
        });
        y -= 8;
      }
    }
  }

  // ── PAGE 3+: VEHICLE & COVERAGE ─────────────────────────────────────────
  if (structured.vehicles.length > 0 || structured.coverageItems.length > 0) {
    const { page, y: startY } = newDetailPage();
    let pg  = page;
    let y   = startY;

    // Vehicle info
    if (structured.vehicles.length > 0) {
      y = drawSectionBand(pg, y, "VEHICLE INFORMATION");
      for (const v of structured.vehicles) {
        const fields: [string, string | null][] = [
          ["Vehicle",      v.description],
          ["VIN",          v.vin],
          ["Garaging ZIP", v.garagingZip],
          ["Primary Use",  v.primaryUse],
          ["Annual Miles", v.annualMiles],
        ];
        for (const [label, value] of fields) {
          if (!value) continue;
          if (y - 22 < 64) {
            const r = newDetailPage();
            pg = r.page; y = r.y;
          }
          y = drawLabelValue(pg, y, label, value);
        }
        y -= 4;
      }
      y -= 8;
    }

    // Coverage table
    if (structured.coverageItems.length > 0) {
      if (y - 28 - 22 * (structured.coverageItems.length + 1) < 64) {
        const r = newDetailPage();
        pg = r.page; y = r.y;
      }
      y = drawSectionBand(pg, y, "COVERAGE DETAILS");
      y = drawCovHeader(pg, y);

      structured.coverageItems.forEach((item, i) => {
        if (y - 20 < 64) {
          const r = newDetailPage();
          pg = r.page; y = r.y;
          y = drawCovHeader(pg, y);
        }
        y = drawCovRow(
          pg, y,
          item.name,
          item.limits ?? "",
          item.deductible ?? "",
          item.premium !== null ? `$${item.premium.toLocaleString()}` : "",
          i % 2 === 0
        );
      });

      // Total row
      if (y - 20 < 64) {
        const r = newDetailPage();
        pg = r.page; y = r.y;
      }
      y = drawCovRow(
        pg, y,
        "Total 6-month premium (paid in full)",
        "", "",
        formatCurrency(structured.paidInFullQuote),
        false,
        true
      );
    }
  }

  // ── FINAL PAGE: DRIVERS & DISCOUNTS ─────────────────────────────────────
  if (structured.drivers.length > 0 || structured.discounts.length > 0) {
    const { page, y: startY } = newDetailPage();
    let pg = page;
    let y  = startY;

    if (structured.drivers.length > 0) {
      y = drawSectionBand(pg, y, "DRIVER INFORMATION");

      for (const driver of structured.drivers) {
        const fields: [string, string | null][] = [
          ["Name",           driver.name],
          ["Date of Birth",  driver.dateOfBirth],
          ["Gender",         driver.gender],
          ["Marital Status", driver.maritalStatus],
          ["Driver Status",  driver.driverStatus],
          ["License Type",   driver.licenseType],
        ];
        for (const [label, value] of fields) {
          if (!value) continue;
          if (y - 22 < 64) {
            const r = newDetailPage();
            pg = r.page; y = r.y;
          }
          y = drawLabelValue(pg, y, label, value);
        }
        y -= 8;
      }
      y -= 4;
    }

    if (structured.discounts.length > 0) {
      if (y - 28 < 64) {
        const r = newDetailPage();
        pg = r.page; y = r.y;
      }
      y = drawSectionBand(pg, y, "PREMIUM DISCOUNTS");

      for (const discount of structured.discounts) {
        if (y - 18 < 64) {
          const r = newDetailPage();
          pg = r.page; y = r.y;
        }
        // Gold bullet
        pg.drawCircle({ x: M + 18, y: y - 10, size: 2.5, color: gold });
        pg.drawText(discount, { x: M + 28, y: y - 14, size: 10, font, color: ink });
        y -= 20;
      }
    }
  }

  return pdf.save();
}
