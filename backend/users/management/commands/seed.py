import psycopg
from django.core.management.base import BaseCommand
from django.contrib.auth.hashers import make_password
from django.conf import settings

USUARIOS_INICIALES = [
    {
        'username': 'admin1',
        'email': 'admin1@myide.com',
        'password': 'Admin1234!',
        'nombre': 'Administrador Principal',
        'rol': 'ADMIN',
    },
    {
        'username': 'david',
        'email': 'david@myide.com',
        'password': 'User1234!',
        'nombre': 'David Dev',
        'rol': 'USUARIO',
    },
    {
        'username': 'samuel',
        'email': 'samuel@myide.com',
        'password': 'User1234!',
        'nombre': 'Samuel Dev',
        'rol': 'USUARIO',
    },
    {
        'username': 'santiago',
        'email': 'santiago@myide.com',
        'password': 'User1234!',
        'nombre': 'Santiago Dev',
        'rol': 'USUARIO',
    },
]


class Command(BaseCommand):
    help = 'Poblar BD con usuarios iniciales (SQL directo, sin ORM)'

    def handle(self, *args, **kwargs):
        db = settings.DATABASES['default']
        try:
            conn = psycopg.connect(
                dbname=db['NAME'],
                user=db['USER'],
                password=db.get('PASSWORD', ''),
                host=db['HOST'],
                port=db['PORT'],
            )
            cur = conn.cursor()

            for data in USUARIOS_INICIALES:
                cur.execute('SELECT id FROM usuarios WHERE username = %s', (data['username'],))
                if cur.fetchone():
                    self.stdout.write(f"  Ya existe: {data['username']}")
                    continue

                es_admin = data['rol'] == 'ADMIN'
                cur.execute(
                    '''INSERT INTO usuarios
                       (username, email, password, nombre, bio, rol,
                        is_active, is_staff, is_superuser, date_joined)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())''',
                    (
                        data['username'],
                        data['email'],
                        make_password(data['password']),
                        data['nombre'],
                        '',
                        data['rol'],
                        True,
                        es_admin,
                        es_admin,
                    ),
                )
                self.stdout.write(f"  Creado: {data['username']} ({data['rol']})")

            conn.commit()
            cur.close()
            conn.close()
            self.stdout.write(self.style.SUCCESS('✓ Seed completado'))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f'✗ Error: {e}'))