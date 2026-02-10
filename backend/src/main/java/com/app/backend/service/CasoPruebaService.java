package com.app.backend.service;


import java.util.List;

import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.app.backend.model.CasoPrueba;
import com.app.backend.repository.CasoPruebaRepository;

import ch.qos.logback.core.model.Model;;

@Service
public class CasoPruebaService {

    @Autowired
    private CasoPruebaRepository casoPruebaRepository;

    @Autowired
    private EvaluacionService evaluacionService;

    @Autowired
    private ModelMapper modelMapper;

    

    
}
