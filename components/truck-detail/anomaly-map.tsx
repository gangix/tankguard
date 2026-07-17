"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, useMap } from "react-leaflet";

type Point = { recorded_at: string; latitude: number; longitude: number; speed_kph: number; ignition_on: number };

function FitTrack({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => { if (points.length) map.fitBounds(points.map((point) => [point.latitude, point.longitude]), { padding: [48, 48], maxZoom: 13 }); }, [map, points]);
  return null;
}

export default function AnomalyMap({ points, occurredAt }: { points: Point[]; occurredAt: string }) {
  const center: [number, number] = points.length ? [points[0].latitude, points[0].longitude] : [40.739, 31.611];
  const path = points.map((point) => [point.latitude, point.longitude] as [number, number]);
  const eventPoint = points.reduce<Point | undefined>((closest, point) => !closest || Math.abs(new Date(point.recorded_at).getTime() - new Date(occurredAt).getTime()) < Math.abs(new Date(closest.recorded_at).getTime() - new Date(occurredAt).getTime()) ? point : closest, undefined);
  return <MapContainer center={center} zoom={11} scrollWheelZoom={false} className="h-[300px] w-full rounded-xl">
    <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <FitTrack points={points} />
    <Polyline positions={path} pathOptions={{ color: "#38bdf8", weight: 4 }} />
    {eventPoint && <CircleMarker center={[eventPoint.latitude, eventPoint.longitude]} radius={10} pathOptions={{ color: "#fb7185", fillColor: "#fb7185", fillOpacity: 0.9, weight: 3 }} />}
  </MapContainer>;
}
