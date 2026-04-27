package com.app.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class CasoPruebaDTO {
    private Long id;
    private String descripcion;
    private String entrada;
    private String salidaEsperada;
    
}

