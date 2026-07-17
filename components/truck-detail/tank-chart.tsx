"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function TankChart({ readings }: { readings: Array<{ recorded_at: string; liters: number }> }) {
  const data = readings.map((reading) => ({ ...reading, label: new Date(reading.recorded_at).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
  return <div className="h-[300px] w-full"><ResponsiveContainer><AreaChart data={data}><defs><linearGradient id="tank" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5}/><stop offset="100%" stopColor="#38bdf8" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#243047" vertical={false}/><XAxis dataKey="label" hide/><YAxis unit=" L" stroke="#94a3b8"/><Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155" }}/><Area type="monotone" dataKey="liters" stroke="#38bdf8" fill="url(#tank)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>;
}
