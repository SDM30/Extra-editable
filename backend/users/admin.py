from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ('username', 'email', 'nombre', 'rol', 'is_active')
    list_filter = ('rol', 'is_active')
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Perfil', {'fields': ('nombre', 'bio', 'rol')}),
    )
