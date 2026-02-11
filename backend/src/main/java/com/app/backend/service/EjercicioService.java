package com.app.backend.service;

import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.app.backend.repository.EjercicioRepository;

@Service
public class EjercicioService {
    @Autowired
    private EjercicioRepository ejercicioRepository;
    @Autowired
    private ModelMapper modelMapper;
}