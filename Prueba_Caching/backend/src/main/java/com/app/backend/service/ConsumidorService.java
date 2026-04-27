package com.app.backend.service;

import com.app.backend.config.ColaConfig;
import com.app.backend.model.EjecucionRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Service;

@Service
public class ConsumidorService {

    private static final Logger log = LoggerFactory.getLogger(ConsumidorService.class);

    // Escucha la cola y procesa cada tarea de ejecucion.
    @RabbitListener(queues = ColaConfig.COLA_EJECUCION)
    public void procesarEjecucion(EjecucionRequest request) {
        log.info("[CONSUMIDOR] Procesando tarea - tareaId={} userId={} lenguaje={}",
                request.getTareaId(), request.getUserId(), request.getLenguaje());

        // Simula el tiempo de compilación y ejecución del EEC
        try {
            Thread.sleep(500);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        log.info("[CONSUMIDOR] Tarea completada - tareaId={} resultado=OK",
                request.getTareaId());
    }
}
