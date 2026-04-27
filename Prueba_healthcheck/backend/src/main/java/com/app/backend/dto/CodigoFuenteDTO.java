package com.app.backend.dto;

import java.time.LocalDate;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class CodigoFuenteDTO {
    private Long id;
    private String contenido;
    private LocalDate fecha;
    private String resultado;
    private String tiempo;
}
