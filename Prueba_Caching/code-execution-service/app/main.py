from fastapi import FastAPI
from pydantic import BaseModel

from app.CodigoFuenteDTO import CodigoFuenteDTO
from app.executor import Ejecutor

server = FastAPI()

class RunRequest(BaseModel):
    contenido: str


@server.post("/run", response_model=CodigoFuenteDTO)
async def run_code(src: RunRequest) -> CodigoFuenteDTO:
    ejecucion = Ejecutor.ejecutarCpp(src.contenido)
    return CodigoFuenteDTO(
        id=None,
        fecha=None,
        contenido=src.contenido,
        resultado=ejecucion.get("resultado", ""),
        tiempo=ejecucion.get("tiempo", ""),
    )
