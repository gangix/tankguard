import { runDetection } from "../lib/detection";

const anomalies = runDetection();
console.log(`Detected ${anomalies.length} anomaly candidate(s).`);
anomalies.forEach((anomaly) => console.log(`${anomaly.truckId} | ${anomaly.displayName} | ${anomaly.occurredAt}`));
