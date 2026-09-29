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

# Activa (True) o desactiva (False) el análisis con IA antes de enviar al SOC.
# Si es False, los eventos se envían crudos al dashboard, sin pasar por OpenAI.
USE_AI = os.getenv("USE_AI", "false").lower() in ("true", "1", "yes")

def sanitize_log_data(text: str) -> str:
    """
    Sanitiza datos sensibles (contraseñas, tokens, claves privadas, hashes)
    antes de enviarlos a OpenAI o a la base de datos central del SOC.
    """
    if not text:
        return text

    # 1. Claves privadas (RSA, OpenSSH, EC, DSA, PGP)
    text = re.sub(
        r'-----BEGIN [A-Z0-9\s_-]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9\s_-]+ PRIVATE KEY-----',
        '[REDACTED_PRIVATE_KEY]',
        text
    )

    # 2. Contraseñas y secretos en parámetros, flags y pares clave-valor comunes:
    text = re.sub(
        r'(?i)\b(password|passwd|pwd|pass|secret|token|api_?key|auth_?token|access_?token|client_?secret)\b(\s*[:=]\s*["\']?)([^"\'\s,;&]+)(["\']?)',
        r'\1\2[REDACTED_SECRET]\4',
        text
    )

    # 3. Tokens tipo Bearer
    text = re.sub(
        r'(?i)\bBearer\s+[A-Za-z0-9_\-\.]+',
        'Bearer [REDACTED_BEARER_TOKEN]',
        text
    )

    # 4. Credenciales en URLs de conexión (ej. http://user:password@host o mysql://...)
    text = re.sub(
        r'([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s\/]+):(.+?)@([a-zA-Z0-9_.-]+(?::\d+)?(?:[\/\?]|$))',
        r'\1\2:[REDACTED_PASSWORD]@\4',
        text
    )

    # 5. Hashes de contraseñas de Linux tipo $6$... o $y$...
    text = re.sub(
        r'\$(?:1|2[aby]|5|6|y)\$[a-zA-Z0-9.\/]+\$[a-zA-Z0-9.\/]{16,}',
        '[REDACTED_PASSWORD_HASH]',
        text
    )

    return text

# Ubicaciones de los logs a patrullar
POSSIBLE_LOGS = {
    "auth": "/var/log/auth.log",
    "snort": "/etc/snort/alert",
    "fail2ban": "/var/log/fail2ban.log",
    "ufw": "/var/log/ufw.log",
    "nginx_error": "/var/log/nginx/error.log",
    "apache_error": "/var/log/apache2/error.log",
    "syslog": "/var/log/syslog"
    #"kernel": "/var/log/kern.log"
}

# Palabras clave para pre-filtrado local (ignora mayúsculas/minúsculas)
KEYWORDS = [
    "error", "failed", "fail", "critical", "denied", "attack", "portscan",
    "nmap", "priority", "out of memory", "kill", #"kernel",
    "kernel panic", "segfault", "ban", "unban", "jail"
]

BATCH_INTERVAL = 15 # Segundos para agrupar logs antes de enviar a OpenAI
CACHE_EXPIRATION_SECONDS = 86400 # 24 horas en segundos

# ==========================================
# INICIALIZACIÓN
# ==========================================
client = AsyncOpenAI(api_key=OPENAI_API_KEY) if (OPENAI_API_KEY and USE_AI) else None
log_queue = asyncio.Queue(maxsize=500)
seen_fingerprints = set()

