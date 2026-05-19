import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, Cookie, Request, HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import get_db, User

SECRET_KEY = os.getenv("SECRET_KEY", "mude-isso-no-env")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 horas


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    request: Request,
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
):
    """
    Valida o cookie JWT e retorna o usuário autenticado.
    Se o token estiver ausente ou inválido, redireciona para /login.
    """
    def redirect_to_login():
        raise HTTPException(
            status_code=302,
            headers={"Location": "/login"},
            detail="Não autenticado",
        )

    if not access_token:
        redirect_to_login()

    try:
        payload = jwt.decode(access_token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if not email:
            redirect_to_login()
    except JWTError:
        redirect_to_login()

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        redirect_to_login()

    return user