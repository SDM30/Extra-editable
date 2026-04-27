package com.app.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ExecutionResponseDTO {
    private String status;       
    private String output;       
    private String errorMessage; 
    private Long executionTime;
}
