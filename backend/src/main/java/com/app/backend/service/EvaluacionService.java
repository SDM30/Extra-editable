package com.app.backend.service;

import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.app.backend.repository.EvaluacionRepository;


@Service
public class EvaluacionService {
    @Autowired
    private EvaluacionRepository evaluacionRepository;

    @Autowired
    private CodigoFuenteService codigoFuenteService;

    @Autowired
    private ModelMapper modelMapper;

    
    
}
