package com.app.backend.controller;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.app.backend.service.ProductorService;

@RestController
@RequestMapping("/api/codigo")
@CrossOrigin(origins = "*")
public class EjecucionController {

    private static final Logger log = LoggerFactory.getLogger(EjecucionController.class);

    private final ProductorService productorService;

    public EjecucionController(ProductorService productorService) {
        this.productorService = productorService;
    }

    /**
     * Recibe la petición de ejecución, la encola y responde
     * inmediatamente con 202 Aceptado + tareaId.
     * El frontend usa el tareaId para identificar el resultado
     * cuando llegue por WebSocket.
     */
    @PostMapping("/ejecutar")
    public ResponseEntity<Map<String, String>> ejecutar(
            @RequestParam Long userId,
            @RequestParam String codigo,
            @RequestParam(defaultValue = "cpp") String lenguaje) {

        log.info("[API-COLA] Nueva solicitud userId={} lenguaje={}", userId, lenguaje);

        Map<String, String> encolado = productorService.encolarEjecucion(userId, codigo, lenguaje);
        String tareaId = encolado.get("tareaId");
        String posicionEstimada = encolado.getOrDefault("posicionEstimada", "N/A");

        return ResponseEntity.accepted().body(Map.of(
                "tareaId", tareaId,
                "estado", "encolado",
            "posicionEstimada", posicionEstimada,
            "mensaje", "Tu codigo esta en la cola, posicion aproximada " + posicionEstimada
        ));
    }
}
