package com.app.backend.model;

import java.time.LocalDateTime;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Entity;
import jakarta.persistence.Lob;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor
public class CodigoFuente {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    // Lob: Permitir contenido largo
    @Lob
    private String contenido;
    private LocalDateTime fechaCreacion;
    @Lob
    private String resultadoDeCompilacion;
    @Lob
    private String resultadoDePrueba;
    private Long tiempoEjecucion;
}
