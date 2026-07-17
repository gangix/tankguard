import OpenAI from "openai";
import { getDashboardSnapshot, getTruckQueryDetail, listAnomalyQuery } from "@/lib/dashboard/queries";

const SYSTEM_PROMPT = `You are TankGuard’s fleet operations assistant. Answer only from supplied tool results. Answer in the same language as the user’s question, including Turkish. Be concise and operational.

Describe discrepancies as events, never accusations. Do not claim any person committed theft, fraud, or misconduct. Assigned drivers are context only. Use these neutral names exactly: Unexplained fuel loss while parked; Location-mismatched transaction; Efficiency deviation from baseline. Distinguish detector facts from possible explanations and recommend investigation steps, not disciplinary action.

When ranking or comparing trucks on any metric, consider both absolute values and each truck's deviation from its own baseline; a truck deviating significantly from its baseline is generally more operationally noteworthy than a stable truck with a higher absolute value. Mention both when they differ.`;

const tools: OpenAI.Responses.FunctionTool[] = [
  { type: "function", name: "get_fleet_stats", description: "Get last-30-day fleet totals and per-truck operational metrics.", parameters: { type: "object", additionalProperties: false, properties: {}, required: [] }, strict: true },
  { type: "function", name: "get_truck_detail", description: "Get a truck profile, last-30-day metrics, detected events, and cached AI verdicts.", parameters: { type: "object", additionalProperties: false, properties: { truck_id: { type: "string", enum: ["TR-01", "TR-02", "TR-03", "TR-04", "TR-05", "TR-06", "TR-07", "TR-08"] } }, required: ["truck_id"] }, strict: true },
  { type: "function", name: "list_anomalies", description: "List neutral detected events, optionally for a truck or detector rule.", parameters: { type: "object", additionalProperties: false, properties: { truck_id: { anyOf: [{ type: "string", enum: ["TR-01", "TR-02", "TR-03", "TR-04", "TR-05", "TR-06", "TR-07", "TR-08"] }, { type: "null" }] }, rule_code: { anyOf: [{ type: "string", enum: ["parked_fuel_loss", "transaction_mismatch", "efficiency_deviation"] }, { type: "null" }] }, limit: { anyOf: [{ type: "integer", minimum: 1, maximum: 20 }, { type: "null" }] } }, required: ["truck_id", "rule_code", "limit"] }, strict: true },
];

function execute(name: string, args: Record<string, unknown>) {
  if (name === "get_fleet_stats") return getDashboardSnapshot();
  if (name === "get_truck_detail") return getTruckQueryDetail(String(args.truck_id));
  if (name === "list_anomalies") return listAnomalyQuery(args.truck_id ? String(args.truck_id) : undefined, args.rule_code ? String(args.rule_code) : undefined, args.limit ? Number(args.limit) : 10);
  return { error: "Unknown tool" };
}

export async function answerFleetQuestion(question: string) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for fleet questions.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let response = await client.responses.create({ model: "gpt-5.6", reasoning: { effort: "low" }, input: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: question }], tools });
  const calledTools: string[] = [];
  for (let round = 0; round < 5; round += 1) {
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) return { answer: response.output_text, calledTools };
    const outputs = calls.map((call) => {
      const args = JSON.parse(call.arguments) as Record<string, unknown>;
      const result = execute(call.name, args);
      calledTools.push(call.name === "get_truck_detail" ? `TR-${String(args.truck_id).slice(-2)} detail` : call.name.replaceAll("_", " "));
      return { type: "function_call_output" as const, call_id: call.call_id, output: JSON.stringify(result) };
    });
    response = await client.responses.create({ model: "gpt-5.6", reasoning: { effort: "low" }, previous_response_id: response.id, input: outputs, tools });
  }
  throw new Error("The question required more than five data lookups. Please ask a narrower question.");
}
