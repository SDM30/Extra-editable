package com.app.backend.service;

import java.util.List;

import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.app.backend.repository.CasoPruebaRepository;
import com.app.backend.dto.CasoPruebaDTO;
import com.app.backend.model.CasoPrueba;
   
@Service
public class CasoPruebaService {

    @Autowired
    private CasoPruebaRepository casoPruebaRepository;

    @Autowired
    private ModelMapper modelMapper;

    public CasoPruebaDTO createCasoPrueba(CasoPruebaDTO casoPruebaDTO) {
        CasoPrueba casoPrueba = modelMapper.map(casoPruebaDTO, CasoPrueba.class);
        casoPrueba = casoPruebaRepository.save(casoPrueba);
        return modelMapper.map(casoPrueba, CasoPruebaDTO.class);
    }

    public CasoPruebaDTO updateCasoPrueba(CasoPruebaDTO casoPruebaDTO) {
        CasoPrueba casoPrueba = modelMapper.map(casoPruebaDTO, CasoPrueba.class);
        casoPrueba = casoPruebaRepository.save(casoPrueba);
        return modelMapper.map(casoPrueba, CasoPruebaDTO.class);
    }

    public CasoPruebaDTO findCasoPrueba(Long id) {
        CasoPrueba casoPrueba = casoPruebaRepository.findById(id).orElseThrow(() -> new RuntimeException("CasoPrueba no encontrado"));
        return modelMapper.map(casoPrueba, CasoPruebaDTO.class);
    }

    public void deleteCasoPrueba(Long id) {
        casoPruebaRepository.deleteById(id);
    }

    public List<CasoPruebaDTO> findCasosPrueba(){
        List<CasoPrueba> casosPrueba = casoPruebaRepository.findAll();
        return casosPrueba.stream()
                .map(casoPrueba -> modelMapper.map(casoPrueba, CasoPruebaDTO.class))
                .toList();
    }
}
