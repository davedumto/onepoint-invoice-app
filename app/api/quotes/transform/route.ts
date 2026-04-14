import path from "node:path";

import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";

import {
  buildBrandedQuotePdf,
  buildDownloadFilename,
  extractQuoteDetails,
} from "@/lib/quote-workflow";

export const runtime = "nodejs";

PDFParse.setWorker(
  path.join(process.cwd(), "node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs")
);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const markupValue = Number(formData.get("markupPercent") ?? "0");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Please upload a PDF file." },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF uploads are supported." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(markupValue) || markupValue < 0 || markupValue > 100) {
      return NextResponse.json(
        { error: "Markup percent must be between 0 and 100." },
        { status: 400 }
      );
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: pdfBuffer });
    const parsed = await parser.getText();
    await parser.destroy();

    const extracted = extractQuoteDetails(parsed.text ?? "");
    const brandedPdf = await buildBrandedQuotePdf({
      extracted,
      markupPercent: markupValue,
    });
    const filename = buildDownloadFilename(
      extracted.customerName,
      extracted.insuranceType
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
      {
        error:
          "We could not process that PDF yet. Please try another quote document.",
      },
      { status: 500 }
    );
  }
}
