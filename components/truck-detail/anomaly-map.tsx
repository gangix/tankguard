"use client";

import { MapContainer, TileLayer, CircleMarker, Polyline } from "react-leaflet";

type Point = { latitude: number; longitude: number; speed_kph: number; ignition_on: number };

export default function AnomalyMap({ points }: { points: Point[] }) {
  const center: [number, number] = points.length ? [points[0].latitude, points[0].longitude] : [40.739, 31.611];
  const path = points.map((point) => [point.latitude, point.longitude] as [number, number]);
  return <MapContainer center={center} zoom={11} scrollWheelZoom={false} className="h-[300px] w-full rounded-xl">
    <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Polyline positions={path} pathOptions={{ color: "#38bdf8", weight: 4 }} />
    {points.length > 0 && <CircleMarker center={center} radius={10} pathOptions={{ color: "#fb7185", fillColor: "#fb7185", fillOpacity: 0.9 }} />}
  </MapContainer>;
}
