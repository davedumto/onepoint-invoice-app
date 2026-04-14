import { NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse/lib/pdf-parse.js");

import { extractStructuredQuote } from "@/lib/gemini-extractor";
import { buildBrandedQuotePdf }   from "@/lib/pdf-builder";
import { buildDownloadFilename }  from "@/lib/quote-workflow";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData   = await request.formData();
    const file       = formData.get("file");
    const markupValue = Number(formData.get("markupPercent") ?? "0");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Please upload a PDF file." }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF uploads are supported." }, { status: 400 });
    }

    if (!Number.isFinite(markupValue) || markupValue < 0 || markupValue > 100) {
      return NextResponse.json(
        { error: "Markup percent must be between 0 and 100." },
        { status: 400 }
      );
    }

    // 1. Extract raw text from the uploaded PDF
    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const parsed    = await pdfParse(pdfBuffer);

    // 2. Use Gemini to parse the raw text into clean structured data
    const structured = await extractStructuredQuote(parsed.text ?? "");

    // 3. Build the branded OnePoint PDF from the structured data
    const brandedPdf = await buildBrandedQuotePdf({ structured, markupPercent: markupValue });

    const filename = buildDownloadFilename(
      structured.customerName,
      structured.insuranceType
    );

    return new NextResponse(Buffer.from(brandedPdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Quote transformation failed", error);

    return NextResponse.json(
      { error: "We could not process that PDF. Please try again." },
      { status: 500 }
    );
  }
}
