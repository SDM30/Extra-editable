from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0003_alter_proyectocolaborador_options'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                CREATE TABLE IF NOT EXISTS proyecto_colaboradores (
                    id BIGSERIAL PRIMARY KEY,
                    fecha_agregado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    proyecto_id BIGINT NOT NULL REFERENCES projects_proyecto(id) ON DELETE CASCADE,
                    usuario_id BIGINT NOT NULL REFERENCES users_user(id) ON DELETE CASCADE,
                    CONSTRAINT proyecto_colaboradores_proyecto_usuario_uniq UNIQUE (proyecto_id, usuario_id)
                );
            """,
            reverse_sql="DROP TABLE IF EXISTS proyecto_colaboradores;",
        ),
    ]