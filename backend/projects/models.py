from django.conf import settings
from django.db import models


class Proyecto(models.Model):
    class Lenguaje(models.TextChoices):
        CPP = 'CPP', 'C++'
        PYTHON = 'PYTHON', 'Python'
        TYPESCRIPT = 'TYPESCRIPT', 'TypeScript'

    nombre = models.CharField(max_length=255)
    descripcion = models.TextField(blank=True)
    fechaCreacion = models.DateTimeField(auto_now_add=True)
    lenguaje = models.CharField(max_length=10, choices=Lenguaje.choices)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='proyectos'
    )

    class Meta:
        ordering = ['-fechaCreacion']
        verbose_name = 'proyecto'

    def __str__(self):
        return f'{self.nombre} ({self.usuario})'


class Archivo(models.Model):
    nombre = models.CharField(max_length=255)
    contenido = models.TextField(blank=True)
    proyecto = models.ForeignKey(
        Proyecto,
        on_delete=models.CASCADE,
        related_name='archivos'
    )
    fechaCreacion = models.DateTimeField(auto_now_add=True)
    fechaActualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('proyecto', 'nombre')
        ordering = ['nombre']
        verbose_name = 'archivo'

    def __str__(self):
        return f'{self.proyecto.nombre}/{self.nombre}'
