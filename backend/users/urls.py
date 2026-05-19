from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import RegisterView, UserViewSet, me, search_usuarios

router = DefaultRouter()
router.register('usuarios', UserViewSet, basename='usuario')

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', TokenObtainPairView.as_view(), name='login'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('me/', me, name='me'),
    path('search/', search_usuarios, name='search_usuarios'),
    path('', include(router.urls)),
]
