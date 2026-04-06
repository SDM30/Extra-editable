import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const fallos = new Counter('requests_fallidas');
const exitosas = new Counter('requests_exitosas');
const tasaError = new Rate('tasa_error');

export const options = {
    vus: 50,
    duration: '40s',
};

export default function () {
    const res = http.post('http://localhost:8080/api/evaluacion', JSON.stringify({}), {
        headers: { 'Content-Type': 'application/json' },
    });

    const ok = check(res, { 'status 200': (r) => r.status === 200 });

    if (ok) {
        exitosas.add(1);
        tasaError.add(false);
    } else {
        fallos.add(1);
        tasaError.add(true);
        console.log(`⚠️  Fallo detectado - status: ${res.status} - tiempo: ${Date.now()}`);
    }

    sleep(0.5);
}

export function handleSummary(data) {
    const ok   = data.metrics.requests_exitosas?.values?.count || 0;
    const fail = data.metrics.requests_fallidas?.values?.count || 0;
    const total = ok + fail;
    const tasa  = total ? ((fail / total) * 100).toFixed(2) : '0.00';

    return {
        stdout: `
╔══════════════════════════════════════════════╗
║        RESULTADO HEALTHCHECK / ROLLBACK      ║
╠══════════════════════════════════════════════╣
║  Total requests        : ${String(total).padEnd(18)}║
║  Requests exitosas     : ${String(ok).padEnd(18)}║
║  Requests fallidas     : ${String(fail).padEnd(18)}║
║  Tasa de error         : ${String(tasa + '%').padEnd(18)}║
╚══════════════════════════════════════════════╝

INSTRUCCIONES PARA LA PRUEBA:
  1. Levantar: docker compose up --build
  2. Correr este test: k6 run test.js
  3. Mientras corre, simular fallo en una instancia:
     docker compose stop evaluacion1
     (o cambiar HEALTHY=false en docker-compose.yml y recrear)
  4. Observar cómo la tasa de error cambia según el escenario
`,
    };
}
