const express = require('express');
const app = express();

const PORT = process.env.PORT || 8081;
const VERSION = process.env.VERSION || 'v1';
const HEALTHY = process.env.HEALTHY !== 'false'; // Cambiar a 'false' para simular fallo en caso 3

app.use(express.json());

// ─── Caso 1 y 2: endpoint principal ───────────────────────────────────────────
app.post('/api/evaluacion', async (req, res) => {
    await new Promise(r => setTimeout(r, 300)); // Simula operación de 300ms
    setTimeout(() => {
        res.json({
            status: 'ok',
            puerto: PORT,
            version: VERSION
        });
    }, 100);
});

// ─── Caso 3: endpoint de health check ─────────────────────────────────────────
app.get('/health', (req, res) => {
    if (HEALTHY) {
        res.status(200).json({ status: 'UP', puerto: PORT, version: VERSION });
    } else {
        res.status(500).json({ status: 'DOWN', puerto: PORT, version: VERSION });
    }
});

app.listen(PORT, () => {
    console.log(`Servicio corriendo en puerto ${PORT} | version=${VERSION} | healthy=${HEALTHY}`);
});