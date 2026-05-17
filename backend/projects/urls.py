from django.urls import path, include
from rest_framework_nested.routers import DefaultRouter, NestedDefaultRouter
from rest_framework.routers import DefaultRouter as SimpleRouter

from .views import ArchivoViewSet, ProyectoViewSet, ValidateCollabTokenView

# /api/projects/
router = SimpleRouter()
router.register('projects', ProyectoViewSet, basename='proyecto')

# /api/projects/{proyecto_pk}/archivos/
nested_router = NestedDefaultRouter(router, 'projects', lookup='proyecto')
nested_router.register('archivos', ArchivoViewSet, basename='proyecto-archivos')

urlpatterns = [
    path('projects/validate-collab-token/', ValidateCollabTokenView.as_view(), name='validate-collab-token'),
    path('', include(router.urls)),
    path('', include(nested_router.urls)),
]
