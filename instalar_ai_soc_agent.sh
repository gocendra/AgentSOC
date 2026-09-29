#!/usr/bin/env bash
# ==============================================================================
# AgentSOC - Instalador Automatizado del Agente de Monitoreo para Linux
# ==============================================================================
# Este script realiza la instalación completa del agente en cualquier servidor:
# 1. Instala paquetes del sistema (python3, python3-venv, python3-pip, curl).
# 2. Crea la carpeta de instalación (/opt/ai_soc_agent o la que indiques).
# 3. Crea el entorno virtual de Python3 (venv).
# 4. Genera/Copia requerimientos_agente.txt e instala las librerías con pip.
# 5. Genera/Copia ai_soc_agent.py y .env-agent-example.
# 6. Inicializa .env-agent con permisos seguros (chmod 600).
# 7. Registra y configura el servicio Systemd (ai_soc_agent.service).
# ==============================================================================

set -e

# Colores para la terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # Sin color

echo -e "${CYAN}"
echo "================================================================="
echo "        🛡️  INSTALADOR DE AGENTE DE SEGURIDAD - AGENTSOC        "
echo "================================================================="
echo -e "${NC}"

# 1. Comprobar solicitud de ayuda rápida
if [[ "$*" == *"-h"* ]] || [[ "$*" == *"--help"* ]]; then
  echo "Uso: sudo bash $0 [opciones]"
  echo ""
  echo "Opciones disponibles:"
  echo "  --soc-url <URL>        URL del SOC central (ej. http://192.168.1.100:8000 o https://soc.udc.edu.ar)"
  echo "  --api-key <KEY>        API Key única asignada a este nodo"
  echo "  --install-dir <DIR>    Directorio de instalación (por defecto: /opt/ai_soc_agent)"
  echo "  --auto-start           Habilita e inicia el servicio Systemd automáticamente"
  echo "  --force                Sobrescribe la configuración existente en .env-agent"
  echo "  -h, --help             Muestra esta ayuda"
  exit 0
fi

# 2. Verificar permisos de superusuario (root)
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Este script debe ejecutarse como root o con sudo.${NC}"
  echo -e "Por favor ejecuta: ${YELLOW}sudo bash $0${NC}"
  exit 1
fi

# 3. Procesar argumentos de línea de comandos
INSTALL_DIR="/opt/ai_soc_agent"
SOC_URL_ARG=""
SOC_API_KEY_ARG=""
AUTO_START=false
FORCE=false
INSTALL_DIR_CUSTOM=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --soc-url)
      SOC_URL_ARG="$2"
      shift 2
      ;;
    --api-key)
      SOC_API_KEY_ARG="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      INSTALL_DIR_CUSTOM=true
      shift 2
      ;;
    --auto-start)
      AUTO_START=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      echo "Uso: sudo bash $0 [opciones]"
      echo ""
      echo "Opciones disponibles:"
      echo "  --soc-url <URL>        URL del SOC central (ej. http://192.168.1.100:8000 o https://soc.udc.edu.ar)"
      echo "  --api-key <KEY>        API Key única asignada a este nodo"
      echo "  --install-dir <DIR>    Directorio de instalación (por defecto: /opt/ai_soc_agent)"
      echo "  --auto-start           Habilita e inicia el servicio Systemd automáticamente"
      echo "  --force                Sobrescribe la configuración existente en .env-agent"
      echo "  -h, --help             Muestra esta ayuda"
      exit 0
      ;;
    *)
      if [[ "$1" != --* ]] && [ "$INSTALL_DIR_CUSTOM" = false ]; then
        INSTALL_DIR="$1"
        INSTALL_DIR_CUSTOM=true
        shift
      else
        echo "Opción no reconocida: $1"
        shift
      fi
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}[INFO]${NC} Directorio de destino: ${GREEN}${INSTALL_DIR}${NC}"
mkdir -p "${INSTALL_DIR}"

# 3. Detectar e instalar dependencias del sistema operativo
echo -e "${BLUE}[INFO]${NC} Verificando dependencias del sistema (Python3, Venv, Pip, Curl)..."

if command -v apt-get &> /dev/null; then
    echo -e "${BLUE}[INFO]${NC} Gestor detectado: apt (Debian / Ubuntu / Kali / Mint)"
    apt-get update -qq || true
    apt-get install -y -qq python3 python3-venv python3-pip curl rsyslog > /dev/null 2>&1 || \
    apt-get install -y -qq python3 python3-venv python3-pip curl > /dev/null 2>&1
