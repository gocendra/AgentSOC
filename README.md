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
  - Cualquier distribución Linux con Python 3.10+.
  - Conexión saliente HTTPS hacia el servidor del SOC.

---

## 1. Instalación de AgentSOC 

Instalación Actualizar paquetes y instalar git

sudo apt update && sudo apt install git -y

Instalar Docker y Docke Compose

sudo apt update
sudo apt install ca-certificates curl -y

sudo install -m 0755 -d /etc/apt/keyrings sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \ "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \ $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \ sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update

sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

sudo usermod -aG docker $USER

newgrp docker

docker --version
docker compose version

git clone https://github.com/gocendra/AgentSOC.git

cd AgentSOC/

chmod +x deploy.sh

./deploy.sh

python3 -c "import secrets; print(secrets.token_urlsafe(64))"
o
openssl rand -base64 48 | tr -dc 'A-Za-z0-9_=-' | head -c 50; echo
El resultado colocarlo en DJANGO_SECRET_KEY

Cambiar contraseña de la base de datos > DB_PASSWORD

./deploy.sh --clean

Desde la LAN > http://IP-LAN Ingresa al sistema. (el navegador debe aceptar http)

Agregar los mail y crear los usuarios 

Agregar SMTP para el envió de mail, una vez agregado pide Autenticación en Dos Pasos (MFA) para los roles admin.


### 2. Despliegue del Agente de Monitoreo (En cada servidor a vigilar)

Para instalar script instalar_ai_soc_agent.sh, este script crea ai_soc_agent.py  y .env-agent  y el servicio en el server a monioterar.

>_ nano instalar_ai_soc_agent.sh  (pegan el contenido que esta github)

>_ chmod +x instalar_ai_soc_agent.sh (permisos de ejecución)

>_ ./instalar_ai_soc_agent.sh

variables en .env-agent

SOC_URL=https://soc.tudominio.com  (127.0.0.1:8000 desarrollo)
SOC_API_KEY=key_asignada_en_el_panel
USE_AI=False  (si queremos usar IA cambiar a true)
OPENAI_API_KEY=(Key de OpenAI)

Configurar que logs queremos monitorear de nuestro server en ai_soc_agent.py

POSSIBLE_LOGS = {
    "auth": "/var/log/auth.log",
    "snort": "/etc/snort/alert",
    "fail2ban": "/var/log/fail2ban.log",
    "ufw": "/var/log/ufw.log",
    "nginx_error": "/var/log/nginx/error.log",
    "apache_error": "/var/log/apache2/error.log",
    "syslog": "/var/log/syslog"
}


Una vez modificado reiniciar el servicio sudo systemctl restart ai_soc_agent.service 


## Consideraciones de Seguridad y Buenas Prácticas

- **Principio de Mínimo Privilegio**: Las claves API de cada agente solo tienen permiso para ingresar logs y reportar heartbeat; no pueden leer información de otros servidores.
- **Protección de Secretos**: Los archivos `.env` y `.env-agent` deben mantenerse siempre con permisos `chmod 600` (`-rw-------`) y nunca comitearse a repositorios públicos.
- **Comunicaciones Cifradas**: Se recomienda encarecidamente utilizar HTTPS con certificados SSL/TLS válidos (Let's Encrypt o Cloudflare) para el endpoint central del SOC.

## Requisitos del Sistema

A continuación se detallan los requisitos de hardware y software necesarios para el despliegue, dependiendo de la escala de la implementación:

| Recurso | Requisito Mínimo (Pruebas / 1 a 5 agentes) | Recomendado para Producción (10 a 50 agentes) | Empresa / Alto Tráfico (+100 agentes) |
| :--- | :--- | :--- | :--- |
| **Procesador (CPU)** | 2 vCPU / Cores | 2 a 4 vCPU | 4 a 8 vCPU |
| **Memoria RAM** | 2 GB (con Swap activo) | 4 GB | 8 GB o más |
| **Almacenamiento (Disco)** | 20 GB SSD | 40 - 60 GB SSD | 100+ GB SSD / NVMe |
| **Sistema Operativo** | Debian 11/12, Ubuntu 22.04/24.04 LTS, Rocky Linux / RHEL 9 | Debian 12 o Ubuntu 24.04 LTS | Debian 12 o Ubuntu 24.04 LTS |
| **Red** | 100 Mbps (IP fija o LAN) | 100 Mbps - 1 Gbps | 1 Gbps |

---

## Licencia

Autor: Lic. Gabriel Cendra 

Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para más detalles.
