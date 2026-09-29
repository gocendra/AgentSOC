#!/bin/bash
# ==============================================================
# AgentSOC - Script Automatizado de Despliegue y Actualización
# Uso: ./deploy.sh [opcional: tag o commit]
# ==============================================================
set -e

# Colores de consola
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}==============================================================${NC}"
echo -e "${BLUE}   🛡️  AgentSOC - Despliegue de Nueva Versión (Docker)       ${NC}"
echo -e "${BLUE}==============================================================${NC}"

# 1. Verificar Docker y Docker Compose
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker no está instalado en este servidor.${NC}"
    exit 1
fi

# Soporte para reinicio limpio desde 0
if [ "$1" = "--clean" ] || [ "$1" = "--fresh" ] || [ "$1" = "-c" ]; then
    echo -e "${YELLOW}🧹 Limpiando volúmenes de base de datos y contenedores anteriores (inicio desde 0)...${NC}"
    docker compose down -v --remove-orphans || true
fi

# 2. Verificar archivo .env
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️ Archivo .env no encontrado. Creando configuración...${NC}"
    if [ -f .env-example ]; then
        cp .env-example .env
    else
        cat << 'EOF' > .env
DEBUG=False
HOST_PORT=80
DB_NAME=soc_central
DB_USER=root
DB_PASSWORD=root_super_secure_pass_2026
DJANGO_SECRET_KEY=soc-secret-jwt-key-2026-secure-hmac-sha256-compliance-auth-token-key-soc
INITIAL_ADMIN_USER=admin
INITIAL_ADMIN_PASSWORD=admin123
INITIAL_ADMIN_EMAIL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
    fi
    chmod 600 .env
    echo -e "${GREEN}✅ Archivo .env inicializado con permisos 600.${NC}"
fi

# 3. Descargar cambios del repositorio si estamos en un repo Git
if [ -d .git ]; then
    echo -e "${BLUE}📥 Sincronizando últimas actualizaciones desde Git...${NC}"
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "master")
    git pull --rebase origin "$CURRENT_BRANCH" || git pull --rebase origin master || git pull --rebase origin main || echo -e "${YELLOW}ℹ️ Continuando con los archivos locales actuales...${NC}"
fi

# 4. Construir las imágenes con la nueva versión
echo -e "${BLUE}🔨 Compilando nuevas imágenes de Frontend y Backend...${NC}"
docker compose build --pull

# 5. Levantar y reemplazar contenedores con la nueva versión
echo -e "${BLUE}🚀 Levantando servicios actualizados en segundo plano...${NC}"
docker compose up -d --remove-orphans

# 6. Esperar a que los servicios estén listos
echo -e "${BLUE}⏳ Esperando a que el backend esté listo...${NC}"
for i in {1..30}; do
    if docker compose ps | grep -q "soc-backend.*healthy"; then
        break
    fi
    sleep 2
done
docker compose ps

echo -e "\n${BLUE}👤 Estado de la cuenta inicial:${NC}"
docker logs soc-backend --tail 25 | grep -i "Usuario Administrador" || true

echo -e "\n${GREEN}==============================================================${NC}"
echo -e "${GREEN}✅ ¡Despliegue completado exitosamente!${NC}"
echo -e "${GREEN}🌐 Acceso al SOC: http://localhost:${HOST_PORT:-80}${NC}"
echo -e "${GREEN}👤 Usuario: ${INITIAL_ADMIN_USER:-admin}${NC}"
echo -e "${GREEN}🔑 Contraseña: (La configurada en INITIAL_ADMIN_PASSWORD de tu .env)${NC}"
echo -e "${GREEN}==============================================================${NC}"
