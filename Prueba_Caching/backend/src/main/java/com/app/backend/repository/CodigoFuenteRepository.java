package com.app.backend.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.app.backend.model.CodigoFuente;

@Repository
public interface CodigoFuenteRepository extends JpaRepository<CodigoFuente, Long> {
}
