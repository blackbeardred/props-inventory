/**
 * The storage survey's responses as an Excel workbook, one row each, in
 * words rather than stored values (migration 021). Only the survey's reader
 * gets it: the database refuses everyone else, and they're sent back to the
 * page, which says why.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SURVEY_ID } from "@/lib/survey/storage-2026";
import { resultsTable, type SurveyResponse } from "@/lib/survey/results";
import { buildXlsx, XLSX_CONTENT_TYPE } from "@/lib/xlsx-write";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/survey-results", request.url));
  }

  const { data, error } = await supabase.rpc("survey_results", { p_survey: SURVEY_ID });
  if (error) {
    return NextResponse.redirect(new URL("/survey-results", request.url));
  }

  const table = resultsTable((data ?? []) as SurveyResponse[]);
  const workbook = buildXlsx({ name: "Survey responses", rows: table });
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Blob([workbook as BlobPart], { type: XLSX_CONTENT_TYPE }), {
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="survey-responses-${today}.xlsx"`,
      // People's answers: never kept by a browser or a proxy.
      "cache-control": "no-store",
    },
  });
}
