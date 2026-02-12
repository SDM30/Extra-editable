package com.app.backend.model;


import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import lombok.AllArgsConstructor;
import lombok.Data;

@Entity
@Data
@AllArgsConstructor
public class CasoPrueba {
    @Id
    @GeneratedValue
    private Long id;
    private String descripcion;
    private String entrada;
    private String salidaEsperada;

    @ManyToOne
    private Evaluacion evaluacion;
}
