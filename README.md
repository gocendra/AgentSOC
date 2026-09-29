# AgentSOC - Intelligent SOC & Threat Intelligence Platform

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Django-5.2-092E20?style=for-the-badge&logo=django&logoColor=white" alt="Django" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Vite-6.0-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI" />
</p>

**AgentSOC** es una plataforma integral de Centro de Operaciones de Seguridad (SOC) y monitoreo de infraestructura distribuida impulsada por Inteligencia Artificial. Diseñada para patrullar servidores en tiempo real, sanitizar logs sensibles, correlacionar anomalías de ciberseguridad, clasificar incidentes y enviar alertas automáticas e instantáneas a través de Telegram y correo electrónico.

---

## Arquitectura General del Sistema

```
  +-------------------------------------------------------------+
  |              SERVIDORES CLIENTE / NODOS REMOTOS             |
  |                                                             |
  |  /var/log/* (auth, syslog, ufw, fail2ban, snort, nginx...)   |
  |                           │                                 |
  |                           ▼                                 |
  |                 [ ai_soc_agent.py ]                         |
  |         - Pre-filtrado por palabras clave                   |
  |         - Sanitización local de credenciales                |
  |         - Anti-Spam por Hash MD5 (24h)                      |
  |         - Telemetría / Heartbeat (CPU, RAM, Disco)          |
  |         - Análisis IA (OpenAI) o Clasificación local        |
  +───────────────────────────┬─────────────────────────────────+
                              │ HTTPS (API Key por nodo)
                              ▼
  +-------------------------------------------------------------+
  |                  SOC CENTRAL (DOCKER)                       |
  |                                                             |
  |  [ Nginx Proxy ] ──► [ Django Backend API ] ──► [ MySQL 8 ] |
  |                             │                               |
  |         ┌───────────────────┼───────────────────┐           |
  |         ▼                   ▼                   ▼           |
  |   Alertas Telegram     Alertas SMTP       Monitoreo Dominios|
  |   (Bots y Canales)    (Email de Alerta)   (HTTP, Latencia,  |
  |                                            Certificados SSL)|
  +─────────────────────────────┬───────────────────────────────+
                                │
                                ▼
  +-------------------------------------------------------------+
  |                  DASHBOARD WEB (REACT / VITE)               |
  |  - Panel de Incidentes y Métricas en tiempo real            |
  |  - Mapa Geoespacial de Ciberinfraestructura (Leaflet)       |
  |  - Gestión de Dispositivos y Sesiones Activas               |
  |  - Control de Acceso RBAC, Bloqueo y MFA Obligatorio        |
  |  - Soporte Multi-idioma (Español / English)                 |
  +-------------------------------------------------------------+
```

---

## Características Principales

### 1. Agente Autónomo de Monitoreo (`ai_soc_agent.py`)
- **Patrullaje Asíncrono de Logs**: Monitorea en tiempo real archivos del sistema (`/var/log/auth.log`, `/var/log/syslog`, `/var/log/fail2ban.log`, `/var/log/ufw.log`, Snort IDS, Nginx y Apache).
- **Sanitización y Ofuscación de Secretos (`sanitize_log_data`)**: Reemplaza automáticamente contraseñas, claves privadas (RSA/SSH), tokens Bearer, connection strings y hashes de Linux por marcas seguras (`[REDACTED]`) **antes** de enviarlos a la IA o a la base de datos central.
- **Clasificación Dual (IA o Local)**:
  - **Modo IA (`USE_AI=True`)**: Emplea modelos LLM (`gpt-4o-mini`) para extraer criticidad estructurada (`CRITICA`, `ALTA`, `MEDIA`, `BAJA`), resumen ejecutivo en lenguaje natural y fragmento de evidencia.
  - **Modo Local (`USE_AI=False`)**: Motor de patrones heurísticos de alta velocidad sin consumo de tokens de API.
- **Deduplicación Anti-Spam**: Genera huellas digitales (hash MD5 independiente de fechas y PIDs) con memoria de 24 horas para evitar saturar las notificaciones ante bucles de errores repetitivos.
- **Telemetría y Heartbeat**: Reporta cada 15 segundos el estado de salud del nodo (porcentaje de CPU, Memoria RAM y almacenamiento en disco).
- **Instalador Standalone (`instalar_ai_soc_agent.sh`)**: Script autoportante que crea entorno virtual, instala dependencias con `pip`, configura permisos estrictos (`chmod 600`) y registra el servicio Systemd para ejecución 24/7 con auto-reinicio.

---

### 2. Backend Central y Motor de Detección (`Django + MySQL`)
- **Ingesta Segura de Incidentes**: Endpoint protegido con autenticación por clave de API única generada para cada nodo registrado.
- **Notificaciones Inmediatas Multicanal**:
  - **Telegram Bot**: Mensajes enriquecidos con formato visual, servidor afectado, criticidad, evidencia y recursos.
  - **Correo Electrónico (SMTP)**: Reportes detallados para administradores y operadores de guardia.
- **Vigilancia de Dominios y Servicios Web**:
  - Sondeo configurable (5m, 15m, 30m, 1h, etc.) de sitios web y APIs.
  - Medición de tiempos de respuesta (latencia HTTP).
  - Alerta temprana de **vencimiento de certificados SSL/TLS**.
  - Detección de caídas de servicio con disparo de advertencias a Telegram.

---

