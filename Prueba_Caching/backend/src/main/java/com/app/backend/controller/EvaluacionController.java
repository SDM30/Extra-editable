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

import com.app.backend.dto.EvaluacionDTO;
import com.app.backend.service.EvaluacionService;


@RestController
@RequestMapping("api/evaluaciones")
public class EvaluacionController {

        @Autowired
        private EvaluacionService evaluacionService;
    
        @PostMapping
        public void createEvaluacion(@RequestBody EvaluacionDTO evaluacionDTO) {
            evaluacionService.createEvaluacion(evaluacionDTO);
        }
    
        @PutMapping
        public void updateEvaluacion(@RequestBody EvaluacionDTO evaluacionDTO) {
            evaluacionService.updateEvaluacion(evaluacionDTO);
        }
    
        @GetMapping("/{id}")
        public EvaluacionDTO getEvaluacion(@PathVariable Long id) {
            return evaluacionService.findEvaluacion(id);
        }
    
        @DeleteMapping("/{id}")
        public void deleteEvaluacion(@PathVariable Long id) {
            evaluacionService.deleteEvaluacion(id);
        }
    
        @GetMapping
        public List<EvaluacionDTO> getEvaluaciones() {
            return evaluacionService.findEvaluaciones();
        }
    
}