elif command -v dnf &> /dev/null; then
    echo -e "${BLUE}[INFO]${NC} Gestor detectado: dnf (RHEL / Rocky / AlmaLinux / Fedora)"
    dnf install -y python3 python3-pip curl > /dev/null
elif command -v yum &> /dev/null; then
    echo -e "${BLUE}[INFO]${NC} Gestor detectado: yum (CentOS / RHEL)"
    yum install -y python3 python3-pip curl > /dev/null
elif command -v pacman &> /dev/null; then
    echo -e "${BLUE}[INFO]${NC} Gestor detectado: pacman (Arch Linux)"
    pacman -Sy --noconfirm python python-pip curl > /dev/null
elif command -v apk &> /dev/null; then
    echo -e "${BLUE}[INFO]${NC} Gestor detectado: apk (Alpine Linux)"
    apk add --no-cache python3 py3-pip curl > /dev/null
else
    echo -e "${YELLOW}[ADVERTENCIA] No se pudo identificar el gestor de paquetes. Asegúrate de tener python3 y venv instalados.${NC}"
fi

# 4. Crear o copiar requerimientos_agente.txt
echo -e "${BLUE}[INFO]${NC} Preparando requerimientos_agente.txt..."
if [ -f "${SCRIPT_DIR}/requerimientos_agente.txt" ]; then
    cp "${SCRIPT_DIR}/requerimientos_agente.txt" "${INSTALL_DIR}/requerimientos_agente.txt"
else
    cat << 'EOF' > "${INSTALL_DIR}/requerimientos_agente.txt"
aiofiles>=23.0.0
psutil>=5.9.0
requests>=2.31.0
python-dotenv>=1.0.0
openai>=1.0.0
EOF
fi

# 5. Crear Entorno Virtual e Instalar Librerías
echo -e "${BLUE}[INFO]${NC} Creando entorno virtual de Python3 en ${INSTALL_DIR}/venv..."
if [ ! -d "${INSTALL_DIR}/venv" ]; then
    python3 -m venv "${INSTALL_DIR}/venv"
fi

echo -e "${BLUE}[INFO]${NC} Instalando dependencias en el entorno virtual..."
"${INSTALL_DIR}/venv/bin/pip" install --upgrade pip -q
"${INSTALL_DIR}/venv/bin/pip" install -r "${INSTALL_DIR}/requerimientos_agente.txt" -q
echo -e "${GREEN}[OK]${NC} Librerías instaladas correctamente."

# 6. Crear o copiar ai_soc_agent.py
echo -e "${BLUE}[INFO]${NC} Instalando ai_soc_agent.py..."
if [ -f "${SCRIPT_DIR}/ai_soc_agent.py" ]; then
    cp "${SCRIPT_DIR}/ai_soc_agent.py" "${INSTALL_DIR}/ai_soc_agent.py"
else
    # Si el script se ejecuta de forma independiente en un server sin el repo
    cat << 'EOF' > "${INSTALL_DIR}/ai_soc_agent.py"
import asyncio
import aiofiles
import os
import json
import hashlib
import psutil
import requests
import re
import socket
from openai import AsyncOpenAI
from datetime import datetime
from dotenv import load_dotenv

# Cargar variables de entorno: priorizar .env-agent si existe, sino cargar .env
_agent_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env-agent")
if os.path.exists(_agent_env):
    load_dotenv(_agent_env)
else:
    load_dotenv()

