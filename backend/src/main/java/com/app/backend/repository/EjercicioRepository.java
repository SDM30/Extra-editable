package com.app.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import com.app.backend.model.Ejercicio;


public interface EjercicioRepository extends JpaRepository<Ejercicio, Long> {

    List<Ejercicio> findByEjercicioId(Long ejercicioId);

}