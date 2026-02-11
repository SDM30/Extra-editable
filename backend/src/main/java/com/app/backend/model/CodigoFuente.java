package com.app.backend.model;

import java.time.LocalDateTime;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Entity;
import lombok.AllArgsConstructor;
import lombok.Data;

@Entity
@Data
@AllArgsConstructor
public class CodigoFuente {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String contenido;
    private LocalDateTime fechaCreacion;
    private String resultadoDeCompilacion;
    private String resultadoDePrueba;
    private Long tiempoEjecucion;
}