# code-execution-service/app/CodigoFuenteDTO.py
from datetime import date
from typing import Optional
from pydantic import BaseModel

class CodigoFuenteDTO(BaseModel):
    contenido: str
    resultado: str = ""
    tiempo: str = ""
    fecha: Optional[date] = None
    id: Optional[int] = None
