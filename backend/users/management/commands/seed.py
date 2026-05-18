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
    {
        'username': 'samuel',
        'email': 'samuel@myide.com',
        'password': 'User1234!',
        'nombre': 'Samuel Dev',
        'rol': User.Role.USUARIO,
    },
    {
        'username': 'santiago',
        'email': 'santiago@myide.com',
        'password': 'User1234!',
        'nombre': 'Santiago Dev',
        'rol': User.Role.USUARIO,
    },
    {
        'username': 'simon',
        'email': 'simon@myide.com',
        'password': 'User1234!',
        'nombre': 'Simon Dev',
        'rol': User.Role.USUARIO,
    },
    {
        'username': 'melissa',
        'email': 'melissa@myide.com',
        'password': 'User1234!',
        'nombre': 'Melissa Dev',
        'rol': User.Role.USUARIO,
    },
    {
        'username': 'gabriel',
        'email': 'gabriel@myide.com',
        'password': 'User1234!',
        'nombre': 'Gabriel Dev',
        'rol': User.Role.USUARIO,
    }
]

class Command(BaseCommand):
    help = 'Poblar BD con usuarios iniciales'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force', action='store_true',
            help='Resetear el password de usuarios existentes al valor por defecto'
        )

    def handle(self, *args, **kwargs):
        """Crea usuarios iniciales. Con --force, resetea el password de los existentes."""
        force = kwargs['force']
        for data in USUARIOS_INICIALES:
            if User.objects.filter(username=data['username']).exists():
                if force:
                    u = User.objects.get(username=data['username'])
                    u.set_password(data['password'])
                    u.save()
                    self.stdout.write(f"  Password reseteado: {data['username']}")
                else:
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
                is_active=True
            )
            self.stdout.write(f"  Creado: {data['username']} ({data['rol']})")