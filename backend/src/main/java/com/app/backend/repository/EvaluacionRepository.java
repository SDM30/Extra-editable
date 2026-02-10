package com.app.backend.repository;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import com.app.backend.model.Evaluacion;


public interface EvaluacionRepository extends JpaRepository<Evaluacion, Long> {
    List<Evaluacion> findByEjercicioId(Long ejercicioId);

    
}

