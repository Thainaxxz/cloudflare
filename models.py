from database import SessionLocal, User, init_db
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_first_admin(email: str, name: str, password: str):
    init_db()
    db = SessionLocal()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        print(f"Usuário {email} já existe.")
        db.close()
        return
    user = User(
        email=email,
        name=name,
        hashed_password=hash_password(password),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    print(f"✅ Admin '{email}' criado com sucesso!")
    db.close()


if __name__ == "__main__":
    create_first_admin(
        email="suporte@divinfo.com.br",
        name="Administrador",
        password="P3r3ir@19"
    )