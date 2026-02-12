package com.app.backend.service;

import java.time.LocalDateTime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import com.app.backend.dto.CodigoFuenteDTO;
import com.app.backend.dto.ExecutionRequestDTO;
import com.app.backend.dto.ExecutionResponseDTO;
import com.app.backend.model.CodigoFuente;
import com.app.backend.repository.CodigoFuenteRepository;

@Service
public class CodigoFuenteService {

    private static final Logger log = LoggerFactory.getLogger(CodigoFuenteService.class);
    private static final String RUNNER_URL = "http://localhost:8000/run";
    private static final int LEGACY_DB_SAFE_LENGTH = 255;

    @Autowired
    private CodigoFuenteRepository repository;

    public CodigoFuenteDTO ejecutarCodigo(CodigoFuenteDTO dto) {
        log.info("Código recibido desde el frontend:\n{}", dto.getContenido());

        CodigoFuenteDTO runnerRequest = new CodigoFuenteDTO();
        runnerRequest.setContenido(dto.getContenido());

        CodigoFuenteDTO runnerResponse = null;
        try {
            runnerResponse = new RestTemplate().postForObject(RUNNER_URL, runnerRequest, CodigoFuenteDTO.class);
        } catch (RestClientException ex) {
            log.error("Error al invocar runner en {}", RUNNER_URL, ex);
        }

        String resultado = runnerResponse != null ? runnerResponse.getResultado() : "No se pudo ejecutar en el runner";
        String tiempo = runnerResponse != null ? runnerResponse.getTiempo() : null;

        CodigoFuente entity = new CodigoFuente();
        entity.setContenido(dto.getContenido());
        entity.setFechaCreacion(LocalDateTime.now());
        entity.setResultadoDeCompilacion(resultado);
        entity.setResultadoDePrueba(resultado);
        entity.setTiempoEjecucion(parseTiempo(tiempo));

        dto.setId(entity.getId());
        dto.setFecha(entity.getFechaCreacion().toLocalDate());
        dto.setResultado(resultado);
        dto.setTiempo(entity.getTiempoEjecucion() == null ? "N/A" : entity.getTiempoEjecucion().toString());
        return dto;
    }

    private Long parseTiempo(String tiempo) {
        if (tiempo == null || tiempo.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(tiempo.trim());
        } catch (NumberFormatException ex) {
            log.warn("No se pudo parsear el tiempo '{}' devuelto por el runner", tiempo);
            return null;
        }
    }
}
