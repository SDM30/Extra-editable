package com.app.backend.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.app.backend.dto.CodigoFuenteDTO;
import com.app.backend.service.CodigoFuenteService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "http://localhost:4200")
@RequiredArgsConstructor
public class CodigoFuenteController {

    @Autowired
    private CodigoFuenteService service;

    // Envia el código del frontend al backend
    // TODO: MANDAR AL DOCKER
    @PostMapping("/ejecutar")
    public CodigoFuenteDTO ejecutarCodigo(@RequestBody CodigoFuenteDTO body) {
        return service.ejecutarCodigo(body);
    }
}
