import { NextResponse } from "next/server";
import { answerFleetQuestion } from "@/lib/fleet-query/service";

export async function POST(request: Request) {
  try {
    const { question } = await request.json() as { question?: string };
    if (!question?.trim()) return NextResponse.json({ error: "Enter a fleet question." }, { status: 400 });
    const result = await Promise.race([answerFleetQuestion(question.trim()), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The fleet query timed out. Please try again.")), 30_000))]);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to answer the fleet question." }, { status: 500 });
  }
}