# ==========================================
# CONFIGURACIÓN DEL AGENTE
# ==========================================
SERVER_NAME = socket.gethostname()
SOC_URL = os.getenv("SOC_URL", "http://127.0.0.1:8000")
SOC_API_KEY = os.getenv("SOC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

USE_AI = os.getenv("USE_AI", "false").lower() in ("true", "1", "yes")

def sanitize_log_data(text: str) -> str:
    """Sanitiza datos sensibles antes de enviarlos al SOC o OpenAI."""
    if not text:
        return text

    # 1. Claves privadas
    text = re.sub(
        r'-----BEGIN [A-Z0-9\s_-]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9\s_-]+ PRIVATE KEY-----',
        '[REDACTED_PRIVATE_KEY]',
        text
    )

    # 2. Contraseñas y secretos
    text = re.sub(
        r'(?i)\b(password|passwd|pwd|pass|secret|token|api_?key|auth_?token|access_?token|client_?secret)\b(\s*[:=]\s*["\']?)([^"\'\s,;&]+)(["\']?)',
        r'\1\2[REDACTED_SECRET]\4',
        text
    )

    # 3. Tokens Bearer
    text = re.sub(r'(?i)\bBearer\s+[A-Za-z0-9_\-\.]+', 'Bearer [REDACTED_BEARER_TOKEN]', text)

    # 4. Credenciales en URLs
    text = re.sub(
        r'([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s\/]+):(.+?)@([a-zA-Z0-9_.-]+(?::\d+)?(?:[\/\?]|$))',
        r'\1\2:[REDACTED_PASSWORD]@\4',
        text
    )

    # 5. Hashes de Linux
    text = re.sub(r'\$(?:1|2[aby]|5|6|y)\$[a-zA-Z0-9.\/]+\$[a-zA-Z0-9.\/]{16,}', '[REDACTED_PASSWORD_HASH]', text)
    return text

POSSIBLE_LOGS = {
    "auth": "/var/log/auth.log",
    "snort": "/etc/snort/alert",
    "fail2ban": "/var/log/fail2ban.log",
    "ufw": "/var/log/ufw.log",
    "nginx_error": "/var/log/nginx/error.log",
    "apache_error": "/var/log/apache2/error.log",
    "syslog": "/var/log/syslog"
}

KEYWORDS = [
    "error", "failed", "fail", "critical", "denied", "attack", "portscan",
    "nmap", "priority", "out of memory", "kill", "kernel panic", "segfault", "ban", "unban", "jail"
]

BATCH_INTERVAL = 15
CACHE_EXPIRATION_SECONDS = 86400

client = AsyncOpenAI(api_key=OPENAI_API_KEY) if (OPENAI_API_KEY and USE_AI) else None
log_queue = asyncio.Queue(maxsize=500)
seen_fingerprints = set()

def get_log_fingerprint(line):
    clean = re.sub(r'\b\d{2}:\d{2}:\d{2}\b', '', line)
    clean = re.sub(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b', '', clean)
    clean = re.sub(r'\b\d{2,4}[-/]\d{2}[-/]\d{2,4}\b', '', clean)
    clean = re.sub(r'\[\s*\d+(\.\d+)?\]', '', clean)
    clean = re.sub(r'\b\d+#\d+\b', '', clean)
    return hashlib.md5(clean.encode()).hexdigest()

def classify_raw_event(log_batch):
    text = log_batch.lower()
    critical_patterns = ("ransomware", "malware", "rootkit", "reverse shell", "privilege escalation", "unauthorized access", "intrusion detected", "exploit", "sql injection", "command injection", "segmentation fault")
    high_patterns = ("nmap", "portscan", "port scan", "masscan", "brute force", "brute-force", "multiple failed login", "possible attack", "scan detected", "syn flood", "dos attack", "denial of service", "unauthorized ssh connection", "unauthorized ssh", "ssh attack", "ssh brute force")
    medium_patterns = ("failed password", "authentication failure", "invalid user", "login failure", "banned", "blocked", "denied", "jail", "too many attempts", "connection refused", "segfault")
    low_patterns = ("icmp", "ping", "echo request", "echo reply", "timeout")

    if any(p in text for p in critical_patterns): return "CRITICA"
    if any(p in text for p in high_patterns): return "ALTA"
    if any(p in text for p in medium_patterns): return "MEDIA"
    if any(p in text for p in low_patterns): return "BAJA"
    return "INFO"

def send_to_soc(criticidad, mensaje, evidencia, resources):
    if not SOC_API_KEY:
        print("ℹ️ SOC_API_KEY no configurada. Omitiendo envio.")
        return

    mensaje = sanitize_log_data(str(mensaje))
    evidencia = sanitize_log_data(str(evidencia))
    url = f"{SOC_URL.rstrip('/')}/logs/ingest/"
    payload = {
        "api_key": SOC_API_KEY,
        "criticality": criticidad,
        "message": mensaje,
        "evidence": evidencia,
        "resources_info": resources
    }
    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code == 201:
            print("✅ Reporte enviado al SOC.")
        else:
            print(f"❌ Error SOC: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ Error de conexion al SOC: {e}")

async def analyze_with_openai(log_batch, resources):
    if not client:
        severity = classify_raw_event(log_batch)
        send_to_soc(severity, f"Evento detectado en {SERVER_NAME} ({severity})", log_batch, resources)
        return

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": 'Analista SOC Senior. Responde UNICAMENTE en JSON valido usando comillas dobles ("). Estructura: {"criticidad": "BAJA|MEDIA|ALTA|CRITICA", "mensaje": "Resumen en español", "evidencia": "Fragmento del log"}'},
                {"role": "user", "content": f"Servidor: {SERVER_NAME}\nEstado: {resources}\nLogs:\n{log_batch}"}
            ],
            temperature=0.1
        )
        content = re.sub(r'```json|```', '', response.choices[0].message.content.strip()).strip()
        try:
            analysis = json.loads(content)
            send_to_soc(analysis.get("criticidad", "BAJA").upper(), analysis.get("mensaje", "Sin detalle"), analysis.get("evidencia", ""), resources)
        except json.JSONDecodeError:
            send_to_soc("INFO", content[:300], "Fallo parseo JSON", resources)
    except Exception as e:
        print(f"❌ ERROR OPENAI: {e}")

