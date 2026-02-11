package com.app.backend.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Ejercicio {
    @Id
    private long id;
    private String enunciado;
    private String tema;

    // Dejar sin relaciones por el momento
}
