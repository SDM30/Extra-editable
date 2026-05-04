from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Archivo, Proyecto
from .permissions import IsProjectOwner
from .serializers import ArchivoSerializer, ProyectoDetailSerializer, ProyectoSerializer


class ProyectoViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsProjectOwner]

    def get_queryset(self):
        return Proyecto.objects.filter(usuario=self.request.user)

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ProyectoDetailSerializer
        return ProyectoSerializer

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)

    def get_permissions(self):
        # list/create: sólo IsAuthenticated; resto: también IsProjectOwner
        if self.action in ('list', 'create'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsProjectOwner()]


class ArchivoViewSet(viewsets.ModelViewSet):
    serializer_class = ArchivoSerializer
    permission_classes = [IsAuthenticated, IsProjectOwner]

    def get_queryset(self):
        return Archivo.objects.filter(
            proyecto__usuario=self.request.user,
            proyecto_id=self.kwargs.get('proyecto_pk')
        )

    def perform_create(self, serializer):
        proyecto = Proyecto.objects.get(
            pk=self.kwargs['proyecto_pk'],
            usuario=self.request.user
        )
        serializer.save(proyecto=proyecto)

    def get_permissions(self):
        if self.action == 'list':
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsProjectOwner()]
