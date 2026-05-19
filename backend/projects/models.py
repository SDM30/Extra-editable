from django.conf import settings
from django.db import models


class Proyecto(models.Model):
    class Lenguaje(models.TextChoices):
        CPP = 'CPP', 'C++'
        PYTHON = 'PYTHON', 'Python'
        TYPESCRIPT = 'TYPESCRIPT', 'TypeScript'

    nombre = models.CharField(max_length=255)
    descripcion = models.TextField(blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True, db_column='fechaCreacion')
    lenguaje = models.CharField(max_length=10, choices=Lenguaje.choices)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='proyectos'
    )

    class Meta:
        managed = False
        db_table = 'projects_proyecto'
        ordering = ['-fecha_creacion']
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
    fecha_creacion = models.DateTimeField(auto_now_add=True, db_column='fechaCreacion')
    fecha_actualizacion = models.DateTimeField(auto_now=True, db_column='fechaActualizacion')

    class Meta:
        managed = False
        db_table = 'projects_archivo'
        unique_together = ('proyecto', 'nombre')
        ordering = ['nombre']
        verbose_name = 'archivo'

    def __str__(self):
        return f'{self.proyecto.nombre}/{self.nombre}'


class CollabSession(models.Model):
    proyecto = models.ForeignKey(
        Proyecto,
        on_delete=models.CASCADE,
        related_name='collab_sessions'
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='collab_sessions'
    )
    token = models.CharField(max_length=512, blank=True)
    last_seen = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-last_seen']

    def __str__(self):
        return f'CollabSession(project={self.proyecto_id}, user={self.usuario_id})'


class ProyectoColaborador(models.Model):
    """Registra qué usuarios pueden colaborar en un proyecto.
    Creado al enviar `colaboradores: [id, ...]` en POST /api/projects/.
    Usado por IsProjectOwner y collab_join para verificar acceso de escritura."""
    proyecto = models.ForeignKey(
        Proyecto,
        on_delete=models.CASCADE,
        related_name='colaboraciones'
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='colaboraciones'
    )
    fecha_agregado = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'proyecto_colaboradores'
        unique_together = ('proyecto', 'usuario')
        ordering = ['fecha_agregado']

    def __str__(self):
        return f'{self.proyecto.nombre} <- {self.usuario.username}'
