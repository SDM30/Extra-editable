package com.app.backend.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import lombok.AllArgsConstructor;
import lombok.Data;

@Entity
@Data
@AllArgsConstructor
public class Evaluacion {

    @Id
    @GeneratedValue
    private Long id;
    private Long puntuacion;
    private String descripcion;

    // Dejar sin relaciones por el momento
}
