package com.app.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.app.backend.model.Pista;

@Repository
public interface PistaRepository extends JpaRepository<Pista, Long> {

    List<Pista> findByCursoIdOrderByOrden(Long cursoId);
}