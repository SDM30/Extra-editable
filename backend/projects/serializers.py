from rest_framework import serializers
from .models import Archivo, Proyecto


class ArchivoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Archivo
        fields = ('id', 'nombre', 'contenido', 'fechaCreacion', 'fechaActualizacion')
        read_only_fields = ('id', 'fechaCreacion', 'fechaActualizacion')


class ProyectoSerializer(serializers.ModelSerializer):
    """Lista — incluye archivos anidados."""
    archivos = ArchivoSerializer(many=True, read_only=True)
    
    class Meta:
        model = Proyecto
        fields = ('id', 'nombre', 'descripcion', 'lenguaje', 'fechaCreacion', 'archivos')
        read_only_fields = ('id', 'fechaCreacion', 'archivos')


class ProyectoDetailSerializer(ProyectoSerializer):
    """Detalle — mismo que lista (ya incluye archivos)."""
    class Meta(ProyectoSerializer.Meta):
        pass
