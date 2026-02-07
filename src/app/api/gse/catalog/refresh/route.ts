import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkBasicAuth } from "@/lib/adminAuth";
import { refreshGseCatalog } from "@/lib/gse/catalog";

const schema = z.object({
  version: z.string().min(1).optional(),
  description: z.string().max(500).optional(),
  sourceVersion: z.string().max(200).optional(),
  officialRows: z.array(z.record(z.unknown())).optional(),
  githubVocabRows: z.array(z.record(z.unknown())).optional(),
  githubSources: z
    .array(
      z.object({
        repo: z.string().min(3),
        ref: z.string().min(1).optional(),
        includeToolkitBootstrap: z.boolean().optional(),
        maxFiles: z.number().int().positive().max(1000).optional(),
      })
    )
    .optional(),
  officialCsv: z.string().optional(),
  officialXlsxBase64: z.string().optional(),
  officialPdfBase64: z.string().optional(),
});

export async function POST(req: NextRequest) {
  if (!checkBasicAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = schema.parse(await req.json());
    const result = await refreshGseCatalog({
      version: body.version,
      description: body.description,
      sourceVersion: body.sourceVersion,
      officialRows: (body.officialRows || []) as never,
      githubVocabRows: (body.githubVocabRows || []) as never,
      githubSources: body.githubSources,
      officialCsv: body.officialCsv,
      officialXlsxBase64: body.officialXlsxBase64,
      officialPdfBase64: body.officialPdfBase64,
    });
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to refresh catalog" },
      { status: 400 }
    );
  }
}
