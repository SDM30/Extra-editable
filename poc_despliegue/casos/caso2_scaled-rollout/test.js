import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter } from 'k6/metrics';

// Contadores por versión para verificar la distribución 90/10
const hitEstable = new Counter('hits_version_estable');
const hitCanario = new Counter('hits_version_canario');

export const options = {
    vus: 100,          // usuarios concurrentes
    duration: '30s',   // duración de la prueba
};

export default function () {
    const res = http.post('http://localhost:8080/api/evaluacion', JSON.stringify({}), {
        headers: { 'Content-Type': 'application/json' },
    });

    check(res, { 'status 200': (r) => r.status === 200 });

    // Identificar a qué instancia fue la request por la version en la respuesta
    if (res.status === 200) {
        const body = JSON.parse(res.body);
        if (body.version === 'v1-estable') hitEstable.add(1);
        if (body.version === 'v2-canario') hitCanario.add(1);
    }

    sleep(1);
}

export function handleSummary(data) {
    const estable = data.metrics.hits_version_estable?.values?.count || 0;
    const canario = data.metrics.hits_version_canario?.values?.count || 0;
    const total = estable + canario;

    return {
        stdout: `
╔══════════════════════════════════════════════╗
║         RESULTADO SCALED ROLLOUT (90/10)     ║
╠══════════════════════════════════════════════╣
║  Total requests        : ${String(total).padEnd(18)}║
║  Hits versión estable  : ${String(estable).padEnd(18)}║
║  Hits versión canario  : ${String(canario).padEnd(18)}║
║  % tráfico estable     : ${String(total ? ((estable/total)*100).toFixed(1)+'%' : 'N/A').padEnd(18)}║
║  % tráfico canario     : ${String(total ? ((canario/total)*100).toFixed(1)+'%' : 'N/A').padEnd(18)}║
╚══════════════════════════════════════════════╝
`,
    };
}