async def tail_log_file(name, path):
    if not os.path.exists(path):
        return

    async with aiofiles.open(path, mode='r') as f:
        await f.seek(0, os.SEEK_END)
        print(f"Patrullando log: {name} ({path})")
        while True:
            line = await f.readline()
            if not line:
                await asyncio.sleep(0.5)
                continue
            line_lower = line.lower()
            if name == "snort" or any(k in line_lower for k in KEYWORDS):
                try:
                    log_queue.put_nowait(f"[{name}] {line.strip()}")
                except asyncio.QueueFull:
                    pass

async def log_processor():
    last_flush_time = datetime.now()
    while True:
        await asyncio.sleep(BATCH_INTERVAL)
        current_time = datetime.now()
        if (current_time - last_flush_time).total_seconds() >= CACHE_EXPIRATION_SECONDS:
            seen_fingerprints.clear()
            last_flush_time = current_time

        batch = []
        while not log_queue.empty():
            line = await log_queue.get()
            fprint = get_log_fingerprint(line)
            if fprint not in seen_fingerprints:
                batch.append(line)
                seen_fingerprints.add(fprint)

        if batch:
            cpu = psutil.cpu_percent()
            ram = psutil.virtual_memory().percent
            raw_batch = sanitize_log_data("\n".join(batch))
            resources = f"CPU: {cpu}% | RAM: {ram}%"
            if USE_AI and client:
                await analyze_with_openai(raw_batch, resources)
            else:
                severity = classify_raw_event(raw_batch)
                send_to_soc(severity, f"Evento crudo detectado en {SERVER_NAME} ({severity})", raw_batch, resources)

async def heartbeat_sender():
    url = f"{SOC_URL.rstrip('/')}/agents/ping/"
    while True:
        try:
            payload = {
                "api_key": SOC_API_KEY,
                "cpu_usage": round(psutil.cpu_percent(interval=0.2), 2),
                "memory_usage": round(psutil.virtual_memory().percent, 2),
                "disk_usage": round(psutil.disk_usage(os.path.abspath(os.sep)).percent, 2),
            }
            requests.post(url, json=payload, timeout=5)
        except Exception as exc:
            pass
        await asyncio.sleep(15)

async def main():
    print(f"🚀 AGENTE SOC INICIANDO EN {SERVER_NAME}")
    existentes = {name: path for name, path in POSSIBLE_LOGS.items() if os.path.exists(path)}
    if not existentes:
        print("⚠️ No se encontraron archivos de log estándar en /var/log. Patrullando heartbeat del nodo.")
    tasks = [tail_log_file(name, path) for name, path in existentes.items()]
    tasks.extend([log_processor(), heartbeat_sender()])
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
EOF
fi

chmod 755 "${INSTALL_DIR}/ai_soc_agent.py"
echo -e "${GREEN}[OK]${NC} ai_soc_agent.py preparado."

# 7. Crear .env-agent-example y .env-agent
echo -e "${BLUE}[INFO]${NC} Configurando archivos de entorno..."
cat << 'EOF' > "${INSTALL_DIR}/.env-agent-example"
SOC_URL=https://soc.tudominio.com
SOC_API_KEY=key_asignada_en_el_panel
USE_AI=False
OPENAI_API_KEY=
EOF

# Si no existe .env-agent o se indicó --force, crearlo a partir del ejemplo
if [ ! -f "${INSTALL_DIR}/.env-agent" ] || [ "$FORCE" = true ]; then
    cp "${INSTALL_DIR}/.env-agent-example" "${INSTALL_DIR}/.env-agent"
fi

# Aplicar argumentos CLI si fueron pasados
if [ -n "$SOC_URL_ARG" ]; then
    sed -i "s|^SOC_URL=.*|SOC_URL=${SOC_URL_ARG}|g" "${INSTALL_DIR}/.env-agent"
    echo -e "${GREEN}[OK]${NC} SOC_URL configurada: ${CYAN}${SOC_URL_ARG}${NC}"
fi

if [ -n "$SOC_API_KEY_ARG" ]; then
    sed -i "s|^SOC_API_KEY=.*|SOC_API_KEY=${SOC_API_KEY_ARG}|g" "${INSTALL_DIR}/.env-agent"
    echo -e "${GREEN}[OK]${NC} SOC_API_KEY configurada para este servidor."
