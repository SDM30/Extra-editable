package com.app.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import com.app.backend.model.CasoPrueba;;

public interface CasoPruebaRepository extends JpaRepository<CasoPrueba, Long> {
    List<CasoPrueba> findByEjercicioId(Long ejercicioId);

    
}
