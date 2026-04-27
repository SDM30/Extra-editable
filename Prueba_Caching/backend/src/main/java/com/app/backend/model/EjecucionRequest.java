package com.app.backend.model;

import java.io.Serializable;

public class EjecucionRequest implements Serializable {
    private String tareaId;
    private Long userId;
    private String codigo;
    private String lenguaje;

    public EjecucionRequest() {
    }

    public EjecucionRequest(String tareaId, Long userId, String codigo, String lenguaje) {
        this.tareaId = tareaId;
        this.userId = userId;
        this.codigo = codigo;
        this.lenguaje = lenguaje;
    }

    public String getTareaId() {
        return tareaId;
    }

    public void setTareaId(String tareaId) {
        this.tareaId = tareaId;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getCodigo() {
        return codigo;
    }

    public void setCodigo(String codigo) {
        this.codigo = codigo;
    }

    public String getLenguaje() {
        return lenguaje;
    }

    public void setLenguaje(String lenguaje) {
        this.lenguaje = lenguaje;
    }
}

