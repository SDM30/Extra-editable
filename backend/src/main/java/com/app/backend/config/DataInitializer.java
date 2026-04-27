package com.app.backend.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import com.app.backend.model.Pista;
import com.app.backend.repository.PistaRepository;

@Component
public class DataInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private final PistaRepository pistaRepository;

    public DataInitializer(PistaRepository pistaRepository) {
        this.pistaRepository = pistaRepository;
    }

    @Override
    public void run(String... args) {
        if (pistaRepository.count() == 0) {
            // Curso 1 - 5 pistas de ejemplo
            for (int i = 1; i <= 5; i++) {
                Pista pista = new Pista();
                pista.setCursoId(1L);
                pista.setContenido("Pista " + i + ": Revisa el uso del bucle for en el ejercicio.");
                pista.setOrden(i);
                pistaRepository.save(pista);
            }
            log.info("Datos de prueba insertados: 5 pistas para cursoId=1");
        }
    }
}