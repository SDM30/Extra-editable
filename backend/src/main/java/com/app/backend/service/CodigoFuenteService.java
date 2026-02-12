package com.app.backend.service;

import java.time.LocalDateTime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.app.backend.dto.CodigoFuenteDTO;
import com.app.backend.model.CodigoFuente;
import com.app.backend.repository.CodigoFuenteRepository;

@Service
public class CodigoFuenteService {

    private static final Logger log = LoggerFactory.getLogger(CodigoFuenteService.class);
    
    @Autowired
    private CodigoFuenteRepository repository;

    public CodigoFuenteDTO ejecutarCodigo(CodigoFuenteDTO dto) {
        // DEBUG: registra el código recibido en la consola del backend
        log.info("Código recibido desde el frontend:\n{}", dto.getContenido());

        // Construir entidad manualmente para evitar ambigüedad de mapeo
        CodigoFuente entity = new CodigoFuente();
        entity.setContenido(dto.getContenido());
        entity.setFechaCreacion(LocalDateTime.now());
        entity.setResultadoDeCompilacion("Código recibido correctamente");
        entity.setResultadoDePrueba(dto.getResultado()); // opcional
        entity.setTiempoEjecucion(null);

        // Persistir y devolver DTO con el ID generado
        entity = repository.save(entity);

        dto.setId(entity.getId());
        dto.setFecha(entity.getFechaCreacion().toLocalDate());
        dto.setResultado(entity.getResultadoDeCompilacion());
        dto.setTiempo(entity.getTiempoEjecucion() == null ? "N/A" : entity.getTiempoEjecucion().toString());
        return dto;
    }

}
