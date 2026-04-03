const express = require('express');
const app = express();

const PORT = process.env.PORT || 8081;

app.use(express.json());

app.post('/api/evaluacion', async (req, res) => {
    
    await new Promise(r => setTimeout(r, 300)); // Simula una operación que tarda 100ms
    setTimeout(() => {
        res.json({
            status: 'ok',
            puerto: PORT
        });
    }, 100);
});

app.listen(PORT, () => {
    console.log(`Servicio corriendo en puerto ${PORT}`);
});