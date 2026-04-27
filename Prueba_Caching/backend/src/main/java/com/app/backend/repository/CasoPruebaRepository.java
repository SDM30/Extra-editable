package com.app.backend.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.app.backend.model.CasoPrueba;

@Repository
public interface CasoPruebaRepository extends JpaRepository<CasoPrueba, Long> {
}
