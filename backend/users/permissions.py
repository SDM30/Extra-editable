from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    """Sólo usuarios con rol ADMIN."""
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_admin)


class IsOwnerOrAdmin(BasePermission):
    """Propietario del objeto o admin."""
    def has_object_permission(self, request, view, obj):
        if request.user.is_admin:
            return True
        owner = getattr(obj, 'usuario', getattr(obj, 'user', obj))
        return owner == request.user
