from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

<<<<<<< HEAD
from django.db.models import Q

=======
>>>>>>> b93e8d684ed12eb2733f7727e71bd33cd95f754d
from .models import User
from .permissions import IsAdmin, IsOwnerOrAdmin
from .serializers import UserCreateSerializer, UserDetailSerializer, UserSerializer


# ---------- Auth ----------

class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = UserCreateSerializer
    permission_classes = [AllowAny]


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_usuarios(request):
    q = request.query_params.get('q', '').strip()
    if len(q) < 2:
        return Response([])
    users = User.objects.filter(
        Q(username__icontains=q) | Q(email__icontains=q)
    ).exclude(id=request.user.id)[:10]
    return Response([
        {'id': u.id, 'username': u.username}
        for u in users
    ])


# ---------- Admin CRUD ----------

class UserViewSet(ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserDetailSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        return User.objects.all().order_by('date_joined')
