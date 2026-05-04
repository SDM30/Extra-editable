from rest_framework import serializers
from .models import Archivo, Proyecto


class ArchivoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Archivo
        fields = ('id', 'nombre', 'contenido', 'fechaCreacion', 'fechaActualizacion')
        read_only_fields = ('id', 'fechaCreacion', 'fechaActualizacion')


class ProyectoSerializer(serializers.ModelSerializer):
    """Lista — sin archivos anidados."""
    class Meta:
        model = Proyecto
        fields = ('id', 'nombre', 'descripcion', 'lenguaje', 'fechaCreacion')
        read_only_fields = ('id', 'fechaCreacion')


class ProyectoDetailSerializer(ProyectoSerializer):
    """Detalle — incluye archivos."""
    archivos = ArchivoSerializer(many=True, read_only=True)

    class Meta(ProyectoSerializer.Meta):
        fields = ProyectoSerializer.Meta.fields + ('archivos',)
