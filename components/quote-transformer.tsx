"use client";

import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";
import { Download, FileText, FileUp, ShieldCheck, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function extractFilename(contentDisposition: string | null) {
  if (!contentDisposition) {
    return "onepoint-quote.pdf";
  }

  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match?.[1] ?? "onepoint-quote.pdf";
}

export function QuoteTransformer() {
  const [file, setFile] = useState<File | null>(null);
  const [markupPercent, setMarkupPercent] = useState("12");
  const [statusMessage, setStatusMessage] = useState(
    "Upload a carrier quote PDF to generate a OnePoint-branded version."
  );
  const [isPending, startTransition] = useTransition();

  const fileNamePreview = useMemo(() => {
    const sourceName = file?.name.replace(/\.pdf$/i, "") ?? "David Vine";
    const normalizedName = sourceName
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("-");

    return `${normalizedName || "David-Vine"}-auto-insurance-quote.pdf`
      .replace(/[^a-z0-9.-]+/gi, "-")
      .replace(/-{2,}/g, "-");
  }, [file]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file) {
      setStatusMessage("Choose a PDF before generating the branded quote.");
      return;
    }

    startTransition(async () => {
      try {
        setStatusMessage("Reading the uploaded PDF and building the new quote...");

        const formData = new FormData();
        formData.append("file", file);
        formData.append("markupPercent", markupPercent);

        const response = await fetch("/api/quotes/transform", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorBody = (await response.json()) as { error?: string };
          throw new Error(errorBody.error ?? "Failed to generate the PDF.");
        }

        const blob = await response.blob();
        const downloadName = extractFilename(
          response.headers.get("Content-Disposition")
        );
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = downloadUrl;
        link.download = downloadName;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);

        setStatusMessage(`Downloaded ${downloadName}`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Something went wrong while generating the quote."
        );
      }
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="overflow-hidden border-border/70 bg-background/95">
        <CardHeader className="space-y-4">
          <Badge variant="outline" className="w-fit bg-secondary/70">
            OnePoint internal quoting workflow
          </Badge>
          <div className="space-y-2">
            <CardTitle className="text-4xl leading-tight tracking-tight text-balance">
              Upload a quote PDF, extract the customer details, add your cut,
              and download a OnePoint-branded PDF.
            </CardTitle>
            <CardDescription className="max-w-2xl text-base leading-7">
              The app reads PDF text, looks for the customer name, insurance
              request, and quoted amount, then creates a downloadable PDF with
              OnePoint branding and your markup already applied.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <label className="text-sm font-medium">
                Quote PDF
              </label>
              <label
                htmlFor="quote-file"
                className="group flex cursor-pointer flex-col gap-4 rounded-[1.5rem] border-2 border-dashed border-[#d6ab4f]/70 bg-[linear-gradient(180deg,rgba(245,238,224,0.82),rgba(255,255,255,0.95))] p-6 transition hover:border-[#132338] hover:bg-[linear-gradient(180deg,rgba(245,238,224,0.96),rgba(255,255,255,1))]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#132338] text-white">
                    <Upload className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-foreground">
                      Click to upload a quote PDF
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Upload the carrier quote here. PDF only.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm">
                  {file ? (
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <FileText className="h-4 w-4 text-[#132338]" />
                      {file.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      No PDF selected yet
                    </span>
                  )}
                </div>
              </label>
              <input
                id="quote-file"
                type="file"
                accept="application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="markupPercent">
                OnePoint markup percentage
              </label>
              <Input
                id="markupPercent"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={markupPercent}
                onChange={(event) => setMarkupPercent(event.target.value)}
                className="h-11"
              />
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-4">
              <p className="text-sm font-medium">Expected output filename</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {fileNamePreview}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" size="lg" disabled={isPending}>
                <FileUp />
                {isPending ? "Generating PDF..." : "Generate branded quote"}
              </Button>
              <Button type="button" variant="outline" size="lg" disabled>
                <Download />
                Download starts automatically
              </Button>
            </div>
          </form>

          <Separator />

          <div className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
            {statusMessage}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        <Card className="border-border/70 bg-[linear-gradient(180deg,rgba(14,25,42,0.96),rgba(27,41,62,0.92))] text-white">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#d6ab4f] text-[#132338]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-white">OnePoint branding</CardTitle>
                <CardDescription className="text-slate-200">
                  PDF output includes a OnePoint-styled header and quote summary.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-100">
            <p>Generated file pattern:</p>
            <p className="rounded-xl bg-white/8 px-4 py-3 font-mono text-xs">
              david-vine-auto-insurance-quote.pdf
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Extraction targets</CardTitle>
            <CardDescription>
              The first version looks for the most common quote fields in the
              uploaded PDF text.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Used for</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Customer name</TableCell>
                  <TableCell>PDF title and filename</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Insurance type</TableCell>
                  <TableCell>Filename and branded summary</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Quoted amount</TableCell>
                  <TableCell>Markup calculation</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Source text excerpt</TableCell>
                  <TableCell>Quick review inside the generated PDF</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
