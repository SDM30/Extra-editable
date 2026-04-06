package com.app.backend.model;

import java.time.LocalDateTime;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;

@Entity
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

    public CodigoFuente() {
    }

    public CodigoFuente(Long id, String contenido, LocalDateTime fechaCreacion, String resultadoDeCompilacion,
            String resultadoDePrueba, Long tiempoEjecucion) {
        this.id = id;
        this.contenido = contenido;
        this.fechaCreacion = fechaCreacion;
        this.resultadoDeCompilacion = resultadoDeCompilacion;
        this.resultadoDePrueba = resultadoDePrueba;
        this.tiempoEjecucion = tiempoEjecucion;
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

    public LocalDateTime getFechaCreacion() {
        return fechaCreacion;
    }

    public void setFechaCreacion(LocalDateTime fechaCreacion) {
        this.fechaCreacion = fechaCreacion;
    }

    public String getResultadoDeCompilacion() {
        return resultadoDeCompilacion;
    }

    public void setResultadoDeCompilacion(String resultadoDeCompilacion) {
        this.resultadoDeCompilacion = resultadoDeCompilacion;
    }

    public String getResultadoDePrueba() {
        return resultadoDePrueba;
    }

    public void setResultadoDePrueba(String resultadoDePrueba) {
        this.resultadoDePrueba = resultadoDePrueba;
    }

    public Long getTiempoEjecucion() {
        return tiempoEjecucion;
    }

    public void setTiempoEjecucion(Long tiempoEjecucion) {
        this.tiempoEjecucion = tiempoEjecucion;
    }
}
