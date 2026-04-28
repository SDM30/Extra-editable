package com.app.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(excludeName = {
    "org.springframework.cloud.autoconfigure.LifecycleMvcEndpointAutoConfiguration",
    "org.springframework.cloud.autoconfigure.RefreshAutoConfiguration"
})
public class ApiGatewayApplication {
    public static void main(String[] args) {
        SpringApplication.run(ApiGatewayApplication.class, args);
    }
}
