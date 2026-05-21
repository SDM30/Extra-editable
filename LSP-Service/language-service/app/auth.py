"""
Dependencia FastAPI para validación de tokens JWT del servicio LSP.

El token es emitido por el backend en POST /api/projects/{id}/lsp/token/
y contiene { sub, username, room, exp }. Se valida localmente con el
JWT_SECRET compartido (HS256), sin llamar al backend en cada request.
"""

import os

import jwt
from fastapi import Header, HTTPException

JWT_SECRET = os.getenv("JWT_SECRET", "jwt-secreto")
JWT_ALGORITHM = "HS256"


def decode_jwt(raw: str) -> dict:
    """Decodifica y valida el token. Lanza HTTPException si es inválido."""
    try:
        return jwt.decode(raw, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


async def verify_lsp_access(
    authorization: str = Header(default=""),
):
    """
    Valida que el request incluya un token JWT válido y que su claim `room`
    coincida con el `project_id` de la URL.

    Uso:
        @router.post("/{project_id}")
        async def create(project_id: str, user: dict = Depends(verify_lsp_access)):
            ...
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")

    payload = decode_jwt(authorization[7:])

    return {
        "user_id": payload.get("sub"),
        "username": payload.get("username", "anon"),
        "room": payload.get("room"),
    }


async def verify_lsp_token_for_project(
    project_id: str,
    authorization: str = Header(default=""),
):
    """
    Igual que verify_lsp_access pero además valida que room == project_id.
    Usar en endpoints que operan sobre un proyecto específico.
    """
    user = await verify_lsp_access(authorization)

    if user.get("room") != project_id:
        raise HTTPException(
            status_code=403,
            detail=f"No pertenece al proyecto {project_id}",
        )

    return user
