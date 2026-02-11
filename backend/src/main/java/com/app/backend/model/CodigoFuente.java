package com.app.backend.model;

import java.time.LocalDate;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Data
@NoArgsConstructor
@AllArgsConstructor
public class CodigoFuente {

    @Id
    private long id;
    private String contenido;
    private LocalDate fecha;
    private String resultado;
    private String tiempo;

    // Dejar sin relaciones por el momento
}
