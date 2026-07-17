import { NextResponse } from "next/server";
import { investigateAnomaly } from "@/lib/ai/verdict";

export async function POST(_: Request, { params }: { params: Promise<{ anomalyId: string }> }) {
  try { return NextResponse.json(await investigateAnomaly((await params).anomalyId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Investigation failed." }, { status: 500 }); }
}
