from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from django.conf import settings
from django.db.models import Count, Q
from django.contrib.auth import get_user_model

User = get_user_model()
from datetime import datetime, timedelta, timezone
import jwt

from .models import Archivo, Proyecto, CollabSession, ProyectoColaborador
from .permissions import IsProjectOwner
from .serializers import ArchivoSerializer, ProyectoDetailSerializer, ProyectoSerializer, ProyectoListaSerializer
from rest_framework.views import APIView
from rest_framework.response import Response as DRFResponse
from rest_framework import status as drf_status


class ValidateCollabTokenView(APIView):
    """Endpoint utilizado por el API Gateway / Load Balancer para validar
    un token JWT emitido por el backend y propagar identidad al servicio
    colaborativo.

    Lee token desde: Authorization header (Bearer ...) o parámetro `token`.
    Si es válido, devuelve 200 con headers:
      - X-Auth-User-Id
      - X-Auth-Username
      - X-Auth-Room
    Si inválido, devuelve 401.
    """
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        token = None
        auth = request.META.get('HTTP_AUTHORIZATION')
        if auth and auth.lower().startswith('bearer '):
            token = auth.split(None, 1)[1]
        if not token:
            token = request.query_params.get('token')

        if not token:
            return DRFResponse({'detail': 'token required'}, status=drf_status.HTTP_400_BAD_REQUEST)

        secret = getattr(settings, 'COLLAB_JWT_SECRET', settings.SECRET_KEY)
        try:
            payload = jwt.decode(token, secret, algorithms=['HS256'])
        except Exception as e:
            return DRFResponse({'detail': 'invalid token'}, status=drf_status.HTTP_401_UNAUTHORIZED)

        user_id = payload.get('sub')
        username = payload.get('username') or payload.get('user') or 'anon'
        room = payload.get('room')

        resp = DRFResponse({'ok': True})
        if user_id:
            resp['X-Auth-User-Id'] = str(user_id)
        if username:
            resp['X-Auth-Username'] = str(username)
        if room:
            resp['X-Auth-Room'] = str(room)

        return resp


