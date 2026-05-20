from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from .models import User


class UserSerializer(serializers.ModelSerializer):
    """Lectura — nunca expone password."""
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'nombre', 'bio', 'rol', 'date_joined')
        read_only_fields = ('id', 'date_joined', 'rol')


class UserCreateSerializer(serializers.ModelSerializer):
    """Registro público — rol siempre USUARIO."""
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = User
        fields = ('username', 'email', 'password', 'nombre')

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class UserDetailSerializer(UserSerializer):
    """Admin: incluye rol editable."""
    class Meta(UserSerializer.Meta):
        read_only_fields = ('id', 'date_joined')
