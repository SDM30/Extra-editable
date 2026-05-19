import os
from datetime import timedelta
from django.utils import timezone

from rest_framework import serializers
from .models import Archivo, Proyecto, CollabSession, ProyectoColaborador

EXTENSIONES_POR_LENGUAJE = {
    'CPP': ('.cpp', '.hpp', '.h', '.c', '.cc', '.cxx'),
    'PYTHON': ('.py', '.pyw'),
    'TYPESCRIPT': ('.ts', '.tsx'),
}


class ArchivoSerializer(serializers.ModelSerializer):
    fechaCreacion = serializers.DateTimeField(source='fecha_creacion', read_only=True)
    fechaActualizacion = serializers.DateTimeField(source='fecha_actualizacion', read_only=True)

    class Meta:
        model = Archivo
        fields = ('id', 'nombre', 'contenido', 'fechaCreacion', 'fechaActualizacion')
        read_only_fields = ('id', 'fechaCreacion', 'fechaActualizacion')

    def validate_nombre(self, value):
        proyecto = self.context.get('proyecto')
        if proyecto is not None:
            _, ext = os.path.splitext(value)
            validas = EXTENSIONES_POR_LENGUAJE.get(proyecto.lenguaje, ())
            if validas and ext and ext.lower() not in [v.lower() for v in validas]:
                raise serializers.ValidationError(
                    f'La extensión "{ext}" no es válida para un proyecto {proyecto.lenguaje}. '
                    f'Extensiones permitidas: {", ".join(validas)}'
                )
    # Impedir renombrar a un nombre que ya existe en el mismo proyecto
            exists = Archivo.objects.filter(
                proyecto=proyecto,
                nombre__iexact=value,
            )
            if self.instance is not None:
                exists = exists.exclude(pk=self.instance.pk)
            if exists.exists():
                raise serializers.ValidationError(
                    f'Ya existe un archivo llamado "{value}" en este proyecto.'
                )
        return value


class ProyectoListaSerializer(serializers.ModelSerializer):
    """Lista ligera — pensada para el selector de proyectos."""
    num_archivos = serializers.SerializerMethodField()
    num_colaboradores = serializers.SerializerMethodField()
    colaboradores = serializers.SerializerMethodField()
    usuario = serializers.CharField(source='usuario.username', read_only=True)
    fechaCreacion = serializers.DateTimeField(source='fecha_creacion', read_only=True)

    class Meta:
        model = Proyecto
        fields = ('id', 'nombre', 'descripcion', 'lenguaje', 'fechaCreacion',
                  'num_archivos', 'num_colaboradores', 'colaboradores', 'usuario')
        read_only_fields = fields

    def get_num_archivos(self, obj):
        return getattr(obj, 'num_archivos', obj.archivos.count())

    def get_num_colaboradores(self, obj):
        if hasattr(obj, 'num_colaboradores'):
            return obj.num_colaboradores
        return ProyectoColaborador.objects.filter(proyecto=obj).count() + 1  # +1 dueño

    def get_colaboradores(self, obj):
        if hasattr(obj, 'colaboradores_nombres'):
            return [{'id': uid, 'username': uname} for uid, uname in obj.colaboradores_nombres]
        colaboradores = ProyectoColaborador.objects.filter(
            proyecto=obj
        ).select_related('usuario')
        return [{'id': c.usuario.id, 'username': c.usuario.username} for c in colaboradores]


class ProyectoSerializer(serializers.ModelSerializer):
    """Creación/edición — acepta colaboradores en create."""
    archivos = ArchivoSerializer(many=True, read_only=True)
    fechaCreacion = serializers.DateTimeField(source='fecha_creacion', read_only=True)
    colaboradores = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False, max_length=4
    )

    class Meta:
        model = Proyecto
        fields = ('id', 'nombre', 'descripcion', 'lenguaje', 'fechaCreacion', 'archivos', 'colaboradores')
        read_only_fields = ('id', 'fechaCreacion', 'archivos')

    def create(self, validated_data):
        """Extrae colaboradores de validated_data antes de crear el Proyecto,
        para evitar TypeError: Proyecto() got unexpected keyword arguments."""
        colaboradores = validated_data.pop('colaboradores', [])
        instance = super().create(validated_data)
        self._colaboradores = colaboradores
        return instance


class ProyectoDetailSerializer(ProyectoSerializer):
    """Detalle — mismo que lista (ya incluye archivos)."""
    class Meta(ProyectoSerializer.Meta):
        pass
