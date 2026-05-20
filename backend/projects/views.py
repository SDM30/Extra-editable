from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Archivo, CollabSession, Proyecto
from .permissions import IsProjectOwner
from .serializers import ArchivoSerializer, ProyectoDetailSerializer, ProyectoSerializer


# ── Validación de token collab (usada por el API Gateway) ─────────────────
class ValidateCollabTokenView(APIView):
    """
    Endpoint para que el API Gateway / Load Balancer valide un JWT emitido
    por el backend y propague identidad al collab-service via headers.

    Lee token desde: Authorization: Bearer <token>  o  ?token=<token>
    Responde 200 con X-Auth-User-Id, X-Auth-Username, X-Auth-Room
    o 401 si el token es inválido.
    """
    authentication_classes = []
    permission_classes     = []

    def get(self, request):
        token = None
        auth  = request.META.get('HTTP_AUTHORIZATION', '')
        if auth.lower().startswith('bearer '):
            token = auth.split(None, 1)[1]
        if not token:
            token = request.query_params.get('token')

        if not token:
            return Response({'detail': 'token required'}, status=status.HTTP_400_BAD_REQUEST)

        secret = getattr(settings, 'COLLAB_JWT_SECRET', settings.SECRET_KEY)
        try:
            payload = jwt.decode(token, secret, algorithms=['HS256'])
        except Exception:
            return Response({'detail': 'invalid token'}, status=status.HTTP_401_UNAUTHORIZED)

        user_id  = payload.get('sub')
        username = payload.get('username') or payload.get('user') or 'anon'
        room     = payload.get('room')

        resp = Response({'ok': True})
        if user_id:  resp['X-Auth-User-Id']  = str(user_id)
        if username: resp['X-Auth-Username']  = str(username)
        if room:     resp['X-Auth-Room']      = str(room)

        return resp


# ── Proyectos ──────────────────────────────────────────────────────────────
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
        if self.action in ('list', 'retrieve', 'create', 'collab_join'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsProjectOwner()]

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated],
            url_path='collab/join')
    def collab_join(self, request, pk=None):
        """
        POST /api/projects/{pk}/collab/join/
        Body: { archivo_id?: number }
        Returns: { token: string, room: string }
        """
        proyecto   = self.get_object()
        archivo_id = request.data.get('archivo_id')

        # Limpiar sesiones expiradas
        timeout_seconds = getattr(settings, 'DEFAULT_COLLAB_SESSION_TIMEOUT_SECONDS', 60)
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)
        CollabSession.objects.filter(last_seen__lt=cutoff).delete()

        max_users = getattr(settings, 'DEFAULT_MAX_COLLAB_USERS', 4)
        current   = CollabSession.objects.filter(proyecto=proyecto).count()
        if current >= max_users:
            return Response(
                {'detail': 'Project collaboration limit reached.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        session, _ = CollabSession.objects.get_or_create(
            proyecto=proyecto,
            usuario=request.user if request.user.is_authenticated else None,
        )

        room = f'project:{proyecto.id}'
        if archivo_id:
            room = f'{room}:archivo:{archivo_id}'

        payload = {
            'sub':      str(request.user.id) if request.user.is_authenticated else f'anon-{session.id}',
            'room':     room,
            'username': getattr(request.user, 'username', 'anon'),
            'exp':      datetime.utcnow() + timedelta(hours=2),
        }

        secret = getattr(settings, 'COLLAB_JWT_SECRET', settings.SECRET_KEY)
        token  = jwt.encode(payload, secret, algorithm='HS256')

        session.token = token
        session.save()

        return Response({'token': token, 'room': room})


# ── Archivos ───────────────────────────────────────────────────────────────
class ArchivoViewSet(viewsets.ModelViewSet):
    serializer_class   = ArchivoSerializer
    permission_classes = [IsAuthenticated, IsProjectOwner]

    def get_queryset(self):
        return Archivo.objects.filter(
            proyecto_id=self.kwargs.get('proyecto_pk')
        )

    def perform_create(self, serializer):
        proyecto = Proyecto.objects.get(pk=self.kwargs['proyecto_pk'])

        # Validar límite de archivos antes de insertar
        # (el trigger de BD es la última línea de defensa)
        count = proyecto.archivos.count()
        if count >= proyecto.max_archivos:
            from rest_framework.exceptions import ValidationError
            raise ValidationError(
                f'El proyecto alcanzó el límite de {proyecto.max_archivos} archivos.'
            )

        serializer.save(proyecto=proyecto)

    def get_permissions(self):
        if self.action in ('list', 'create', 'retrieve', 'update', 'partial_update'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsProjectOwner()]