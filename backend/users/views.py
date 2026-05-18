from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import User
from .permissions import IsAdmin, IsOwnerOrAdmin
from .serializers import UserCreateSerializer, UserDetailSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    queryset           = User.objects.all()
    serializer_class   = UserCreateSerializer
    permission_classes = [AllowAny]


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


class UserViewSet(ModelViewSet):
    queryset           = User.objects.all()
    serializer_class   = UserDetailSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        return User.objects.all().order_by('date_joined')