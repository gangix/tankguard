"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { DashboardTruck } from "@/lib/dashboard/queries";

function Bounds({ trucks }: { trucks: DashboardTruck[] }) {
  const map = useMap();
  useEffect(() => { if (trucks.length) map.fitBounds(trucks.map((truck) => [truck.latitude, truck.longitude]), { padding: [36, 36], maxZoom: 7 }); }, [map, trucks]);
  return null;
}

export default function FleetMap({ trucks }: { trucks: DashboardTruck[] }) {
  return <MapContainer center={[40.5, 30.5]} zoom={6} scrollWheelZoom={false} className="h-full w-full rounded-2xl">
    <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Bounds trucks={trucks} />
    {trucks.map((truck) => <CircleMarker key={truck.id} center={[truck.latitude, truck.longitude]} radius={truck.anomalies.length ? 11 : 8} pathOptions={{ color: truck.anomalies.length ? "#fb7185" : "#38bdf8", fillColor: truck.anomalies.length ? "#fb7185" : "#38bdf8", fillOpacity: 0.9, weight: truck.anomalies.length ? 4 : 2 }}><Tooltip><strong>{truck.plate}</strong><br />{truck.anomalies.length ? truck.anomalies.map((event) => event.display_name).join(", ") : "No detected events"}</Tooltip></CircleMarker>)}
  </MapContainer>;
}
