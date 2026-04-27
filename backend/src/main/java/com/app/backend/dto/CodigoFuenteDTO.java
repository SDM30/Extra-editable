package com.app.backend.dto;

import java.time.LocalDate;

public class CodigoFuenteDTO {
    private Long id;
    private String contenido;
    private LocalDate fecha;
    private String resultado;
    private String tiempo;

    public CodigoFuenteDTO() {
    }

    public CodigoFuenteDTO(Long id, String contenido, LocalDate fecha, String resultado, String tiempo) {
        this.id = id;
        this.contenido = contenido;
        this.fecha = fecha;
        this.resultado = resultado;
        this.tiempo = tiempo;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getContenido() {
        return contenido;
    }

    public void setContenido(String contenido) {
        this.contenido = contenido;
    }

    public LocalDate getFecha() {
        return fecha;
    }

    public void setFecha(LocalDate fecha) {
        this.fecha = fecha;
    }

    public String getResultado() {
        return resultado;
    }

    public void setResultado(String resultado) {
        this.resultado = resultado;
    }

    public String getTiempo() {
        return tiempo;
    }

    public void setTiempo(String tiempo) {
        this.tiempo = tiempo;
    }
}
