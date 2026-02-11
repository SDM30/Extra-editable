package com.app.backend.service;

import java.util.List;

import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.app.backend.dto.EvaluacionDTO;
import com.app.backend.model.Evaluacion;

import com.app.backend.repository.EvaluacionRepository;


@Service
public class EvaluacionService {
    @Autowired
    private EvaluacionRepository evaluacionRepository;

    @Autowired
    private ModelMapper modelMapper;

    public EvaluacionDTO createEvaluacion(EvaluacionDTO evaluacionDTO) {
        Evaluacion evaluacion = modelMapper.map(evaluacionDTO, Evaluacion.class);
        evaluacion = evaluacionRepository.save(evaluacion);
        return modelMapper.map(evaluacion, EvaluacionDTO.class);
    }

    public EvaluacionDTO updateEvaluacion(EvaluacionDTO evaluacionDTO) {
        Evaluacion evaluacion = modelMapper.map(evaluacionDTO, Evaluacion.class);
        evaluacion = evaluacionRepository.save(evaluacion);
        return modelMapper.map(evaluacion, EvaluacionDTO.class);
    }

    public EvaluacionDTO findEvaluacion(Long id) {
        Evaluacion evaluacion = evaluacionRepository.findById(id).orElseThrow(() -> new RuntimeException("Evaluacion no encontrado"));
        return modelMapper.map(evaluacion, EvaluacionDTO.class);
    }
    
    public void deleteEvaluacion(Long id) {
        evaluacionRepository.deleteById(id);
    }

    public List<EvaluacionDTO> findEvaluaciones(){
        List<Evaluacion> evaluaciones = evaluacionRepository.findAll();
        return evaluaciones.stream()
                .map(evaluacion -> modelMapper.map(evaluacion, EvaluacionDTO.class))
                .toList();
    }
}