### 3. Seguridad, Políticas Centralizadas e IAM
- **Control de Acceso Basado en Roles (RBAC)**: Roles de usuario granulares (`admin`, `write`, `read`).
- **Autenticación en Dos Factores (MFA)**: Reto obligatorio de verificación con código PIN de 6 dígitos enviado por correo para administradores u operadores.
- **Protección contra Fuerza Bruta**: Bloqueo temporal automático tras intentos fallidos consecutivos de inicio de sesión con temporizador reactivo.
- **Gestión Forense de Sesiones y Dispositivos**:
  - Identificación de tipo de dispositivo (Desktop, Mobile, Tablet), sistema operativo y navegador mediante análisis de User-Agent.
  - Registro de dirección IP de conexión y geolocalización.
  - Distintivo visual en tiempo real para la sesión activa del operador.
  - Botón de pánico para revocar sesiones individuales o cerrar todas las demás sesiones remotas en un clic.
- **Detección de Accesos Sospechosos**: Generación automática de eventos de criticidad ALTA ante inicios de sesión desde nuevas direcciones IP o dispositivos nunca antes vistos.
- **Recuperación Segura de Contraseñas**: Flujo de restablecimiento guiado por código PIN temporal y sugeridor de contraseñas de alta entropía (16 caracteres).

---

### 4. Interfaz Web de Última Generación (`React + Vite`)
- **Diseño Cyberpunk / Dark Glassmorphism**: Estética moderna con microanimaciones, canvas espacial interactivo y destellos difuminados en componentes críticos.
- **Dashboard Analítico**:
  - Tarjetas de métricas en vivo (Eventos Totales, Incidentes Críticos, Nodos Activos, Nivel de Amenaza).
  - Gráficos interactivos de criticidad, actividad temporal y distribución por servidor (Recharts).
  - Explorador y filtrado avanzado de logs con modal de inspección de evidencia.
  - Exportación de auditoría en formatos **CSV, JSON y Excel (.xlsx)**.
- **Mapa Geoespacial de Ciberinfraestructura (Leaflet)**:
  - Visualización geográfica de servidores conectados.
  - Monitoreo en tiempo real de satélites (ISS), cables submarinos de fibra óptica, centros de IA y búnkeres de seguridad crítica.
- **Soporte Bilingüe Completo (i18n)**:
  - Alternancia instantánea entre **Español (ES)** e **Inglés (EN)** en todas las vistas, menús y formularios.
  - Selector de idioma accesible directamente desde la pantalla de login.
  - Persistencia automática de idioma y tema en `localStorage`.

---

## Stack Tecnológico

| Capa | Tecnologías |
| :--- | :--- |
| **Agente Cliente** | Python 3.10+, `asyncio`, `aiofiles`, `psutil`, `requests`, `openai`, `python-dotenv` |
| **Backend SOC** | Python, Django 5.2, Django REST Framework, SimpleJWT, Gunicorn, MySQL 8.0 |
| **Frontend Web** | React 18, Vite 6, Tailwind CSS, Lucide Icons, Recharts, Leaflet |
| **Infraestructura** | Docker, Docker Compose, Nginx (Reverse Proxy & Static Server), Systemd |
| **Integraciones** | Telegram Bot API, Servidores SMTP, OpenAI API |

---

## Requisitos Previos

- **Para el Servidor SOC Central**:
  - Linux (Debian 11/12, Ubuntu 22.04/24.04 o similar recomendado).
  - Docker y Docker Compose v2+.
  - Puertos `80` y `443` disponibles.
- **Para los Nodos / Servidores a Monitorear**:
  - Cualquier distribución Linux con Python 3.8+.
  - Conexión saliente HTTPS hacia el servidor del SOC.

---

## Instalación Rápida

### 1. Despliegue del SOC Central (Servidor Principal)

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/tu-usuario/agente_soc.git
   cd agente_soc
   ```

2. Configurar las variables de entorno:
   ```bash
   cp .env-example .env
   chmod 600 .env
   nano .env
   ```
   *(Asegúrate de definir `DJANGO_SECRET_KEY`, contraseñas de MySQL y credenciales de Telegram/SMTP).*

3. Levantar los contenedores con Docker Compose:
   ```bash
   docker compose up -d --build
   ```

4. Acceder al dashboard en tu navegador:
   ```
   https://tu-dominio.com  o  http://ip-del-servidor
   ```

---

### 2. Despliegue del Agente de Monitoreo (En cada servidor a vigilar)

El agente cuenta con un instalador automático que crea la carpeta `/opt/ai_soc_agent`, instala el entorno virtual y registra el servicio en Systemd:

```bash
# Ejecutar el instalador automatizado
sudo bash instalar_ai_soc_agent.sh
```

El script te solicitará la **URL del SOC** (ej. `https://soc.tudominio.com`) y la **API Key** generada para ese nodo en el panel.

Para gestionar el agente en el servidor cliente:
```bash
# Iniciar y habilitar el servicio para arranque automático
sudo systemctl enable --now ai_soc_agent

# Ver estado del servicio
sudo systemctl status ai_soc_agent

# Ver logs de patrullaje en tiempo real
journalctl -u ai_soc_agent -f
```

---

## Consideraciones de Seguridad y Buenas Prácticas

- **Principio de Mínimo Privilegio**: Las claves API de cada agente solo tienen permiso para ingresar logs y reportar heartbeat; no pueden leer información de otros servidores.
- **Protección de Secretos**: Los archivos `.env` y `.env-agent` deben mantenerse siempre con permisos `chmod 600` (`-rw-------`) y nunca comitearse a repositorios públicos.
- **Comunicaciones Cifradas**: Se recomienda encarecidamente utilizar HTTPS con certificados SSL/TLS válidos (Let's Encrypt o Cloudflare) para el endpoint central del SOC.

---

## Licencia

Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para más detalles.
