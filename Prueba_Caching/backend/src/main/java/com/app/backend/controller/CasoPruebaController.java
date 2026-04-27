package com.app.backend.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.app.backend.dto.CasoPruebaDTO;
import com.app.backend.service.CasoPruebaService;

@RestController
@RequestMapping("api/casos-prueba")
public class CasoPruebaController {
    
    @Autowired
    private CasoPruebaService casoPruebaService;

    @PostMapping
    public void createCasoPrueba(@RequestBody CasoPruebaDTO casoPruebaDTO) {
        casoPruebaService.createCasoPrueba(casoPruebaDTO);
    }

    @PutMapping
    public void updateCasoPrueba(@RequestBody CasoPruebaDTO casoPruebaDTO) {
        casoPruebaService.updateCasoPrueba(casoPruebaDTO);
    }

    @GetMapping("/{id}")
    public CasoPruebaDTO getCasoPrueba(@PathVariable Long id) {
        return casoPruebaService.findCasoPrueba(id);
    }

    @DeleteMapping("/{id}")
    public void deleteCasoPrueba(@PathVariable Long id) {
        casoPruebaService.deleteCasoPrueba(id);
    }

    @GetMapping
    public List<CasoPruebaDTO> getCasosPrueba() {
        return casoPruebaService.findCasosPrueba();
    }
}
