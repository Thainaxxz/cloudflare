import os
from typing import Optional
from datetime import timedelta

from fastapi import FastAPI, Request, HTTPException, Depends, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from services import CloudflareService
from database import get_db, init_db, AuditLog, User
from auth import (
    verify_password,
    create_access_token,
    get_current_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)

load_dotenv()

app = FastAPI(title="DNS Manager", version="2.0.0")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ─── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Cria as tabelas no banco se ainda não existirem."""
    init_db()


# ─── Helpers ───────────────────────────────────────────────────────────────────

def get_cf_service() -> CloudflareService:
    token = os.getenv("CLOUDFLARE_API_TOKEN", "")
    zone_id = os.getenv("CLOUDFLARE_ZONE_ID", "")
    if not token or not zone_id:
        raise HTTPException(
            status_code=503,
            detail="CLOUDFLARE_API_TOKEN e CLOUDFLARE_ZONE_ID não configurados no .env",
        )
    return CloudflareService(token, zone_id)


def save_audit(db: Session, user_email: str, action: str,
               record_type: str = None, record_name: str = None, detail: str = None):
    """Salva uma entrada no log de auditoria."""
    log = AuditLog(
        user_email=user_email,
        action=action,
        record_type=record_type,
        record_name=record_name,
        detail=detail,
    )
    db.add(log)
    db.commit()


# ─── Pydantic Models ───────────────────────────────────────────────────────────

class RecordCreate(BaseModel):
    type: str
    name: str
    content: str
    ttl: int = 1
    proxied: bool = False
    priority: Optional[int] = None


# ─── Páginas (Frontend) ────────────────────────────────────────────────────────

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Exibe a tela de login."""
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/", response_class=HTMLResponse)
async def index(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Painel principal — requer autenticação."""
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "user_name": current_user.name, "user_email": current_user.email},
    )


# ─── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/login")
async def do_login(
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    """Valida credenciais e emite cookie JWT."""
    user = db.query(User).filter(User.email == email).first()

    if not user or not verify_password(password, user.hashed_password):
        # Retorna para /login com mensagem de erro
        return templates.TemplateResponse(
            "login.html",
            {"request": {}, "error": "E-mail ou senha inválidos."},
            status_code=401,
        )

    if not user.is_active:
        return templates.TemplateResponse(
            "login.html",
            {"request": {}, "error": "Usuário desativado. Contate o administrador."},
            status_code=403,
        )

    token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,      # JavaScript não consegue ler — mais seguro
        samesite="lax",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    return response


@app.post("/logout")
async def logout():
    """Remove o cookie de sessão e redireciona para o login."""
    response = RedirectResponse(url="/login", status_code=302)
    response.delete_cookie("access_token")
    return response


# ─── API: Status ───────────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status(
    current_user: User = Depends(get_current_user),
):
    """Verifica se o token e o zone_id do Cloudflare são válidos."""
    cf = get_cf_service()
    token_check = await cf.verify_token()
    zone_check = await cf.get_zone_info()
    zone_name = None
    if zone_check.get("success"):
        zone_name = zone_check["result"].get("name")
    return {
        "token_valid": token_check.get("success", False),
        "zone_valid": zone_check.get("success", False),
        "zone_name": zone_name,
    }


# ─── API: Registros DNS ────────────────────────────────────────────────────────

@app.get("/api/records")
async def list_records(
    type: Optional[str] = None,
    name: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    cf = get_cf_service()
    result = await cf.list_records(record_type=type, name=name)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("errors", "Erro ao listar registros"))
    return {"records": result["result"], "total": len(result["result"])}


@app.post("/api/records", status_code=201)
async def create_record(
    record: RecordCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cf = get_cf_service()
    result = await cf.create_record(
        record_type=record.type,
        name=record.name,
        content=record.content,
        ttl=record.ttl,
        proxied=record.proxied,
        priority=record.priority,
    )
    if not result.get("success"):
        errors = result.get("errors", [])
        msg = errors[0].get("message", "Erro ao criar registro") if errors else "Erro desconhecido"
        raise HTTPException(status_code=400, detail=msg)

    save_audit(
        db,
        user_email=current_user.email,
        action="CREATE",
        record_type=record.type,
        record_name=record.name,
        detail=f"content={record.content} ttl={record.ttl} proxied={record.proxied}",
    )
    return {"record": result["result"]}


@app.put("/api/records/{record_id}")
async def update_record(
    record_id: str,
    record: RecordCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cf = get_cf_service()
    result = await cf.update_record(
        record_id=record_id,
        record_type=record.type,
        name=record.name,
        content=record.content,
        ttl=record.ttl,
        proxied=record.proxied,
        priority=record.priority,
    )
    if not result.get("success"):
        errors = result.get("errors", [])
        msg = errors[0].get("message", "Erro ao atualizar registro") if errors else "Erro desconhecido"
        raise HTTPException(status_code=400, detail=msg)

    save_audit(
        db,
        user_email=current_user.email,
        action="UPDATE",
        record_type=record.type,
        record_name=record.name,
        detail=f"id={record_id} content={record.content} ttl={record.ttl} proxied={record.proxied}",
    )
    return {"record": result["result"]}


@app.delete("/api/records/{record_id}")
async def delete_record(
    record_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cf = get_cf_service()
    result = await cf.delete_record(record_id)
    if not result.get("success"):
        errors = result.get("errors", [])
        msg = errors[0].get("message", "Erro ao deletar registro") if errors else "Erro desconhecido"
        raise HTTPException(status_code=400, detail=msg)

    save_audit(
        db,
        user_email=current_user.email,
        action="DELETE",
        record_name=record_id,
        detail=f"record_id={record_id}",
    )
    return {"deleted": record_id}


# ─── API: Auditoria ────────────────────────────────────────────────────────────

@app.get("/api/audit")
async def list_audit_logs(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retorna os últimos registros de auditoria. Apenas admins."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")
    logs = (
        db.query(AuditLog)
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .all()
    )
    return {
        "logs": [
            {
                "id": log.id,
                "user_email": log.user_email,
                "action": log.action,
                "record_type": log.record_type,
                "record_name": log.record_name,
                "detail": log.detail,
                "timestamp": log.timestamp.isoformat(),
            }
            for log in logs
        ]
    }


# ─── API: Usuários (admin) ─────────────────────────────────────────────────────

@app.get("/api/users")
async def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista todos os usuários. Apenas admins."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")
    users = db.query(User).all()
    return {
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "is_active": u.is_active,
                "is_admin": u.is_admin,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ]
    }


# ─── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)