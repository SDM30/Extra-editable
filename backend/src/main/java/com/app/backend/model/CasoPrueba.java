package com.app.backend.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import lombok.AllArgsConstructor;
import lombok.Data;

@Entity
@Data
@AllArgsConstructor
public class CasoPrueba {

    @Id
    private Long id;
    private String desc;
    private String entrada;
    private String salida;

    // Dejar sin relaciones por el momento
}