fi

# Si la clave sigue siendo el placeholder o está vacía, y estamos en terminal interactiva, solicitarla
CURRENT_KEY=$(grep -E '^SOC_API_KEY=' "${INSTALL_DIR}/.env-agent" | cut -d '=' -f2- | tr -d ' "\r\n')
if [ "$CURRENT_KEY" = "key_asignada_en_el_panel" ] || [ -z "$CURRENT_KEY" ]; then
    if [ -t 0 ]; then
        echo ""
        echo -e "${CYAN}--- Configuración Inicial del Agente ---${NC}"
        if [ -z "$SOC_URL_ARG" ]; then
            read -p "Ingresa la URL del SOC Central [ej: http://192.168.1.100:8000]: " input_url
            if [ -n "$input_url" ]; then
                sed -i "s|^SOC_URL=.*|SOC_URL=${input_url}|g" "${INSTALL_DIR}/.env-agent"
            fi
        fi

        read -p "Ingresa la SOC_API_KEY única asignada a este nodo: " input_key
        if [ -n "$input_key" ]; then
            sed -i "s|^SOC_API_KEY=.*|SOC_API_KEY=${input_key}|g" "${INSTALL_DIR}/.env-agent"
            CURRENT_KEY="$input_key"
        fi
    fi
fi

# Permisos seguros para las credenciales
chmod 600 "${INSTALL_DIR}/.env-agent"
chmod 644 "${INSTALL_DIR}/.env-agent-example"
echo -e "${GREEN}[OK]${NC} Archivos de configuración preparados con permisos estrictos (chmod 600)."

# 8. Configurar servicio Systemd
echo -e "${BLUE}[INFO]${NC} Configurando servicio Systemd para ejecución 24/7..."
cat << EOF > /etc/systemd/system/ai_soc_agent.service
[Unit]
Description=AgentSOC Security Monitoring Agent Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env-agent
ExecStart=${INSTALL_DIR}/venv/bin/python3 ${INSTALL_DIR}/ai_soc_agent.py
Restart=always
RestartSec=10
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# Iniciar automáticamente si se solicitó o si ya tiene una API Key válida
ACTIVE_KEY=$(grep -E '^SOC_API_KEY=' "${INSTALL_DIR}/.env-agent" | cut -d '=' -f2- | tr -d ' "\r\n')
SERVICE_STARTED=false

if command -v systemctl &> /dev/null; then
    if [ "$AUTO_START" = true ] || ([ -n "$ACTIVE_KEY" ] && [ "$ACTIVE_KEY" != "key_asignada_en_el_panel" ]); then
        echo -e "${BLUE}[INFO]${NC} Habilitando e iniciando servicio ai_soc_agent..."
        systemctl enable --now ai_soc_agent || true
        SERVICE_STARTED=true
        echo -e "${GREEN}[OK]${NC} Servicio ai_soc_agent activo y reportando al SOC central."
    fi
fi

echo -e "\n${GREEN}=================================================================${NC}"
echo -e "${GREEN}   ✅ INSTALACIÓN DE AGENTSOC COMPLETADA CON ÉXITO   ${NC}"
echo -e "${GREEN}=================================================================${NC}"
echo -e "📁 Directorio: ${YELLOW}${INSTALL_DIR}${NC}"
echo -e "⚙️  Archivo de configuración: ${YELLOW}${INSTALL_DIR}/.env-agent${NC}"
echo -e "🐍 Entorno virtual: ${YELLOW}${INSTALL_DIR}/venv${NC}"
echo -e "🛠️  Servicio Systemd: ${YELLOW}/etc/systemd/system/ai_soc_agent.service${NC}"
echo ""
if [ "$SERVICE_STARTED" = true ]; then
    echo -e "${GREEN}🟢 El agente ya está en ejecución y enviando métricas.${NC}"
    echo -e "   Para ver el log en vivo: ${YELLOW}journalctl -u ai_soc_agent -f${NC}"
    echo -e "   Para ver el estado:      ${YELLOW}systemctl status ai_soc_agent${NC}"
else
    echo -e "${CYAN}Pasos siguientes para poner en marcha el agente:${NC}"
    echo -e "1. Revisa o ajusta tu API Key en: ${YELLOW}nano ${INSTALL_DIR}/.env-agent${NC}"
    echo -e "2. Inicia y habilita el servicio: ${YELLOW}systemctl enable --now ai_soc_agent${NC}"
    echo -e "3. Monitorea los logs en tiempo real: ${YELLOW}journalctl -u ai_soc_agent -f${NC}"
fi
echo "================================================================="

