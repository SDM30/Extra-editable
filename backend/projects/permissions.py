from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsProjectOwner(BasePermission):
    """Permite escritura al dueño del proyecto y a los colaboradores registrados
    en ProyectoColaborador. Lectura (SAFE_METHODS) permitida a cualquier autenticado."""
    def has_object_permission(self, request, view, obj):
        proyecto = getattr(obj, 'proyecto', obj)
        if request.method in SAFE_METHODS:
            return True
        if proyecto.usuario_id == request.user.id:
            return True
        from .models import ProyectoColaborador
        return ProyectoColaborador.objects.filter(
            proyecto=proyecto, usuario=request.user
        ).exists()