class LspTokenView(APIView):
    """Endpoint que emite un token JWT scoped al proyecto para el servicio LSP.

    POST /api/projects/{project_id}/lsp/token/
    Header: Authorization: Bearer <access_token>

    Retorna { token, room } donde el token incluye:
      - sub: user_id
      - username: nombre de usuario
      - room: project_id
      - exp: 1 hora

    El LSP service valida este token localmente (HS256, JWT_SECRET compartido)
    y rechaza requests cuyo room no coincida con el project_id del endpoint.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, project_id=None):
        proyecto = Proyecto.objects.get(pk=project_id)

        if proyecto.usuario != request.user:
            if not ProyectoColaborador.objects.filter(
                proyecto=proyecto, usuario=request.user
            ).exists():
                return Response(
                    {'detail': 'No tienes acceso a este proyecto.'},
                    status=status.HTTP_403_FORBIDDEN
                )

        payload = {
            'sub': str(request.user.id),
            'username': request.user.username,
            'room': str(project_id),
            'exp': datetime.utcnow() + timedelta(hours=1),
        }
        secret = getattr(settings, 'COLLAB_JWT_SECRET', settings.SECRET_KEY)
        token = jwt.encode(payload, secret, algorithm='HS256')
        return Response({'token': token, 'room': str(project_id)})


class ProyectoViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsProjectOwner]

    def get_queryset(self):
        """Para list: proyectos propios + compartidos via ProyectoColaborador."""
        qs = Proyecto.objects.all()
        if self.action == 'list':
            qs = qs.filter(
                Q(usuario=self.request.user) |
                Q(colaboraciones__usuario=self.request.user)
            ).distinct().annotate(num_archivos=Count('archivos'))
        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return ProyectoListaSerializer
        if self.action == 'retrieve':
            return ProyectoDetailSerializer
        return ProyectoSerializer

    def perform_create(self, serializer):
        proyecto = serializer.save(usuario=self.request.user)
        colaboradores_ids = getattr(serializer, '_colaboradores', [])
        for uid in colaboradores_ids:
            try:
                user = User.objects.get(pk=uid)
                ProyectoColaborador.objects.create(proyecto=proyecto, usuario=user)
            except (User.DoesNotExist, Exception):
                pass

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'create', 'collab_join', 'collaborators'):
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

        # Verificar que el usuario es dueño o colaborador
        if proyecto.usuario != request.user:
            if not ProyectoColaborador.objects.filter(
                proyecto=proyecto, usuario=request.user
            ).exists():
                return Response(
                    {'detail': 'No tienes acceso a este proyecto.'},
                    status=status.HTTP_403_FORBIDDEN
                )

        timeout_seconds = getattr(settings, 'DEFAULT_COLLAB_SESSION_TIMEOUT_SECONDS', 60)
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)

        max_users = getattr(settings, 'DEFAULT_MAX_COLLAB_USERS', 4)
        current = CollabSession.objects.filter(proyecto=proyecto, last_seen__gte=cutoff).count()
        if current >= max_users:
            return Response({'detail': 'Project collaboration limit reached.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # Create or update session for this user
        session, _ = CollabSession.objects.get_or_create(
            proyecto=proyecto,
            usuario=request.user if request.user.is_authenticated else None,
        )

        # Build token payload (collab-service expects sub/user and room info)
        room = str(proyecto.id)
        if archivo_id:
            room = f'{proyecto.id}:{archivo_id}'

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

    @action(detail=True, methods=['get'], permission_classes=[IsAuthenticated], url_path='collaborators')
    def collaborators(self, request, pk=None):
        """Endpoint: GET /api/projects/{pk}/collaborators/

        Retorna todos los colaboradores (activos e inactivos) del proyecto.
        """
        proyecto = self.get_object()

        timeout_seconds = getattr(settings, 'DEFAULT_COLLAB_SESSION_TIMEOUT_SECONDS', 60)
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout_seconds)

        sessions = CollabSession.objects.filter(
            proyecto=proyecto, usuario__isnull=False
        ).select_related('usuario')

        usuarios_activos = {
            s.usuario.id: s.last_seen >= cutoff
            for s in sessions if s.usuario
        }

        colaboradores_perm = ProyectoColaborador.objects.filter(
            proyecto=proyecto
        ).select_related('usuario')

        usuarios_set = {}
        for c in colaboradores_perm:
            usuarios_set[c.usuario.id] = {
                'id': c.usuario.id,
                'username': c.usuario.username,
                'activo': usuarios_activos.get(c.usuario.id, False)
            }
        # Agregar usuarios que tienen sesión pero no son colaboradores permanentes
        for s in sessions:
            if s.usuario and s.usuario.id not in usuarios_set:
                usuarios_set[s.usuario.id] = {
                    'id': s.usuario.id,
                    'username': s.usuario.username,
                    'activo': s.last_seen >= cutoff
                }

        usuarios = list(usuarios_set.values())
        return Response({'count': len(usuarios), 'usuarios': usuarios})


class ArchivoViewSet(viewsets.ModelViewSet):
    serializer_class = ArchivoSerializer
    permission_classes = [IsAuthenticated, IsProjectOwner]

    def get_queryset(self):
        return Archivo.objects.filter(
            proyecto_id=self.kwargs.get('proyecto_pk')
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        try:
            context['proyecto'] = Proyecto.objects.get(
                pk=self.kwargs['proyecto_pk']
            )
        except Proyecto.DoesNotExist:
            pass
        return context

    def perform_create(self, serializer):
        proyecto = self.get_serializer_context().get('proyecto')
        serializer.save(proyecto=proyecto)

    def get_permissions(self):
        if self.action in ('list', 'create', 'retrieve'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsProjectOwner()]
