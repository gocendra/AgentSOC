#!/bin/bash
set -e

echo "⏳ Esperando a que la base de datos MySQL esté disponible y autenticada..."
python3 - << 'EOF'
import time
import os
import MySQLdb

host = os.environ.get('DB_HOST', 'db')
port = int(os.environ.get('DB_PORT', 3306))
user = os.environ.get('DB_USER', 'root')
password = os.environ.get('DB_PASSWORD', 'root')
db_name = os.environ.get('DB_NAME', 'soc_central')

for attempt in range(90):
    try:
        conn = MySQLdb.connect(host=host, port=port, user=user, passwd=password)
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE IF NOT EXISTS `{db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
        conn.close()
        print(f"✅ Conexión autenticada con MySQL en {host}:{port} (Base de datos '{db_name}' verificada).")
        break
    except Exception as e:
        if attempt % 5 == 0:
            print(f"⏳ Esperando que MySQL esté listo y autenticado en {host}:{port} (intento {attempt+1}/90): {e}")
        time.sleep(1)
else:
    print(f"❌ ERROR: No se pudo autenticar con MySQL en {host}:{port} tras 90 segundos.")
    exit(1)
EOF

# Asegurar que el paquete de migraciones exista con __init__.py
mkdir -p /app/migrations
touch /app/migrations/__init__.py

echo "🛠️ Sincronizando migraciones y esquema de base de datos..."
python3 - << 'EOF'
import os
import backend_soc_django
import django
from django.core.management import call_command

try:
    call_command('migrate', interactive=False, fake_initial=True)
    print("✅ Migraciones de Django aplicadas correctamente.")
except Exception as e:
    print(f"ℹ️ [migrate fake_initial]: {e}")
    try:
        call_command('migrate', interactive=False)
        print("✅ Migraciones aplicadas en modo normal.")
    except Exception as e2:
        print(f"ℹ️ [migrate fallback]: {e2}")
        try:
            print("🔄 Registrando migraciones existentes (--fake)...")
            call_command('migrate', interactive=False, fake=True)
            print("✅ Migraciones sincronizadas con éxito (--fake).")
        except Exception as e3:
            print(f"⚠️ [migrate fake]: {e3}")

try:
    from backend_soc_django import ensure_domain_table
    ensure_domain_table()
    print("✅ Tablas auxiliares e índices verificados.")
except Exception as e:
    print(f"ℹ️ [ensure_domain_table]: {e}")
EOF

echo "👤 Verificando usuario administrador inicial..."
python3 - << 'EOF'
import os
import backend_soc_django
from django.contrib.auth.models import User
from backend_soc_django import UserProfile

init_user = os.environ.get('INITIAL_ADMIN_USER', 'admin').strip().strip('"\'')
init_pass = os.environ.get('INITIAL_ADMIN_PASSWORD', 'admin123').strip().strip('"\'')
init_email = os.environ.get('INITIAL_ADMIN_EMAIL', '').strip().strip('"\'')

try:
    import django.utils.timezone
    from django.db import connection
    try:
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE auth_user MODIFY COLUMN last_login DATETIME NULL")
    except Exception:
        pass

    user, created = User.objects.get_or_create(
        username=init_user,
        defaults={
            'email': init_email,
            'is_staff': True,
            'is_superuser': True,
            'last_login': django.utils.timezone.now()
        }
    )
    user.set_password(init_pass)
    user.is_active = True
    if user.last_login is None:
        user.last_login = django.utils.timezone.now()
    if init_email:
        user.email = init_email
    user.save()

    profile, _ = UserProfile.objects.get_or_create(user=user, defaults={'role': 'admin'})
    profile.role = 'admin'
    profile.is_locked = False
    profile.failed_attempts = 0
    profile.locked_until = None
    profile.save()

    from django.contrib.auth import authenticate
    test_auth = authenticate(username=init_user, password=init_pass)
    if test_auth:
        print(f"✅ Usuario Administrador '{init_user}' configurado ({'creado' if created else 'actualizado'}). Autenticado correctamente con INITIAL_ADMIN_PASSWORD.")
    else:
        print(f"⚠️ Advertencia: No se pudo verificar la autenticación para '{init_user}'.")
except Exception as e:
    print(f"⚠️ Error al configurar administrador: {e}")
EOF

# Si se pasaron argumentos a docker run / docker-compose, ejecutarlos
if [ "$#" -gt 0 ]; then
    echo "⚡ Ejecutando comando personalizado: $@"
    exec "$@"
fi

# Iniciar servidor backend según modo DEBUG
DEBUG_MODE=$(echo "${DEBUG:-False}" | tr '[:upper:]' '[:lower:]')

if [ "$DEBUG_MODE" = "true" ] || [ "$DEBUG_MODE" = "1" ]; then
    echo "🚀 Iniciando Django Server (Modo Debug) en 0.0.0.0:8000..."
    exec python3 backend_soc_django.py runserver 0.0.0.0:8000
else
    WORKERS="${GUNICORN_WORKERS:-1}"
    THREADS="${GUNICORN_THREADS:-4}"
    echo "🚀 Iniciando Gunicorn WSGI Server (Producción, ${WORKERS} worker(s), ${THREADS} threads) en 0.0.0.0:8000..."
    exec gunicorn backend_soc_django:application \
        --bind 0.0.0.0:8000 \
        --workers "$WORKERS" \
        --threads "$THREADS" \
        --timeout 120 \
        --access-logfile - \
        --error-logfile -
fi

