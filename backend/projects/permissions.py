from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsProjectOwner(BasePermission):
    """Sólo el propietario del proyecto puede modificarlo."""
    def has_object_permission(self, request, view, obj):
        proyecto = getattr(obj, 'proyecto', obj)  # Archivo → proyecto; Proyecto → self
        if request.method in SAFE_METHODS:
            return True

        return proyecto.usuario == request.user
