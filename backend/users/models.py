from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        USUARIO = 'USUARIO', 'Usuario Estándar'
        ADMIN = 'ADMIN', 'Administrador'

    nombre = models.CharField(max_length=255, blank=True)
    bio = models.TextField(blank=True, max_length=500)
    rol = models.CharField(max_length=10, choices=Role.choices, default=Role.USUARIO)

    # email único requerido
    email = models.EmailField(unique=True)

    class Meta:
        verbose_name = 'usuario'
        verbose_name_plural = 'usuarios'
        managed = False
        db_table = 'usuarios'

    def __str__(self):
        return self.username

    @property
    def is_admin(self):
        return self.rol == self.Role.ADMIN