def get_log_fingerprint(line):
    """
    Limpia la línea de marcas de tiempo y PIDs para evitar hashes
    duplicados del mismo error, deteniendo el SPAM en Telegram.
    """
    clean = re.sub(r'\b\d{2}:\d{2}:\d{2}\b', '', line) # Hora (10:07:00)
    clean = re.sub(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b', '', clean) # Fechas (Jun 29)
    clean = re.sub(r'\b\d{2,4}[-/]\d{2}[-/]\d{2,4}\b', '', clean) # Fechas (2026-06-29)
    clean = re.sub(r'\[\s*\d+(\.\d+)?\]', '', clean) # PIDs ([1234]) y marcas kernel ([84235.197160])
    clean = re.sub(r'\b\d+#\d+\b', '', clean) # IDs de Nginx (1234#1234)
    return hashlib.md5(clean.encode()).hexdigest()


def classify_raw_event(log_batch):
    """Clasifica localmente un lote crudo cuando la IA está desactivada."""
    text = log_batch.lower()

    critical_patterns = (
        "ransomware",
        "malware",
        "rootkit",
        "reverse shell",
        "privilege escalation",
        "unauthorized access",
        "intrusion detected",
        "exploit",
        "sql injection",
        "command injection",
        "segmentation fault",
    )
    high_patterns = (
        "nmap",
        "portscan",
        "port scan",
        "masscan",
        "brute force",
        "brute-force",
        "multiple failed login",
        "possible attack",
        "scan detected",
        "syn flood",
        "dos attack",
        "denial of service",
        "unauthorized ssh connection",
        "unauthorized ssh",
        "unauthorized connection",
        "ssh attack",
        "ssh scan",
        "ssh brute force",
        "connection to port 22",
        "port 22 attack",
    )
    medium_patterns = (
        "failed password",
        "authentication failure",
        "invalid user",
        "login failure",
        "banned",
        "blocked",
        "denied",
        "jail",
        "repeated",
        "too many attempts",
        "connection refused",
        "segfault",
    )
    low_patterns = (
        "icmp",
        "ping",
        "echo request",
        "echo reply",
        "timeout",
    )

    if any(pattern in text for pattern in critical_patterns):
        return "CRITICA"
    if any(pattern in text for pattern in high_patterns):
        return "ALTA"
    if any(pattern in text for pattern in medium_patterns):
        return "MEDIA"
    if any(pattern in text for pattern in low_patterns):
        return "BAJA"
    return "INFO"


def send_to_soc(criticidad, mensaje, evidencia, resources):
    """Envía el reporte de seguridad estructurado al backend del SOC Dashboard."""
    if not SOC_API_KEY:
        print("ℹ️ SOC_API_KEY no configurada en .env. Omitiendo envío al Dashboard.")
        return

    # Sanitizar siempre antes del despacho para garantizar que ningún dato sensible llegue al SOC
    mensaje = sanitize_log_data(str(mensaje))
    evidencia = sanitize_log_data(str(evidencia))

    print("--- [DEBUG] Enviando reporte al SOC Central ---")
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
            print("✅ OK: Reporte registrado en la base de datos del SOC.")
        else:
            print(f"❌ ERROR SOC: El servidor respondió {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ ERROR DE CONEXIÓN AL SOC: {e}")

async def analyze_with_openai(log_batch, resources):
    """Llama a OpenAI y fuerza una respuesta estricta en JSON incluyendo evidencia."""
    if not client:
        print("⚠️ OpenAI no está configurado (falta OPENAI_API_KEY). Despachando evento crudo directo.")
        severity = classify_raw_event(log_batch)
        send_to_soc(
            severity,
            f"Evento detectado en {SERVER_NAME} ({severity})",
            log_batch,
            resources,
        )
        return

    print("--- [DEBUG] Llamando a OpenAI para analizar logs ---")
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": 'Analista SOC Senior. Responde UNICAMENTE en JSON válido usando comillas dobles ("). No uses comillas simples. No uses bloques de código markdown. Estructura exacta: {"criticidad": "BAJA|MEDIA|ALTA|CRITICA", "mensaje": "Un resumen corto en español", "evidencia": "Copia aquí un fragmento muy corto del log original que demuestre el error"}'
                },
                {"role": "user", "content": f"Servidor: {SERVER_NAME}\nEstado: {resources}\nLogs:\n{log_batch}"}
            ],
            temperature=0.1
        )
        content = response.choices[0].message.content.strip()

        # Limpieza agresiva de bloques de código (```json ... ```) en caso de que la IA los use
        content = re.sub(r'```json|```', '', content).strip()

        try:
            analysis = json.loads(content)
            criticidad = analysis.get("criticidad", "BAJA").upper()
            mensaje = analysis.get("mensaje", "Sin detalle")
            evidencia = analysis.get("evidencia", "No se extrajo evidencia")

            # Enviar el log de forma estructurada a nuestro Dashboard (MySQL)
            send_to_soc(criticidad, mensaje, evidencia, resources)

        except json.JSONDecodeError:
            print("⚠️ Falló el formato JSON, enviando respuesta cruda al SOC.")
            send_to_soc("INFO", content[:300], "Fallo de parseo JSON de OpenAI", resources)

    except Exception as e:
        print(f"❌ ERROR OPENAI: {e}")

