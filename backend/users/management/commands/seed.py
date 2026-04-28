from django.core.management.base import BaseCommand
from users.models import User

USUARIOS_INICIALES = [
    {
        'username': 'admin1',
        'email': 'admin1@myide.com',
        'password': 'Admin1234!',
        'nombre': 'Administrador Principal',
        'rol': User.Role.ADMIN,
    },
    {
        'username': 'david',
        'email': 'david@myide.com',
        'password': 'User1234!',
        'nombre': 'David Dev',
        'rol': User.Role.USUARIO,
    },
]

class Command(BaseCommand):
    help = 'Poblar BD con usuarios iniciales'

    def handle(self, *args, **kwargs):
        for data in USUARIOS_INICIALES:
            if User.objects.filter(username=data['username']).exists():
                self.stdout.write(f"  Ya existe: {data['username']}")
                continue

            es_admin = data['rol'] == User.Role.ADMIN

            User.objects.create_user(
                username=data['username'],
                email=data['email'],
                password=data['password'],
                nombre=data['nombre'],
                rol=data['rol'],
                is_staff=es_admin,      # ← acceso al panel /admin/
                is_superuser=es_admin,  # ← permisos totales en admin
            )
            self.stdout.write(f"  Creado: {data['username']} ({data['rol']})")