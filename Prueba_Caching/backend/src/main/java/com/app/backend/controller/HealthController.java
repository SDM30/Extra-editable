package com.app.backend.controller;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "http://localhost:4200")
public class HealthController {

    private static final long START_TIME = ManagementFactory.getRuntimeMXBean().getStartTime();

    @GetMapping("/health")
    public Map<String, Object> health() {
        long uptimeSeconds = (System.currentTimeMillis() - START_TIME) / 1000;
        return Map.of(
            "status", "ok",
            "service", "backend",
            "uptime_seconds", uptimeSeconds
        );
    }
}