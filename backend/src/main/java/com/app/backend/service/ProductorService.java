package com.app.backend.service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;

import com.app.backend.config.ColaConfig;
import com.app.backend.model.EjecucionRequest;
import com.rabbitmq.client.AMQP;

@Service
public class ProductorService {

    private static final Logger log = LoggerFactory.getLogger(ProductorService.class);

    private final RabbitTemplate rabbitTemplate;

    public ProductorService(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    /**
     * Encola una tarea de ejecución de código.
     * El backend responde inmediatamente con el tareaId
     * sin esperar que el EEC procese el código.
     */
    public Map<String, String> encolarEjecucion(Long userId, String codigo, String lenguaje) {
        String tareaId = UUID.randomUUID().toString();
        Integer posicionEstimada = estimarPosicion();

        EjecucionRequest request = new EjecucionRequest(tareaId, userId, codigo, lenguaje);

        rabbitTemplate.convertAndSend(
                ColaConfig.EXCHANGE,
                ColaConfig.ROUTING_KEY,
                request
        );

        log.info("[PRODUCTOR] Tarea encolada - tareaId={} userId={} posicionEstimada={}",
                tareaId, userId, posicionEstimada);

        Map<String, String> respuesta = new HashMap<>();
        respuesta.put("tareaId", tareaId);
        respuesta.put("posicionEstimada", posicionEstimada == null ? "N/A" : String.valueOf(posicionEstimada));
        return respuesta;
    }

    private Integer estimarPosicion() {
        try {
            return rabbitTemplate.execute(channel -> {
                AMQP.Queue.DeclareOk estadoCola = channel.queueDeclarePassive(ColaConfig.COLA_EJECUCION);
                return (int) estadoCola.getMessageCount() + 1;
            });
        } catch (AmqpException ex) {
            log.warn("[PRODUCTOR] No fue posible estimar posicion en cola", ex);
            return null;
        }
    }
}