async def tail_log_file(name, path):
    """Monitorea archivos de log en tiempo real."""
    if not os.path.exists(path):
        print(f"ℹ️ Saltando {name}: No existe.")
        return

    async with aiofiles.open(path, mode='r') as f:
        await f.seek(0, os.SEEK_END)
        print(f"Monitoreando: {name} ({path})")

        while True:
            line = await f.readline()
            if not line:
                await asyncio.sleep(0.5)
                continue

            line_lower = line.lower()
            if name == "snort" or any(k in line_lower for k in KEYWORDS):
                print(f"LOG DETECTADO en {name}")
                try:
                    log_queue.put_nowait(f"[{name}] {line.strip()}")
                except asyncio.QueueFull:
                    pass

async def log_processor():
    """Agrupa los eventos y administra la caché de 24 horas."""
    print(f"--- [DEBUG] Procesador de logs iniciado ---")
    last_flush_time = datetime.now()

    while True:
        await asyncio.sleep(BATCH_INTERVAL)

        # Limpieza de caché cada 24 horas
        current_time = datetime.now()
        if (current_time - last_flush_time).total_seconds() >= CACHE_EXPIRATION_SECONDS:
            seen_fingerprints.clear()
            last_flush_time = current_time
            print(f"[{current_time}] Memoria de alertas duplicadas limpia (24 horas).")

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
                # Envío directo, sin análisis de OpenAI, con clasificación local de severidad.
                severity = classify_raw_event(raw_batch)
                send_to_soc(
                    severity,
                    f"Evento crudo detectado en {SERVER_NAME} ({severity})",
                    raw_batch,
                    resources,
                )

async def heartbeat_sender():
    """Envía periódicamente el estado y los recursos del servidor al SOC."""
    url = f"{SOC_URL.rstrip('/')}/agents/ping/"

    while True:
        try:
            payload = {
                "api_key": SOC_API_KEY,
                "cpu_usage": round(psutil.cpu_percent(interval=0.2), 2),
                "memory_usage": round(psutil.virtual_memory().percent, 2),
                "disk_usage": round(
                    psutil.disk_usage(os.path.abspath(os.sep)).percent,
                    2,
                ),
            }
            response = requests.post(url, json=payload, timeout=5)

            if response.status_code != 200:
                print(
                    f"❌ ERROR HEARTBEAT: {response.status_code} - "
                    f"{response.text}"
                )
        except (requests.RequestException, OSError, ValueError) as exc:
            print(f"❌ ERROR HEARTBEAT: {exc}")

        await asyncio.sleep(15)


async def main():
    """Inicia los monitores, el procesador y el heartbeat."""
    print(f"AGENTE SOC INICIANDO EN {SERVER_NAME}")

    existentes = {
        name: path
        for name, path in POSSIBLE_LOGS.items()
        if os.path.exists(path)
    }
    if not existentes:
        print("⚠️ Aviso: No se encontró ningún archivo de log en /var/log en este momento. El agente continuará enviando telemetría de CPU/RAM/Disco y heartbeat al SOC.")

    tasks = [
        tail_log_file(name, path)
        for name, path in existentes.items()
    ]
    tasks.extend([log_processor(), heartbeat_sender()])
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
