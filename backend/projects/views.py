from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django.views.decorators.csrf import csrf_exempt


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
    
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def collab_access(request, proyecto_pk):
    """
    Hocuspocus llama a este endpoint para validar que el usuario
    autenticado tiene acceso al proyecto antes de abrir el documento.
    """
    try:
        Proyecto.objects.get(pk=proyecto_pk, usuario=request.user)
        return Response({'access': True})
    except Proyecto.DoesNotExist:
        return Response({'access': False}, status=403)
 
 
@api_view(['POST'])
@permission_classes([AllowAny])  # Hocuspocus usa token interno, no JWT de usuario
def collab_sync(request):
    """
    Webhook: Hocuspocus llama aquí tras onStoreDocument.
    Actualiza archivos.contenido con el texto plano extraído del Y.Text.
    El campo ydoc ya fue actualizado por db.js directamente vía SQL.
    """
    project_id = request.data.get('project_id')
    filename   = request.data.get('filename')
    content    = request.data.get('content', '')
 
    if not project_id or not filename:
        return Response({'error': 'project_id y filename requeridos'}, status=400)
 
    updated = Archivo.objects.filter(
        proyecto_id=project_id,
        nombre=filename,
    ).update(contenido=content)
 
    if not updated:
        return Response({'error': 'Archivo no encontrado'}, status=404)
 
    return Response({'ok': True})
