from django.contrib import admin
from .models import Archivo, Proyecto


class ArchivoInline(admin.TabularInline):
    model = Archivo
    extra = 0


@admin.register(Proyecto)
class ProyectoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'lenguaje', 'usuario', 'fecha_creacion')

@admin.register(Archivo)
class ArchivoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'proyecto', 'fecha_actualizacion')
