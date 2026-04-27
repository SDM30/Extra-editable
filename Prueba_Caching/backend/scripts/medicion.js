/**
 * Script k6 para medir latencia con y sin cache.
 *
 * Uso:
 *   k6 run backend/scripts/medicion.js
 */

import http from "k6/http";
import { sleep, check } from "k6";
import { Trend, Counter } from "k6/metrics";

const latenciaSinCache = new Trend("latencia_sin_cache", true);
const latenciaConCache = new Trend("latencia_con_cache", true);
const requestsSinCache = new Counter("requests_sin_cache");
const requestsConCache = new Counter("requests_con_cache");

export const options = {
    scenarios: {
        sin_cache: {
            executor: "constant-vus",
            vus: 100,
            duration: "15s",
            env: { ESCENARIO: "sin-cache" },
        },
        con_cache: {
            executor: "constant-vus",
            vus: 100,
            duration: "15s",
            startTime: "20s",
            env: { ESCENARIO: "con-cache" },
        },
    },
    thresholds: {
        latencia_con_cache: ["p(95)<20"],
    },
};

const BASE_URL = "http://localhost:8080";
const CURSO_ID = 1;

export default function () {
    const escenario = __ENV.ESCENARIO;
    const url = `${BASE_URL}/api/pistas/${escenario}/${CURSO_ID}`;

    const res = http.get(url);

    check(res, { "status 200": (r) => r.status === 200 });

    if (escenario === "sin-cache") {
        latenciaSinCache.add(res.timings.duration);
        requestsSinCache.add(1);
    } else {
        latenciaConCache.add(res.timings.duration);
        requestsConCache.add(1);
    }

    sleep(0.1);
}

export function handleSummary(data) {
    const sc = data.metrics.latencia_sin_cache;
    const cc = data.metrics.latencia_con_cache;

    const resumen = `
RESULTADOS - PoC Caching vs Sin Caching

Latencia promedio:
- Sin cache: ${sc?.values?.avg?.toFixed(2)} ms
- Con cache: ${cc?.values?.avg?.toFixed(2)} ms

Latencia p95:
- Sin cache: ${sc?.values?.["p(95)"]?.toFixed(2)} ms
- Con cache: ${cc?.values?.["p(95)"]?.toFixed(2)} ms

Latencia p99:
- Sin cache: ${sc?.values?.["p(99)"]?.toFixed(2)} ms
- Con cache: ${cc?.values?.["p(99)"]?.toFixed(2)} ms

Requests totales:
- Sin cache: ${data.metrics.requests_sin_cache?.values?.count}
- Con cache: ${data.metrics.requests_con_cache?.values?.count}
`;

    console.log(resumen);
    return { "resumen_caching.txt": resumen };
}
