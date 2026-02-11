package com.app.backend.service;

import java.time.LocalDate;

import org.modelmapper.ModelMapper;
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

    @Autowired
    private ModelMapper modelMapper;

    public CodigoFuenteDTO ejecutarCodigo(CodigoFuenteDTO dto) {
        // DEBUG: registra el código recibido en la consola del backend
        log.info("Código recibido desde el frontend:\n{}", dto.getContenido());

        // Devolvemos el mismo DTO con algunos campos rellenados
        dto.setFecha(LocalDate.now());
        dto.setResultado("Código recibido correctamente");
        dto.setTiempo("N/A");

        // Persistir para que genere ID y devolver lo que quedó en BD
        CodigoFuente entity = modelMapper.map(dto, CodigoFuente.class);
        entity = repository.save(entity);
        return modelMapper.map(entity, CodigoFuenteDTO.class);
    }

}
