from rest_framework import serializers
from .models import Archivo, Proyecto

MAX_ARCHIVO_BYTES = 65536   # 64 KB — debe coincidir con CHECK en esquema.sql


class ArchivoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Archivo
        fields = ('id', 'nombre', 'contenido', 'fechaCreacion', 'fechaActualizacion')
        read_only_fields = ('id', 'fechaCreacion', 'fechaActualizacion')

    def validate_contenido(self, value):
        if len(value.encode('utf-8')) > MAX_ARCHIVO_BYTES:
            raise serializers.ValidationError(
                f'El archivo supera el límite de {MAX_ARCHIVO_BYTES // 1024} KB.'
            )
        return value

    def validate(self, attrs):
        # Validar peso total del proyecto al crear o actualizar
        request = self.context.get('request')
        view    = self.context.get('view')

        if view and hasattr(view, 'kwargs'):
            proyecto_pk = view.kwargs.get('proyecto_pk')
            if proyecto_pk:
                try:
                    proyecto = Proyecto.objects.get(pk=proyecto_pk)
                except Proyecto.DoesNotExist:
                    return attrs

                nuevo_contenido = attrs.get('contenido', '')
                nuevo_bytes     = len(nuevo_contenido.encode('utf-8'))

                # Excluir el propio archivo en caso de actualización
                instancia_pk = self.instance.pk if self.instance else None
                archivos_qs  = proyecto.archivos.all()
                if instancia_pk:
                    archivos_qs = archivos_qs.exclude(pk=instancia_pk)

                bytes_existentes = sum(
                    len((a.contenido or '').encode('utf-8')) for a in archivos_qs
                )

                if (bytes_existentes + nuevo_bytes) > proyecto.max_bytes_total:
                    limite_kb = proyecto.max_bytes_total // 1024
                    raise serializers.ValidationError(
                        f'El proyecto supera el límite de almacenamiento ({limite_kb} KB total).'
                    )

        return attrs


class ProyectoSerializer(serializers.ModelSerializer):
    """Lista — sin archivos anidados para minimizar payload."""
    class Meta:
        model  = Proyecto
        fields = ('id', 'nombre', 'descripcion', 'lenguaje', 'fechaCreacion',
                  'max_archivos', 'max_bytes_total')
        read_only_fields = ('id', 'fechaCreacion')


class ProyectoDetailSerializer(ProyectoSerializer):
    """Detalle — incluye archivos anidados."""
    archivos = ArchivoSerializer(many=True, read_only=True)

    class Meta(ProyectoSerializer.Meta):
        fields = ProyectoSerializer.Meta.fields + ('archivos',)