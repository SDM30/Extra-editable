from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Archivo, Proyecto
from .permissions import IsProjectOwner
from .serializers import ArchivoSerializer, ProyectoDetailSerializer, ProyectoSerializer
from django.conf import settings
from datetime import datetime, timedelta, timezone
import jwt
from .models import CollabSession


class ProyectoViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsProjectOwner]

    def get_queryset(self):
        return Proyecto.objects.all()

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ProyectoDetailSerializer
        return ProyectoSerializer

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)

    def get_permissions(self):
        # list/retrieve/create/collab_join: sólo autenticación; escritura destructiva: dueño
        if self.action in ('list', 'retrieve', 'create', 'collab_join'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsProjectOwner()]

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated], url_path='collab/join')
    def collab_join(self, request, pk=None):
        """Endpoint: POST /api/projects/{pk}/collab/join/

        Body: { archivo_id?: number }
        Returns: { token: string, room: string }
        """
        proyecto = self.get_object()
        archivo_id = request.data.get('archivo_id')

        # Clean up stale sessions
        timeout_seconds = getattr(settings, 'DEFAULT_COLLAB_SESSION_TIMEOUT_SECONDS', 60)
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)
        CollabSession.objects.filter(last_seen__lt=cutoff).delete()

        max_users = getattr(settings, 'DEFAULT_MAX_COLLAB_USERS', 4)
        current = CollabSession.objects.filter(proyecto=proyecto).count()
        if current >= max_users:
            return Response({'detail': 'Project collaboration limit reached.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # Create or update session for this user
        session, _ = CollabSession.objects.get_or_create(
            proyecto=proyecto,
            usuario=request.user if request.user.is_authenticated else None,
        )

        # Build token payload (collab-service expects sub/user and room info)
        room = f'project:{proyecto.id}'
        if archivo_id:
            room = f'{room}:archivo:{archivo_id}'

        payload = {
            'sub': str(request.user.id) if request.user and request.user.is_authenticated else f'anon-{session.id}',
            'room': room,
            'username': getattr(request.user, 'username', 'anon') if request.user and request.user.is_authenticated else request.data.get('username', 'Anónimo'),
            'exp': datetime.utcnow() + timedelta(hours=2),
        }

        secret = getattr(settings, 'COLLAB_JWT_SECRET', settings.SECRET_KEY)
        token = jwt.encode(payload, secret, algorithm='HS256')

        session.token = token
        session.save()

        return Response({'token': token, 'room': room})


class ArchivoViewSet(viewsets.ModelViewSet):
    serializer_class = ArchivoSerializer
    permission_classes = [IsAuthenticated, IsProjectOwner]

    def get_queryset(self):
        return Archivo.objects.filter(
            proyecto_id=self.kwargs.get('proyecto_pk')
        )

    def perform_create(self, serializer):
        proyecto = Proyecto.objects.get(
            pk=self.kwargs['proyecto_pk']
        )
        serializer.save(proyecto=proyecto)

    def get_permissions(self):
        if self.action in ('list', 'create', 'retrieve', 'update', 'partial_update'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsProjectOwner()]
