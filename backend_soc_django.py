import ipaddress
import json
import math
import urllib.request
import csv
import io
import hashlib
import os
import sys
import time
import subprocess
import threading
import datetime
import requests
import random
import re
import secrets
import socket
import platform
import psutil
import smtplib
import uuid
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# Configuración exclusiva del backend SOC.
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

# Cuando es importado por Gunicorn / WSGI (gunicorn backend_soc_django:application):
# Enlazar este módulo con __main__ para que Django registre los modelos y migraciones bajo '__main__'
_is_direct_entrypoint = (__name__ == '__main__')
if not _is_direct_entrypoint:
    sys.modules['__main__'] = sys.modules[__name__]
    __name__ = '__main__'

import django
from django.conf import settings
from datetime import timedelta
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.core.management import execute_from_command_line, call_command

# ==========================================
# 1. CONFIGURACIÓN DE DJANGO (SETTINGS)
# ==========================================
# Se configura Django "al vuelo" para funcionar en un solo archivo
if not settings.configured:
    settings.configure(
        DEBUG=os.environ.get('DEBUG', 'True').lower() in ('true', '1'),
        SECRET_KEY=os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-soc-central-jwt-signing-key-32bytes-min-length-auth-token-2026'),
        ROOT_URLCONF=__name__,
        ALLOWED_HOSTS=['*'],
        DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
        MIGRATION_MODULES={'__main__': 'migrations'},
        INSTALLED_APPS=[
            'django.contrib.auth',
            'django.contrib.contenttypes',
            'rest_framework',
            'rest_framework_simplejwt',
            'corsheaders',
            '__main__',
        ],
        MIDDLEWARE=[
            'corsheaders.middleware.CorsMiddleware',
            'django.middleware.common.CommonMiddleware',
        ],
        SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'),
        CORS_ALLOW_ALL_ORIGINS=True,
        CORS_ALLOW_HEADERS=[
            'accept',
            'accept-encoding',
            'authorization',
            'content-type',
            'dnt',
            'origin',
            'user-agent',
            'x-csrftoken',
            'x-requested-with',
            'x-session-token',
        ],
        DATABASES={
            'default': {
                'ENGINE': 'django.db.backends.mysql',
                'NAME': os.environ.get('DB_NAME', 'soc_central'),
                'USER': os.environ.get('DB_USER', 'root'),
                'PASSWORD': os.environ.get('DB_PASSWORD', 'root'),
                'HOST': os.environ.get('DB_HOST', 'localhost'),
                'PORT': os.environ.get('DB_PORT', '3306'),
            }
        },
        REST_FRAMEWORK={
            'DEFAULT_AUTHENTICATION_CLASSES': (
                'rest_framework_simplejwt.authentication.JWTAuthentication',
            ),
            'DEFAULT_PERMISSION_CLASSES': (
                'rest_framework.permissions.IsAuthenticated',
            ),
        },
        SIMPLE_JWT={
            'ACCESS_TOKEN_LIFETIME': timedelta(hours=24),
            'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
            'ROTATE_REFRESH_TOKENS': True,
        },
        LOGGING={
            'version': 1,
            'disable_existing_loggers': False,
            'handlers': {
                'console': {
                    'class': 'logging.StreamHandler',
                },
            },
            'root': {
                'handlers': ['console'],
                'level': 'INFO',
            },
            'loggers': {
                'django.request': {
                    'handlers': ['console'],
                    'level': 'ERROR',
                    'propagate': False,
                },
            },
        },
    )
    django.setup()

# ==========================================
# 2. MODELOS DE BASE DE DATOS (ORM)
# ==========================================
from django.db import models
from django.utils.timezone import now
from django.contrib.auth.models import User

# Extensión del usuario estándar de Django para agregar Roles y Seguridad


def default_telegram_severities():
    return ['ALTA', 'CRITICA']


class AIConfig(models.Model):
    provider = models.CharField(max_length=50, default='gemini')
    model_name = models.CharField(max_length=100, default='gemini-2.5-flash')
    api_key = models.CharField(max_length=255, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class EmailConfig(models.Model):
    smtp_host = models.CharField(max_length=255, default='smtp.gmail.com', blank=True)
    smtp_port = models.IntegerField(default=587)
    smtp_user = models.CharField(max_length=255, blank=True, default='')
    smtp_password = models.CharField(max_length=255, blank=True, default='')
    smtp_use_tls = models.BooleanField(default=True)
    smtp_use_ssl = models.BooleanField(default=False)
    from_name = models.CharField(max_length=100, default='AgentSOC Seguridad', blank=True)
    from_email = models.CharField(max_length=255, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)


class SystemBranding(models.Model):
    company_name = models.CharField(max_length=200, blank=True, default='')
    custom_welcome_text = models.CharField(max_length=255, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)


class UserProfile(models.Model):
    ROLE_CHOICES = (
        ('admin', 'Administrador'),
        ('write', 'Escritura'),
        ('read', 'Lectura'),
    )
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='read')
    failed_attempts = models.IntegerField(default=0)
    is_locked = models.BooleanField(default=False)
    locked_until = models.DateTimeField(null=True, blank=True)
    reset_code = models.CharField(max_length=20, blank=True, default='')
    reset_code_expires = models.DateTimeField(null=True, blank=True)
    telegram_chat_id = models.CharField(max_length=100, blank=True)
    telegram_bot_token = models.CharField(max_length=200, blank=True, default='')
    telegram_severities = models.JSONField(default=default_telegram_severities)
    mfa_token = models.CharField(max_length=64, blank=True, default='')
    mfa_code = models.CharField(max_length=20, blank=True, default='')
    mfa_code_expires = models.DateTimeField(null=True, blank=True)
    mfa_last_sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.user.username} - {self.role}"


class UserSession(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')
    session_token = models.CharField(max_length=64, unique=True, db_index=True)
    ip_address = models.CharField(max_length=50)
    user_agent = models.TextField(blank=True)
    device_name = models.CharField(max_length=150, default='Dispositivo desconocido')
    device_type = models.CharField(max_length=50, default='desktop') # desktop, mobile, tablet
    location = models.CharField(max_length=150, default='Red Interna / Local')
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    country = models.CharField(max_length=100, blank=True, default='')
    city = models.CharField(max_length=100, blank=True, default='')
    is_tor = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_suspicious = models.BooleanField(default=False)
    suspicious_reason = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'user_sessions'
        ordering = ['-last_activity']

    def __str__(self):
        return f"{self.user.username} - {self.device_name} ({self.ip_address})"


class SecurityPolicy(models.Model):
    enforce_mfa_admin = models.BooleanField(default=True)
    enforce_mfa_all = models.BooleanField(default=False)
    max_active_sessions_per_user = models.IntegerField(default=5)
    session_timeout_hours = models.IntegerField(default=24)
    alert_on_new_device = models.BooleanField(default=True)
    alert_on_new_ip = models.BooleanField(default=True)
    notify_suspicious_email = models.BooleanField(default=True)
    notify_suspicious_telegram = models.BooleanField(default=True)
    detect_impossible_travel = models.BooleanField(default=True)
    impossible_travel_speed_kmh = models.IntegerField(default=800)
    detect_tor_exit_nodes = models.BooleanField(default=True)
    block_tor_logins = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'security_policies'

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(id=1)
        return obj


class TorExitNode(models.Model):
    ip_address = models.CharField(max_length=50, unique=True, db_index=True)
    last_seen = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'tor_exit_nodes'

    def __str__(self):
        return self.ip_address


class IPGeolocation(models.Model):
    ip_address = models.CharField(max_length=50, unique=True, db_index=True)
    country = models.CharField(max_length=100, blank=True, default='')
    city = models.CharField(max_length=100, blank=True, default='')
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    isp = models.CharField(max_length=150, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ip_geolocations'

    def __str__(self):
        return f"{self.ip_address} - {self.city}, {self.country}"


class TrustedAccess(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='trusted_accesses')
    ip_address = models.CharField(max_length=50, blank=True, default='')
    device_name = models.CharField(max_length=150, blank=True, default='')
    note = models.CharField(max_length=255, blank=True, default='Autorizado como legítimo')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'trusted_accesses'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} - {self.ip_address} ({self.device_name})"


class IOCIndicator(models.Model):
    INDICATOR_TYPES = [
        ('ip', 'Dirección IP'),
        ('domain', 'Nombre de Dominio'),
        ('hash_md5', 'Hash MD5'),
        ('hash_sha256', 'Hash SHA256'),
        ('url', 'URL Maliciosa'),
    ]
    THREAT_TYPES = [
        ('c2_botnet', 'C2 / Servidor de Comando y Control'),
        ('malware', 'Distribución de Malware'),
        ('ransomware', 'Ransomware / Extorsión'),
        ('phishing', 'Phishing / Robo de Credenciales'),
        ('scanner', 'Escáner / Explotación de Vulnerabilidades'),
        ('tor_exit', 'Nodo de Salida Tor'),
        ('brute_force', 'Ataque de Fuerza Bruta / Credential Stuffing'),
    ]
    SEVERITY_LEVELS = [
        ('CRITICA', 'Crítica'),
        ('ALTA', 'Alta'),
        ('MEDIA', 'Media'),
        ('BAJA', 'Baja'),
    ]

    indicator_value = models.CharField(max_length=191, unique=True, db_index=True)
    indicator_type = models.CharField(max_length=20, choices=INDICATOR_TYPES, default='ip', db_index=True)
    threat_type = models.CharField(max_length=50, choices=THREAT_TYPES, default='c2_botnet', db_index=True)
    malware_family = models.CharField(max_length=100, blank=True, default='', db_index=True)
    source = models.CharField(max_length=100, default='Feodo Tracker (abuse.ch)')
    confidence = models.IntegerField(default=85)
    severity = models.CharField(max_length=20, choices=SEVERITY_LEVELS, default='CRITICA')
    is_active = models.BooleanField(default=True, db_index=True)
    hit_count = models.IntegerField(default=0)
    last_hit_at = models.DateTimeField(null=True, blank=True)
    description = models.TextField(blank=True, default='')
    tags = models.CharField(max_length=255, blank=True, default='')
    first_seen = models.DateTimeField(default=timezone.now)
    last_seen = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'ioc_indicators'
        ordering = ['-last_seen']

    def __str__(self):
        return f"[{self.indicator_type.upper()}] {self.indicator_value} ({self.malware_family or self.threat_type})"


class IOCHit(models.Model):
    indicator_value = models.CharField(max_length=191, db_index=True)
    indicator_type = models.CharField(max_length=20, default='ip')
    threat_type = models.CharField(max_length=50, default='c2_botnet')
    malware_family = models.CharField(max_length=100, blank=True, default='')
    source_feed = models.CharField(max_length=100, blank=True, default='')
    severity = models.CharField(max_length=20, default='CRITICA')
    source_event = models.CharField(max_length=255, default='Desconocido')
    matched_value = models.CharField(max_length=191)
    client_ip = models.CharField(max_length=50, blank=True, default='')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='ioc_hits')
    action_taken = models.CharField(max_length=150, default='Alerta SOC Generada')
    details = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'ioc_hits'
        ordering = ['-created_at']

    def __str__(self):
        return f"IOC Hit: {self.indicator_value} ({self.malware_family}) at {self.created_at}"


def generate_default_agent_api_key():
    import uuid
    return f"key_{uuid.uuid4().hex[:16]}"


class Agent(models.Model):
    STATUS_CHOICES = (
        ('active', 'Activo'),
        ('inactive', 'Inactivo'),
        ('maintenance', 'Mantenimiento'),
    )
    name = models.CharField(max_length=100)
    ip_address = models.CharField(max_length=45)
    api_key = models.CharField(max_length=100, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    cpu_usage = models.FloatField(null=True, blank=True)
    memory_usage = models.FloatField(null=True, blank=True)
    disk_usage = models.FloatField(null=True, blank=True)
    metrics_updated_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.api_key:
            self.api_key = generate_default_agent_api_key()
        super().save(*args, **kwargs)


class Log(models.Model):
    CRITICALITY_CHOICES = (
        ('BAJA', 'Baja'),
        ('MEDIA', 'Media'),
        ('ALTA', 'Alta'),
        ('CRITICA', 'Crítica'),
        ('INFO', 'Info'),
    )
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name='logs')
    criticality = models.CharField(max_length=20, choices=CRITICALITY_CHOICES)
    message = models.TextField()
    evidence = models.TextField(blank=True, null=True)
    resources_info = models.CharField(max_length=255, blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)


class UbicacionTecnologica(models.Model):
    TIPOS = [
        ('udc', 'UDC / Educación'),
        ('datacenter', 'Data Center'),
        ('tech', 'Empresa Tech'),
        ('ciencia', 'Ciencia / Observatorio'),
        ('seguridad', 'Ciberseguridad / Militar'),
        ('fibra', 'Punto de Aterrizaje Fibra'),
    ]

    nombre = models.CharField(max_length=100)
    descripcion = models.TextField()
    latitud = models.FloatField()
    longitud = models.FloatField()
    tipo = models.CharField(max_length=20, choices=TIPOS)
    creado_en = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.nombre


class Domain(models.Model):
    name = models.CharField(max_length=255, unique=True)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='monitored_domains')
    check_interval_seconds = models.IntegerField(default=60)
    custom_telegram_chat_id = models.CharField(max_length=100, blank=True, default='')
    is_monitoring = models.BooleanField(default=False)
    is_ip = models.BooleanField(default=False)
    last_status = models.CharField(max_length=20, default='unknown')  # 'online', 'offline', 'unknown'
    last_http_code = models.CharField(max_length=20, blank=True, default='')
    response_time_ms = models.FloatField(null=True, blank=True)
    failed_attempts = models.IntegerField(default=0)
    last_checked = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'monitored_domains'
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class SystemLatencyMetric(models.Model):
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    icmp_latency_ms = models.FloatField(null=True, blank=True)
    http_latency_ms = models.FloatField(null=True, blank=True)

    class Meta:
        db_table = 'system_latency_metrics'
        ordering = ['created_at']

    def __str__(self):
        return f"{self.created_at} - ICMP: {self.icmp_latency_ms}ms"


def ensure_domain_table():
    from django.db import connection
    is_mysql = getattr(connection, 'vendor', '') == 'mysql'
    table_suffix = " ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4;" if is_mysql else ";"

    def run_query(sql):
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql)
        except Exception:
            pass

    # 1. monitored_domains
    run_query(f"""
        CREATE TABLE IF NOT EXISTS monitored_domains (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(191) NOT NULL UNIQUE,
            is_monitoring TINYINT(1) NOT NULL DEFAULT 0,
            is_ip TINYINT(1) NOT NULL DEFAULT 0,
            last_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
            last_http_code VARCHAR(20) NOT NULL DEFAULT '',
            response_time_ms DOUBLE NULL,
            failed_attempts INT NOT NULL DEFAULT 0,
            last_checked DATETIME NULL,
            last_error TEXT NULL,
            check_interval_seconds INT NOT NULL DEFAULT 60,
            custom_telegram_chat_id VARCHAR(100) NOT NULL DEFAULT '',
            user_id INT NULL,
            created_at DATETIME NOT NULL
        ){table_suffix}
    """)

    # 2. Agregar columnas a monitored_domains
    for col_name, col_type in [
        ('check_interval_seconds', 'INT NOT NULL DEFAULT 60'),
        ('custom_telegram_chat_id', "VARCHAR(100) NOT NULL DEFAULT ''"),
        ('user_id', 'INT NULL')
    ]:
        try:
            with connection.cursor() as cursor:
                if is_mysql:
                    cursor.execute(f"SHOW COLUMNS FROM monitored_domains LIKE '{col_name}'")
                    if not cursor.fetchone():
                        cursor.execute(f"ALTER TABLE monitored_domains ADD COLUMN {col_name} {col_type}")
        except Exception:
            pass

    # 2.5. Asegurar que auth_user.last_login permita NULL
    try:
        with connection.cursor() as cursor:
            if is_mysql:
                cursor.execute("ALTER TABLE auth_user MODIFY COLUMN last_login DATETIME NULL")
    except Exception:
        pass

    # 3. Agregar columnas a UserProfile
    for tbl in ['__main___userprofile', 'userprofile']:
        for col_name, col_type in [
            ('locked_until', 'DATETIME NULL'),
            ('reset_code', "VARCHAR(20) NOT NULL DEFAULT ''"),
            ('reset_code_expires', 'DATETIME NULL'),
            ('telegram_bot_token', "VARCHAR(200) NOT NULL DEFAULT ''"),
            ('mfa_token', "VARCHAR(64) NOT NULL DEFAULT ''"),
            ('mfa_code', "VARCHAR(20) NOT NULL DEFAULT ''"),
            ('mfa_code_expires', 'DATETIME NULL'),
            ('mfa_last_sent_at', 'DATETIME NULL'),
            ('telegram_chat_id', "VARCHAR(100) NOT NULL DEFAULT ''"),
            ('telegram_severities', "JSON NULL")
        ]:
            try:
                with connection.cursor() as cursor:
                    if is_mysql:
                        cursor.execute(f"SHOW COLUMNS FROM {tbl} LIKE '{col_name}'")
                        if not cursor.fetchone():
                            cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN {col_name} {col_type}")
            except Exception:
                pass

    # 4. user_sessions
    run_query(f"""
        CREATE TABLE IF NOT EXISTS user_sessions (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            session_token VARCHAR(64) NOT NULL UNIQUE,
            ip_address VARCHAR(50) NOT NULL,
            user_agent TEXT NULL,
            device_name VARCHAR(150) NOT NULL DEFAULT 'Dispositivo desconocido',
            device_type VARCHAR(50) NOT NULL DEFAULT 'desktop',
            location VARCHAR(150) NOT NULL DEFAULT 'Red Interna / Local',
            latitude DOUBLE NULL,
            longitude DOUBLE NULL,
            country VARCHAR(100) NOT NULL DEFAULT '',
            city VARCHAR(100) NOT NULL DEFAULT '',
            is_tor TINYINT(1) NOT NULL DEFAULT 0,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            is_suspicious TINYINT(1) NOT NULL DEFAULT 0,
            suspicious_reason VARCHAR(255) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            last_activity DATETIME NOT NULL,
            INDEX idx_user_sessions_user (user_id),
            INDEX idx_user_sessions_active (is_active)
        ){table_suffix}
    """)

    for col_name, col_type in [
        ('latitude', 'DOUBLE NULL'),
        ('longitude', 'DOUBLE NULL'),
        ('country', "VARCHAR(100) NOT NULL DEFAULT ''"),
        ('city', "VARCHAR(100) NOT NULL DEFAULT ''"),
        ('is_tor', 'TINYINT(1) NOT NULL DEFAULT 0')
    ]:
        try:
            with connection.cursor() as cursor:
                if is_mysql:
                    cursor.execute(f"SHOW COLUMNS FROM user_sessions LIKE '{col_name}'")
                    if not cursor.fetchone():
                        cursor.execute(f"ALTER TABLE user_sessions ADD COLUMN {col_name} {col_type}")
        except Exception:
            pass

    # 5. security_policies
    run_query(f"""
        CREATE TABLE IF NOT EXISTS security_policies (
            id INT PRIMARY KEY,
            enforce_mfa_admin TINYINT(1) NOT NULL DEFAULT 1,
            enforce_mfa_all TINYINT(1) NOT NULL DEFAULT 0,
            max_active_sessions_per_user INT NOT NULL DEFAULT 5,
            session_timeout_hours INT NOT NULL DEFAULT 24,
            alert_on_new_device TINYINT(1) NOT NULL DEFAULT 1,
            alert_on_new_ip TINYINT(1) NOT NULL DEFAULT 1,
            notify_suspicious_email TINYINT(1) NOT NULL DEFAULT 1,
            notify_suspicious_telegram TINYINT(1) NOT NULL DEFAULT 1,
            detect_impossible_travel TINYINT(1) NOT NULL DEFAULT 1,
            impossible_travel_speed_kmh INT NOT NULL DEFAULT 800,
            detect_tor_exit_nodes TINYINT(1) NOT NULL DEFAULT 1,
            block_tor_logins TINYINT(1) NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL
        ){table_suffix}
    """)

    for col_name, col_type in [
        ('detect_impossible_travel', 'TINYINT(1) NOT NULL DEFAULT 1'),
        ('impossible_travel_speed_kmh', 'INT NOT NULL DEFAULT 800'),
        ('detect_tor_exit_nodes', 'TINYINT(1) NOT NULL DEFAULT 1'),
        ('block_tor_logins', 'TINYINT(1) NOT NULL DEFAULT 0')
    ]:
        try:
            with connection.cursor() as cursor:
                if is_mysql:
                    cursor.execute(f"SHOW COLUMNS FROM security_policies LIKE '{col_name}'")
                    if not cursor.fetchone():
                        cursor.execute(f"ALTER TABLE security_policies ADD COLUMN {col_name} {col_type}")
        except Exception:
            pass

    run_query("INSERT IGNORE INTO security_policies (id, enforce_mfa_admin, enforce_mfa_all, max_active_sessions_per_user, session_timeout_hours, alert_on_new_device, alert_on_new_ip, notify_suspicious_email, notify_suspicious_telegram, detect_impossible_travel, impossible_travel_speed_kmh, detect_tor_exit_nodes, block_tor_logins, updated_at) VALUES (1, 1, 0, 5, 24, 1, 1, 1, 1, 1, 800, 1, 0, NOW())")

    # 6. tor_exit_nodes
    run_query(f"""
        CREATE TABLE IF NOT EXISTS tor_exit_nodes (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            ip_address VARCHAR(50) NOT NULL UNIQUE,
            last_seen DATETIME NOT NULL
        ){table_suffix}
    """)

    # 7. ip_geolocations
    run_query(f"""
        CREATE TABLE IF NOT EXISTS ip_geolocations (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            ip_address VARCHAR(50) NOT NULL UNIQUE,
            country VARCHAR(100) NOT NULL DEFAULT '',
            city VARCHAR(100) NOT NULL DEFAULT '',
            latitude DOUBLE NULL,
            longitude DOUBLE NULL,
            isp VARCHAR(150) NOT NULL DEFAULT '',
            updated_at DATETIME NOT NULL
        ){table_suffix}
    """)

    # 8. trusted_accesses
    run_query(f"""
        CREATE TABLE IF NOT EXISTS trusted_accesses (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            ip_address VARCHAR(50) NOT NULL DEFAULT '',
            device_name VARCHAR(150) NOT NULL DEFAULT '',
            note VARCHAR(255) NOT NULL DEFAULT 'Autorizado como legítimo',
            created_at DATETIME NOT NULL,
            INDEX idx_trusted_user (user_id),
            INDEX idx_trusted_ip (ip_address)
        ){table_suffix}
    """)

    # 9. emailconfig, systembranding, latency
    run_query(f"""
        CREATE TABLE IF NOT EXISTS __main___emailconfig (
            id INT AUTO_INCREMENT PRIMARY KEY,
            smtp_host VARCHAR(255) NOT NULL DEFAULT 'smtp.gmail.com',
            smtp_port INT NOT NULL DEFAULT 587,
            smtp_user VARCHAR(255) NOT NULL DEFAULT '',
            smtp_password VARCHAR(255) NOT NULL DEFAULT '',
            smtp_use_tls TINYINT(1) NOT NULL DEFAULT 1,
            smtp_use_ssl TINYINT(1) NOT NULL DEFAULT 0,
            from_name VARCHAR(100) NOT NULL DEFAULT 'AgentSOC Seguridad',
            from_email VARCHAR(255) NOT NULL DEFAULT '',
            updated_at DATETIME NOT NULL
        ){table_suffix}
    """)
    run_query(f"""
        CREATE TABLE IF NOT EXISTS __main___systembranding (
            id INT AUTO_INCREMENT PRIMARY KEY,
            company_name VARCHAR(200) NOT NULL DEFAULT '',
            custom_welcome_text VARCHAR(255) NOT NULL DEFAULT '',
            updated_at DATETIME NOT NULL
        ){table_suffix}
    """)
    run_query(f"""
        CREATE TABLE IF NOT EXISTS system_latency_metrics (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            created_at DATETIME NOT NULL,
            icmp_latency_ms DOUBLE NULL,
            http_latency_ms DOUBLE NULL,
            INDEX idx_latency_created_at (created_at)
        ){table_suffix}
    """)

    # 10. ioc_indicators (VARCHAR(191) para respetar límite de índices de MariaDB/MySQL en utf8mb4)
    run_query(f"""
        CREATE TABLE IF NOT EXISTS ioc_indicators (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            indicator_value VARCHAR(191) NOT NULL UNIQUE,
            indicator_type VARCHAR(20) NOT NULL DEFAULT 'ip',
            threat_type VARCHAR(50) NOT NULL DEFAULT 'c2_botnet',
            malware_family VARCHAR(100) NOT NULL DEFAULT '',
            source VARCHAR(100) NOT NULL DEFAULT 'Feodo Tracker (abuse.ch)',
            confidence INT NOT NULL DEFAULT 85,
            severity VARCHAR(20) NOT NULL DEFAULT 'CRITICA',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            hit_count INT NOT NULL DEFAULT 0,
            last_hit_at DATETIME NULL,
            description TEXT NULL,
            tags VARCHAR(255) NOT NULL DEFAULT '',
            first_seen DATETIME NOT NULL,
            last_seen DATETIME NOT NULL,
            INDEX idx_ioc_type (indicator_type),
            INDEX idx_ioc_threat (threat_type),
            INDEX idx_ioc_active (is_active)
        ){table_suffix}
    """)

    # 11. ioc_hits
    run_query(f"""
        CREATE TABLE IF NOT EXISTS ioc_hits (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            indicator_value VARCHAR(191) NOT NULL,
            indicator_type VARCHAR(20) NOT NULL DEFAULT 'ip',
            threat_type VARCHAR(50) NOT NULL DEFAULT 'c2_botnet',
            malware_family VARCHAR(100) NOT NULL DEFAULT '',
            source_feed VARCHAR(100) NOT NULL DEFAULT '',
            severity VARCHAR(20) NOT NULL DEFAULT 'CRITICA',
            source_event VARCHAR(255) NOT NULL DEFAULT 'Desconocido',
            matched_value VARCHAR(191) NOT NULL,
            client_ip VARCHAR(50) NOT NULL DEFAULT '',
            user_id INT NULL,
            action_taken VARCHAR(150) NOT NULL DEFAULT 'Alerta SOC Generada',
            details TEXT NULL,
            created_at DATETIME NOT NULL,
            INDEX idx_hit_val (indicator_value),
            INDEX idx_hit_created (created_at)
        ){table_suffix}
    """)

    try:
        admin_u = User.objects.filter(username='admin').first()
        init_email = os.environ.get('INITIAL_ADMIN_EMAIL', '').strip()
        if admin_u and (not admin_u.email or not admin_u.email.strip()):
            if init_email:
                admin_u.email = init_email
                admin_u.save(update_fields=['email'])
            else:
                cfg = EmailConfig.objects.first()
                if cfg and (cfg.from_email or cfg.smtp_user):
                    admin_u.email = (cfg.from_email.strip() or cfg.smtp_user.strip())
                    admin_u.save(update_fields=['email'])
    except Exception:
        pass


_last_latency_record_time = 0
_latency_record_lock = threading.Lock()

def record_system_latency(icmp_ms=None, http_ms=None):
    """Registra una muestra de latencia en la base de datos con limitación de frecuencia."""
    global _last_latency_record_time
    now_ts = time.time()
    with _latency_record_lock:
        if now_ts - _last_latency_record_time < 8:
            return
        _last_latency_record_time = now_ts

    try:
        ensure_domain_table()
        if icmp_ms is None:
            icmp_ms = get_icmp_latency()
        if http_ms is None:
            http_ms = round(float(icmp_ms * 0.55) if icmp_ms else 12.0, 1)

        SystemLatencyMetric.objects.create(
            icmp_latency_ms=icmp_ms,
            http_latency_ms=http_ms
        )

        # Limpieza probabilística (~2%) de registros mayores a 48 horas
        import random
        if random.random() < 0.02:
            cutoff = timezone.now() - datetime.timedelta(hours=48)
            SystemLatencyMetric.objects.filter(created_at__lt=cutoff).delete()
    except Exception as e:
        pass


def seed_initial_latency_history():
    """Genera datos históricos continuos para las últimas 24 horas si la tabla tiene pocas muestras."""
    try:
        ensure_domain_table()
        if SystemLatencyMetric.objects.count() >= 30:
            return
        import random
        base_icmp = get_icmp_latency() or 22.0
        now = timezone.now()
        samples = []
        # Crear 144 puntos distribuidos uniformemente en 24 horas (1 cada 10 minutos)
        for i in range(144, 0, -1):
            sample_time = now - datetime.timedelta(minutes=i * 10)
            jitter = random.uniform(-3.5, 4.5)
            if random.random() < 0.04:
                jitter += random.uniform(8.0, 22.0)
            icmp = max(4.0, round(base_icmp + jitter, 1))
            http = max(2.5, round(icmp * random.uniform(0.4, 0.7), 1))
            samples.append(SystemLatencyMetric(
                created_at=sample_time,
                icmp_latency_ms=icmp,
                http_latency_ms=http
            ))
        SystemLatencyMetric.objects.bulk_create(samples)
        print("✅ Base histórica de telemetría de 24 horas inicializada.")
    except Exception as e:
        print(f"Nota seeding latency: {e}")


_latency_collector_started = False
_latency_collector_lock = threading.Lock()

def start_latency_collector_if_needed():
    """Inicia un hilo en segundo plano que recopila métricas de latencia de red de forma continua."""
    global _latency_collector_started
    with _latency_collector_lock:
        if _latency_collector_started:
            return
        _latency_collector_started = True

    def _worker():
        time.sleep(4)
        seed_initial_latency_history()
        while True:
            try:
                record_system_latency()
            except Exception:
                pass
            time.sleep(60)

    t = threading.Thread(target=_worker, daemon=True, name="SystemLatencyCollector")
    t.start()


# ==========================================
# 3. SERIALIZADORES (DRF)
# ==========================================
from rest_framework import serializers

class DomainSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True, default=None)
    user_id = serializers.IntegerField(source='user.id', read_only=True, default=None)

    class Meta:
        model = Domain
        fields = [
            'id', 'name', 'user_id', 'user_username', 'check_interval_seconds',
            'custom_telegram_chat_id', 'is_monitoring', 'is_ip',
            'last_status', 'last_http_code', 'response_time_ms',
            'failed_attempts', 'last_checked', 'last_error', 'created_at'
        ]

class TelegramPreferencesSerializer(serializers.ModelSerializer):
    telegram_chat_id = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=100,
    )
    telegram_bot_token = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=200,
    )
    telegram_severities = serializers.ListField(
        child=serializers.ChoiceField(choices=Log.CRITICALITY_CHOICES),
        required=True,
        allow_empty=True,
    )
        
    class Meta:
        model = UserProfile
        fields = ['telegram_chat_id', 'telegram_bot_token', 'telegram_severities']

    def validate_telegram_severities(self, value):
        return list(dict.fromkeys(value))


class AIConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIConfig
        fields = '__all__'


class EmailConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailConfig
        fields = '__all__'


class SystemBrandingSerializer(serializers.ModelSerializer):
    welcome_text = serializers.SerializerMethodField()

    class Meta:
        model = SystemBranding
        fields = ['company_name', 'custom_welcome_text', 'welcome_text', 'updated_at']

    def get_welcome_text(self, obj):
        if obj.company_name and obj.company_name.strip():
            return f"AgentSOC - {obj.company_name.strip()}"
        if obj.custom_welcome_text and obj.custom_welcome_text.strip():
            return obj.custom_welcome_text.strip()
        return "Agent - SOC"


def validate_password_strength(password):
    """
    Valida que la contraseña cumpla con criterios de seguridad:
    - Longitud mínima de 8 caracteres
    - Al menos una letra mayúscula (A-Z)
    - Al menos una letra minúscula (a-z)
    - Al menos un dígito numérico (0-9)
    - Al menos un carácter especial (!@#$%^&*...)
    """
    if not password:
        return False, "La contraseña es obligatoria."
    if len(password) < 8:
        return False, "La contraseña debe tener al menos 8 caracteres."
    if not re.search(r'[A-Z]', password):
        return False, "La contraseña debe incluir al menos una letra mayúscula (A-Z)."
    if not re.search(r'[a-z]', password):
        return False, "La contraseña debe incluir al menos una letra minúscula (a-z)."
    if not re.search(r'\d', password):
        return False, "La contraseña debe incluir al menos un número (0-9)."
    if not re.search(r'[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]', password):
        return False, "La contraseña debe incluir al menos un carácter especial (ej. !@#$%&*)."
    return True, ""


def generate_strong_password(length=16):
    """Genera una contraseña aleatoria criptográficamente segura."""
    upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    lower = "abcdefghjkmnpqrstuvwxyz"
    digits = "23456789"
    symbols = "!@#$%^&*()_+-=[]{}|;:?"
    
    password = [
        secrets.choice(upper),
        secrets.choice(lower),
        secrets.choice(digits),
        secrets.choice(symbols)
    ]
    all_chars = upper + lower + digits + symbols
    for _ in range(length - 4):
        password.append(secrets.choice(all_chars))
    secrets.SystemRandom().shuffle(password)
    return ''.join(password)


class UserSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    role = serializers.CharField(source='profile.role', read_only=True)
    is_locked = serializers.BooleanField(source='profile.is_locked', read_only=True)
    failed_attempts = serializers.IntegerField(source='profile.failed_attempts', read_only=True)
    locked_until = serializers.DateTimeField(source='profile.locked_until', read_only=True)
    password = serializers.CharField(write_only=True, required=False)
    role_input = serializers.ChoiceField(choices=UserProfile.ROLE_CHOICES, write_only=True, required=False)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'role', 'is_locked', 'failed_attempts', 'locked_until', 'password', 'role_input']

    def validate_password(self, value):
        if value:
            is_valid, err_msg = validate_password_strength(value)
            if not is_valid:
                raise serializers.ValidationError(err_msg)
        return value

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        role = validated_data.pop('role_input', 'read')
        
        if not password:
            raise serializers.ValidationError({"password": "La contraseña es obligatoria al crear un usuario."})
        
        is_valid, err_msg = validate_password_strength(password)
        if not is_valid:
            raise serializers.ValidationError({"password": err_msg})
        
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()
            
        UserProfile.objects.get_or_create(user=user, defaults={'role': role})
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        role = validated_data.pop('role_input', None)
        
        if password:
            is_valid, err_msg = validate_password_strength(password)
            if not is_valid:
                raise serializers.ValidationError({"password": err_msg})
        
        instance = super().update(instance, validated_data)
        
        if password:
            instance.set_password(password)
            instance.save()
            
        if role:
            profile, _ = UserProfile.objects.get_or_create(user=instance)
            profile.role = role
            profile.save()
            
        return instance

class AgentSerializer(serializers.ModelSerializer):
    is_truly_active = serializers.SerializerMethodField()
    
    class Meta:
        model = Agent
        fields = '__all__'

    def validate_ip_address(self, value):
        try:
            return str(ipaddress.ip_address(value.strip()))
        except (ValueError, AttributeError):
            raise serializers.ValidationError(
                'Ingresá una dirección IPv4 o IPv6 válida.'
            )

    def get_is_truly_active(self, obj):
        if not obj.last_seen:
            return False
        return (now() - obj.last_seen).total_seconds() < 35

class LogSerializer(serializers.ModelSerializer):
    server = serializers.CharField(source='agent.name', read_only=True)

    class Meta:
        model = Log
        fields = ['id', 'server', 'criticality', 'message', 'evidence', 'resources_info', 'timestamp']
# ==========================================
# 4. PERMISOS PERSONALIZADOS (RBAC)
# ==========================================
from rest_framework.permissions import BasePermission, IsAuthenticated, AllowAny

class IsAdminUserRole(BasePermission):
    """Permite el acceso solo si el usuario tiene el rol 'admin' en su perfil."""
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and hasattr(request.user, 'profile') and request.user.profile.role == 'admin')

class IsWriteUserRole(BasePermission):
    """Permite el acceso si el usuario es 'admin' o 'write'."""
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated or not hasattr(request.user, 'profile'):
            return False
        return request.user.profile.role in ['admin', 'write']
# ==========================================
# 5. VISTAS Y CONTROLADORES (API VIEWS)
# ==========================================
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, viewsets
from django.contrib.auth import authenticate
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework.decorators import action

def send_telegram_alert(level, message, server_name, chat_id, evidence=None, return_error=False, bot_token=None):
    """Envía una alerta al chat de Telegram configurado por un usuario."""
    telegram_bot_token = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN")

    if not telegram_bot_token:
        try:
            profile_with_token = UserProfile.objects.exclude(telegram_bot_token='').first()
            if profile_with_token and profile_with_token.telegram_bot_token:
                telegram_bot_token = profile_with_token.telegram_bot_token
        except Exception:
            pass

    if not telegram_bot_token:
        error = "TELEGRAM_BOT_TOKEN no está configurado en el backend ni en la interfaz."
        print(f"❌ {error}")
        return (False, error) if return_error else False

    if not chat_id:
        error = "No hay un Telegram Chat ID configurado."
        return (False, error) if return_error else False

    url = f"https://api.telegram.org/bot{telegram_bot_token}/sendMessage"

    emojis = {
        "BAJA": "ℹ️",
        "MEDIA": "⚠️",
        "ALTA": "🚨",
        "CRITICA": "💀",
        "INFO": "🔔"
    }
    normalized_level = level.upper()
    emoji = emojis.get(normalized_level, "🔔")
    full_text = (
        f"{emoji} [{server_name.upper()}] ALERTA {normalized_level}\n\n"
        f"{message}"
    )

    if evidence and str(evidence).strip():
        clean_evidence = str(evidence).strip()
        if len(clean_evidence) > 3000:
            clean_evidence = clean_evidence[:3000] + "\n...[Evidencia truncada por longitud]"
        full_text += f"\n\n📋 Evidencia del Log:\n{clean_evidence}"

    try:
        response = requests.post(
            url,
            json={"chat_id": chat_id, "text": full_text},
            timeout=15,
        )
        if response.status_code == 200:
            return (True, "") if return_error else True

        try:
            telegram_error = response.json().get("description", response.text)
        except ValueError:
            telegram_error = response.text

        error = f"Telegram rechazó el mensaje: {telegram_error}"
        print(f"❌ ERROR: {error}")
        return (False, error) if return_error else False
    except requests.RequestException as exc:
        error = f"No se pudo conectar con Telegram: {exc}"
        print(f"❌ ERROR DE RED: {error}")
        return (False, error) if return_error else False


def send_telegram_alerts(level, message, server_name, evidence=None):
    """Notifica solo a usuarios suscriptos a la severidad recibida."""
    normalized_level = level.upper()
    profiles = UserProfile.objects.exclude(telegram_chat_id='').only(
        'telegram_chat_id',
        'telegram_bot_token',
        'telegram_severities',
    )

    for profile in profiles.iterator():
        severities = profile.telegram_severities or []
        if normalized_level in severities:
            send_telegram_alert(
                normalized_level,
                message,
                server_name,
                profile.telegram_chat_id,
                evidence=evidence,
                bot_token=getattr(profile, 'telegram_bot_token', '') or None,
            )


def send_telegram_alerts_async(level, message, server_name, evidence=None):
    """Ejecuta el envío de alertas de Telegram en un hilo en segundo plano para no bloquear requests."""
    t = threading.Thread(
        target=send_telegram_alerts,
        args=(level, message, server_name),
        kwargs={'evidence': evidence},
        daemon=True
    )
    t.start()


from rest_framework.permissions import IsAuthenticated

class TelegramPreferencesView(APIView):
    permission_classes = [IsAuthenticated]

    def get_profile(self, user):
        ensure_domain_table()
        profile, _ = UserProfile.objects.get_or_create(user=user)
        return profile

    def get(self, request):
        profile = self.get_profile(request.user)
        data = TelegramPreferencesSerializer(profile).data
        role = getattr(profile, 'role', 'read')
        # Limitar la visual de Telegram Chat ID y Bot Token para usuarios de solo lectura
        if role == 'read':
            if data.get('telegram_chat_id'):
                chat_id = str(data['telegram_chat_id']).strip()
                data['telegram_chat_id'] = ('••••' + chat_id[-4:]) if len(chat_id) > 4 else '••••••••'
            if data.get('telegram_bot_token'):
                data['telegram_bot_token'] = '••••••••••••••••'
        return Response(data)

    def put(self, request):
        profile = self.get_profile(request.user)
        if getattr(profile, 'role', 'read') == 'read':
            return Response({'detail': 'Los usuarios de solo lectura no pueden modificar configuraciones.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = TelegramPreferencesSerializer(profile, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def patch(self, request):
        profile = self.get_profile(request.user)
        if getattr(profile, 'role', 'read') == 'read':
            return Response({'detail': 'Los usuarios de solo lectura no pueden modificar configuraciones.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = TelegramPreferencesSerializer(
            profile,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TelegramTestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ensure_domain_table()
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        if getattr(profile, 'role', 'read') == 'read':
            return Response({'detail': 'Los usuarios de solo lectura no pueden enviar mensajes de prueba.'}, status=status.HTTP_403_FORBIDDEN)
        chat_id = str(request.data.get('telegram_chat_id') or profile.telegram_chat_id).strip()
        bot_token = str(request.data.get('telegram_bot_token') or getattr(profile, 'telegram_bot_token', '')).strip() or None

        if not chat_id:
            return Response(
                {"detail": "Debes ingresar o guardar un Telegram Chat ID antes de probar."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        level = str(request.data.get('criticality') or 'INFO').upper()
        valid_criticalities = {choice[0] for choice in Log.CRITICALITY_CHOICES}
        if level not in valid_criticalities:
            level = 'INFO'

        server_name = request.data.get('server_name') or 'SOC-TEST'
        test_message = (
            f"Mensaje de prueba exitoso para el usuario @{request.user.username}.\n"
            f"Canal de alertas operativo correctamente."
        )

        success, error = send_telegram_alert(
            level=level,
            message=test_message,
            server_name=server_name,
            chat_id=chat_id,
            return_error=True,
            bot_token=bot_token,
        )

        if not success:
            return Response(
                {"detail": error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"status": "Mensaje de prueba enviado exitosamente a Telegram."},
            status=status.HTTP_200_OK,
        )


class AIConfigView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        config = AIConfig.objects.first()
        if not config:
            config = AIConfig.objects.create()
        data = AIConfigSerializer(config).data
        role = getattr(getattr(request.user, 'profile', None), 'role', 'read')
        # Limitar la visual de la API Key para usuarios no administradores
        if role != 'admin' and data.get('api_key'):
            data['api_key'] = '••••••••••••••••'
        return Response(data)

    def post(self, request):
        if not hasattr(request.user, 'profile') or request.user.profile.role != 'admin':
            return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)
        
        config = AIConfig.objects.first()
        if not config:
            config = AIConfig.objects.create()
        
        serializer = AIConfigSerializer(config, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

def send_recovery_email(recipient_email, username, code):
    """Envía el código PIN de 6 dígitos usando la configuración SMTP."""
    ensure_domain_table()
    config = EmailConfig.objects.first()
    if not config or not config.smtp_user or not config.smtp_password:
        return False, "SMTP no configurado en el SOC."

    sender_email = config.from_email.strip() or config.smtp_user.strip()
    sender_name = config.from_name.strip() or "AgentSOC RaspGuardGC Seguridad"

    subject = f"[AgentSOC] Código de recuperación de contraseña: {code}"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #ffffff; margin: 0; padding: 20px; }}
        .card {{ max-width: 480px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; border: 1px solid #334155; padding: 32px; color: #ffffff; }}
        .header {{ text-align: center; margin-bottom: 24px; }}
        .badge {{ display: inline-block; padding: 6px 12px; background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }}
        .code-box {{ text-align: center; margin: 28px 0; padding: 18px; background-color: #0b0f19; border: 1px solid #4f46e5; border-radius: 8px; }}
        .pin {{ font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #818cf8; font-family: monospace; }}
        .footer {{ font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px; border-top: 1px solid #334155; padding-top: 16px; }}
        p {{ color: #ffffff !important; }}
      </style>
    </head>
    <body style="background-color: #0f172a; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px;">
      <div class="card" style="max-width: 480px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; border: 1px solid #334155; padding: 32px; color: #ffffff;">
        <div class="header" style="text-align: center; margin-bottom: 24px;">
          <span class="badge" style="display: inline-block; padding: 6px 12px; background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">AgentSOC Authentication</span>
          <h2 style="color: #ffffff; margin-top: 12px; font-size: 22px; font-weight: 700;">Recuperación de Contraseña</h2>
        </div>
        <p style="color: #ffffff !important; font-size: 16px; line-height: 1.6; margin: 14px 0;">Hola <strong style="color: #ffffff !important;">{username}</strong>,</p>
        <p style="color: #ffffff !important; font-size: 15px; line-height: 1.6; margin: 14px 0;">Has solicitado restablecer tu contraseña en la plataforma <strong style="color: #ffffff !important;">AgentSOC</strong>. Ingresa el siguiente código de verificación de 6 dígitos:</p>
        <div class="code-box" style="text-align: center; margin: 28px 0; padding: 18px; background-color: #0b0f19; border: 1px solid #4f46e5; border-radius: 8px;">
          <div class="pin" style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #818cf8; font-family: monospace;">{code}</div>
        </div>
        <p style="color: #e2e8f0 !important; font-size: 13px; line-height: 1.5; margin-top: 16px;">⏱️ Este código es válido durante <strong style="color: #ffffff !important;">15 minutos</strong>. Si no solicitaste este cambio, ignora este mensaje o notifica inmediatamente al administrador del SOC.</p>
        <div class="footer" style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px; border-top: 1px solid #334155; padding-top: 16px;">
          © AgentSOC Security Platform • Mensaje generado automáticamente
        </div>
      </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = recipient_email

    text_content = f"Hola {username},\n\nTu código de recuperación en AgentSOC es: {code}\n(Válido por 15 minutos).\n"
    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        host = config.smtp_host.strip() or 'smtp.gmail.com'
        port = int(config.smtp_port or 587)
        if config.smtp_use_ssl or port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=12)
        else:
            server = smtplib.SMTP(host, port, timeout=12)
            if config.smtp_use_tls:
                server.starttls()

        pwd = config.smtp_password.strip()
        if 'gmail' in host.lower():
            pwd = pwd.replace(' ', '')
        server.login(config.smtp_user.strip(), pwd)
        server.sendmail(sender_email, [recipient_email], msg.as_string())
        server.quit()
        return True, "Correo enviado exitosamente."
    except Exception as exc:
        err_raw = str(exc)
        if "Application-specific password required" in err_raw or "534" in err_raw or "InvalidSecondFactor" in err_raw:
            err_msg = (
                "Google exige una 'Contraseña de Aplicación' de 16 caracteres en lugar de tu contraseña personal de Gmail. "
                "Para obtenerla: 1) Activa Verificación en 2 pasos en tu cuenta Google, "
                "2) Entra a https://myaccount.google.com/apppasswords, "
                "3) Genera una clave con nombre 'AgentSOC' y pégala aquí."
            )
        elif "Username and Password not accepted" in err_raw or "535" in err_raw:
            err_msg = "Credenciales SMTP rechazadas por el servidor (Usuario o Contraseña incorrectos)."
        else:
            err_msg = f"Error SMTP: {err_raw}"
        print(f"❌ {err_msg}")
        return False, err_msg


class EmailConfigView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_domain_table()
        config = EmailConfig.objects.first()
        if not config:
            config = EmailConfig.objects.create()
        data = EmailConfigSerializer(config).data
        role = getattr(getattr(request.user, 'profile', None), 'role', 'read')
        # Limitar la visual de datos sensibles de correo para usuarios no administradores
        if role != 'admin':
            data['smtp_password'] = '••••••••••••••••'
            if data.get('smtp_user'):
                parts = data['smtp_user'].split('@')
                if len(parts) == 2 and len(parts[0]) > 2:
                    data['smtp_user'] = parts[0][:2] + '••••@' + parts[1]
                else:
                    data['smtp_user'] = '••••••••'
            if data.get('from_email'):
                parts = data['from_email'].split('@')
                if len(parts) == 2 and len(parts[0]) > 2:
                    data['from_email'] = parts[0][:2] + '••••@' + parts[1]
                else:
                    data['from_email'] = '••••••••'
        return Response(data)

    def post(self, request):
        if not hasattr(request.user, 'profile') or request.user.profile.role != 'admin':
            return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)

        ensure_domain_table()
        config = EmailConfig.objects.first()
        if not config:
            config = EmailConfig.objects.create()

        serializer = EmailConfigSerializer(config, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class EmailTestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not hasattr(request.user, 'profile') or request.user.profile.role != 'admin':
            return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)

        ensure_domain_table()
        target_email = str(request.data.get('target_email') or request.user.email or '').strip()
        if not target_email:
            return Response(
                {"detail": "Debe especificar un correo de destino para la prueba."},
                status=status.HTTP_400_BAD_REQUEST
            )

        ok, msg = send_recovery_email(target_email, request.user.username, "123456")
        if ok:
            return Response({"status": f"Correo de prueba enviado con éxito a {target_email}."})
        return Response({"detail": f"Fallo al conectar o enviar correo: {msg}"}, status=status.HTTP_400_BAD_REQUEST)


class SystemBrandingView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        ensure_domain_table()
        branding = SystemBranding.objects.first()
        if not branding:
            branding = SystemBranding.objects.create()
        return Response(SystemBrandingSerializer(branding).data)

    def post(self, request):
        if not request.user or not request.user.is_authenticated or not hasattr(request.user, 'profile') or request.user.profile.role != 'admin':
            return Response({'error': 'Solo los administradores pueden cambiar la identidad de la empresa.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        branding = SystemBranding.objects.first()
        if not branding:
            branding = SystemBranding.objects.create()
        company_name = str(request.data.get('company_name', '')).strip()
        custom_welcome_text = str(request.data.get('custom_welcome_text', '')).strip()
        branding.company_name = company_name
        branding.custom_welcome_text = custom_welcome_text
        branding.save()
        return Response(SystemBrandingSerializer(branding).data)


def parse_user_agent(ua_string):
    """Analiza la cabecera User-Agent para obtener un nombre amigable y tipo de dispositivo."""
    if not ua_string:
        return "Dispositivo desconocido", "desktop"

    ua = ua_string.lower()

    # Tipo de dispositivo
    device_type = "desktop"
    if any(k in ua for k in ["mobile", "iphone", "ipod", "android"]) and "tablet" not in ua and "ipad" not in ua:
        device_type = "mobile"
    elif any(k in ua for k in ["ipad", "tablet"]):
        device_type = "tablet"

    # Navegador
    browser = "Navegador Web"
    if "edg/" in ua or "edge/" in ua:
        browser = "Microsoft Edge"
    elif "chrome/" in ua and "chromium" not in ua and "edg" not in ua:
        browser = "Google Chrome"
    elif "firefox/" in ua:
        browser = "Mozilla Firefox"
    elif "safari/" in ua and "chrome" not in ua:
        browser = "Apple Safari"
    elif "opera" in ua or "opr/" in ua:
        browser = "Opera"
    elif "curl" in ua:
        browser = "cURL"
    elif "python" in ua or "requests" in ua:
        browser = "Python Client"

    # Sistema Operativo
    os_name = "SO Desconocido"
    if "windows nt 10.0" in ua or "windows nt 11.0" in ua:
        os_name = "Windows"
    elif "windows" in ua:
        os_name = "Windows"
    elif "android" in ua:
        os_name = "Android"
    elif "iphone" in ua or "ipad" in ua or "ios" in ua:
        os_name = "iOS"
    elif "mac os x" in ua or "macintosh" in ua:
        os_name = "macOS"
    elif "linux" in ua:
        os_name = "Linux"

    device_name = f"{browser} en {os_name}"
    return device_name, device_type


def mask_email(email_str):
    if not email_str or '@' not in email_str:
        return 'correo configurado'
    user_part, domain_part = email_str.split('@', 1)
    if len(user_part) <= 2:
        masked_user = user_part[0] + '***'
    else:
        masked_user = user_part[:2] + '***' + user_part[-1]
    return f"{masked_user}@{domain_part}"


import math
import urllib.request
import json

def haversine_distance_km(lat1, lon1, lat2, lon2):
    """Calcula la distancia en kilómetros entre dos coordenadas geográficas usando la fórmula de Haversine."""
    try:
        R = 6371.0 # Radio medio de la Tierra en km
        phi1 = math.radians(float(lat1))
        phi2 = math.radians(float(lat2))
        delta_phi = math.radians(float(lat2) - float(lat1))
        delta_lambda = math.radians(float(lon2) - float(lon1))

        a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
        return R * c
    except Exception:
        return 0.0

GEO_CACHE = {}

def get_client_ip(request):
    """Obtiene la dirección IP pública del cliente a partir de cabeceras de proxy o REMOTE_ADDR."""
    if not request:
        return '127.0.0.1'
    try:
        x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded:
            return x_forwarded.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR') or '127.0.0.1'
    except Exception:
        return '127.0.0.1'

def is_private_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except Exception:
        return True

def geolocate_ip(ip_str):
    """Obtiene datos de geolocalización para una dirección IP pública usando ip-api.com con caché en memoria y DB."""
    if not ip_str or is_private_ip(ip_str):
        return {
            'location': 'Red Interna / Local',
            'country': 'Red Local',
            'city': 'LAN',
            'lat': None,
            'lon': None,
            'isp': 'Red Privada'
        }

    if ip_str in GEO_CACHE:
        return GEO_CACHE[ip_str]

    try:
        cached = IPGeolocation.objects.filter(ip_address=ip_str).first()
        if cached:
            loc_str = f"{cached.city}, {cached.country}".strip(', ') or cached.country or 'Ubicación Desconocida'
            res = {
                'location': loc_str,
                'country': cached.country or '',
                'city': cached.city or '',
                'lat': cached.latitude,
                'lon': cached.longitude,
                'isp': cached.isp or ''
            }
            GEO_CACHE[ip_str] = res
            return res
    except Exception:
        pass

    try:
        url = f"http://ip-api.com/json/{ip_str}?fields=status,country,city,lat,lon,isp"
        req = urllib.request.Request(url, headers={'User-Agent': 'AgentSOC-Security/1.0'})
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('status') == 'success':
                country = data.get('country', '')
                city = data.get('city', '')
                lat = data.get('lat')
                lon = data.get('lon')
                isp = data.get('isp', '')
                loc_str = f"{city}, {country}".strip(', ') or country or 'Ubicación Desconocida'

                res = {
                    'location': loc_str,
                    'country': country,
                    'city': city,
                    'lat': lat,
                    'lon': lon,
                    'isp': isp
                }
                GEO_CACHE[ip_str] = res

                try:
                    IPGeolocation.objects.update_or_create(
                        ip_address=ip_str,
                        defaults={
                            'country': country,
                            'city': city,
                            'latitude': lat,
                            'longitude': lon,
                            'isp': isp
                        }
                    )
                except Exception:
                    pass

                return res
    except Exception as e:
        print(f"ℹ️ [GeoIP] Error al geolocalizar {ip_str}: {e}")

    fallback = {
        'location': 'Internet / Remoto',
        'country': '',
        'city': '',
        'lat': None,
        'lon': None,
        'isp': ''
    }
    GEO_CACHE[ip_str] = fallback
    return fallback

TOR_EXIT_IPS = set()
TOR_LAST_UPDATED = None

def is_tor_exit_node(ip_str):
    """Comprueba si una dirección IP pertenece a un nodo de salida oficial de la Red Tor."""
    if not ip_str or is_private_ip(ip_str):
        return False
    if ip_str in TOR_EXIT_IPS:
        return True
    try:
        return TorExitNode.objects.filter(ip_address=ip_str).exists()
    except Exception:
        return False

CANONICAL_TOR_EXIT_IPS = [
    '101.99.92.179', '101.99.92.182', '101.99.92.194', '101.99.92.198', '102.130.113.9',
    '102.130.127.117', '103.106.3.94', '103.109.101.105', '103.126.161.54', '103.129.222.46',
    '103.163.218.11', '103.172.134.26', '103.193.179.233', '103.196.37.111', '103.208.86.5',
    '103.251.167.10', '103.251.167.20', '103.253.24.18', '103.28.52.93', '103.81.180.100',
    '104.167.242.116', '104.167.242.117', '104.167.242.118', '104.192.1.138', '104.192.171.138',
    '104.192.3.74', '104.219.236.100', '104.219.236.101', '104.237.158.32', '104.244.72.115',
    '104.244.72.132', '104.244.73.136', '104.244.73.190', '104.244.73.193', '104.244.73.43',
    '104.244.74.23', '104.244.74.97', '104.244.75.74', '104.244.77.192', '104.244.77.208',
    '104.244.77.79', '104.244.77.80', '104.244.78.162', '104.244.78.233', '104.244.79.178',
    '104.244.79.44', '104.244.79.50', '104.244.79.61', '107.172.13.143', '107.172.31.146',
    '185.220.101.5', '171.25.193.25', '80.67.167.81', '198.98.51.189', '89.58.26.216',
    '109.70.100.4', '5.45.102.93', '192.42.116.99', '185.220.101.6', '185.220.101.7'
]

def seed_initial_tor_nodes():
    """Siembra nodos Tor canónicos si la base de datos está vacía para garantizar disponibilidad inmediata."""
    global TOR_EXIT_IPS
    try:
        ensure_domain_table()
        now_dt = timezone.now()
        if not TorExitNode.objects.exists():
            objs = [TorExitNode(ip_address=ip, last_seen=now_dt) for ip in CANONICAL_TOR_EXIT_IPS]
            TorExitNode.objects.bulk_create(objs, ignore_conflicts=True)
            print(f"🧅 [TOR CTI] Sembrados {len(objs)} nodos Tor de referencia en base de datos.")
        db_ips = set(TorExitNode.objects.values_list('ip_address', flat=True))
        if db_ips:
            TOR_EXIT_IPS = db_ips
    except Exception as e:
        print(f"ℹ️ [TOR CTI] Aviso sembrando nodos Tor iniciales: {e}")
        if not TOR_EXIT_IPS:
            TOR_EXIT_IPS = set(CANONICAL_TOR_EXIT_IPS)

def update_tor_exit_nodes():
    """Descarga la lista de nodos de salida Tor con soporte de múltiples espejos de alta velocidad y almacenamiento en DB y RAM."""
    global TOR_LAST_UPDATED, TOR_EXIT_IPS
    ensure_domain_table()
    
    # Espejos ordenados por resiliencia y velocidad de respuesta
    tor_sources = [
        "https://raw.githubusercontent.com/SecOps-Institute/Tor-IP-Addresses/master/tor-exit-nodes.lst",
        "https://check.torproject.org/torbulkexitlist",
        "https://raw.githubusercontent.com/DanMcInerney/tor-exit-nodes/master/exit-nodes.csv"
    ]
    
    valid_ips = set()
    ctx = None
    try:
        ctx = ssl._create_unverified_context()
    except Exception:
        pass

    for url in tor_sources:
        try:
            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AgentSOC-TorCTI/2.0',
                    'Accept': 'text/plain,*/*'
                }
            )
            with urllib.request.urlopen(req, timeout=12.0, context=ctx) as resp:
                content = resp.read(2 * 1024 * 1024).decode('utf-8', errors='ignore')
                for line in content.splitlines():
                    line_clean = line.strip().split(',')[0].strip()
                    if line_clean and not line_clean.startswith('#'):
                        try:
                            ipaddress.ip_address(line_clean)
                            valid_ips.add(line_clean)
                        except ValueError:
                            continue
            if len(valid_ips) >= 10:
                print(f"🧅 [TOR CTI] Descargados {len(valid_ips)} nodos Tor desde {url}")
                break
        except Exception as e:
            print(f"⚠️ [TOR CTI] Espejo {url} no disponible ({e}), intentando siguiente...")

    now_dt = timezone.now()
    if len(valid_ips) >= 10:
        TOR_EXIT_IPS = valid_ips
        TOR_LAST_UPDATED = now_dt
        try:
            TorExitNode.objects.all().delete()
            nodes = [TorExitNode(ip_address=ip, last_seen=now_dt) for ip in valid_ips]
            TorExitNode.objects.bulk_create(nodes, batch_size=500, ignore_conflicts=True)
            print(f"🧅 [TOR CTI] Lista de nodos de salida Tor actualizada: {len(valid_ips)} nodos activos guardados en DB y RAM.")
        except Exception as e:
            print(f"ℹ️ [TOR CTI] Error guardando nodos en DB: {e}")
        return len(valid_ips)

    # Si todos los espejos fallaron (ej. red aislada), usar nodos guardados en DB o semilla
    try:
        db_ips = set(TorExitNode.objects.values_list('ip_address', flat=True))
        if db_ips:
            TOR_EXIT_IPS = db_ips
            return len(db_ips)
    except Exception:
        pass

    seed_initial_tor_nodes()
    return len(TOR_EXIT_IPS) or len(CANONICAL_TOR_EXIT_IPS)

_tor_sync_started = False
_tor_sync_lock = threading.Lock()

def start_tor_sync_if_needed():
    """Inicia el hilo de sincronización en segundo plano de la lista Tor."""
    global _tor_sync_started
    with _tor_sync_lock:
        if _tor_sync_started:
            return
        _tor_sync_started = True

    def _worker():
        import time
        try:
            ensure_domain_table()
            seed_initial_tor_nodes()
            db_ips = set(TorExitNode.objects.values_list('ip_address', flat=True))
            if db_ips:
                global TOR_EXIT_IPS
                TOR_EXIT_IPS = db_ips
                print(f"🧅 [TOR CTI] Cargados {len(db_ips)} nodos Tor desde base de datos en RAM.")
        except Exception:
            pass

        time.sleep(2)
        try:
            update_tor_exit_nodes()
        except Exception as e:
            print(f"ℹ️ [TOR CTI] Primer sync diferido: {e}")

        while True:
            time.sleep(6 * 3600)
            try:
                update_tor_exit_nodes()
            except Exception:
                pass

    t = threading.Thread(target=_worker, daemon=True, name="TorExitNodesSync")
    t.start()

# ==========================================
# MOTOR DE CIBERINTELIGENCIA Y CORRELACIÓN DE IOCs (CTI)
# ==========================================
INITIAL_SEED_IOCS = [
    # C2 & Botnets (IPs)
    {"val": "185.220.101.5", "type": "ip", "threat": "c2_botnet", "family": "Dridex / Emotet", "src": "Feodo Tracker (abuse.ch)", "conf": 98, "sev": "CRITICA", "desc": "Servidor activo de Comando y Control (C2) de Dridex Banking Trojan.", "tags": "c2,trojan,banking"},
    {"val": "194.26.29.112", "type": "ip", "threat": "c2_botnet", "family": "Cobalt Strike", "src": "ThreatFox (abuse.ch)", "conf": 100, "sev": "CRITICA", "desc": "TeamServer Cobalt Strike detectado con perfil maleable de ataque.", "tags": "c2,redteam,stager"},
    {"val": "45.154.255.88", "type": "ip", "threat": "c2_botnet", "family": "QakBot / QBot", "src": "Feodo Tracker (abuse.ch)", "conf": 95, "sev": "CRITICA", "desc": "Nodo controlador C2 activo de la red de bots QakBot.", "tags": "botnet,c2,loader"},
    {"val": "91.240.118.168", "type": "ip", "threat": "malware", "family": "RedLine Stealer", "src": "ThreatFox (abuse.ch)", "conf": 94, "sev": "CRITICA", "desc": "Panel de recolección y exfiltración de credenciales RedLine.", "tags": "infostealer,credentials"},
    {"val": "103.145.13.242", "type": "ip", "threat": "c2_botnet", "family": "Mirai", "src": "Feodo Tracker (abuse.ch)", "conf": 96, "sev": "CRITICA", "desc": "C2 Botnet Mirai ejecutando escaneos telnet y ataques DDoS masivos.", "tags": "ddos,iot,mirai"},
    {"val": "193.106.191.162", "type": "ip", "threat": "malware", "family": "AgentTesla", "src": "ThreatFox (abuse.ch)", "conf": 95, "sev": "CRITICA", "desc": "Exfiltrador SMTP/FTP de keylogger y credenciales AgentTesla.", "tags": "keylogger,rat"},
    {"val": "109.237.103.124", "type": "ip", "threat": "ransomware", "family": "LockBit 3.0", "src": "ThreatFox (abuse.ch)", "conf": 99, "sev": "CRITICA", "desc": "Proxy de negociación y portal C2 afiliado al cártel LockBit.", "tags": "ransomware,extortion"},
    {"val": "185.196.8.12", "type": "ip", "threat": "c2_botnet", "family": "Sliver C2", "src": "ThreatFox (abuse.ch)", "conf": 92, "sev": "CRITICA", "desc": "Framework ofensivo Sliver para post-explotación y persistencia.", "tags": "c2,framework"},
    {"val": "45.9.148.119", "type": "ip", "threat": "malware", "family": "AsyncRAT", "src": "ThreatFox (abuse.ch)", "conf": 93, "sev": "CRITICA", "desc": "Trojan de administración remota AsyncRAT con evasión de EDR.", "tags": "rat,trojan"},
    {"val": "195.123.244.116", "type": "ip", "threat": "c2_botnet", "family": "IcedID / BokBot", "src": "Feodo Tracker (abuse.ch)", "conf": 92, "sev": "CRITICA", "desc": "C2 IcedID especializado en acceso inicial para despliegue de ransomware.", "tags": "c2,banking,initial-access"},
    # Dominios
    {"val": "c2-stealer.network", "type": "domain", "threat": "malware", "family": "RedLine / Vidar", "src": "ThreatFox (abuse.ch)", "conf": 95, "sev": "CRITICA", "desc": "Dominio de callback y exfiltración de registros robados de navegadores.", "tags": "domain,c2,stealer"},
    {"val": "fast-phish-portal.top", "type": "domain", "threat": "phishing", "family": "Credential Phish", "src": "URLhaus (abuse.ch)", "conf": 90, "sev": "ALTA", "desc": "Página clonada de Office 365 / Google Workspace para robo de cuentas.", "tags": "phishing,office365"},
    {"val": "ransom-payment-gate.cc", "type": "domain", "threat": "ransomware", "family": "LockBit", "src": "ThreatFox (abuse.ch)", "conf": 100, "sev": "CRITICA", "desc": "Puerta de enlace TOR-to-Web para pago de rescate y subasta de datos.", "tags": "ransomware,leak-site"},
    {"val": "cobalt-listener-01.xyz", "type": "domain", "threat": "c2_botnet", "family": "Cobalt Strike", "src": "ThreatFox (abuse.ch)", "conf": 96, "sev": "CRITICA", "desc": "Listener HTTP/HTTPS con malleable C2 profile activo.", "tags": "c2,beacon"},
    {"val": "update-microsoft-win11.biz", "type": "domain", "threat": "malware", "family": "Trojan Dropper", "src": "URLhaus (abuse.ch)", "conf": 92, "sev": "ALTA", "desc": "Dominio que simula descargas legítimas para infectar endpoints.", "tags": "dropper,spoofing"},
    # Hashes (SHA256 & MD5)
    {"val": "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f", "type": "hash_sha256", "threat": "ransomware", "family": "WannaCry", "src": "ThreatFox (abuse.ch)", "conf": 100, "sev": "CRITICA", "desc": "Gusano ransomware WannaCry (mssecsvc.exe) que explota EternalBlue MS17-010.", "tags": "worm,ransomware,eternalblue"},
    {"val": "84c82835a5d21bbcf75a61706d8ab549", "type": "hash_md5", "threat": "ransomware", "family": "LockBit 3.0", "src": "ThreatFox (abuse.ch)", "conf": 99, "sev": "CRITICA", "desc": "Cifrador ejecutable LockBit Black con bypass de AMSI.", "tags": "ransomware,encryptor"},
    {"val": "d3b07384d113edec49eaa6238ad5ff00", "type": "hash_md5", "threat": "c2_botnet", "family": "Cobalt Strike", "src": "ThreatFox (abuse.ch)", "conf": 100, "sev": "CRITICA", "desc": "Stager binario Cobalt Strike DLL inyectado en memoria.", "tags": "stager,in-memory"},
    {"val": "f2c537d805be4a1599814421b449b4d081bc83284aa1796be4bbf63be0b8e7ac", "type": "hash_sha256", "threat": "malware", "family": "Emotet", "src": "ThreatFox (abuse.ch)", "conf": 98, "sev": "CRITICA", "desc": "Módulo DLL de persistencia Emotet distribuido en campañas de spam.", "tags": "botnet,loader"},
    {"val": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "type": "hash_sha256", "threat": "scanner", "family": "Canary Test", "src": "SOC Threat Intelligence", "conf": 100, "sev": "BAJA", "desc": "Hash de prueba canario estándar (Empty/Canary) para verificación de correlación del SOC.", "tags": "test,canary"}
]

# Inicializar mapa RAM de ultra-alta velocidad pre-poblado con IOCs canónicos
CTI_IOC_MAP = {
    x["val"].strip().lower(): {
        'id': idx + 1,
        'indicator_value': x["val"],
        'indicator_type': x["type"],
        'threat_type': x["threat"],
        'malware_family': x["family"],
        'source': x["src"],
        'confidence': x["conf"],
        'severity': x["sev"],
        'description': x["desc"],
        'hit_count': 0
    }
    for idx, x in enumerate(INITIAL_SEED_IOCS)
}
CTI_LAST_SYNC = None
_cti_sync_started = False
_cti_sync_lock = threading.Lock()

def seed_initial_cti_iocs():
    """Siembra IOCs iniciales de alta confianza si la base de datos está vacía."""
    try:
        ensure_domain_table()
        if IOCIndicator.objects.exists():
            return
        now_dt = timezone.now()
        objs = [
            IOCIndicator(
                indicator_value=x["val"][:191],
                indicator_type=x["type"],
                threat_type=x["threat"],
                malware_family=x["family"][:100],
                source=x["src"][:100],
                confidence=x["conf"],
                severity=x["sev"],
                description=x["desc"],
                tags=x["tags"],
                first_seen=now_dt,
                last_seen=now_dt
            )
            for x in INITIAL_SEED_IOCS
        ]
        IOCIndicator.objects.bulk_create(objs, ignore_conflicts=True)
        print(f"🛡️ [CTI ENGINE] Base de conocimiento sembrada con {len(objs)} IOCs iniciales.")
    except Exception as e:
        print(f"ℹ️ [CTI ENGINE] Aviso sembrando IOCs iniciales en DB: {e}")

def refresh_cti_ram_cache():
    """Carga todos los IOCs activos a memoria RAM para correlación en microsegundos (< 0.05ms)."""
    global CTI_IOC_MAP
    try:
        # Pre-poblar primero con los IOCs canónicos para garantizar presencia permanente
        new_map = {
            x["val"].strip().lower(): {
                'id': idx + 1,
                'indicator_value': x["val"],
                'indicator_type': x["type"],
                'threat_type': x["threat"],
                'malware_family': x["family"],
                'source': x["src"],
                'confidence': x["conf"],
                'severity': x["sev"],
                'description': x["desc"],
                'hit_count': 0
            }
            for idx, x in enumerate(INITIAL_SEED_IOCS)
        }
        iocs = list(IOCIndicator.objects.filter(is_active=True).values(
            'id', 'indicator_value', 'indicator_type', 'threat_type',
            'malware_family', 'source', 'confidence', 'severity',
            'description', 'hit_count'
        ))
        for item in iocs:
            val_clean = item['indicator_value'].strip().lower()
            new_map[val_clean] = item
        CTI_IOC_MAP = new_map
        print(f"⚡ [CTI ENGINE] {len(new_map)} indicadores cargados en memoria RAM de ultra-alta velocidad.")
        return len(new_map)
    except Exception as e:
        print(f"ℹ️ [CTI ENGINE] Aviso cargando caché RAM desde DB: {e}")
        return len(CTI_IOC_MAP)

def _download_cti_feed_content(url, timeout=25.0, max_bytes=4*1024*1024):
    """Descarga de forma segura y rápida contenido de feeds con soporte SSL y User-Agent."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AgentSOC-CTI/2.0',
        'Accept': 'text/csv,text/plain,*/*',
    }
    req = urllib.request.Request(url, headers=headers)
    ctx = None
    try:
        ctx = ssl._create_unverified_context()
    except Exception:
        pass
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read(max_bytes)
        return raw.decode('utf-8', errors='ignore')

def update_cti_feeds():
    """Descarga e integra en tiempo real las listas de CTI de abuse.ch (Feodo Tracker C2 y ThreatFox)."""
    global CTI_LAST_SYNC, CTI_IOC_MAP
    ensure_domain_table()
    now_dt = timezone.now()
    new_count = 0

    # 1. Feodo Tracker by abuse.ch (Botnet C2 IP blocklist)
    feodo_urls = [
        "https://feodotracker.abuse.ch/downloads/ipblocklist.csv",
        "https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt"
    ]
    feodo_items = []
    for f_url in feodo_urls:
        try:
            content = _download_cti_feed_content(f_url, timeout=20.0)
            if "ipsum" in f_url:
                # Espejo fallback ipsum (IPs maliciosas con alta reputación negativa)
                lines = content.splitlines()
                for line in lines:
                    line_s = line.strip()
                    if not line_s or line_s.startswith('#'):
                        continue
                    parts = line_s.split()
                    ip = parts[0].strip()
                    score = int(parts[1].strip()) if len(parts) > 1 and parts[1].isdigit() else 3
                    if ip and not is_private_ip(ip) and score >= 3:
                        feodo_items.append({
                            "val": ip[:191],
                            "type": "ip",
                            "threat": "c2_botnet",
                            "family": "Multi-Threat IP",
                            "src": "Ipsum CTI Feed",
                            "conf": min(95, 60 + score * 5),
                            "severity": "CRITICA" if score >= 5 else "ALTA",
                            "desc": f"Dirección IP maliciosa con nivel de amenaza {score} en listas de ciberinteligencia.",
                            "tags": "botnet,threat,c2"
                        })
                        if len(feodo_items) >= 250:
                            break
            else:
                # abuse.ch Feodo Tracker oficial CSV
                reader = csv.reader(io.StringIO(content))
                for row in reader:
                    if not row or row[0].startswith('#') or len(row) < 5:
                        continue
                    ip = row[1].strip()
                    status_c2 = row[3].strip() if len(row) > 3 else "online"
                    malware = row[5].strip() if len(row) > 5 else "Botnet C2"
                    if ip and not is_private_ip(ip):
                        feodo_items.append({
                            "val": ip[:191],
                            "type": "ip",
                            "threat": "c2_botnet",
                            "family": (malware or "Feodo Botnet")[:100],
                            "src": "Feodo Tracker (abuse.ch)",
                            "conf": 98 if status_c2 == "online" else 88,
                            "severity": "CRITICA",
                            "desc": f"Servidor C2 activo ({status_c2}) de la familia {malware} detectado por abuse.ch Feodo Tracker.",
                            "tags": "c2,botnet"
                        })
                        if len(feodo_items) >= 400:
                            break

            if feodo_items:
                print(f"🛡️ [CTI ENGINE] Obtenidos {len(feodo_items)} IOCs de Botnets desde {f_url}")
                break
        except Exception as e:
            print(f"⚠️ [CTI ENGINE] Aviso al descargar {f_url}: {e}")

    if feodo_items:
        objs = [
            IOCIndicator(
                indicator_value=x["val"],
                indicator_type=x["type"],
                threat_type=x["threat"],
                malware_family=x["family"],
                source=x["src"],
                confidence=x["conf"],
                severity=x.get("severity", "CRITICA"),
                description=x["desc"],
                tags=x.get("tags", "c2,botnet"),
                first_seen=now_dt,
                last_seen=now_dt
            )
            for x in feodo_items
        ]
        try:
            IOCIndicator.objects.bulk_create(objs, batch_size=200, ignore_conflicts=True)
            new_count += len(objs)
            print(f"🛡️ [CTI ENGINE] Sincronizados {len(objs)} C2 botnets en base de datos.")
        except Exception as dbe:
            print(f"ℹ️ [CTI ENGINE] Aviso guardando Feodo en DB: {dbe}")
            for x in feodo_items:
                CTI_IOC_MAP[x["val"].lower()] = {
                    'id': 0,
                    'indicator_value': x["val"],
                    'indicator_type': x["type"],
                    'threat_type': x["threat"],
                    'malware_family': x["family"],
                    'source': x["src"],
                    'confidence': x["conf"],
                    'severity': x.get("severity", "CRITICA"),
                    'description': x["desc"],
                    'hit_count': 0
                }
            new_count += len(feodo_items)

    # 2. ThreatFox by abuse.ch (Community IOCs - Hashes, Domains, IPs)
    tf_url = "https://threatfox.abuse.ch/downloads/recent.csv"
    try:
        content = _download_cti_feed_content(tf_url, timeout=25.0)
        reader = csv.reader(io.StringIO(content))
        tf_items = []
        for row in reader:
            if not row or row[0].startswith('#') or len(row) < 8:
                continue
            val = row[2].strip()
            ioc_type_raw = row[3].strip().lower()
            threat_raw = row[4].strip().lower()
            malware_name = row[7].strip() if len(row) > 7 else (row[5].strip() if len(row) > 5 else "")
            conf_str = row[9].strip() if len(row) > 9 else "80"
            tags_str = row[12].strip() if len(row) > 12 else ""
            try:
                conf = int(conf_str)
            except ValueError:
                conf = 80

            clean_val = val
            t_type = "ip"
            if "ip:port" in ioc_type_raw:
                clean_val = val.split(':')[0]
                t_type = "ip"
            elif "domain" in ioc_type_raw:
                clean_val = val.split(':')[0]
                t_type = "domain"
            elif "sha256" in ioc_type_raw:
                t_type = "hash_sha256"
            elif "md5" in ioc_type_raw:
                t_type = "hash_md5"
            elif "url" in ioc_type_raw:
                t_type = "url"

            cat_threat = "c2_botnet" if "botnet" in threat_raw else ("ransomware" if "ransom" in threat_raw else ("phishing" if "phish" in threat_raw else "malware"))
            
            if clean_val and not (t_type == "ip" and is_private_ip(clean_val)):
                tf_items.append({
                    "val": clean_val[:191],
                    "type": t_type,
                    "threat": cat_threat,
                    "family": (malware_name or "ThreatFox Threat")[:100],
                    "src": "ThreatFox (abuse.ch)",
                    "conf": conf,
                    "severity": "CRITICA" if conf >= 80 else "ALTA",
                    "desc": f"Indicador de amenaza {malware_name or cat_threat} ({threat_raw}) detectado por ThreatFox.",
                    "tags": tags_str[:250]
                })
                if len(tf_items) >= 400:
                    break

        if tf_items:
            objs = [
                IOCIndicator(
                    indicator_value=x["val"],
                    indicator_type=x["type"],
                    threat_type=x["threat"],
                    malware_family=x["family"],
                    source=x["src"],
                    confidence=x["conf"],
                    severity=x["severity"],
                    description=x["desc"],
                    tags=x["tags"],
                    first_seen=now_dt,
                    last_seen=now_dt
                )
                for x in tf_items
            ]
            try:
                IOCIndicator.objects.bulk_create(objs, batch_size=200, ignore_conflicts=True)
                new_count += len(objs)
                print(f"🛡️ [CTI ENGINE] Sincronizados {len(objs)} IOCs comunitarios desde ThreatFox.")
            except Exception as dbe:
                print(f"ℹ️ [CTI ENGINE] Aviso guardando ThreatFox en DB: {dbe}")
                for x in tf_items:
                    CTI_IOC_MAP[x["val"].lower()] = {
                        'id': 0,
                        'indicator_value': x["val"],
                        'indicator_type': x["type"],
                        'threat_type': x["threat"],
                        'malware_family': x["family"],
                        'source': x["src"],
                        'confidence': x["conf"],
                        'severity': x["severity"],
                        'description': x["desc"],
                        'hit_count': 0
                    }
                new_count += len(tf_items)
    except Exception as e:
        print(f"⚠️ [CTI ENGINE] Aviso al descargar ThreatFox: {e}")

    refresh_cti_ram_cache()
    CTI_LAST_SYNC = timezone.now()
    return new_count

def start_cti_sync_if_needed():
    """Inicia el hilo en segundo plano para sincronizar y mantener en RAM el motor de CTI."""
    global _cti_sync_started
    with _cti_sync_lock:
        if _cti_sync_started:
            return
        _cti_sync_started = True

    def _worker():
        import time
        try:
            ensure_domain_table()
            seed_initial_cti_iocs()
            refresh_cti_ram_cache()
        except Exception as e:
            print(f"ℹ️ [CTI ENGINE] Inicio caché diferido: {e}")

        time.sleep(3)
        try:
            update_cti_feeds()
        except Exception as e:
            print(f"ℹ️ [CTI ENGINE] Primer sync diferido: {e}")

        while True:
            time.sleep(12 * 3600)
            try:
                update_cti_feeds()
            except Exception:
                pass

    t = threading.Thread(target=_worker, daemon=True, name="CTIEngineSync")
    t.start()

def check_ioc_match(candidate):
    """Comprueba de forma instantánea si un valor (IP, dominio, hash) coincide con un IOC malicioso conocido."""
    if not candidate:
        return None
    cand_str = str(candidate).strip().lower()
    if '://' in cand_str:
        cand_str = cand_str.split('://', 1)[1]
    if '/' in cand_str:
        cand_str = cand_str.split('/', 1)[0]
    if ':' in cand_str:
        cand_str = cand_str.split(':', 1)[0]
    cand_str = cand_str.strip()
    if not cand_str:
        return None
    
    # 1. Búsqueda directa en RAM O(1)
    if cand_str in CTI_IOC_MAP:
        return CTI_IOC_MAP[cand_str]

    # 2. Comprobar si es un nodo de Tor
    if is_tor_exit_node(cand_str):
        return {
            'id': 0,
            'indicator_value': cand_str,
            'indicator_type': 'ip',
            'threat_type': 'tor_exit',
            'malware_family': 'Red Tor (Anonimato / Evasión)',
            'source': 'The Tor Project (Oficial)',
            'confidence': 100,
            'severity': 'CRITICA',
            'description': 'Nodo oficial de salida de la Red Tor. Potencial vector de ocultación de origen o ataque anónimo.',
            'hit_count': 1
        }

    # 3. Fallback a base de datos
    try:
        ioc = IOCIndicator.objects.filter(indicator_value__iexact=cand_str, is_active=True).first()
        if ioc:
            data = {
                'id': ioc.id,
                'indicator_value': ioc.indicator_value,
                'indicator_type': ioc.indicator_type,
                'threat_type': ioc.threat_type,
                'malware_family': ioc.malware_family,
                'source': ioc.source,
                'confidence': ioc.confidence,
                'severity': ioc.severity,
                'description': ioc.description,
                'hit_count': ioc.hit_count
            }
            CTI_IOC_MAP[cand_str] = data
            return data
    except Exception:
        pass

    return None

def scan_text_for_iocs(text):
    """Extrae artefactos (IPs, hashes SHA256/MD5, dominios) de un texto y busca coincidencias con la base de CTI."""
    if not text:
        return []
    
    text_str = str(text).strip()
    matched = []
    seen_values = set()

    # Si el texto es un solo token/artefacto, comprobarlo directamente
    if len(text_str.split()) == 1:
        direct = check_ioc_match(text_str)
        if direct and direct['indicator_value'] not in seen_values:
            seen_values.add(direct['indicator_value'])
            matched.append(direct)

    ip_pattern = r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b'
    sha256_pattern = r'\b[a-fA-F0-9]{64}\b'
    md5_pattern = r'\b[a-fA-F0-9]{32}\b'
    domain_pattern = r'\b[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.(?:[a-zA-Z0-9\-]{1,63}\.)*[a-zA-Z]{2,24}\b'

    candidates = set()
    for ip in re.findall(ip_pattern, text_str):
        if not is_private_ip(ip):
            candidates.add(ip)
    for sha in re.findall(sha256_pattern, text_str):
        candidates.add(sha)
    for md5 in re.findall(md5_pattern, text_str):
        candidates.add(md5)
    for url_host in re.findall(r'https?://([^\s/\'"<>]+)', text_str):
        host_clean = url_host.split(':')[0].strip().lower()
        if host_clean and '.' in host_clean:
            candidates.add(host_clean)
    for dom in re.findall(domain_pattern, text_str, re.IGNORECASE):
        dom_clean = dom.lower().strip('.')
        if '.' in dom_clean and not any(dom_clean.endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.gif', '.css', '.js', '.svg')):
            candidates.add(dom_clean)

    for cand in candidates:
        match = check_ioc_match(cand)
        if match and match['indicator_value'] not in seen_values:
            seen_values.add(match['indicator_value'])
            matched.append(match)

    return matched

def record_ioc_hit(matched_ioc, source_event, matched_value, client_ip='', user=None, action_taken="Alerta SOC Generada", details=""):
    """Registra una correlación/match de IOC en la base de datos y actualiza métricas."""
    try:
        val = matched_ioc.get('indicator_value', matched_value)
        IOCIndicator.objects.filter(indicator_value=val).update(
            hit_count=models.F('hit_count') + 1,
            last_hit_at=timezone.now()
        )
        if val.lower() in CTI_IOC_MAP:
            CTI_IOC_MAP[val.lower()]['hit_count'] = CTI_IOC_MAP[val.lower()].get('hit_count', 0) + 1

        hit = IOCHit.objects.create(
            indicator_value=val,
            indicator_type=matched_ioc.get('indicator_type', 'ip'),
            threat_type=matched_ioc.get('threat_type', 'c2_botnet'),
            malware_family=matched_ioc.get('malware_family', ''),
            source_feed=matched_ioc.get('source', 'CTI Engine'),
            severity=matched_ioc.get('severity', 'CRITICA'),
            source_event=source_event,
            matched_value=matched_value,
            client_ip=client_ip,
            user=user,
            action_taken=action_taken,
            details=str(details)
        )
        return hit
    except Exception as e:
        print(f"ℹ️ [CTI ENGINE] Error guardando hit de IOC: {e}")
        return None

def check_suspicious_access(user, client_ip, user_agent, device_name):
    """
    Comprueba si el inicio de sesión califica como acceso sospechoso según políticas:
    0. Correlación CTI de IOCs de Amenazas Activas (C2, Botnets, Malware).
    1. Detección de Nodos Tor / Redes de Anonimización.
    2. Detección de Viaje Imposible (Impossible Travel / UEBA).
    3. Nueva dirección IP o nuevo dispositivo no confiables.
    """
    policy = SecurityPolicy.get_solo()
    reasons = []
    is_tor = False
    is_impossible_travel = False
    criticality = "ALTA"
    travel_details = None
    cti_match = None

    geo_current = geolocate_ip(client_ip)

    # 0. Correlación CTI de IOCs de Amenazas Activas (C2, Botnets, Malware)
    if not is_private_ip(client_ip):
        cti_match = check_ioc_match(client_ip)
        if cti_match and cti_match.get('threat_type') != 'tor_exit':
            criticality = "CRITICA"
            fam = cti_match.get('malware_family') or cti_match.get('threat_type', 'Amenaza CTI')
            src = cti_match.get('source', 'CTI Feeds')
            conf = cti_match.get('confidence', 90)
            reasons.append(f"🚨 CTI MATCH CRÍTICO: IP {client_ip} clasificada como {fam} [{cti_match.get('threat_type')}] en feed {src} (Confianza: {conf}%)")
            record_ioc_hit(cti_match, source_event=f"Intento de autenticación de usuario '{user.username}'", matched_value=client_ip, client_ip=client_ip, user=user, action_taken="🚨 Alerta Crítica CTI + Registro Forense")

    # 1. Comprobación de Nodos de Salida de Tor
    if policy.detect_tor_exit_nodes and not is_private_ip(client_ip):
        if is_tor_exit_node(client_ip):
            is_tor = True
            criticality = "CRITICA"
            reasons.append(f"🧅 Conexión anónima detectada desde nodo de salida de la Red Tor ({client_ip})")

    # 2. Comprobación de Viaje Imposible (Impossible Travel)
    if policy.detect_impossible_travel and not is_private_ip(client_ip) and geo_current.get('lat') is not None:
        curr_lat = geo_current['lat']
        curr_lon = geo_current['lon']

        last_session = UserSession.objects.filter(
            user=user,
            latitude__isnull=False,
            longitude__isnull=False
        ).exclude(ip_address=client_ip).order_by('-last_activity').first()

        if last_session and last_session.latitude is not None and last_session.longitude is not None:
            prev_lat = last_session.latitude
            prev_lon = last_session.longitude
            dist_km = haversine_distance_km(prev_lat, prev_lon, curr_lat, curr_lon)

            now_dt = timezone.now()
            time_diff = (now_dt - last_session.last_activity).total_seconds()
            hours_diff = max(time_diff / 3600.0, 0.001)

            if dist_km > 150.0:
                calc_speed = dist_km / hours_diff
                speed_threshold = policy.impossible_travel_speed_kmh or 800

                if calc_speed > speed_threshold:
                    is_impossible_travel = True
                    criticality = "CRITICA"
                    mins_diff = int(time_diff / 60)
                    time_str = f"{mins_diff} min" if mins_diff < 120 else f"{round(hours_diff, 1)} h"
                    prev_loc = last_session.location or f"{last_session.city}, {last_session.country}".strip(', ') or last_session.ip_address
                    curr_loc = geo_current.get('location') or f"{geo_current.get('city')}, {geo_current.get('country')}".strip(', ') or client_ip

                    travel_details = {
                        'distance_km': round(dist_km, 1),
                        'time_hours': round(hours_diff, 2),
                        'speed_kmh': round(calc_speed, 1),
                        'prev_location': prev_loc,
                        'prev_ip': last_session.ip_address,
                        'curr_location': curr_loc,
                        'curr_ip': client_ip
                    }

                    reasons.append(
                        f"✈️ Viaje Imposible detectado: de {prev_loc} a {curr_loc} ({int(dist_km)} km en {time_str} - Requiere {int(calc_speed)} km/h > {speed_threshold} km/h)"
                    )

    # 3. Comprobación estándar de nueva IP o dispositivo
    has_history = (
        UserSession.objects.filter(user=user).exists() or
        TrustedAccess.objects.filter(user=user).exists()
    )
    if has_history:
        if policy.alert_on_new_ip:
            known_ip = (
                UserSession.objects.filter(user=user, ip_address=client_ip, is_suspicious=False).exists() or
                TrustedAccess.objects.filter(user=user, ip_address=client_ip).exists()
            )
            if not known_ip and not is_tor:
                reasons.append(f"Nueva dirección IP detectada ({client_ip})")

        if policy.alert_on_new_device:
            known_dev = (
                UserSession.objects.filter(user=user, device_name=device_name, is_suspicious=False).exists() or
                TrustedAccess.objects.filter(user=user, device_name=device_name).exists()
            )
            if not known_dev:
                reasons.append(f"Nuevo dispositivo detectado ({device_name})")

    is_suspicious = len(reasons) > 0
    reason_str = " | ".join(reasons) if is_suspicious else ""

    meta = {
        'geo': geo_current,
        'is_tor': is_tor,
        'is_impossible_travel': is_impossible_travel,
        'criticality': criticality,
        'travel_details': travel_details,
        'cti_match': cti_match
    }
    return is_suspicious, reason_str, meta


def send_mfa_email(recipient_email, username, code, client_ip='127.0.0.1', device_name='Dispositivo desconocido'):
    """Envía el código PIN de 6 dígitos para autenticación de dos factores (MFA)."""
    ensure_domain_table()
    config = EmailConfig.objects.first()
    if not config or not config.smtp_user or not config.smtp_password:
        return False, "SMTP no configurado en el SOC."

    sender_email = config.from_email.strip() or config.smtp_user.strip()
    sender_name = config.from_name.strip() or "AgentSOC Seguridad"

    subject = f"[AgentSOC] Código de Acceso MFA: {code}"
    timestamp_str = timezone.now().strftime("%Y-%m-%d %H:%M:%S UTC")

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0f19; color: #ffffff; margin: 0; padding: 20px; }}
        .card {{ max-width: 500px; margin: 0 auto; background-color: #111827; border-radius: 14px; border: 1px solid #374151; padding: 32px; color: #ffffff; }}
        .badge {{ display: inline-block; padding: 6px 14px; background-color: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; }}
        .code-box {{ text-align: center; margin: 24px 0; padding: 20px; background-color: #1e1b4b; border: 1px solid #6366f1; border-radius: 10px; }}
        .pin {{ font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #a5b4fc; font-family: monospace; }}
        .details-table {{ width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; color: #cbd5e1; }}
        .details-table td {{ padding: 8px 10px; border-bottom: 1px solid #1f2937; }}
        .details-table td.label {{ color: #94a3b8; font-weight: 600; width: 35%; }}
        .alert-box {{ background-color: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 8px; padding: 12px 16px; margin-top: 20px; font-size: 12px; color: #fda4af; }}
        .footer {{ font-size: 11px; color: #64748b; text-align: center; margin-top: 24px; border-top: 1px solid #1f2937; padding-top: 16px; }}
      </style>
    </head>
    <body style="background-color: #0b0f19; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px;">
      <div class="card" style="max-width: 500px; margin: 0 auto; background-color: #111827; border-radius: 14px; border: 1px solid #374151; padding: 32px; color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <span class="badge" style="display: inline-block; padding: 6px 14px; background-color: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">AgentSOC Security • MFA</span>
          <h2 style="color: #ffffff; margin-top: 14px; font-size: 22px; font-weight: 700;">Código de Verificación</h2>
          <p style="color: #94a3b8; font-size: 14px; margin: 6px 0 0 0;">Autenticación en Dos Pasos para Administradores</p>
        </div>
        <p style="color: #f1f5f9; font-size: 15px; line-height: 1.6;">Hola <strong>{username}</strong>,</p>
        <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">Se ha detectado un inicio de sesión con tu cuenta de Administrador. Ingresa el siguiente código PIN de 6 dígitos para completar el acceso:</p>
        
        <div class="code-box" style="text-align: center; margin: 24px 0; padding: 20px; background-color: #1e1b4b; border: 1px solid #6366f1; border-radius: 10px;">
          <div class="pin" style="font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #a5b4fc; font-family: monospace;">{code}</div>
        </div>

        <table class="details-table" style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; color: #cbd5e1;">
          <tr><td class="label" style="color: #94a3b8; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #1f2937;">Dispositivo:</td><td style="padding: 6px 8px; border-bottom: 1px solid #1f2937;">{device_name}</td></tr>
          <tr><td class="label" style="color: #94a3b8; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #1f2937;">Dirección IP:</td><td style="padding: 6px 8px; border-bottom: 1px solid #1f2937; font-family: monospace;">{client_ip}</td></tr>
          <tr><td class="label" style="color: #94a3b8; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #1f2937;">Fecha y Hora:</td><td style="padding: 6px 8px; border-bottom: 1px solid #1f2937;">{timestamp_str}</td></tr>
        </table>

        <div class="alert-box" style="background-color: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 8px; padding: 12px 16px; margin-top: 20px; font-size: 12px; color: #fda4af;">
          ⚠️ <strong>Importante:</strong> Este código expira en <strong>10 minutos</strong>. Si no estás intentando iniciar sesión, revoca las sesiones y cambia tu contraseña inmediatamente.
        </div>

        <div class="footer" style="font-size: 11px; color: #64748b; text-align: center; margin-top: 24px; border-top: 1px solid #1f2937; padding-top: 16px;">
          © AgentSOC Security Platform • Mensaje generado automáticamente
        </div>
      </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = recipient_email

    text_content = f"Hola {username},\n\nTu código de verificación MFA para AgentSOC es: {code}\n(Válido por 10 minutos).\nIP: {client_ip}\nDispositivo: {device_name}\n"
    msg.attach(MIMEText(text_content, "plain", "utf-8"))
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        host = config.smtp_host.strip() or 'smtp.gmail.com'
        port = int(config.smtp_port or 587)
        if config.smtp_use_ssl or port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=12)
        else:
            server = smtplib.SMTP(host, port, timeout=12)
            if config.smtp_use_tls:
                server.starttls()

        pwd = config.smtp_password.strip()
        if 'gmail' in host.lower():
            pwd = pwd.replace(' ', '')
        server.login(config.smtp_user.strip(), pwd)
        server.sendmail(sender_email, [recipient_email], msg.as_string())
        server.quit()
        return True, "Email enviado con éxito"
    except Exception as e:
        print(f"Error SMTP enviando MFA: {e}")
        return False, str(e)


def send_suspicious_login_alert(user, client_ip, device_name, reason, criticality="ALTA"):
    """Envía alertas por acceso sospechoso a través de Email, Telegram y registra en el Log del SOC."""
    try:
        policy = SecurityPolicy.get_solo()
        now_str = timezone.now().strftime("%Y-%m-%d %H:%M:%S UTC")

        # 1. Registrar en los Logs del SOC con la criticidad adecuada (ALTA o CRITICA)
        agent = Agent.objects.filter(name__icontains="SOC").first() or Agent.objects.first()
        if not agent:
            agent = Agent.objects.create(name="SOC Central", ip_address="127.0.0.1", api_key=f"key_{uuid.uuid4().hex[:16]}", status="active")

        prefix = "🚨 [CIBERINTELIGENCIA CRÍTICA]" if criticality == "CRITICA" else "⚠️ [ACCESO SOSPECHOSO]"
        alert_msg = f"{prefix} Cuenta '{user.username}': {reason} (IP: {client_ip}, Dispositivo: {device_name})"
        evidence_log = (
            f"Usuario: {user.username}\n"
            f"Rol: {getattr(user.profile, 'role', 'read') if hasattr(user, 'profile') else 'read'}\n"
            f"IP Origen: {client_ip}\n"
            f"Dispositivo: {device_name}\n"
            f"Nivel de Criticidad: {criticality}\n"
            f"Motivo: {reason}\n"
            f"Timestamp: {now_str}"
        )

        Log.objects.create(
            agent=agent,
            criticality=criticality,
            message=alert_msg,
            evidence=evidence_log,
            resources_info=f"IP: {client_ip} | Usuario: {user.username}"
        )

        # 2. Notificación por Telegram
        if policy.notify_suspicious_telegram:
            try:
                send_telegram_alerts(criticality, alert_msg, agent.name, evidence=evidence_log)
            except Exception as e_tg:
                print(f"⚠️ [send_telegram_alerts in suspicious alert]: {e_tg}")

        # 3. Notificación por Correo
        if policy.notify_suspicious_email and user.email:
            config = EmailConfig.objects.first()
            if config and config.smtp_user and config.smtp_password:
                try:
                    sender_email = config.from_email.strip() or config.smtp_user.strip()
                    sender_name = config.from_name.strip() or "AgentSOC Alertas de Seguridad"
                    subject = f"{prefix} Alerta de Seguridad para {user.username}"

                    border_color = "#ef4444" if criticality == "CRITICA" else "#e11d48"
                    badge_color = "#f87171" if criticality == "CRITICA" else "#fb7185"

                    html_body = f"""
                    <div style="font-family: sans-serif; background-color: #0f172a; color: #fff; padding: 24px; border-radius: 12px; max-width: 520px; margin: 0 auto; border: 1px solid {border_color};">
                      <h3 style="color: {badge_color}; margin-top: 0;">{prefix}</h3>
                      <p>Hola <strong>{user.username}</strong>,</p>
                      <p>El sistema de ciberinteligencia y detección del SOC ha identificado un evento de acceso que requiere tu atención:</p>
                      <div style="background-color: #1e293b; padding: 14px; border-radius: 8px; font-size: 13px; line-height: 1.6; margin: 16px 0;">
                        • <strong>Motivo:</strong> {reason}<br>
                        • <strong>IP de Origen:</strong> {client_ip}<br>
                        • <strong>Dispositivo:</strong> {device_name}<br>
                        • <strong>Nivel de Criticidad:</strong> <span style="color: {badge_color}; font-weight: bold;">{criticality}</span><br>
                        • <strong>Fecha:</strong> {now_str}
                      </div>
                      <p style="font-size: 12px; color: #94a3b8;">Si fuiste tú, puedes ignorar este aviso o marcarlo como legítimo en el panel. Si no reconoces este acceso, ingresa inmediatamente para revocar todas las sesiones activas y cambiar tu contraseña.</p>
                    </div>
                    """
                    msg = MIMEMultipart("alternative")
                    msg["Subject"] = subject
                    msg["From"] = f"{sender_name} <{sender_email}>"
                    msg["To"] = user.email.strip()
                    msg.attach(MIMEText(alert_msg, "plain", "utf-8"))
                    msg.attach(MIMEText(html_body, "html", "utf-8"))

                    host = config.smtp_host.strip() or 'smtp.gmail.com'
                    port = int(config.smtp_port or 587)
                    if config.smtp_use_ssl or port == 465:
                        server = smtplib.SMTP_SSL(host, port, timeout=10)
                    else:
                        server = smtplib.SMTP(host, port, timeout=10)
                        if config.smtp_use_tls:
                            server.starttls()
                    pwd = config.smtp_password.strip()
                    if 'gmail' in host.lower():
                        pwd = pwd.replace(' ', '')
                    server.login(config.smtp_user.strip(), pwd)
                    server.sendmail(sender_email, [user.email.strip()], msg.as_string())
                    server.quit()
                except Exception as e:
                    print(f"Error enviando correo de alerta sospechosa: {e}")
    except Exception as e_alert_main:
        print(f"⚠️ [send_suspicious_login_alert main exception]: {e_alert_main}")


class CustomLoginView(APIView):
    """Maneja el login, verificación MFA para administradores y bloqueo por fuerza bruta."""
    permission_classes = []

    def post(self, request):
        ensure_domain_table()
        username = str(request.data.get('username') or '').strip()
        password = str(request.data.get('password') or '').strip()

        # Obtener IP del cliente para auditoría
        client_ip = request.META.get('HTTP_X_FORWARDED_FOR') or request.META.get('REMOTE_ADDR') or '127.0.0.1'
        if ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()

        user_obj = User.objects.filter(username__iexact=username).first()
        env_admin_user = os.environ.get('INITIAL_ADMIN_USER', 'admin').strip().strip('"\'')
        env_admin_pass = os.environ.get('INITIAL_ADMIN_PASSWORD', '').strip().strip('"\'')

        if not user_obj:
            if username.lower() == env_admin_user.lower() and env_admin_pass and password == env_admin_pass:
                print(f"🚀 [AUTH BOOTSTRAP] Creando cuenta administradora '{username}' en vivo...")
                user_obj = User.objects.create_user(username=env_admin_user, password=env_admin_pass, last_login=timezone.now())
                user_obj.is_staff = True
                user_obj.is_superuser = True
                user_obj.save()
                UserProfile.objects.create(user=user_obj, role='admin')
            else:
                print(f"❌ [AUTH] Usuario '{username}' no encontrado en la base de datos.")
                return Response({"detail": "Credenciales inválidas"}, status=status.HTTP_401_UNAUTHORIZED)

        username = user_obj.username
        profile = getattr(user_obj, 'profile', None)
        now_dt = timezone.now()

        # Comprobar si coincide con la clave administrativa del .env para auto-reparar desincronizaciones y bloqueos
        is_initial_admin = (username.lower() == env_admin_user.lower())
        if is_initial_admin and env_admin_pass and password == env_admin_pass:
            if not user_obj.check_password(env_admin_pass):
                print(f"🔄 [AUTH] Sincronizando contraseña en base de datos para '{username}' desde INITIAL_ADMIN_PASSWORD.")
                user_obj.set_password(env_admin_pass)
                user_obj.is_active = True
                if user_obj.last_login is None:
                    user_obj.last_login = timezone.now()
                user_obj.save()
            if profile and (profile.is_locked or profile.failed_attempts > 0):
                profile.is_locked = False
                profile.failed_attempts = 0
                profile.locked_until = None
                profile.save()

        # 1. Verificar si la cuenta está actualmente bloqueada
        if profile and profile.is_locked:
            if profile.locked_until and now_dt < profile.locked_until:
                remaining_seconds = max(1, int((profile.locked_until - now_dt).total_seconds()))
                return Response({
                    "detail": f"Cuenta temporalmente bloqueada. Intenta de nuevo en {remaining_seconds} segundos.",
                    "locked_until": profile.locked_until.isoformat(),
                    "remaining_seconds": remaining_seconds,
                    "failed_attempts": profile.failed_attempts
                }, status=status.HTTP_403_FORBIDDEN)
            elif profile.locked_until and now_dt >= profile.locked_until:
                profile.is_locked = False
                profile.save(update_fields=['is_locked'])
            elif not profile.locked_until:
                return Response({"detail": "Cuenta bloqueada permanentemente por el administrador."}, status=status.HTTP_403_FORBIDDEN)

        # 2. Intentar autenticación
        user = authenticate(username=username, password=password)

        if not user:
            print(f"❌ [AUTH] Credenciales inválidas para '{username}' desde IP {client_ip}.")
            if profile:
                profile.failed_attempts += 1
                attempts = profile.failed_attempts

                if attempts >= 3:
                    exp = min(attempts - 3, 10)
                    lock_seconds = min(86400, 60 * (2 ** exp))
                    profile.is_locked = True
                    profile.locked_until = now_dt + timedelta(seconds=lock_seconds)
                    profile.save()

                    agent = Agent.objects.filter(name__icontains="SOC").first() or Agent.objects.first()
                    if not agent:
                        agent = Agent.objects.create(name="SOC Central", ip_address="127.0.0.1", api_key=f"key_{uuid.uuid4().hex[:16]}", status="active")

                    alert_msg = f"Detectado posible ataque de fuerza bruta contra el usuario '{username}'. Cuenta bloqueada por {lock_seconds}s tras {attempts} intentos fallidos."
                    evidence_log = (
                        f"Usuario objetivo: {username}\n"
                        f"IP Origen: {client_ip}\n"
                        f"Intentos fallidos acumulados: {attempts}\n"
                        f"Penalización exponencial: {lock_seconds} segundos\n"
                        f"Bloqueado hasta: {profile.locked_until.strftime('%Y-%m-%d %H:%M:%S UTC')}"
                    )

                    Log.objects.create(
                        agent=agent,
                        criticality="ALTA",
                        message=alert_msg,
                        evidence=evidence_log,
                        resources_info=f"IP: {client_ip} | Usuario: {username}"
                    )

                    send_telegram_alerts("ALTA", alert_msg, agent.name, evidence=evidence_log)

                    return Response({
                        "detail": f"Cuenta temporalmente bloqueada. Intenta de nuevo en {lock_seconds} segundos.",
                        "locked_until": profile.locked_until.isoformat(),
                        "remaining_seconds": lock_seconds,
                        "failed_attempts": attempts
                    }, status=status.HTTP_403_FORBIDDEN)
                else:
                    profile.save(update_fields=['failed_attempts'])
                    return Response({
                        "detail": "Credenciales inválidas",
                        "failed_attempts": attempts
                    }, status=status.HTTP_401_UNAUTHORIZED)

            return Response({"detail": "Credenciales inválidas"}, status=status.HTTP_401_UNAUTHORIZED)

        # 3. Login exitoso, resetear intentos y levantar bloqueo
        if hasattr(user, 'profile'):
            user.profile.failed_attempts = 0
            user.profile.is_locked = False
            user.profile.locked_until = None
            user.profile.save()
        user.last_login = timezone.now()
        user.save(update_fields=['last_login'])

        user_agent = request.META.get('HTTP_USER_AGENT', '')
        device_name, device_type = parse_user_agent(user_agent)

        policy = SecurityPolicy.get_solo()
        user_role = user.profile.role if hasattr(user, 'profile') else 'read'

        # MFA obligatorio para rol 'admin' (o si la política enforce_mfa_all está activada)
        requires_mfa = (user_role == 'admin' and policy.enforce_mfa_admin) or policy.enforce_mfa_all

        # Comprobar si hay canales disponibles para entregar el código MFA
        dest_email = user.email.strip() if user.email else ''
        if not dest_email:
            init_email = os.environ.get('INITIAL_ADMIN_EMAIL', '').strip()
            if init_email:
                dest_email = init_email
                user.email = dest_email
                user.save(update_fields=['email'])
            else:
                cfg = EmailConfig.objects.first()
                if cfg and (cfg.from_email or cfg.smtp_user):
                    dest_email = (cfg.from_email.strip() or cfg.smtp_user.strip())
                    user.email = dest_email
                    user.save(update_fields=['email'])

        email_cfg = EmailConfig.objects.first()
        has_smtp = bool(email_cfg and email_cfg.smtp_user and email_cfg.smtp_password and email_cfg.smtp_host)
        has_delivery_channel = bool(dest_email) and has_smtp

        if requires_mfa and has_delivery_channel:
            mfa_code = f"{random.randint(100000, 999999)}"
            mfa_token = str(uuid.uuid4())

            profile = user.profile
            profile.mfa_token = mfa_token
            profile.mfa_code = mfa_code
            profile.mfa_code_expires = timezone.now() + timedelta(minutes=10)
            profile.mfa_last_sent_at = timezone.now()
            profile.save(update_fields=['mfa_token', 'mfa_code', 'mfa_code_expires', 'mfa_last_sent_at'])

            # El código de doble factor (MFA) se envía EXCLUSIVAMENTE al correo electrónico del usuario (no por Telegram)
            send_mfa_email(dest_email, user.username, mfa_code, client_ip, device_name)

            return Response({
                "mfa_required": True,
                "mfa_token": mfa_token,
                "email_masked": mask_email(dest_email),
                "message": f"Se ha enviado un código de verificación de 6 dígitos a su correo electrónico ({mask_email(dest_email)})."
            }, status=status.HTTP_200_OK)

        elif requires_mfa and not has_delivery_channel:
            print(f"ℹ️ [SOC BOOTSTRAP] Acceso de arranque permitido para '{user.username}': No hay servidor SMTP o correo configurado para entrega de MFA por email. Se requiere configuración inicial en el panel.")

        # Login directo para roles que no requieren MFA o primer arranque de configuración
        session_token = str(uuid.uuid4())
        is_suspicious, suspicious_reason, meta = check_suspicious_access(user, client_ip, user_agent, device_name)

        if meta.get('is_tor') and policy.block_tor_logins:
            send_suspicious_login_alert(user, client_ip, device_name, "Acceso bloqueado: Conexión desde nodo de la Red Tor prohibida por política", criticality="CRITICA")
            return Response({"detail": "Acceso bloqueado por política de seguridad: Conexiones anónimas desde la Red Tor no están permitidas."}, status=status.HTTP_403_FORBIDDEN)

        geo = meta.get('geo', {})
        try:
            UserSession.objects.create(
                user=user,
                session_token=session_token,
                ip_address=client_ip,
                user_agent=user_agent,
                device_name=device_name,
                device_type=device_type,
                location=geo.get('location', 'Red Interna / Local'),
                latitude=geo.get('lat'),
                longitude=geo.get('lon'),
                country=geo.get('country', ''),
                city=geo.get('city', ''),
                is_tor=meta.get('is_tor', False),
                is_active=True,
                is_suspicious=is_suspicious,
                suspicious_reason=suspicious_reason
            )
        except Exception as e_sess:
            print(f"⚠️ [UserSession create error]: {e_sess}")

        if is_suspicious:
            try:
                send_suspicious_login_alert(user, client_ip, device_name, suspicious_reason, criticality=meta.get('criticality', 'ALTA'))
            except Exception as e_alert:
                print(f"⚠️ [send_suspicious_login_alert error]: {e_alert}")

        refresh = RefreshToken.for_user(user)
        refresh['session_token'] = session_token
        access = refresh.access_token
        access['session_token'] = session_token
        resp_data = {
            'access_token': str(access),
            'refresh_token': str(refresh),
            'role': user_role,
            'session_token': session_token
        }
        if requires_mfa and not has_delivery_channel:
            resp_data['initial_setup_required'] = True
            resp_data['setup_warning'] = 'Primer inicio: Configure un servidor SMTP en Ajustes del Sistema y asigne su correo electrónico para activar la protección MFA obligatoria.'

        return Response(resp_data)


class MFAVerifyView(APIView):
    """Valida el código PIN de 6 dígitos del desafío MFA y emite el JWT."""
    permission_classes = []

    def post(self, request):
        ensure_domain_table()
        mfa_token = str(request.data.get('mfa_token') or '').strip()
        code = str(request.data.get('code') or '').strip()

        if not mfa_token or not code:
            return Response({"detail": "Token MFA y código requeridos."}, status=status.HTTP_400_BAD_REQUEST)

        profile = UserProfile.objects.filter(mfa_token=mfa_token).first()
        if not profile:
            return Response({"detail": "Sesión de verificación inválida o expirada."}, status=status.HTTP_401_UNAUTHORIZED)

        now = timezone.now()
        if not profile.mfa_code_expires or now > profile.mfa_code_expires:
            return Response({"detail": "El código PIN ha expirado. Solicita uno nuevo."}, status=status.HTTP_401_UNAUTHORIZED)

        if profile.mfa_code != code:
            return Response({"detail": "Código de verificación incorrecto."}, status=status.HTTP_401_UNAUTHORIZED)

        user = profile.user
        profile.mfa_token = ''
        profile.mfa_code = ''
        profile.mfa_code_expires = None
        profile.save(update_fields=['mfa_token', 'mfa_code', 'mfa_code_expires'])

        # Registrar sesión de dispositivo
        client_ip = request.META.get('HTTP_X_FORWARDED_FOR') or request.META.get('REMOTE_ADDR') or '127.0.0.1'
        if ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()

        user_agent = request.META.get('HTTP_USER_AGENT', '')
        device_name, device_type = parse_user_agent(user_agent)
        is_suspicious, suspicious_reason, meta = check_suspicious_access(user, client_ip, user_agent, device_name)

        policy = SecurityPolicy.objects.first()
        if meta.get('is_tor') and policy and policy.block_tor_logins:
            send_suspicious_login_alert(user, client_ip, device_name, "Acceso bloqueado: Conexión desde nodo de la Red Tor prohibida por política", criticality="CRITICA")
            return Response({"detail": "Acceso bloqueado por política de seguridad: Conexiones anónimas desde la Red Tor no están permitidas."}, status=status.HTTP_403_FORBIDDEN)

        session_token = str(uuid.uuid4())
        # Respetar límite de sesiones simultáneas
        max_sessions = policy.max_active_sessions_per_user if policy else 5
        active_sessions = list(UserSession.objects.filter(user=user, is_active=True).order_by('last_activity'))
        if len(active_sessions) >= max_sessions:
            to_revoke = active_sessions[:len(active_sessions) - max_sessions + 1]
            for s in to_revoke:
                s.is_active = False
                s.save(update_fields=['is_active'])

        geo = meta.get('geo', {})
        UserSession.objects.create(
            user=user,
            session_token=session_token,
            ip_address=client_ip,
            user_agent=user_agent,
            device_name=device_name,
            device_type=device_type,
            location=geo.get('location', 'Red Interna / Local'),
            latitude=geo.get('lat'),
            longitude=geo.get('lon'),
            country=geo.get('country', ''),
            city=geo.get('city', ''),
            is_tor=meta.get('is_tor', False),
            is_active=True,
            is_suspicious=is_suspicious,
            suspicious_reason=suspicious_reason
        )

        if is_suspicious:
            send_suspicious_login_alert(user, client_ip, device_name, suspicious_reason, criticality=meta.get('criticality', 'ALTA'))

        refresh = RefreshToken.for_user(user)
        refresh['session_token'] = session_token
        access = refresh.access_token
        access['session_token'] = session_token
        return Response({
            'access_token': str(access),
            'refresh_token': str(refresh),
            'role': profile.role,
            'session_token': session_token
        })


class MFAResendView(APIView):
    """Reenvía el código PIN de 6 dígitos con un cooldown de 60 segundos."""
    permission_classes = []

    def post(self, request):
        ensure_domain_table()
        mfa_token = str(request.data.get('mfa_token') or '').strip()
        if not mfa_token:
            return Response({"detail": "Token MFA requerido."}, status=status.HTTP_400_BAD_REQUEST)

        profile = UserProfile.objects.filter(mfa_token=mfa_token).first()
        if not profile:
            return Response({"detail": "Sesión de verificación inválida."}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        if profile.mfa_last_sent_at and (now - profile.mfa_last_sent_at).total_seconds() < 60:
            wait_sec = int(60 - (now - profile.mfa_last_sent_at).total_seconds())
            return Response({
                "detail": f"Por favor espera {wait_sec} segundos antes de solicitar un nuevo código."
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

        user = profile.user
        mfa_code = f"{random.randint(100000, 999999)}"
        profile.mfa_code = mfa_code
        profile.mfa_code_expires = now + timedelta(minutes=10)
        profile.mfa_last_sent_at = now
        profile.save(update_fields=['mfa_code', 'mfa_code_expires', 'mfa_last_sent_at'])

        client_ip = request.META.get('HTTP_X_FORWARDED_FOR') or request.META.get('REMOTE_ADDR') or '127.0.0.1'
        if ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()
        user_agent = request.META.get('HTTP_USER_AGENT', '')
        device_name, _ = parse_user_agent(user_agent)

        dest_email = user.email.strip() if user.email else ''
        if not dest_email:
            cfg = EmailConfig.objects.first()
            if cfg:
                dest_email = (cfg.from_email or cfg.smtp_user or '').strip()

        if dest_email:
            send_mfa_email(dest_email, user.username, mfa_code, client_ip, device_name)

        return Response({
            "message": f"Nuevo código enviado a {mask_email(dest_email)}",
            "email_masked": mask_email(dest_email)
        })


class UserSessionListView(APIView):
    """Lista las sesiones activas y recientes del usuario actual o de todos si es admin."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_domain_table()
        user = request.user
        is_admin = getattr(user.profile, 'role', 'read') == 'admin' if hasattr(user, 'profile') else False
        show_all = request.query_params.get('all') == 'true' and is_admin

        # Leer session_token de header o JWT
        current_session_token = request.headers.get('X-Session-Token') or ''
        if not current_session_token and hasattr(request, 'auth') and hasattr(request.auth, 'get'):
            current_session_token = request.auth.get('session_token', '')

        # Auto-expirar sesiones que superen el tiempo límite configurado
        policy = SecurityPolicy.objects.first()
        timeout_hours = policy.session_timeout_hours if policy else 24
        cutoff = timezone.now() - datetime.timedelta(hours=timeout_hours)
        UserSession.objects.filter(is_active=True, last_activity__lt=cutoff).update(is_active=False)

        # Actualizar last_activity de la sesión actual
        if current_session_token:
            UserSession.objects.filter(session_token=current_session_token, is_active=True).update(last_activity=timezone.now())

        if show_all:
            sessions_qs = UserSession.objects.all().select_related('user')[:100]
        else:
            sessions_qs = UserSession.objects.filter(user=user)[:50]

        data = []
        for s in sessions_qs:
            data.append({
                'id': s.id,
                'username': s.user.username,
                'ip_address': s.ip_address,
                'device_name': s.device_name,
                'device_type': s.device_type,
                'location': s.location,
                'country': getattr(s, 'country', ''),
                'city': getattr(s, 'city', ''),
                'latitude': getattr(s, 'latitude', None),
                'longitude': getattr(s, 'longitude', None),
                'is_tor': getattr(s, 'is_tor', False),
                'is_active': s.is_active,
                'is_current': (s.session_token == current_session_token),
                'is_suspicious': s.is_suspicious,
                'suspicious_reason': s.suspicious_reason,
                'created_at': s.created_at.isoformat(),
                'last_activity': s.last_activity.isoformat()
            })

        return Response(data)


class UserSessionRevokeView(APIView):
    """Revoca una sesión específica."""
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        ensure_domain_table()
        user = request.user
        is_admin = getattr(user.profile, 'role', 'read') == 'admin' if hasattr(user, 'profile') else False

        session_obj = None
        if str(session_id).isdigit():
            if is_admin:
                session_obj = UserSession.objects.filter(id=int(session_id)).first()
            else:
                session_obj = UserSession.objects.filter(id=int(session_id), user=user).first()

        if not session_obj:
            if is_admin:
                session_obj = UserSession.objects.filter(session_token=str(session_id)).first()
            else:
                session_obj = UserSession.objects.filter(session_token=str(session_id), user=user).first()

        if not session_obj:
            return Response({"detail": "Sesión no encontrada."}, status=status.HTTP_404_NOT_FOUND)

        session_obj.is_active = False
        session_obj.save(update_fields=['is_active'])

        return Response({"message": f"Sesión en '{session_obj.device_name}' revocada con éxito."})


class UserSessionRevokeOthersView(APIView):
    """Revoca todas las demás sesiones excepto la actual."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ensure_domain_table()
        user = request.user
        current_session_token = request.headers.get('X-Session-Token') or ''
        if not current_session_token and hasattr(request, 'auth') and hasattr(request.auth, 'get'):
            current_session_token = request.auth.get('session_token', '')

        qs = UserSession.objects.filter(user=user, is_active=True)
        if current_session_token:
            qs = qs.exclude(session_token=current_session_token)

        revoked_count = qs.update(is_active=False)
        return Response({"message": f"Se han revocado {revoked_count} sesiones activas."})


class UserSessionAuthorizeView(APIView):
    """Marca un acceso sospechoso como legítimo y guarda la IP y dispositivo como confiables."""
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        ensure_domain_table()
        user = request.user
        is_admin = getattr(user.profile, 'role', 'read') == 'admin' if hasattr(user, 'profile') else False

        session_obj = None
        if str(session_id).isdigit():
            if is_admin:
                session_obj = UserSession.objects.filter(id=int(session_id)).first()
            else:
                session_obj = UserSession.objects.filter(id=int(session_id), user=user).first()

        if not session_obj:
            if is_admin:
                session_obj = UserSession.objects.filter(session_token=str(session_id)).first()
            else:
                session_obj = UserSession.objects.filter(session_token=str(session_id), user=user).first()

        if not session_obj:
            return Response({"detail": "Sesión no encontrada."}, status=status.HTTP_404_NOT_FOUND)

        target_user = session_obj.user
        authorizer_name = user.username if user != target_user else "el usuario"

        # 1. Marcar la sesión como no sospechosa
        session_obj.is_suspicious = False
        session_obj.suspicious_reason = f"Autorizado como legítimo por {authorizer_name}"
        session_obj.save(update_fields=['is_suspicious', 'suspicious_reason'])

        # 2. Guardar en TrustedAccess (IP y Dispositivo)
        if session_obj.ip_address:
            TrustedAccess.objects.get_or_create(
                user=target_user,
                ip_address=session_obj.ip_address,
                defaults={
                    'device_name': session_obj.device_name,
                    'note': f"Autorizado como legítimo por {authorizer_name}"
                }
            )

        if session_obj.device_name and session_obj.device_name != 'Dispositivo desconocido':
            TrustedAccess.objects.get_or_create(
                user=target_user,
                device_name=session_obj.device_name,
                defaults={
                    'ip_address': session_obj.ip_address,
                    'note': f"Autorizado como legítimo por {authorizer_name}"
                }
            )

        # 3. Marcar también otras sesiones sospechosas del mismo usuario con idéntica IP y dispositivo
        UserSession.objects.filter(
            user=target_user,
            ip_address=session_obj.ip_address,
            device_name=session_obj.device_name,
            is_suspicious=True
        ).update(
            is_suspicious=False,
            suspicious_reason=f"Autorizado como legítimo por {authorizer_name}"
        )

        # 4. Registrar auditoría en Log
        try:
            agent = Agent.objects.filter(name="SOC-Security-Monitor").first() or Agent.objects.first()
            if agent:
                Log.objects.create(
                    agent=agent,
                    log_type="INFO",
                    criticality="BAJA",
                    description=f"Acceso marcado como legítimo para '{target_user.username}' (IP: {session_obj.ip_address}, Disp: '{session_obj.device_name}') por '{user.username}'.",
                    evidence=f"Sesión #{session_obj.id} autorizada. IP y dispositivo agregados a lista de accesos confiables.",
                    resources_info=f"IP: {session_obj.ip_address} | Usuario: {target_user.username} | AutorizadoPor: {user.username}"
                )
        except Exception as e:
            print(f"Error registrando auditoría en Log: {e}")

        return Response({
            "message": f"Acceso de '{session_obj.device_name}' ({session_obj.ip_address}) guardado y autorizado como legítimo.",
            "session_id": session_obj.id,
            "is_suspicious": False
        })


class TrustedAccessListView(APIView):
    """Lista los accesos confiables autorizados."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_domain_table()
        user = request.user
        is_admin = getattr(user.profile, 'role', 'read') == 'admin' if hasattr(user, 'profile') else False

        qs = TrustedAccess.objects.select_related('user').all() if is_admin else TrustedAccess.objects.filter(user=user)
        data = [{
            'id': t.id,
            'user_id': t.user_id,
            'username': t.user.username,
            'ip_address': t.ip_address,
            'device_name': t.device_name,
            'note': t.note,
            'created_at': t.created_at.isoformat() if t.created_at else ''
        } for t in qs]
        return Response(data)


class TrustedAccessDeleteView(APIView):
    """Elimina un acceso confiable guardado."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        ensure_domain_table()
        user = request.user
        is_admin = getattr(user.profile, 'role', 'read') == 'admin' if hasattr(user, 'profile') else False

        obj = TrustedAccess.objects.filter(id=pk).first() if is_admin else TrustedAccess.objects.filter(id=pk, user=user).first()
        if not obj:
            return Response({"detail": "Registro no encontrado."}, status=status.HTTP_404_NOT_FOUND)

        obj.delete()
        return Response({"message": "Acceso confiable eliminado de la lista de permitidos."})


class SecurityPolicyView(APIView):
    """Permite ver y actualizar las políticas de seguridad globales del SOC."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_domain_table()
        policy = SecurityPolicy.get_solo()
        return Response({
            "enforce_mfa_admin": policy.enforce_mfa_admin,
            "enforce_mfa_all": policy.enforce_mfa_all,
            "max_active_sessions_per_user": policy.max_active_sessions_per_user,
            "session_timeout_hours": policy.session_timeout_hours,
            "alert_on_new_device": policy.alert_on_new_device,
            "alert_on_new_ip": policy.alert_on_new_ip,
            "notify_suspicious_email": policy.notify_suspicious_email,
            "notify_suspicious_telegram": policy.notify_suspicious_telegram,
            "detect_impossible_travel": policy.detect_impossible_travel,
            "impossible_travel_speed_kmh": policy.impossible_travel_speed_kmh,
            "detect_tor_exit_nodes": policy.detect_tor_exit_nodes,
            "block_tor_logins": policy.block_tor_logins,
            "updated_at": policy.updated_at.isoformat() if policy.updated_at else None
        })

    def patch(self, request):
        ensure_domain_table()
        if not hasattr(request.user, 'profile') or request.user.profile.role != 'admin':
            return Response({"detail": "Permiso denegado. Solo administradores pueden modificar políticas."}, status=status.HTTP_403_FORBIDDEN)

        policy = SecurityPolicy.get_solo()
        for field in [
            'enforce_mfa_admin', 'enforce_mfa_all', 'max_active_sessions_per_user',
            'session_timeout_hours', 'alert_on_new_device', 'alert_on_new_ip',
            'notify_suspicious_email', 'notify_suspicious_telegram',
            'detect_impossible_travel', 'impossible_travel_speed_kmh',
            'detect_tor_exit_nodes', 'block_tor_logins'
        ]:
            if field in request.data:
                setattr(policy, field, request.data[field])

        policy.save()
        return Response({
            "message": "Políticas de seguridad actualizadas exitosamente.",
            "enforce_mfa_admin": policy.enforce_mfa_admin,
            "enforce_mfa_all": policy.enforce_mfa_all,
            "max_active_sessions_per_user": policy.max_active_sessions_per_user,
            "session_timeout_hours": policy.session_timeout_hours,
            "alert_on_new_device": policy.alert_on_new_device,
            "alert_on_new_ip": policy.alert_on_new_ip,
            "notify_suspicious_email": policy.notify_suspicious_email,
            "notify_suspicious_telegram": policy.notify_suspicious_telegram,
            "detect_impossible_travel": policy.detect_impossible_travel,
            "impossible_travel_speed_kmh": policy.impossible_travel_speed_kmh,
            "detect_tor_exit_nodes": policy.detect_tor_exit_nodes,
            "block_tor_logins": policy.block_tor_logins
        })


class TorStatusView(APIView):
    """Devuelve el estado de la lista de nodos de salida Tor y configuración CTI."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_domain_table()
        start_tor_sync_if_needed()
        policy = SecurityPolicy.get_solo()
        count = len(TOR_EXIT_IPS)
        if count == 0:
            count = TorExitNode.objects.count()
            if count == 0:
                seed_initial_tor_nodes()
                count = len(TOR_EXIT_IPS) or TorExitNode.objects.count()

        last_dt = TOR_LAST_UPDATED
        if not last_dt:
            try:
                last_node = TorExitNode.objects.order_by('-last_seen').first()
                if last_node and last_node.last_seen:
                    last_dt = last_node.last_seen
            except Exception:
                pass

        return Response({
            "active_nodes": count,
            "last_updated": last_dt.isoformat() if last_dt else timezone.now().isoformat(),
            "detect_tor_exit_nodes": policy.detect_tor_exit_nodes,
            "block_tor_logins": policy.block_tor_logins,
            "detect_impossible_travel": policy.detect_impossible_travel,
            "impossible_travel_speed_kmh": policy.impossible_travel_speed_kmh
        })


class TorSyncView(APIView):
    """Fuerza la sincronización en vivo de la lista de nodos de salida Tor desde TorProject."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ensure_domain_table()
        is_admin = request.user.is_superuser or request.user.is_staff or (hasattr(request.user, 'profile') and request.user.profile.role == 'admin')
        if not is_admin:
            return Response({"detail": "Permiso denegado. Solo administradores pueden sincronizar la lista Tor."}, status=status.HTTP_403_FORBIDDEN)

        try:
            count = update_tor_exit_nodes()
        except Exception as e:
            return Response({"detail": f"Error sincronizando nodos Tor: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({
            "message": f"Lista de nodos de salida Tor sincronizada con éxito ({count} nodos activos registrados).",
            "count": count,
            "last_updated": TOR_LAST_UPDATED.isoformat() if TOR_LAST_UPDATED else timezone.now().isoformat()
        })


class TorScanView(APIView):
    """
    Escanea e inspecciona visualmente una IP para análisis forense CTI y prueba de Viaje Imposible.
    Devuelve estado de geolocalización, coincidencia en la Red Tor, vector Haversine y trazabilidad de pasos.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ensure_domain_table()
        target_ip = str(request.data.get('ip') or '').strip()
        if not target_ip:
            target_ip = request.META.get('HTTP_X_FORWARDED_FOR') or request.META.get('REMOTE_ADDR') or '127.0.0.1'
            if ',' in target_ip:
                target_ip = target_ip.split(',')[0].strip()

        policy = SecurityPolicy.get_solo()
        geo = geolocate_ip(target_ip)
        is_tor = is_tor_exit_node(target_ip)

        prev_lat = request.data.get('prev_lat')
        prev_lon = request.data.get('prev_lon')
        prev_name = request.data.get('prev_name') or 'Última Sesión (Referencia)'
        elapsed_minutes = float(request.data.get('elapsed_minutes') or 15.0)

        if prev_lat is None or prev_lon is None:
            last_sess = UserSession.objects.filter(user=request.user, latitude__isnull=False, longitude__isnull=False).order_by('-last_activity').first()
            if last_sess:
                prev_lat = last_sess.latitude
                prev_lon = last_sess.longitude
                prev_name = f"{last_sess.city}, {last_sess.country}" if last_sess.city else (last_sess.location or 'Sesión Previa')
                delta = timezone.now() - last_sess.last_activity
                elapsed_minutes = max(1.0, delta.total_seconds() / 60.0)
            else:
                prev_lat = 40.4168
                prev_lon = -3.7038
                prev_name = 'Madrid, España (Referencia)'

        curr_lat = geo.get('lat')
        curr_lon = geo.get('lon')
        curr_name = f"{geo.get('city')}, {geo.get('country')}" if geo.get('city') else (geo.get('location') or 'Destino Actual')

        is_private = is_private_ip(target_ip)
        if curr_lat is None or curr_lon is None:
            if is_private:
                curr_lat = -34.6037
                curr_lon = -58.3816
                curr_name = 'Red Local / Sede Central'
            else:
                curr_lat = 52.3676
                curr_lon = 4.9041
                curr_name = 'Nodo Externo (Ámsterdam)'

        distance_km = haversine_distance_km(prev_lat, prev_lon, curr_lat, curr_lon)
        elapsed_hours = max(0.01, elapsed_minutes / 60.0)
        speed_kmh = round(distance_km / elapsed_hours, 1)

        is_impossible = (distance_km > 300) and (speed_kmh > policy.impossible_travel_speed_kmh)

        criticality = "NORMAL"
        if is_tor or is_impossible:
            criticality = "CRITICA"

        scan_steps = [
            {
                "id": "geo",
                "label": "Resolución Geográfica & ASN",
                "detail": f"IP {target_ip} localiza en {curr_name} (Lat: {curr_lat:.2f}, Lon: {curr_lon:.2f}) | ISP: {geo.get('isp', 'N/A')}",
                "status": "warning" if is_private else "success"
            },
            {
                "id": "tor",
                "label": "Correlación CTI Tor Project",
                "detail": f"Analizado contra {len(TOR_EXIT_IPS) or TorExitNode.objects.count()} nodos oficiales. " + 
                          ("🚨 COINCIDENCIA CONFIRMADA: NODO DE SALIDA TOR DETECTADO." if is_tor else "Limpio: La IP no figura como repetidor de salida Tor."),
                "status": "danger" if is_tor else "success",
                "match": is_tor
            },
            {
                "id": "ueba",
                "label": "Vector de Tránsito UEBA (Haversine)",
                "detail": f"Distancia física: {distance_km:,.1f} km en {elapsed_minutes:.0f} min ➔ Velocidad calculada: {speed_kmh:,.1f} km/h (Límite: {policy.impossible_travel_speed_kmh} km/h). " +
                          ("🚨 ANOMALÍA: VIAJE IMPOSIBLE CONFIRMADO." if is_impossible else "Normal: Velocidad dentro de los parámetros físicos admisibles."),
                "status": "danger" if is_impossible else "success",
                "impossible": is_impossible
            },
            {
                "id": "policy",
                "label": "Evaluación de Políticas de Seguridad",
                "detail": "Acceso bloqueado preventivamente (403)" if (is_tor and policy.block_tor_logins) else ("Alerta crítica generada para Telegram y Correo" if criticality == "CRITICA" else "Acceso autorizado conforme a políticas."),
                "status": "danger" if criticality == "CRITICA" else "success"
            }
        ]

        sample_tor_node = None
        if TOR_EXIT_IPS:
            sample_tor_node = next(iter(TOR_EXIT_IPS))
        elif TorExitNode.objects.exists():
            first_node = TorExitNode.objects.first()
            if first_node:
                sample_tor_node = first_node.ip_address

        return Response({
            "target_ip": target_ip,
            "geo": {
                "location": curr_name,
                "country": geo.get('country', ''),
                "city": geo.get('city', ''),
                "latitude": curr_lat,
                "longitude": curr_lon,
                "isp": geo.get('isp', ''),
                "is_private": is_private
            },
            "is_tor": is_tor,
            "tor_active_nodes": len(TOR_EXIT_IPS) or TorExitNode.objects.count(),
            "sample_tor_node": sample_tor_node,
            "impossible_travel": {
                "detected": is_impossible,
                "distance_km": round(distance_km, 1),
                "elapsed_minutes": round(elapsed_minutes, 1),
                "elapsed_hours": round(elapsed_hours, 2),
                "speed_kmh": speed_kmh,
                "speed_threshold_kmh": policy.impossible_travel_speed_kmh,
                "prev_point": {
                    "name": prev_name,
                    "latitude": prev_lat,
                    "longitude": prev_lon
                },
                "curr_point": {
                    "name": curr_name,
                    "latitude": curr_lat,
                    "longitude": curr_lon
                }
            },
            "criticality": criticality,
            "blocked": bool(is_tor and policy.block_tor_logins),
            "scan_steps": scan_steps,
            "timestamp": timezone.now().isoformat()
        })

class CTIStatsView(APIView):
    """Estadísticas globales del motor de ciberinteligencia (CTI) y correlación."""
    def get(self, request):
        ensure_domain_table()
        seed_initial_cti_iocs()
        start_cti_sync_if_needed()
        from django.db.models import Count

        try:
            total_iocs = IOCIndicator.objects.filter(is_active=True).count()
            by_type_qs = IOCIndicator.objects.filter(is_active=True).values('indicator_type').annotate(count=Count('id'))
            iocs_by_type = {item['indicator_type']: item['count'] for item in by_type_qs}

            by_threat_qs = IOCIndicator.objects.filter(is_active=True).values('threat_type').annotate(count=Count('id'))
            iocs_by_threat = {item['threat_type']: item['count'] for item in by_threat_qs}

            top_families = list(
                IOCIndicator.objects.filter(is_active=True)
                .exclude(malware_family='')
                .values('malware_family')
                .annotate(count=Count('id'))
                .order_by('-count')[:8]
            )

            total_hits = IOCHit.objects.count()
            recent_hits = list(
                IOCHit.objects.values(
                    'id', 'indicator_value', 'indicator_type', 'threat_type',
                    'malware_family', 'source_feed', 'severity', 'source_event',
                    'client_ip', 'action_taken', 'created_at'
                ).order_by('-created_at')[:10]
            )
            feodo_count = IOCIndicator.objects.filter(source__icontains="Feodo", is_active=True).count()
            tf_count = IOCIndicator.objects.filter(source__icontains="ThreatFox", is_active=True).count()
            urlhaus_count = IOCIndicator.objects.filter(source__icontains="URLhaus", is_active=True).count()
            soc_count = IOCIndicator.objects.filter(source__icontains="SOC", is_active=True).count()
        except Exception:
            total_iocs = len(CTI_IOC_MAP)
            iocs_by_type = {}
            iocs_by_threat = {}
            for item in CTI_IOC_MAP.values():
                t = item.get('indicator_type', 'ip')
                iocs_by_type[t] = iocs_by_type.get(t, 0) + 1
                th = item.get('threat_type', 'c2_botnet')
                iocs_by_threat[th] = iocs_by_threat.get(th, 0) + 1
            top_families = [{"malware_family": "Cobalt Strike", "count": 1}, {"malware_family": "LockBit", "count": 1}]
            total_hits = 0
            recent_hits = []
            feodo_count = 10
            tf_count = 10
            urlhaus_count = 5
            soc_count = 5

        tor_count = len(TOR_EXIT_IPS) or (TorExitNode.objects.count() if hasattr(TorExitNode, 'objects') else 0)

        return Response({
            "total_iocs": total_iocs or len(CTI_IOC_MAP),
            "ram_cached_iocs": len(CTI_IOC_MAP),
            "iocs_by_type": iocs_by_type,
            "iocs_by_threat": iocs_by_threat,
            "top_malware_families": top_families,
            "total_hits": total_hits,
            "recent_hits": recent_hits,
            "tor_nodes_count": tor_count,
            "last_sync": CTI_LAST_SYNC.isoformat() if CTI_LAST_SYNC else None,
            "feeds_status": [
                {
                    "name": "abuse.ch Feodo Tracker",
                    "type": "Botnet C2 IP Blocklist",
                    "status": "online",
                    "active_indicators": feodo_count,
                    "trust_level": "98% (Certificado Oficial)"
                },
                {
                    "name": "abuse.ch ThreatFox",
                    "type": "Hashes, Dominios y C2 Multi-vector",
                    "status": "online",
                    "active_indicators": tf_count,
                    "trust_level": "95% (Comunitario Validado)"
                },
                {
                    "name": "abuse.ch URLhaus",
                    "type": "Distribución de Payloads & Malware URLs",
                    "status": "online",
                    "active_indicators": urlhaus_count,
                    "trust_level": "94% (Alta Certeza)"
                },
                {
                    "name": "The Tor Project",
                    "type": "Nodos de Salida Tor (CTI Anonimato)",
                    "status": "online",
                    "active_indicators": tor_count,
                    "trust_level": "100% (Oficial)"
                },
                {
                    "name": "SOC Threat Vault",
                    "type": "Indicadores Locales y Propios",
                    "status": "online",
                    "active_indicators": soc_count,
                    "trust_level": "100% (Interno)"
                }
            ]
        })

class CTIIndicatorListView(APIView):
    """Lista y creación de indicadores de compromiso (IOCs)."""
    def get(self, request):
        ensure_domain_table()
        seed_initial_cti_iocs()
        start_cti_sync_if_needed()
        from django.db.models import Q
        from django.core.paginator import Paginator

        page_number = int(request.query_params.get('page', 1))
        page_size = min(int(request.query_params.get('page_size', 20)), 100)
        search = request.query_params.get('search', '').strip().lower()
        ioc_type = request.query_params.get('type', '').strip()
        threat_type = request.query_params.get('threat', '').strip()
        severity = request.query_params.get('severity', '').strip()

        try:
            qs = IOCIndicator.objects.filter(is_active=True)
            if search:
                qs = qs.filter(
                    Q(indicator_value__icontains=search) |
                    Q(malware_family__icontains=search) |
                    Q(description__icontains=search) |
                    Q(tags__icontains=search)
                )

            if ioc_type and ioc_type != 'all':
                qs = qs.filter(indicator_type=ioc_type)

            if threat_type and threat_type != 'all':
                qs = qs.filter(threat_type=threat_type)

            if severity and severity != 'all':
                qs = qs.filter(severity=severity)

            paginator = Paginator(qs.order_by('-last_seen'), page_size)
            page_obj = paginator.get_page(page_number)

            indicators = [
                {
                    "id": ioc.id,
                    "indicator_value": ioc.indicator_value,
                    "indicator_type": ioc.indicator_type,
                    "threat_type": ioc.threat_type,
                    "malware_family": ioc.malware_family,
                    "source": ioc.source,
                    "confidence": ioc.confidence,
                    "severity": ioc.severity,
                    "hit_count": ioc.hit_count,
                    "last_hit_at": ioc.last_hit_at.isoformat() if ioc.last_hit_at else None,
                    "description": ioc.description,
                    "tags": ioc.tags,
                    "first_seen": ioc.first_seen.isoformat(),
                    "last_seen": ioc.last_seen.isoformat(),
                }
                for ioc in page_obj
            ]

            return Response({
                "results": indicators,
                "total": paginator.count,
                "total_pages": paginator.num_pages,
                "current_page": page_obj.number,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            })
        except Exception:
            fallback_items = list(CTI_IOC_MAP.values())
            if search:
                fallback_items = [x for x in fallback_items if search in x.get('indicator_value', '').lower() or search in x.get('malware_family', '').lower() or search in x.get('description', '').lower()]
            if ioc_type and ioc_type != 'all':
                fallback_items = [x for x in fallback_items if x.get('indicator_type') == ioc_type]
            if threat_type and threat_type != 'all':
                fallback_items = [x for x in fallback_items if x.get('threat_type') == threat_type]
            if severity and severity != 'all':
                fallback_items = [x for x in fallback_items if x.get('severity') == severity]

            now_iso = timezone.now().isoformat()
            indicators = [
                {
                    "id": x.get('id', idx + 1),
                    "indicator_value": x.get('indicator_value', ''),
                    "indicator_type": x.get('indicator_type', 'ip'),
                    "threat_type": x.get('threat_type', 'c2_botnet'),
                    "malware_family": x.get('malware_family', ''),
                    "source": x.get('source', 'CTI Engine'),
                    "confidence": x.get('confidence', 90),
                    "severity": x.get('severity', 'CRITICA'),
                    "hit_count": x.get('hit_count', 0),
                    "last_hit_at": None,
                    "description": x.get('description', ''),
                    "tags": x.get('tags', ''),
                    "first_seen": now_iso,
                    "last_seen": now_iso,
                }
                for idx, x in enumerate(fallback_items[:page_size])
            ]
            return Response({
                "results": indicators,
                "total": len(fallback_items),
                "total_pages": max(1, (len(fallback_items) + page_size - 1) // page_size),
                "current_page": 1,
                "has_next": False,
                "has_previous": False,
            })

    def post(self, request):
        ensure_domain_table()
        val = str(request.data.get('indicator_value', '')).strip()
        if not val:
            return Response({"detail": "El valor del indicador es obligatorio."}, status=status.HTTP_400_BAD_REQUEST)

        ioc_type = request.data.get('indicator_type', 'ip')
        threat_type = request.data.get('threat_type', 'c2_botnet')
        malware_family = str(request.data.get('malware_family', '')).strip()[:100]
        confidence = int(request.data.get('confidence', 90))
        severity = request.data.get('severity', 'CRITICA')
        description = str(request.data.get('description', '')).strip()
        tags = str(request.data.get('tags', '')).strip()

        now_dt = timezone.now()
        val_clean = val[:191]
        try:
            ioc, created = IOCIndicator.objects.update_or_create(
                indicator_value=val_clean,
                defaults={
                    'indicator_type': ioc_type,
                    'threat_type': threat_type,
                    'malware_family': malware_family,
                    'source': f"SOC Analyst ({getattr(request.user, 'username', 'analyst')})",
                    'confidence': confidence,
                    'severity': severity,
                    'description': description,
                    'tags': tags,
                    'is_active': True,
                    'last_seen': now_dt
                }
            )
            ioc_id = ioc.id
        except Exception:
            ioc_id = 999
            created = True

        CTI_IOC_MAP[val_clean.lower()] = {
            'id': ioc_id,
            'indicator_value': val_clean,
            'indicator_type': ioc_type,
            'threat_type': threat_type,
            'malware_family': malware_family,
            'source': f"SOC Analyst ({getattr(request.user, 'username', 'analyst')})",
            'confidence': confidence,
            'severity': severity,
            'description': description,
            'hit_count': 0
        }
        refresh_cti_ram_cache()

        return Response({
            "id": ioc_id,
            "indicator_value": val_clean,
            "created": created,
            "message": "Indicador registrado exitosamente en el motor CTI."
        }, status=status.HTTP_201_CREATED)

class CTIIndicatorDetailView(APIView):
    """Gestión y borrado de indicadores individuales."""
    def delete(self, request, pk):
        ensure_domain_table()
        try:
            ioc = IOCIndicator.objects.filter(pk=pk).first()
            if ioc:
                val = ioc.indicator_value.lower()
                ioc.delete()
                CTI_IOC_MAP.pop(val, None)
        except Exception:
            pass
        refresh_cti_ram_cache()
        return Response({"detail": "Indicador eliminado exitosamente."})

class CTISyncView(APIView):
    """Sincronización en vivo de feeds de ciberinteligencia."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ensure_domain_table()
        tor_count = 0
        cti_count = 0
        errors = []
        try:
            tor_count = update_tor_exit_nodes()
        except Exception as e:
            errors.append(f"Tor: {e}")
        try:
            cti_count = update_cti_feeds()
        except Exception as e:
            errors.append(f"Feeds: {e}")

        total_active_tor = len(TOR_EXIT_IPS) or tor_count
        msg = f"Sincronización finalizada: {cti_count} nuevos indicadores CTI procesados y {total_active_tor} nodos Tor activos."
        if errors:
            msg += f" (Avisos: {'; '.join(errors)})"

        return Response({
            "status": "success",
            "message": msg,
            "total_cached": len(CTI_IOC_MAP),
            "tor_nodes_count": total_active_tor,
            "timestamp": timezone.now().isoformat()
        })

class CTIScanView(APIView):
    """Escáner forense y correlador instantáneo de artefactos (IPs, hashes, dominios, texto)."""
    def post(self, request):
        ensure_domain_table()
        start_cti_sync_if_needed()
        try:
            target = str(request.data.get('target', '')).strip()
            if not target:
                return Response({"detail": "Debe proporcionar una IP, hash, dominio o bloque de texto."}, status=status.HTTP_400_BAD_REQUEST)

            matches = scan_text_for_iocs(target)
            if not matches:
                direct = check_ioc_match(target)
                if direct:
                    matches.append(direct)

            ip_pattern = r'\b(?:\d{1,3}\.){3}\d{1,3}\b'
            extracted_ips = re.findall(ip_pattern, target)
            primary_ip = extracted_ips[0] if extracted_ips else None

            # Si no se ingresó una IP directamente, intentar resolución DNS del host
            if not primary_ip:
                try:
                    clean_host = target.replace('http://', '').replace('https://', '').split('/')[0].split(':')[0].strip()
                    if clean_host and '.' in clean_host and not any(c in clean_host for c in ' :/?#@'):
                        resolved_ip = socket.gethostbyname(clean_host)
                        if resolved_ip:
                            primary_ip = resolved_ip
                except Exception:
                    pass

            geo_info = None
            is_tor = False
            if primary_ip:
                is_tor = is_tor_exit_node(primary_ip)
                geo_info = geolocate_ip(primary_ip)

            risk_score = 0
            if matches:
                max_conf = max(m.get('confidence', 80) for m in matches)
                has_crit = any(m.get('severity') == 'CRITICA' for m in matches)
                risk_score = min(100, max_conf + (10 if has_crit else 0))
            elif is_tor:
                risk_score = 85
            elif primary_ip and is_private_ip(primary_ip):
                risk_score = 0
            else:
                risk_score = 0

            kill_chain_stage = "Sin actividad maliciosa detectada"
            mitigation_actions = []
            if matches or is_tor:
                has_c2 = any(m.get('threat_type') == 'c2_botnet' for m in matches)
                has_ransom = any(m.get('threat_type') == 'ransomware' for m in matches)
                has_phish = any(m.get('threat_type') == 'phishing' for m in matches)

                if has_c2:
                    kill_chain_stage = "Command and Control (TA0011) / Botnet Callback"
                    mitigation_actions = [
                        "Bloquear IP en Firewall perimetral: sudo iptables -I INPUT -s <IP> -j DROP",
                        "Aislar de la red los hosts que hayan establecido conexiones TCP con este destino.",
                        "Revisar conexiones salientes en puertos no estándar (8080, 4444, 8888, 6666)."
                    ]
                elif has_ransom:
                    kill_chain_stage = "Impact (TA0040) / Data Encrypted for Impact"
                    mitigation_actions = [
                        "Desconectar inmediatamente de la red VLAN los endpoints sospechosos.",
                        "Bloquear la ejecución del hash binario en todas las políticas EDR/AppLocker.",
                        "Verificar integridad de copias de seguridad offline y snapshots inmutables."
                    ]
                elif has_phish:
                    kill_chain_stage = "Initial Access (TA0001) / Spearphishing Link"
                    mitigation_actions = [
                        "Bloquear el dominio malicioso a nivel de resolución DNS interna (Pi-hole / Bind).",
                        "Forzar reseteo masivo de credenciales y revocar tokens de sesión activos.",
                        "Buscar logs de correo electrónico con correos entrantes que contengan este enlace."
                    ]
                elif is_tor:
                    kill_chain_stage = "Defense Evasion (TA0005) / Anonymization Network"
                    mitigation_actions = [
                        "Forzar Autenticación de Dos Factores (MFA) obligatoria para esta sesión.",
                        "Habilitar política 'Bloquear Accesos desde Tor' en la configuración del SOC.",
                        "Auditar las acciones y consultas SQL ejecutadas por este usuario."
                    ]
                else:
                    kill_chain_stage = "Execution & Persistence (TA0002 / TA0003)"
                    mitigation_actions = [
                        "Bloquear indicador en lista negra del SOC.",
                        "Revisar logs de auditoría en busca de ocurrencias históricas."
                    ]

            # Registrar IOCHit si hubo coincidencia
            if matches:
                for m in matches:
                    try:
                        record_ioc_hit(
                            matched_ioc=m,
                            source_event="Threat Hunter Manual Scan",
                            matched_value=target[:191],
                            client_ip=primary_ip or get_client_ip(request),
                            user=request.user if request.user and request.user.is_authenticated else None,
                            action_taken="Escaneado por Analista SOC"
                        )
                    except Exception:
                        pass
            elif is_tor and primary_ip:
                try:
                    tor_ioc = {
                        'indicator_value': primary_ip[:191],
                        'indicator_type': 'ip',
                        'threat_type': 'tor_exit',
                        'malware_family': 'Red Tor',
                        'source': 'The Tor Project',
                        'severity': 'CRITICA'
                    }
                    record_ioc_hit(
                        matched_ioc=tor_ioc,
                        source_event="Threat Hunter Tor Scan",
                        matched_value=target[:191],
                        client_ip=primary_ip,
                        user=request.user if request.user and request.user.is_authenticated else None,
                        action_taken="Nodo Tor Identificado"
                    )
                except Exception:
                    pass

            return Response({
                "target": target,
                "primary_ip": primary_ip,
                "risk_score": risk_score,
                "verdict": "CRÍTICO - AMENAZA IDENTIFICADA" if risk_score >= 80 else ("SOSPECHOSO" if risk_score >= 50 else "LIMPIO / CONFIABLE"),
                "matches_count": len(matches),
                "matches": matches,
                "is_tor": is_tor,
                "geo": geo_info,
                "kill_chain_stage": kill_chain_stage,
                "mitigation_actions": mitigation_actions,
                "timestamp": timezone.now().isoformat()
            })
        except Exception as e:
            return Response({
                "target": str(request.data.get('target', '')),
                "primary_ip": None,
                "risk_score": 0,
                "verdict": "LIMPIO / CONFIABLE",
                "matches_count": 0,
                "matches": [],
                "is_tor": False,
                "geo": None,
                "kill_chain_stage": "Sin actividad maliciosa detectada",
                "mitigation_actions": [],
                "timestamp": timezone.now().isoformat()
            })

class CTIHitsListView(APIView):
    """Historial de detecciones e impactos de IOCs correlacionados en tiempo real."""
    def get(self, request):
        ensure_domain_table()
        from django.core.paginator import Paginator
        page_number = int(request.query_params.get('page', 1))
        page_size = min(int(request.query_params.get('page_size', 20)), 100)
        search = request.query_params.get('search', '').strip()

        try:
            qs = IOCHit.objects.select_related('user').order_by('-created_at')
            if search:
                qs = qs.filter(
                    models.Q(indicator_value__icontains=search) |
                    models.Q(malware_family__icontains=search) |
                    models.Q(source_event__icontains=search) |
                    models.Q(client_ip__icontains=search)
                )

            paginator = Paginator(qs, page_size)
            page_obj = paginator.get_page(page_number)

            hits = [
                {
                    "id": h.id,
                    "indicator_value": h.indicator_value,
                    "indicator_type": h.indicator_type,
                    "threat_type": h.threat_type,
                    "malware_family": h.malware_family,
                    "source_feed": h.source_feed,
                    "severity": h.severity,
                    "source_event": h.source_event,
                    "matched_value": h.matched_value,
                    "client_ip": h.client_ip,
                    "user_username": h.user.username if h.user else None,
                    "action_taken": h.action_taken,
                    "created_at": h.created_at.isoformat()
                }
                for h in page_obj
            ]

            return Response({
                "results": hits,
                "total": paginator.count,
                "total_pages": paginator.num_pages,
                "current_page": page_obj.number,
                "has_next": page_obj.has_next(),
                "has_previous": page_obj.has_previous(),
            })
        except Exception:
            return Response({
                "results": [],
                "total": 0,
                "total_pages": 1,
                "current_page": 1,
                "has_next": False,
                "has_previous": False,
            })

class ForgotPasswordView(APIView):
    """Genera un código PIN de recuperación de contraseña para el usuario."""
    permission_classes = []

    def post(self, request):
        identifier = str(request.data.get('identifier') or request.data.get('email') or request.data.get('username') or '').strip()
        if not identifier:
            return Response(
                {"detail": "Debe ingresar su nombre de usuario o correo electrónico."},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = User.objects.filter(username__iexact=identifier).first() or User.objects.filter(email__iexact=identifier).first()
        if not user:
            return Response(
                {"detail": "No se encontró ningún usuario con ese nombre o correo electrónico."},
                status=status.HTTP_404_NOT_FOUND
            )

        profile, _ = UserProfile.objects.get_or_create(user=user)

        # Validar que el usuario tenga un correo electrónico configurado
        if not user.email or not user.email.strip():
            return Response(
                {"detail": f"El usuario '{user.username}' no tiene una dirección de correo configurada en el sistema. Contacte al administrador para asignar su correo."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Generar PIN de 6 dígitos numéricos
        code = f"{random.randint(100000, 999999)}"
        profile.reset_code = code
        profile.reset_code_expires = timezone.now() + timedelta(minutes=15)
        profile.save(update_fields=['reset_code', 'reset_code_expires'])

        # Enviar código exclusivamente por correo electrónico
        email_sent, email_err = send_recovery_email(user.email.strip(), user.username, code)
        if not email_sent:
            return Response(
                {"detail": f"Fallo al enviar el correo de recuperación: {email_err}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # Notificar vía Telegram únicamente si el usuario particular tiene su propio chat_id personal configurado
        target_chat_id = profile.telegram_chat_id
        if target_chat_id:
            bot_token = profile.telegram_bot_token or os.environ.get("TELEGRAM_BOT_TOKEN")
            send_telegram_alert(
                "INFO",
                f"Código de recuperación de contraseña para '{user.username}': {code} (válido por 15 minutos).",
                "SOC AUTH",
                target_chat_id,
                bot_token=bot_token
            )

        # Máscara de email para privacidad
        parts = user.email.split('@')
        name_p = parts[0]
        masked_name = name_p[0] + '***' + (name_p[-1] if len(name_p) > 1 else '')
        masked_email = f"{masked_name}@{parts[1]}" if len(parts) > 1 else user.email

        return Response({
            "status": "success",
            "message": f"Hemos enviado un código de verificación de 6 dígitos a tu correo ({masked_email}) y Telegram si está configurado. Revisa tu bandeja de entrada o spam.",
            "username": user.username,
            "masked_email": masked_email,
            "email_sent": True,
            "expires_in_minutes": 15
        }, status=status.HTTP_200_OK)

class ResetPasswordView(APIView):
    """Valida el PIN y actualiza la contraseña del usuario."""
    permission_classes = []

    def post(self, request):
        identifier = str(request.data.get('identifier') or request.data.get('username') or request.data.get('email') or '').strip()
        code = str(request.data.get('code') or '').strip()
        new_password = str(request.data.get('new_password') or '').strip()

        if not identifier or not code or not new_password:
            return Response(
                {"detail": "Todos los campos son obligatorios (usuario/email, código y nueva contraseña)."},
                status=status.HTTP_400_BAD_REQUEST
            )

        is_valid, err_msg = validate_password_strength(new_password)
        if not is_valid:
            return Response(
                {"detail": err_msg},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = User.objects.filter(username__iexact=identifier).first() or User.objects.filter(email__iexact=identifier).first()
        if not user or not hasattr(user, 'profile'):
            return Response(
                {"detail": "Usuario no encontrado."},
                status=status.HTTP_404_NOT_FOUND
            )

        profile = user.profile
        if not profile.reset_code or profile.reset_code.strip() != code:
            return Response(
                {"detail": "El código de recuperación ingresado es inválido."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if profile.reset_code_expires and timezone.now() > profile.reset_code_expires:
            return Response(
                {"detail": "El código de recuperación ha expirado. Por favor solicita uno nuevo."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Restablecer contraseña y limpiar bloqueo
        user.set_password(new_password)
        user.save()

        profile.reset_code = ''
        profile.reset_code_expires = None
        profile.failed_attempts = 0
        profile.is_locked = False
        profile.locked_until = None
        profile.save()

        return Response({
            "status": "success",
            "message": "Contraseña restablecida exitosamente. Ya puedes iniciar sesión con tu nueva contraseña."
        }, status=status.HTTP_200_OK)


class GeneratePasswordView(APIView):
    """Genera una contraseña segura y de alta entropía bajo demanda."""
    permission_classes = []

    def get(self, request):
        length = 16
        try:
            length = int(request.query_params.get('length', 16))
            length = max(8, min(length, 64))
        except (ValueError, TypeError):
            length = 16
        return Response({"password": generate_strong_password(length)})


class UserViewSet(viewsets.ModelViewSet):
    """Gestión de usuarios. Exclusivo para administradores."""
    queryset = User.objects.all().select_related('profile')
    serializer_class = UserSerializer
    permission_classes = [IsAdminUserRole]

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user.username == 'admin' or user.id == request.user.id:
            from rest_framework.response import Response
            from rest_framework import status
            return Response({"detail": "El usuario admin principal o la cuenta en sesión actual no pueden ser eliminadas."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        user = self.get_object()
        # El usuario admin principal siempre se puede editar (mail, pass, etc.), pero debe conservar el rol admin
        if user.username == 'admin':
            role_input = request.data.get('role_input')
            if role_input and role_input != 'admin':
                from rest_framework.response import Response
                from rest_framework import status
                return Response({"detail": "El usuario administrador principal no puede perder su rol de admin."}, status=status.HTTP_400_BAD_REQUEST)
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def unlock(self, request, pk=None):
        user = self.get_object()
        if hasattr(user, 'profile'):
            user.profile.is_locked = False
            user.profile.failed_attempts = 0
            user.profile.locked_until = None
            user.profile.save()
            return Response({"status": "Usuario desbloqueado con éxito"})
        return Response({"detail": "Perfil no encontrado"}, status=status.HTTP_404_NOT_FOUND)

class AgentViewSet(viewsets.ModelViewSet):
    """Gestión de servidores/agentes."""
    queryset = Agent.objects.all()
    serializer_class = AgentSerializer
    
    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            self.permission_classes = [IsWriteUserRole]
        else:
            self.permission_classes = [BasePermission] # Requiere estar autenticado por defecto
        return super().get_permissions()

class AgentPingView(APIView):
    """Recibe heartbeat y métricas del agente."""
    permission_classes = [] 

    def post(self, request):
        api_key = request.data.get('api_key')
        agent = Agent.objects.filter(api_key=api_key).first()
        if not agent:
            return Response(
                {"detail": "API Key inválida"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        agent.last_seen = now()
        update_fields = ['last_seen']

        for field in ('cpu_usage', 'memory_usage', 'disk_usage'):
            value = request.data.get(field)
            if value is not None:
                try:
                    value = float(value)
                    if 0 <= value <= 100:
                        setattr(agent, field, value)
                        update_fields.append(field)
                except (TypeError, ValueError):
                    pass

        agent.metrics_updated_at = now()
        update_fields.append('metrics_updated_at')
        agent.save(update_fields=list(dict.fromkeys(update_fields)))
        return Response({"status": "ping received"})

class AgentInstallerScriptView(APIView):
    """Descarga el script instalador automatizado para agentes remotos."""
    permission_classes = [AllowAny]

    def get(self, request):
        installer_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'instalar_ai_soc_agent.sh')
        if not os.path.exists(installer_path):
            return Response({"error": "Script instalador no encontrado en el servidor."}, status=status.HTTP_404_NOT_FOUND)
        try:
            with open(installer_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return HttpResponse(content, content_type='text/x-shellscript; charset=utf-8')
        except Exception as e:
            return Response({"error": f"Error leyendo instalador: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class LogIngestView(APIView):
    """Endpoint para que el script de Python de los servidores envíe logs."""
    permission_classes = []

    def post(self, request):
        api_key = request.data.get('api_key')
        agent = Agent.objects.filter(api_key=api_key, status='active').first()
        
        if not agent:
            return Response(
                {"detail": "API Key inválida o servidor inactivo"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = serializers.Serializer(data=request.data)
        criticality = str(request.data.get('criticality', 'INFO')).upper()
        valid_criticalities = {choice[0] for choice in Log.CRITICALITY_CHOICES}
        if criticality not in valid_criticalities:
            return Response(
                {"criticality": "Severidad inválida"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = str(request.data.get('message', '')).strip()
        if not message:
            return Response(
                {"message": "El mensaje es obligatorio"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        evidence = str(request.data.get('evidence', '') or '').strip()
        resources_info = str(request.data.get('resources_info', '') or '').strip()

        # Correlación CTI automática en tiempo real
        full_text = f"{message} {evidence} {resources_info}"
        cti_matches = scan_text_for_iocs(full_text)
        if cti_matches:
            criticality = "CRITICA"
            cti_lines = "\n".join([f" • [{m['indicator_type'].upper()}] {m['indicator_value']} -> {m['malware_family'] or m['threat_type']} ({m['source']} - {m['confidence']}%)" for m in cti_matches])
            evidence = (evidence + "\n\n" if evidence else "") + f"🚨 [ALERTA CTI CORRELACIONADA - IOCs DETECTADOS]:\n{cti_lines}"
            for m in cti_matches:
                record_ioc_hit(m, source_event=f"Log Servidor: {agent.name}", matched_value=m['indicator_value'], client_ip=getattr(agent, 'ip_address', ''), action_taken="🚨 Alerta Crítica SOC Correlacionada")

        Log.objects.create(
            agent=agent,
            criticality=criticality,
            message=message,
            evidence=evidence,
            resources_info=resources_info
        )

        send_telegram_alerts_async(criticality, message, agent.name, evidence=evidence)

        return Response(
            {"status": "Log registrado exitosamente"},
            status=status.HTTP_201_CREATED,
        )

class LogListView(APIView):
    """Endpoint para leer logs desde el panel React con soporte de paginación y filtros completos."""
    def get(self, request):
        from django.db.models import Q
        
        server_id = request.query_params.get('server_id')
        server_name = request.query_params.get('server')
        criticidad = request.query_params.get('criticidad')
        search = request.query_params.get('search')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        
        all_records = request.query_params.get('all', '').lower() in ['true', '1', 'yes']
        paginate_param = request.query_params.get('paginate', '').lower()
        if paginate_param in ['false', '0', 'no']:
            all_records = True

        logs = Log.objects.all().order_by('-timestamp')

        if server_id:
            logs = logs.filter(agent_id=server_id)
        if server_name:
            logs = logs.filter(agent__name__icontains=server_name)
        if criticidad:
            logs = logs.filter(criticality=criticidad)
        if search:
            logs = logs.filter(
                Q(message__icontains=search) |
                Q(evidence__icontains=search) |
                Q(agent__name__icontains=search) |
                Q(criticality__iexact=search)
            )
        if start_date:
            logs = logs.filter(timestamp__gte=start_date)
        if end_date:
            logs = logs.filter(timestamp__lte=end_date)

        # Conteos globales para dashboards y tarjetas
        total_count = logs.count()
        critical_count = Log.objects.filter(criticality='CRITICA').count()
        high_count = Log.objects.filter(criticality='ALTA').count()

        if all_records:
            logs = logs[:5000]
            serializer = LogSerializer(logs, many=True)
            return Response(serializer.data)

        try:
            page = int(request.query_params.get('page', 1))
            if page < 1:
                page = 1
        except (TypeError, ValueError):
            page = 1

        try:
            page_size = int(request.query_params.get('page_size', 50))
            if page_size < 1:
                page_size = 50
            elif page_size > 200:
                page_size = 200
        except (TypeError, ValueError):
            page_size = 50

        total_pages = max(1, (total_count + page_size - 1) // page_size) if total_count > 0 else 1
        if page > total_pages and total_count > 0:
            page = total_pages

        start = (page - 1) * page_size
        end = start + page_size
        paged_logs = logs[start:end]

        serializer = LogSerializer(paged_logs, many=True)
        return Response({
            'count': total_count,
            'total_pages': total_pages,
            'current_page': page,
            'page_size': page_size,
            'critical_count': critical_count,
            'high_count': high_count,
            'results': serializer.data
        })

    def delete(self, request):
        """Endpoint para eliminar eventos seleccionados o purgar masivamente por criticidad/filtro."""
        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "No autenticado"}, status=status.HTTP_401_UNAUTHORIZED)
            
        profile = getattr(request.user, 'profile', None)
        user_role = profile.role if profile else ('admin' if request.user.is_superuser else 'readonly')
        if user_role not in ['admin', 'write']:
            return Response({"detail": "Permiso denegado: solo administradores u operadores con escritura pueden eliminar eventos"}, status=status.HTTP_403_FORBIDDEN)

        data = request.data or {}
        ids = data.get('ids')
        criticidad = data.get('criticidad') or request.query_params.get('criticidad')
        criticidad_in = data.get('criticidad_in')
        delete_all = data.get('all', False) or request.query_params.get('all', '').lower() in ['true', '1']
        server_name = data.get('server') or request.query_params.get('server')

        deleted_count = 0
        if ids and isinstance(ids, list):
            deleted_count, _ = Log.objects.filter(id__in=ids).delete()
        elif criticidad_in and isinstance(criticidad_in, list):
            query = Log.objects.filter(criticality__in=criticidad_in)
            if server_name:
                query = query.filter(agent__name__icontains=server_name)
            deleted_count, _ = query.delete()
        elif criticidad:
            query = Log.objects.filter(criticality=criticidad)
            if server_name:
                query = query.filter(agent__name__icontains=server_name)
            deleted_count, _ = query.delete()
        elif delete_all:
            query = Log.objects.all()
            if server_name:
                query = query.filter(agent__name__icontains=server_name)
            deleted_count, _ = query.delete()
        else:
            return Response({"detail": "Debe especificar 'ids', 'criticidad', 'criticidad_in' o 'all' para eliminar eventos"}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "status": "success",
            "deleted_count": deleted_count,
            "message": f"Se eliminaron {deleted_count} eventos correctamente."
        })

# ==========================================
# 5.1. SERVICIO Y VISTA DE MAPA TECNOLÓGICO (CYBERMAP)
# ==========================================
from django.db.models import Q
from rest_framework.permissions import AllowAny

# El modelo UbicacionTecnologica está definido localmente.
# Si la tabla aún no fue migrada en MySQL, las consultas se capturan con try/except.
DB_DISPONIBLE = True

class TechMapService:
    def __init__(self):
        # Header necesario para que OpenStreetMap (Nominatim) no bloquee las peticiones
        self.headers = {'User-Agent': 'CyberMap_Project_v4/1.0 (admin@local.test)'}

    def obtener_iss(self):
        """Consulta API externa para la ISS en tiempo real"""
        try:
            r = requests.get("http://api.open-notify.org/iss-now.json", timeout=4)
            data = r.json()
            return [{
                'nombre': 'ISS (Estación Espacial)',
                'coords': [float(data['iss_position']['latitude']), float(data['iss_position']['longitude'])],
                'tipo': 'satelite',
                'desc': 'Ubicación en tiempo real. Velocidad: 27,600 km/h.',
                'url': 'https://www.nasa.gov/mission_pages/station/main/index.html'
            }]
        except Exception:
            return []

    def obtener_cables_submarinos(self):
        """Lista masiva de cables submarinos clave"""
        return [
            # --- CONEXIÓN SUDAMÉRICA ---
            {'nombre': 'Cable Firmina (Google)', 'tipo': 'cable', 'coords': [[33.65, -78.93], [-36.58, -56.69]], 'desc': 'USA -> Las Toninas (Argentina). El cable más largo con alimentación única.'},
            {'nombre': 'Cable Tannat', 'tipo': 'cable', 'coords': [[-34.90, -56.16], [-23.96, -46.33]], 'desc': 'Uruguay -> Brasil.'},
            {'nombre': 'Cable Malbec', 'tipo': 'cable', 'coords': [[-22.90, -43.17], [-36.58, -56.69]], 'desc': 'Río de Janeiro -> Las Toninas.'},
            {'nombre': 'EllaLink', 'tipo': 'cable', 'coords': [[38.72, -9.13], [-3.71, -38.54]], 'desc': 'Europa (Portugal) -> Brasil (Fortaleza).'},
            {'nombre': 'SACS', 'tipo': 'cable', 'coords': [[-3.71, -38.54], [-8.83, 13.23]], 'desc': 'Brasil -> Angola (África).'},
            {'nombre': 'Cable Curie', 'tipo': 'cable', 'coords': [[33.92, -118.35], [-33.01, -71.62]], 'desc': 'Los Angeles -> Chile (Valparaíso).'},
            {'nombre': 'Humboldt (En construcción)', 'tipo': 'cable', 'coords': [[-33.01, -71.62], [-33.86, 151.20]], 'desc': 'Chile -> Australia. Primer cable transpacífico del hemisferio sur.'},
            
            # --- MUNDIALES ---
            {'nombre': 'MAREA', 'tipo': 'cable', 'coords': [[36.85, -75.97], [43.34, -3.00]], 'desc': 'USA -> España. Capacidad récord.'},
            {'nombre': 'Grace Hopper', 'tipo': 'cable', 'coords': [[40.71, -74.00], [50.82, -4.54]], 'desc': 'USA -> UK. Tecnología de fibra conmutada.'},
            {'nombre': '2Africa', 'tipo': 'cable', 'coords': [[50.82, -4.54], [-33.92, 18.42]], 'desc': 'El cable más largo del mundo, rodeando África.'},
            {'nombre': 'SEA-ME-WE 5', 'tipo': 'cable', 'coords': [[43.12, 5.93], [1.35, 103.81]], 'desc': 'Francia -> Singapur. Columna vertebral Eurasia.'},
            {'nombre': 'JUPITER', 'tipo': 'cable', 'coords': [[33.92, -118.35], [34.96, 139.95]], 'desc': 'USA -> Japón.'},
        ]

    def geocodificar_externo(self, query):
        """Busca direcciones reales usando OpenStreetMap (Nominatim)"""
        try:
            url = f"https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=3"
            r = requests.get(url, headers=self.headers, timeout=4)
            if r.status_code == 200:
                data = r.json()
                resultados_geo = []
                for item in data:
                    resultados_geo.append({
                        'nombre': item.get('name') or query.title(),
                        'coords': [float(item['lat']), float(item['lon'])],
                        'tipo': 'ciencia',
                        'desc': item.get('display_name', 'Ubicación encontrada'),
                        'url': ''
                    })
                return resultados_geo
        except Exception:
            return []
        return []

    def geolocalizar_ip(self, ip_str):
        """
        Geolocaliza una dirección IP consultando https://api.iping.cc/v1/query?ip={ip}&language=en
        Retorna la posición geográfica y toda la metadata de ciberinteligencia (ISP, ASN, Proxy, Riesgo, etc.)
        """
        try:
            clean_ip = ip_str.strip()
            if clean_ip.lower().startswith('ip:'):
                clean_ip = clean_ip[3:].strip()
            clean_ip = clean_ip.strip("'\"")

            url = f"https://api.iping.cc/v1/query?ip={clean_ip}&language=en"
            r = requests.get(url, headers=self.headers, timeout=6)
            if r.status_code == 200:
                res_data = r.json()
                data = res_data.get('data') or {}
                lat = data.get('latitude')
                lon = data.get('longitude')
                if lat is not None and lon is not None and str(lat).strip() and str(lon).strip():
                    lat_f = float(lat)
                    lon_f = float(lon)
                    ip_val = data.get('ip', clean_ip)
                    city = data.get('city') or ''
                    region = data.get('region') or ''
                    country = data.get('country') or ''
                    continent = data.get('continent') or ''
                    isp = data.get('isp') or 'Desconocido'
                    asn = data.get('asn') or 'N/A'
                    as_owner = data.get('as_owner') or ''
                    as_type = data.get('as_type') or ''
                    company = data.get('company') or ''
                    is_proxy = data.get('is_proxy')
                    risk_score = data.get('risk_score', 0)
                    risk_tag = data.get('risk_tag') or ''

                    loc_parts = [p for p in [city, region, country, continent] if p]
                    loc_str = ", ".join(loc_parts) if loc_parts else "Ubicación detectada"

                    desc = f"IP: {ip_val} | Ubicación: {loc_str} | ISP: {isp} | ASN: {asn} ({as_owner or as_type}) | Proxy: {is_proxy} | Riesgo: {risk_score}/100 ({risk_tag or 'Normal'})"

                    return [{
                        'nombre': f"IP: {ip_val}",
                        'coords': [lat_f, lon_f],
                        'tipo': 'ip',
                        'desc': desc,
                        'url': f"https://www.infobyip.com/ip-{ip_val}.html",
                        'ip_data': data
                    }]
        except Exception:
            pass
        return []

    def buscar(self, query=""):
        resultados = []
        q = (query or "").lower().strip()

        # Por defecto no mostrar nada si no hay consulta explícita
        if not q:
            return []

        # ---------------------------------------------------------
        # 0. DETECCIÓN AUTOMÁTICA DE BÚSQUEDA POR IP
        # ---------------------------------------------------------
        import re
        ip_match = re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', q)
        if ip_match:
            ip_found = ip_match.group(0)
            ip_results = self.geolocalizar_ip(ip_found)
            if ip_results:
                return ip_results

        # ---------------------------------------------------------
        # 1. BÚSQUEDA EN BASE DE DATOS LOCAL (MySQL)
        # ---------------------------------------------------------
        if DB_DISPONIBLE:
            try:
                db_results = UbicacionTecnologica.objects.all()[:50] if q in ['all', 'todos', '*', 'todo', 'completo'] else UbicacionTecnologica.objects.filter(
                    Q(nombre__icontains=q) | Q(tipo__icontains=q) | Q(descripcion__icontains=q)
                )
                for item in db_results:
                    resultados.append({
                        'nombre': item.nombre,
                        'coords': [item.latitud, item.longitud],
                        'tipo': item.tipo,
                        'desc': item.descripcion,
                        'url': ''
                    })
            except Exception:
                pass

        # ---------------------------------------------------------
        # 2. CATEGORÍAS DE INTELIGENCIA (Listas Completas)
        # ---------------------------------------------------------
        show_all = q in ['all', 'todos', '*', 'todo', 'completo']

        # --- INTELIGENCIA ARTIFICIAL (TOP 20) ---
        ai_data = [
            {'nombre': 'OpenAI HQ', 'coords': [37.7609, -122.4148], 'tipo': 'ia', 'desc': 'San Francisco - Creadores de ChatGPT y Sora.', 'url': 'https://openai.com'},
            {'nombre': 'Anthropic', 'coords': [37.7836, -122.4005], 'tipo': 'ia', 'desc': 'San Francisco - Creadores de Claude.', 'url': 'https://www.anthropic.com'},
            {'nombre': 'Google DeepMind (US)', 'coords': [37.4220, -122.0841], 'tipo': 'ia', 'desc': 'Mountain View - Gemini y Transformers.', 'url': 'https://deepmind.google'},
            {'nombre': 'Meta AI (FAIR)', 'coords': [37.4530, -122.1817], 'tipo': 'ia', 'desc': 'Menlo Park - Llama 3 Open Source.', 'url': 'https://ai.meta.com'},
            {'nombre': 'NVIDIA AI Lab', 'coords': [37.3734, -121.9667], 'tipo': 'ia', 'desc': 'Santa Clara - Hardware para IA y Omniverse.', 'url': 'https://www.nvidia.com'},
            {'nombre': 'xAI (Elon Musk)', 'coords': [37.5925, -122.3667], 'tipo': 'ia', 'desc': 'Burlingame - Grok.', 'url': 'https://x.ai'},
            {'nombre': 'Tesla AI', 'coords': [37.3946, -122.1503], 'tipo': 'ia', 'desc': 'Palo Alto - Autopilot FSD y Optimus.'},
            {'nombre': 'Apple AI', 'coords': [37.3349, -122.0090], 'tipo': 'ia', 'desc': 'Cupertino - Apple Intelligence.'},
            {'nombre': 'Microsoft AI', 'coords': [47.6423, -122.1369], 'tipo': 'ia', 'desc': 'Redmond - Copilot e Inversor OpenAI.'},
            {'nombre': 'Boston Dynamics', 'coords': [42.3957, -71.2662], 'tipo': 'ia', 'desc': 'Waltham, MA - Robótica avanzada (Atlas).'},
            {'nombre': 'IBM Watson', 'coords': [41.2097, -73.7998], 'tipo': 'ia', 'desc': 'New York - Pioneros históricos.'},
            {'nombre': 'Google DeepMind (UK)', 'coords': [51.5332, -0.1264], 'tipo': 'ia', 'desc': 'Londres - AlphaGo y AlphaFold.', 'url': 'https://deepmind.google'},
            {'nombre': 'Mistral AI', 'coords': [48.8724, 2.3424], 'tipo': 'ia', 'desc': 'París - IA Europea Open Source.', 'url': 'https://mistral.ai'},
            {'nombre': 'Hugging Face', 'coords': [48.8347, 2.3787], 'tipo': 'ia', 'desc': 'París - El hub de modelos open source.', 'url': 'https://huggingface.co'},
            {'nombre': 'Stability AI', 'coords': [51.5033, -0.1195], 'tipo': 'ia', 'desc': 'Londres - Stable Diffusion.', 'url': 'https://stability.ai'},
            {'nombre': 'Baidu (Ernie)', 'coords': [40.0559, 116.3072], 'tipo': 'ia', 'desc': 'Pekín - Líder IA en China.'},
            {'nombre': 'Alibaba Cloud', 'coords': [30.1914, 120.1873], 'tipo': 'ia', 'desc': 'Hangzhou - Tongyi Qianwen.'},
            {'nombre': 'TII (Falcon)', 'coords': [24.4320, 54.4491], 'tipo': 'ia', 'desc': 'Abu Dhabi - Modelos Falcon Open Source.'}
        ]

        # --- HERRAMIENTAS OSINT & RASTREO (Con URLs) ---
        osint_data = [
            {'nombre': 'Maxar Technologies', 'coords': [39.8825, -105.0883], 'tipo': 'osint', 'desc': 'USA - Imágenes satelitales de alta resolución.', 'url': 'https://www.maxar.com'},
            {'nombre': 'Planet Labs', 'coords': [37.7766, -122.4042], 'tipo': 'osint', 'desc': 'USA - Monitoreo diario de la Tierra.', 'url': 'https://www.planet.com'},
            {'nombre': 'Airbus Intelligence', 'coords': [43.6047, 1.4442], 'tipo': 'osint', 'desc': 'Francia - Satélites Pléiades.', 'url': 'https://www.intelligence-airbusds.com'},
            {'nombre': 'FlightRadar24 HQ', 'coords': [59.3293, 18.0686], 'tipo': 'osint', 'desc': 'Suecia - Rastreo aéreo.', 'url': 'https://www.flightradar24.com'},
            {'nombre': 'MarineTraffic HQ', 'coords': [37.9838, 23.7275], 'tipo': 'osint', 'desc': 'Grecia - Rastreo marítimo.', 'url': 'https://www.marinetraffic.com'},
            {'nombre': 'Internet Archive', 'coords': [37.7829, -122.4716], 'tipo': 'osint', 'desc': 'USA - Wayback Machine.', 'url': 'https://archive.org'},
            {'nombre': 'Bellingcat HQ', 'coords': [52.3676, 4.9041], 'tipo': 'osint', 'desc': 'Países Bajos - Investigación OSINT.', 'url': 'https://www.bellingcat.com'},
            {'nombre': 'ICIJ', 'coords': [38.9056, -77.0369], 'tipo': 'osint', 'desc': 'USA - Panama Papers.', 'url': 'https://www.icij.org'},
            {'nombre': 'Citizen Lab', 'coords': [43.6629, -79.3957], 'tipo': 'osint', 'desc': 'Canadá - Ciberespionaje y DDHH.', 'url': 'https://citizenlab.ca'},
            {'nombre': 'VirusTotal (Google)', 'coords': [36.7196, -4.4200], 'tipo': 'osint', 'desc': 'Málaga, España - La base de datos de malware más grande del mundo.', 'url': 'https://www.virustotal.com'},
            {'nombre': 'Mandiant (Google Cloud)', 'coords': [38.9687, -77.3411], 'tipo': 'osint', 'desc': 'Reston, USA - Famosos por descubrir ataques APT estatales.', 'url': 'https://www.mandiant.com'},
            {'nombre': 'Have I Been Pwned', 'coords': [-28.0167, 153.4000], 'tipo': 'osint', 'desc': 'Australia - Verificación de filtraciones de contraseñas.', 'url': 'https://haveibeenpwned.com'},
            {'nombre': 'Chainalysis HQ', 'coords': [40.7408, -73.9904], 'tipo': 'osint', 'desc': 'New York, USA - Rastreo de lavado de dinero en Bitcoin y cripto.', 'url': 'https://www.chainalysis.com'},
            {'nombre': 'OCCRP HQ', 'coords': [43.8563, 18.4131], 'tipo': 'osint', 'desc': 'Bosnia - Reporte de Crimen Organizado y Corrupción.', 'url': 'https://www.occrp.org'},
            {'nombre': 'WikiLeaks (Fundación)', 'coords': [64.1466, -21.9426], 'tipo': 'osint', 'desc': 'Islandia - Alojamiento histórico de filtraciones masivas.', 'url': 'https://wikileaks.org'},
            {'nombre': 'ProPublica', 'coords': [40.7075, -74.0113], 'tipo': 'osint', 'desc': 'New York, USA - Periodismo de investigación basado en datos.', 'url': 'https://www.propublica.org'},
            {'nombre': 'SIPRI', 'coords': [59.3698, 18.0076], 'tipo': 'osint', 'desc': 'Suecia - Investigación sobre el comercio global de armas.', 'url': 'https://www.sipri.org'},
            {'nombre': 'Oryx (Blog)', 'coords': [52.3702, 4.8952], 'tipo': 'osint', 'desc': 'Países Bajos - Conteo visual de pérdidas militares.', 'url': 'https://www.oryxspioenkop.com'},
            {'nombre': 'Shodan HQ', 'coords': [30.2672, -97.7431], 'tipo': 'osint', 'desc': 'Austin, USA - El buscador de dispositivos IoT conectados.', 'url': 'https://www.shodan.io'},
            {'nombre': 'SatelliteMap.space', 'coords': [33.9207, -118.3278], 'tipo': 'osint', 'desc': 'Visualización global en tiempo real de la constelación de satélites Starlink y OneWeb.', 'url': 'https://satellitemap.space/'}
        ]

        # --- SEGURIDAD, INTELIGENCIA & MILITAR (Lista Completa) ---
        seguridad_data = [
            {'nombre': 'NSA HQ', 'coords': [39.1089, -76.7716], 'tipo': 'seguridad', 'desc': 'USA - Fort Meade.'},
            {'nombre': 'Utah Data Center', 'coords': [40.4319, -111.9297], 'tipo': 'seguridad', 'desc': 'USA - Almacenamiento masivo NSA.'},
            {'nombre': 'CIA HQ', 'coords': [38.9517, -77.1466], 'tipo': 'seguridad', 'desc': 'USA - Langley.'},
            {'nombre': 'El Pentágono', 'coords': [38.8719, -77.0563], 'tipo': 'seguridad', 'desc': 'USA - Defensa.'},
            {'nombre': 'Cheyenne Mountain', 'coords': [38.7442, -104.8463], 'tipo': 'seguridad', 'desc': 'USA - Búnker NORAD.'},
            {'nombre': 'GCHQ', 'coords': [51.8995, -2.1246], 'tipo': 'seguridad', 'desc': 'UK - The Doughnut (SIGINT).'},
            {'nombre': 'MI6', 'coords': [51.4872, -0.1243], 'tipo': 'seguridad', 'desc': 'UK - Inteligencia.'},
            {'nombre': 'CSEC', 'coords': [45.4418, -75.6315], 'tipo': 'seguridad', 'desc': 'Canadá - Ciberseguridad.'},
            {'nombre': 'ASD', 'coords': [-35.2974, 149.1235], 'tipo': 'seguridad', 'desc': 'Australia - Cyber Intel.'},
            {'nombre': 'GCSB', 'coords': [-41.2784, 174.7766], 'tipo': 'seguridad', 'desc': 'Nueva Zelanda - Comunicaciones.'},
            {'nombre': 'FSB HQ', 'coords': [55.7607, 37.6272], 'tipo': 'seguridad', 'desc': 'Rusia - Lubyanka.'},
            {'nombre': 'GRU HQ', 'coords': [55.7833, 37.5167], 'tipo': 'seguridad', 'desc': 'Rusia - Inteligencia Militar.'},
            {'nombre': 'Unidad 61398', 'coords': [31.2988, 121.4925], 'tipo': 'seguridad', 'desc': 'China - Ciberguerra (Shanghái).'},
            {'nombre': 'MSS', 'coords': [39.9075, 116.4005], 'tipo': 'seguridad', 'desc': 'China - Seguridad del Estado.'},
            {'nombre': 'Bureau 121', 'coords': [39.0392, 125.7625], 'tipo': 'seguridad', 'desc': 'Corea del Norte - Hackers estatales.'},
            {'nombre': 'NATO CCDCOE', 'coords': [59.4262, 24.7409], 'tipo': 'seguridad', 'desc': 'Estonia - Ciberdefensa OTAN.'},
            {'nombre': 'BND', 'coords': [52.5330, 13.3760], 'tipo': 'seguridad', 'desc': 'Alemania - Inteligencia.'},
            {'nombre': 'Unit 8200', 'coords': [32.1463, 34.8052], 'tipo': 'seguridad', 'desc': 'Israel - Ciberinteligencia.'},
            {'nombre': 'Mossad', 'coords': [32.1373, 34.8145], 'tipo': 'seguridad', 'desc': 'Israel - Inteligencia.'},
            {'nombre': 'Pionen', 'coords': [59.3160, 18.0840], 'tipo': 'seguridad', 'desc': 'Suecia - Búnker nuclear de datos.'},
            {'nombre': 'Swiss Fort Knox', 'coords': [46.4862, 7.2847], 'tipo': 'seguridad', 'desc': 'Suiza - Búnker Alpes.'},
            {'nombre': 'Menwith Hill', 'coords': [54.0083, -1.6896], 'tipo': 'seguridad', 'desc': 'UK - Estación ECHELON.'},
            {'nombre': 'Pine Gap', 'coords': [-23.7992, 133.7371], 'tipo': 'seguridad', 'desc': 'Australia - Base espía CIA.'},
            {'nombre': 'Base Espacial China', 'coords': [-38.1914, -70.1495], 'tipo': 'seguridad', 'desc': 'Argentina (Neuquén) - Espacio Profundo.'},
            {'nombre': 'AFI', 'coords': [-34.6063, -58.3712], 'tipo': 'seguridad', 'desc': 'Argentina - Inteligencia.'},
            {'nombre': 'ABIN', 'coords': [-15.8267, -47.9218], 'tipo': 'seguridad', 'desc': 'Brasil - Inteligencia.'},
            {'nombre': 'NSO Group', 'coords': [32.1624, 34.8447], 'tipo': 'seguridad', 'desc': 'Israel - Pegasus Spyware.'},
            {'nombre': 'Palantir', 'coords': [39.7392, -104.9903], 'tipo': 'seguridad', 'desc': 'USA - Minería de datos.'},
            {'nombre': 'Natanz', 'coords': [33.7236, 51.7282], 'tipo': 'seguridad', 'desc': 'Irán - Zona ataque Stuxnet.'}
        ]

        # --- RED PROFUNDA, TOR & DNS ---
        net_data = [
            {'nombre': 'Tor Auth: Moria1', 'coords': [42.3601, -71.0589], 'tipo': 'tor', 'desc': 'USA - Autoridad Tor.'},
            {'nombre': 'Tor Auth: Tor26', 'coords': [52.5200, 13.4050], 'tipo': 'tor', 'desc': 'Alemania - Autoridad Tor.'},
            {'nombre': 'Tor Auth: Dizum', 'coords': [52.3676, 4.9041], 'tipo': 'tor', 'desc': 'Países Bajos - Autoridad Tor.'},
            {'nombre': 'Root Server A', 'coords': [38.9339, -77.3306], 'tipo': 'net', 'desc': 'USA - Verisign (.com).'},
            {'nombre': 'Root Server E', 'coords': [37.4216, -122.0620], 'tipo': 'net', 'desc': 'USA - NASA.'},
            {'nombre': 'Root Server K', 'coords': [52.3702, 4.8952], 'tipo': 'net', 'desc': 'Holanda - RIPE NCC.'},
            {'nombre': 'Root Server M', 'coords': [35.6895, 139.6917], 'tipo': 'net', 'desc': 'Japón - WIDE.'},
            {'nombre': 'DE-CIX Frankfurt', 'coords': [50.1109, 8.6821], 'tipo': 'net', 'desc': 'Alemania - IXP mayor tráfico mundial.'},
            {'nombre': 'PTT.br', 'coords': [-23.5505, -46.6333], 'tipo': 'net', 'desc': 'Brasil - Mayor IXP Hemisferio Sur.'},
            {'nombre': 'CyberBunker', 'coords': [51.4925, 6.1362], 'tipo': 'tor', 'desc': 'Alemania - Ex-Búnker Dark Web.'},
            {'nombre': 'Sealand', 'coords': [51.8952, 1.4805], 'tipo': 'tor', 'desc': 'Mar del Norte - Data Haven.'}
        ]

        # --- CHIPS & SEMICONDUCTORES ---
        chips_data = [
            {'nombre': 'TSMC Fab 12', 'coords': [24.7831, 121.0064], 'tipo': 'tech', 'desc': 'Taiwán - Fábrica de chips más avanzada.'},
            {'nombre': 'ASML HQ', 'coords': [51.4042, 5.4673], 'tipo': 'tech', 'desc': 'Países Bajos - Máquinas litografía EUV.'},
            {'nombre': 'Samsung Electronics', 'coords': [37.0270, 127.0540], 'tipo': 'tech', 'desc': 'Corea del Sur - Chips de memoria.'},
            {'nombre': 'Intel Ocotillo', 'coords': [33.2427, -111.8679], 'tipo': 'tech', 'desc': 'USA - Fabricación masiva.'},
            {'nombre': 'Foxconn', 'coords': [34.5428, 113.8443], 'tipo': 'tech', 'desc': 'China - iPhone City.'}
        ]

        # --- DATA CENTERS ---
        dcs = [
            {'nombre': "AWS Virginia", 'coords': [39.0438, -77.4874], 'tipo': 'datacenter', 'desc': 'USA - Corazón de internet.'},
            {'nombre': "Google Quilicura", 'coords': [-33.3667, -70.7333], 'tipo': 'datacenter', 'desc': 'Chile - Región Latam.'},
            {'nombre': "AWS Sao Paulo", 'coords': [-23.5505, -46.6333], 'tipo': 'datacenter', 'desc': 'Brasil.'},
            {'nombre': "Switch Citadel", 'coords': [39.5583, -119.5694], 'tipo': 'datacenter', 'desc': 'Nevada - Data Center más grande.'},
            {'nombre': "Facebook Luleå", 'coords': [65.5848, 22.1547], 'tipo': 'datacenter', 'desc': 'Suecia - Artico.'},
            {'nombre': "Microsoft Azure", 'coords': [53.3341, -6.2285], 'tipo': 'datacenter', 'desc': 'Irlanda - Hub Europa.'},
            {'nombre': "Google Hamina", 'coords': [60.5693, 27.1878], 'tipo': 'datacenter', 'desc': 'Finlandia - Refrigerado por mar.'},
            {'nombre': "Google Changhua", 'coords': [24.1378, 120.4079], 'tipo': 'datacenter', 'desc': 'Taiwán - Hub Asia.'}
        ]

        # --- CRYPTO & BLOCKCHAIN ---
        crypto_data = [
            {'nombre': 'Bitcoin Beach', 'coords': [13.4925, -89.4428], 'tipo': 'crypto', 'desc': 'El Salvador.'},
            {'nombre': 'Crypto Valley', 'coords': [47.1662, 8.5155], 'tipo': 'crypto', 'desc': 'Suiza - Ethereum HQ.'},
            {'nombre': 'Riot Whinstone', 'coords': [30.5562, -97.0267], 'tipo': 'crypto', 'desc': 'Texas - Minería masiva.'},
            {'nombre': 'Bitmain', 'coords': [39.9965, 116.3263], 'tipo': 'crypto', 'desc': 'China - Fabricante ASICs.'},
            {'nombre': 'Genesis Mining', 'coords': [63.9850, -22.6056], 'tipo': 'crypto', 'desc': 'Islandia - Minería Geotérmica.'}
        ]

        # --- ENERGÍA & BIOSEGURIDAD ---
        mix_data = [
            {'nombre': 'ITER', 'coords': [43.6872, 5.7629], 'tipo': 'energia', 'desc': 'Francia - Fusión Nuclear.'},
            {'nombre': 'NIF (Ignición)', 'coords': [37.6819, -121.7680], 'tipo': 'energia', 'desc': 'USA - Fusión Láser.'},
            {'nombre': 'Three Gorges', 'coords': [30.8232, 111.0034], 'tipo': 'energia', 'desc': 'China - Hidroeléctrica.'},
            {'nombre': 'Wuhan Institute', 'coords': [30.3758, 114.2635], 'tipo': 'bio', 'desc': 'China - Virología.'},
            {'nombre': 'CDC HQ', 'coords': [33.7993, -84.3280], 'tipo': 'bio', 'desc': 'USA - Control Enfermedades.'},
            {'nombre': 'Vector Institute', 'coords': [54.9405, 83.2185], 'tipo': 'bio', 'desc': 'Rusia - Reserva Viruela.'},
            {'nombre': 'Instituto Malbrán', 'coords': [-34.6366, -58.3887], 'tipo': 'bio', 'desc': 'Argentina - Microbiología.'}
        ]

        # --- UDC (Universidad del Chubut - Sedes y Extensiones) ---
        udc_data = [
            {'nombre': "UDC Rawson (Sede Central y Rectorado)", 'coords': [-43.2987, -65.0980], 'tipo': 'udc', 'desc': "Sede Central de la Universidad del Chubut - Rectorado y Gestión Académica.", 'url': 'https://udc.edu.ar'},
            {'nombre': "UDC Aulas y Laboratorios Rawson", 'coords': [-43.3035, -65.1036], 'tipo': 'udc', 'desc': "Edificio de Aulas, Laboratorios de Informática, Ciberseguridad y Redes UDC.", 'url': 'https://udc.edu.ar'},
            {'nombre': "UDC Sede Puerto Madryn", 'coords': [-42.7827, -65.0486], 'tipo': 'udc', 'desc': "Sede Puerto Madryn - Carreras de Tecnología, Salud y Producción.", 'url': 'https://udc.edu.ar'},
            {'nombre': "UDC Sede Cordillerana Esquel", 'coords': [-42.9187, -71.2920], 'tipo': 'udc', 'desc': "Sede Cordillerana UDC Esquel - Formación tecnológica regional.", 'url': 'https://udc.edu.ar'},
            {'nombre': "UDC Extensión Áulica Gaiman", 'coords': [-43.2897, -65.4927], 'tipo': 'udc', 'desc': "Extensión Áulica UDC en el Valle Inferior del Río Chubut.", 'url': 'https://udc.edu.ar'},
            {'nombre': "UDC Extensión Áulica Sarmiento", 'coords': [-45.5901, -69.0712], 'tipo': 'udc', 'desc': "Extensión Áulica UDC Sarmiento.", 'url': 'https://udc.edu.ar'},
        ]

        # --- COMPUTACIÓN CUÁNTICA (The Bleeding Edge) ---
        quantum_data = [
            {'nombre': 'IBM Quantum (Yorktown)', 'coords': [41.2097, -73.7998], 'tipo': 'quantum', 'desc': 'USA - Hogar de "Eagle" y "Osprey", los procesadores cuánticos más avanzados de IBM.', 'url': 'https://research.ibm.com/ibm-q/'},
            {'nombre': 'Google Sycamore (Santa Barbara)', 'coords': [34.4208, -119.6982], 'tipo': 'quantum', 'desc': 'USA - Donde Google alcanzó la "Supremacía Cuántica" en 2019.', 'url': 'https://quantumai.google'},
            {'nombre': 'D-Wave Systems', 'coords': [49.2497, -123.0006], 'tipo': 'quantum', 'desc': 'Canadá - Pioneros en computación cuántica comercial (Annealing).', 'url': 'https://www.dwavesys.com'},
            {'nombre': 'Rigetti Computing', 'coords': [37.8665, -122.2964], 'tipo': 'quantum', 'desc': 'California - Startup líder en chips cuánticos superconductores.', 'url': 'https://www.rigetti.com'},
            {'nombre': 'USTC (JiuZhang)', 'coords': [31.8422, 117.2579], 'tipo': 'quantum', 'desc': 'China - Laboratorio que creó "JiuZhang", la computadora cuántica fotónica más rápida.', 'url': ''}
        ]

        # --- RADIOASTRONOMÍA Y SETI (Escuchando el Universo) ---
        radio_data = [
            {'nombre': 'VLA (Very Large Array)', 'coords': [34.0784, -107.6184], 'tipo': 'radio', 'desc': 'Nuevo México, USA - Icónico conjunto de 27 antenas de radio (Famoso por la película "Contact").', 'url': 'https://public.nrao.edu/visit/very-large-array/'},
            {'nombre': 'FAST Telescope (Sky Eye)', 'coords': [25.6529, 106.8566], 'tipo': 'radio', 'desc': 'China - El radiotelescopio de plato único más grande del mundo (500m).', 'url': ''},
            {'nombre': 'Allen Telescope Array (SETI)', 'coords': [40.8178, -121.4695], 'tipo': 'radio', 'desc': 'California - Dedicado exclusivamente a la búsqueda de inteligencia extraterrestre (SETI).', 'url': 'https://www.seti.org'},
            {'nombre': 'Observatorio de Arecibo (Memorial)', 'coords': [18.3464, -66.7528], 'tipo': 'radio', 'desc': 'Puerto Rico - Lugar histórico donde se envió el "Mensaje de Arecibo" a las estrellas en 1974.', 'url': 'https://www.naic.edu'},
            {'nombre': 'ALMA', 'coords': [-23.0234, -67.7538], 'tipo': 'radio', 'desc': 'Atacama, Chile - El proyecto astronómico terrestre más grande del mundo.', 'url': 'https://www.almaobservatory.org'}
        ]

        # --- MISTERIOS Y LUGARES EXTRAÑOS (Conspiraciones Tech) ---
        mystery_data = [
            {'nombre': 'HAARP', 'coords': [62.3917, -145.1500], 'tipo': 'misterio', 'desc': 'Alaska, USA - Instalación de investigación ionosférica (y centro de teorías de conspiración climática).', 'url': 'https://haarp.gi.alaska.edu'},
            {'nombre': 'Area 51 (Groom Lake)', 'coords': [37.2343, -115.8067], 'tipo': 'misterio', 'desc': 'Nevada, USA - Base altamente clasificada. Desarrollo de aviones espía (U-2, SR-71) y mitos OVNI.', 'url': ''},
            {'nombre': 'UVB-76 "The Buzzer"', 'coords': [60.3130, 30.2730], 'tipo': 'misterio', 'desc': 'Rusia - Estación de radio fantasma que transmite un zumbido misterioso desde los años 70.', 'url': ''},
            {'nombre': 'Point Nemo', 'coords': [-48.8767, -123.3933], 'tipo': 'misterio', 'desc': 'Océano Pacífico - El cementerio de naves espaciales. Aquí caerá la ISS cuando se retire.', 'url': ''},
            {'nombre': 'Svalbard Global Seed Vault', 'coords': [78.2356, 15.4913], 'tipo': 'misterio', 'desc': 'Noruega - La bóveda del fin del mundo. Backup de semillas para un apocalipsis.', 'url': 'https://www.croptrust.org/work/svalbard-global-seed-vault/'}
        ]

        all_lists = [
            (ai_data, ('ia', 'ai', 'gpt', 'inteligencia', 'bot')),
            (osint_data, ('osint', 'investigacion', 'rastreo', 'radar', 'geo')),
            (seguridad_data, ('seguridad', 'hack', 'nsa', 'militar', 'intel')),
            (net_data, ('tor', 'red', 'dns', 'root', 'ixp')),
            (chips_data, ('chip', 'cpu', 'semiconductor', 'tsmc')),
            (dcs, ('data center', 'datacenter', 'aws', 'google', 'azure')),
            (crypto_data, ('crypto', 'bitcoin', 'mineria')),
            (mix_data, ('energia', 'fusion', 'bio', 'lab')),
            (udc_data, ('udc', 'chubut', 'rawson', 'madryn', 'esquel', 'gaiman', 'sarmiento', 'universidad')),
            (quantum_data, ('cuantica', 'quantum', 'qbit', 'futuro')),
            (radio_data, ('radio', 'telescopio', 'espacio', 'seti', 'aliens')),
            (mystery_data, ('misterio', 'secreto', 'haarp', 'area 51')),
        ]

        if show_all:
            for dataset, _ in all_lists:
                resultados.extend(dataset)
            resultados.extend(self.obtener_iss())
            resultados.extend(self.obtener_cables_submarinos())
        else:
            for dataset, keywords in all_lists:
                if any(kw in q for kw in keywords):
                    resultados.extend(dataset)
                else:
                    for item in dataset:
                        if q in item['nombre'].lower() or q in item['desc'].lower():
                            resultados.append(item)

            if 'iss' in q or 'espacio' in q or 'satelite' in q:
                resultados.extend(self.obtener_iss())

            if 'fibra' in q or 'cable' in q or 'internet' in q:
                resultados.extend(self.obtener_cables_submarinos())
            else:
                for cable in self.obtener_cables_submarinos():
                    if q in cable['nombre'].lower() or q in cable['desc'].lower():
                        resultados.append(cable)

            # Fallback Nominatim
            comandos_clave = ['iss', 'fibra', 'cable', 'udc', 'tor', 'osint', 'bio', 'ia', 'crypto', 'chip', 'data', 'seguridad', 'energia', 'quantum', 'radio', 'misterio']
            es_comando = any(cmd in q for cmd in comandos_clave)

            if len(resultados) == 0 or (len(q) > 3 and not es_comando):
                geo_data = self.geocodificar_externo(q)
                resultados.extend(geo_data)

        # Deduplicar resultados manteniendo el orden
        seen = set()
        unique_results = []
        for item in resultados:
            key = (item['nombre'], str(item.get('coords')))
            if key not in seen:
                seen.add(key)
                unique_results.append(item)

        return unique_results

class TechMapView(APIView):
    """
    Endpoint para buscar y visualizar ubicaciones tecnológicas,
    cables submarinos, satélites, ciberinteligencia y geolocalización de IPs en el mapa.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        ip_param = request.query_params.get('ip', '').strip()
        query = request.query_params.get('q', '').strip()
        service = TechMapService()

        if ip_param:
            resultados = service.geolocalizar_ip(ip_param)
            return Response({
                "query": ip_param,
                "is_ip": True,
                "total": len(resultados),
                "results": resultados
            })

        resultados = service.buscar(query)
        return Response({
            "query": query,
            "total": len(resultados),
            "results": resultados
        })

# ==========================================
# 5.5 MONITOREO DE DOMINIOS E IPS PÚBLICAS
# ==========================================
def ping_domain(domain_name):
    """
    Verifica la conectividad de un dominio o dirección IP mediante Ping ICMP
    y petición HTTP/HTTPS si corresponde a un dominio.
    """
    is_ip = False
    try:
        ipaddress.ip_address(domain_name)
        is_ip = True
    except ValueError:
        is_ip = False

    try:
        # Paso 1: Hacemos ping
        start_t = time.time()
        response = subprocess.run(
            ["ping", "-c", "1", "-W", "2", domain_name],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        elapsed_ms = round((time.time() - start_t) * 1000, 1)

        if response.returncode != 0:
            return {
                'active': False,
                'is_ip': is_ip,
                'http_code': '000',
                'response_time_ms': elapsed_ms,
                'error': f"Sin respuesta de Ping ICMP"
            }

        # Si es IP, no continuamos con el curl
        if is_ip:
            return {
                'active': True,
                'is_ip': True,
                'http_code': 'ICMP',
                'response_time_ms': elapsed_ms,
                'error': ''
            }

        # Paso 2: Hacemos una petición HTTP/HTTPS solo si es un dominio
        curl_command = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", f"https://{domain_name}", "--max-time", "4"]
        http_response = subprocess.run(
            curl_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        http_code = http_response.stdout.decode().strip()
        # Fallback a http:// si https responde 000
        if http_code == "000":
            curl_http = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", f"http://{domain_name}", "--max-time", "4"]
            res2 = subprocess.run(curl_http, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            http_code2 = res2.stdout.decode().strip()
            if http_code2 != "000":
                http_code = http_code2

        # Paso 3: Verificar errores HTTP
        if http_code == "000":
            return {
                'active': False,
                'is_ip': False,
                'http_code': '000',
                'response_time_ms': elapsed_ms,
                'error': f"No se pudo establecer conexión HTTP/S"
            }

        if http_code.startswith("5"):
            return {
                'active': False,
                'is_ip': False,
                'http_code': http_code,
                'response_time_ms': elapsed_ms,
                'error': f"Servidor caído (Error {http_code})"
            }

        return {
            'active': True,
            'is_ip': False,
            'http_code': http_code,
            'response_time_ms': elapsed_ms,
            'error': ''
        }

    except Exception as e:
        return {
            'active': False,
            'is_ip': is_ip,
            'http_code': 'ERR',
            'response_time_ms': None,
            'error': str(e)
        }

monitoring_threads = {}
failed_ping_counts = {}
last_notification_time = {}

def start_monitoring_domain_thread(domain_id):
    """Inicia el hilo de monitoreo continuo para un dominio."""
    t = threading.Thread(target=run_domain_monitor, args=(domain_id,), daemon=True)
    monitoring_threads[domain_id] = t
    t.start()

def notify_domain_telegram(domain, level="CRITICA", message="", server_name="Domain-Monitor"):
    """
    Envía notificación a Telegram priorizando al usuario asociado al dominio / IP.
    1. Si el dominio tiene custom_telegram_chat_id, usa ese chat_id.
    2. Si el dominio tiene user y su UserProfile tiene telegram_chat_id, usa ese chat_id.
    3. Si no hay chat específico, recurre a send_telegram_alerts(level, message, server_name).
    """
    target_chat_id = None
    user_name = None

    if domain.custom_telegram_chat_id:
        target_chat_id = domain.custom_telegram_chat_id.strip()

    if not target_chat_id and domain.user:
        user_name = domain.user.username
        try:
            profile = getattr(domain.user, 'profile', None)
            if profile and profile.telegram_chat_id:
                target_chat_id = profile.telegram_chat_id.strip()
        except Exception as e:
            print(f"Error resolviendo perfil de usuario para telegram: {e}")
    elif domain.user:
        user_name = domain.user.username

    full_message = message
    if user_name:
        full_message += f"\n👤 Responsable: {user_name}"

    if target_chat_id:
        sent, err = send_telegram_alert(level, full_message, server_name, target_chat_id, return_error=True)
        if not sent:
            print(f"Aviso Telegram a chat_id {target_chat_id} falló: {err}. Reintentando con alerta general.")
            send_telegram_alerts(level, full_message, server_name)
        return sent
    else:
        send_telegram_alerts(level, full_message, server_name)
        return True

def run_domain_monitor(domain_id):
    """Bucle de trabajo de monitoreo continuo en segundo plano."""
    from django.db import connection
    connection.close()

    failed_ping_counts[domain_id] = 0
    last_notification_time.setdefault(domain_id, None)

    try:
        domain = Domain.objects.get(id=domain_id)
        domain.is_monitoring = True
        domain.save()
    except Exception:
        return

    current_t = threading.current_thread()
    while domain_id in monitoring_threads and monitoring_threads.get(domain_id) == current_t:
        try:
            domain = Domain.objects.get(id=domain_id)
            if not domain.is_monitoring:
                break

            check = ping_domain(domain.name)
            is_active = check['active']

            prev_status = domain.last_status
            domain.last_status = 'online' if is_active else 'offline'
            domain.last_http_code = check.get('http_code') or ''
            domain.response_time_ms = check.get('response_time_ms')
            domain.last_error = check.get('error') or ''
            domain.is_ip = check.get('is_ip', False)
            domain.last_checked = timezone.now()

            if not is_active:
                failed_ping_counts[domain_id] = failed_ping_counts.get(domain_id, 0) + 1
                domain.failed_attempts = failed_ping_counts[domain_id]
                domain.save()

                if failed_ping_counts[domain_id] >= 5:
                    now_dt = datetime.datetime.now()
                    last_notif = last_notification_time.get(domain_id)

                    if not last_notif or (now_dt - last_notif) >= timedelta(minutes=60):
                        tipo_str = "IP Pública" if domain.is_ip else "Dominio Web"
                        alert_msg = (
                            f"El objetivo {domain.name} ({tipo_str}) está CAÍDO tras {domain.failed_attempts} intentos consecutivos.\n"
                            f"⏱ Intervalo de sondeo: {domain.check_interval_seconds}s\n"
                            f"⚠️ Error detectado: {domain.last_error or 'Sin respuesta ICMP / Timeout HTTP'}"
                        )
                        try:
                            notify_domain_telegram(domain, "CRITICA", alert_msg, "Domain-Monitor")
                        except Exception as te:
                            print(f"Error enviando alerta de dominio a Telegram: {te}")
                        last_notification_time[domain_id] = now_dt
            else:
                if prev_status == 'offline' and failed_ping_counts.get(domain_id, 0) >= 5:
                    tipo_str = "IP Pública" if domain.is_ip else "Dominio Web"
                    recovery_msg = (
                        f"El objetivo {domain.name} ({tipo_str}) se ha RECUPERADO exitosamente y está ONLINE.\n"
                        f"⚡ Latencia ping: {domain.response_time_ms} ms\n"
                        f"📡 Estado: {domain.last_http_code or 'ICMP OK'}"
                    )
                    try:
                        notify_domain_telegram(domain, "INFO", recovery_msg, "Domain-Monitor")
                    except Exception as te:
                        print(f"Error enviando notificación de recuperación a Telegram: {te}")

                failed_ping_counts[domain_id] = 0
                domain.failed_attempts = 0
                domain.save()
                last_notification_time[domain_id] = None

        except Exception as e:
            print(f"Error en bucle de monitoreo del dominio {domain_id}: {e}")

        # Intervalo configurable en segundos para proteger la IP pública del SOC
        interval_secs = max(5, getattr(domain, 'check_interval_seconds', 60) or 60)
        time.sleep(interval_secs)

    monitoring_threads.pop(domain_id, None)
    failed_ping_counts.pop(domain_id, None)
    last_notification_time.pop(domain_id, None)
    try:
        domain = Domain.objects.get(id=domain_id)
        domain.is_monitoring = False
        domain.save()
    except Exception:
        pass

def stop_monitoring_domain(domain_id):
    """Detiene el hilo de monitoreo de un dominio."""
    if domain_id in monitoring_threads:
        monitoring_threads[domain_id] = None
        try:
            domain = Domain.objects.get(id=domain_id)
            domain.is_monitoring = False
            domain.save()
        except Exception:
            pass

def ping_domain_and_save(domain_id):
    """Comprobación única bajo demanda en segundo plano."""
    from django.db import connection
    connection.close()
    try:
        domain = Domain.objects.get(id=domain_id)
        check = ping_domain(domain.name)
        domain.last_status = 'online' if check['active'] else 'offline'
        domain.last_http_code = check.get('http_code') or ''
        domain.response_time_ms = check.get('response_time_ms')
        domain.last_error = check.get('error') or ''
        domain.is_ip = check.get('is_ip', False)
        domain.last_checked = timezone.now()
        domain.save()
    except Exception:
        pass

def restart_all_monitoring():
    """Reinicia los hilos de monitoreo activos al iniciar el servidor."""
    ensure_domain_table()
    try:
        domains = Domain.objects.filter(is_monitoring=True)
        for domain in domains:
            start_monitoring_domain_thread(domain.id)
    except Exception as e:
        print(f"Nota: No se pudo reiniciar monitoreo de dominios: {e}")

# En desarrollo (runserver) se ejecuta solo en el proceso hijo (RUN_MAIN=true).
# En producción (Gunicorn, uWSGI, Docker o systemd) no existe RUN_MAIN, por lo que debe ejecutarse siempre.
_is_dev_reloader_parent = ("runserver" in sys.argv) and (os.environ.get("RUN_MAIN") != "true")
_management_cmds = {'makemigrations', 'migrate', 'showmigrations', 'collectstatic', 'check', 'createsuperuser', 'shell', 'dbshell', 'sqlmigrate', 'squashmigrations', 'flush'}
_is_mgmt_cmd = any(cmd in sys.argv for cmd in _management_cmds)
if not _is_dev_reloader_parent and not _is_mgmt_cmd:
    threading.Thread(target=restart_all_monitoring, daemon=True, name="RestartMonitoring").start()
    threading.Thread(target=start_latency_collector_if_needed, daemon=True, name="LatencyCollector").start()
    start_tor_sync_if_needed()
    start_cti_sync_if_needed()

def is_read_only_user(request):
    """Verifica si el usuario autenticado tiene rol de solo lectura (read)."""
    if request.user and request.user.is_authenticated and hasattr(request.user, 'profile'):
        return request.user.profile.role == 'read'
    return False

class DomainListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        ensure_domain_table()
        try:
            domains = Domain.objects.all()
            return Response(DomainSerializer(domains, many=True).data)
        except Exception:
            return Response([])

    def post(self, request):
        if is_read_only_user(request):
            return Response({'error': 'Los usuarios de solo lectura no tienen permisos para agregar objetivos.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        raw_name = request.data.get('name', '').strip()
        if not raw_name:
            return Response({'error': 'Debes ingresar un dominio o dirección IP.'}, status=status.HTTP_400_BAD_REQUEST)

        clean_name = raw_name.lower()
        for prefix in ['https://', 'http://', 'ftp://']:
            if clean_name.startswith(prefix):
                clean_name = clean_name[len(prefix):]
        clean_name = clean_name.split('/')[0].strip()

        if Domain.objects.filter(name=clean_name).exists():
            return Response({'error': f'El objetivo "{clean_name}" ya está registrado.'}, status=status.HTTP_400_BAD_REQUEST)

        is_ip = False
        try:
            ipaddress.ip_address(clean_name)
            is_ip = True
        except ValueError:
            is_ip = False

        # Intervalo en segundos (por defecto 60, min 5, max 86400)
        try:
            raw_interval = int(request.data.get('check_interval_seconds', 60))
            check_interval = max(5, min(86400, raw_interval))
        except (ValueError, TypeError):
            check_interval = 60

        custom_chat_id = str(request.data.get('custom_telegram_chat_id', '')).strip()

        assigned_user = None
        if request.user and request.user.is_authenticated:
            assigned_user = request.user
        elif request.data.get('user_id'):
            try:
                assigned_user = User.objects.get(id=request.data.get('user_id'))
            except User.DoesNotExist:
                pass

        domain = Domain.objects.create(
            name=clean_name,
            is_ip=is_ip,
            user=assigned_user,
            check_interval_seconds=check_interval,
            custom_telegram_chat_id=custom_chat_id,
            is_monitoring=False,
            last_status='unknown'
        )

        auto_start = request.data.get('auto_start', True)
        if auto_start:
            start_monitoring_domain_thread(domain.id)
        else:
            threading.Thread(target=lambda: ping_domain_and_save(domain.id), daemon=True).start()

        return Response(DomainSerializer(domain).data, status=status.HTTP_201_CREATED)

class DomainDetailView(APIView):
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        if is_read_only_user(request):
            return Response({'error': 'Los usuarios de solo lectura no tienen permisos para modificar objetivos.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        try:
            domain = Domain.objects.get(pk=pk)
            if 'check_interval_seconds' in request.data:
                try:
                    val = int(request.data['check_interval_seconds'])
                    domain.check_interval_seconds = max(5, min(86400, val))
                except (ValueError, TypeError):
                    pass
            if 'custom_telegram_chat_id' in request.data:
                domain.custom_telegram_chat_id = str(request.data['custom_telegram_chat_id']).strip()
            if 'user_id' in request.data:
                uid = request.data['user_id']
                if uid:
                    try:
                        domain.user = User.objects.get(pk=uid)
                    except User.DoesNotExist:
                        pass
                else:
                    domain.user = None
            domain.save()
            return Response(DomainSerializer(domain).data)
        except Domain.DoesNotExist:
            return Response({'error': 'Dominio no encontrado'}, status=status.HTTP_404_NOT_FOUND)

    def put(self, request, pk):
        return self.patch(request, pk)

    def delete(self, request, pk):
        if is_read_only_user(request):
            return Response({'error': 'Los usuarios de solo lectura no tienen permisos para eliminar objetivos.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        try:
            domain = Domain.objects.get(pk=pk)
            stop_monitoring_domain(domain.id)
            domain.delete()
            return Response({'status': 'deleted', 'id': pk})
        except Domain.DoesNotExist:
            return Response({'error': 'Dominio no encontrado'}, status=status.HTTP_404_NOT_FOUND)

class DomainStartMonitorView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, pk):
        if is_read_only_user(request):
            return Response({'error': 'Los usuarios de solo lectura no tienen permisos para iniciar monitoreo.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        try:
            domain = Domain.objects.get(pk=pk)
            if pk not in monitoring_threads or monitoring_threads[pk] is None:
                start_monitoring_domain_thread(pk)
            return Response({'status': 'monitoring_started', 'id': pk, 'name': domain.name})
        except Domain.DoesNotExist:
            return Response({'error': 'Dominio no encontrado'}, status=status.HTTP_404_NOT_FOUND)

class DomainStopMonitorView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, pk):
        if is_read_only_user(request):
            return Response({'error': 'Los usuarios de solo lectura no tienen permisos para detener monitoreo.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        try:
            domain = Domain.objects.get(pk=pk)
            stop_monitoring_domain(pk)
            return Response({'status': 'monitoring_stopped', 'id': pk, 'name': domain.name})
        except Domain.DoesNotExist:
            return Response({'error': 'Dominio no encontrado'}, status=status.HTTP_404_NOT_FOUND)

class DomainCheckNowView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, pk):
        ensure_domain_table()
        try:
            domain = Domain.objects.get(pk=pk)
            check = ping_domain(domain.name)
            domain.last_status = 'online' if check['active'] else 'offline'
            domain.last_http_code = check.get('http_code') or ''
            domain.response_time_ms = check.get('response_time_ms')
            domain.last_error = check.get('error') or ''
            domain.is_ip = check.get('is_ip', False)
            domain.last_checked = timezone.now()
            if check['active']:
                domain.failed_attempts = 0
            domain.save()
            return Response(DomainSerializer(domain).data)
        except Domain.DoesNotExist:
            return Response({'error': 'Dominio no encontrado'}, status=status.HTTP_404_NOT_FOUND)

class DomainStartAllView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if is_read_only_user(request):
            return Response({'error': 'Los usuarios de solo lectura no tienen permisos para iniciar monitoreo.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        domains = Domain.objects.all()
        for domain in domains:
            if domain.id not in monitoring_threads or monitoring_threads.get(domain.id) is None:
                start_monitoring_domain_thread(domain.id)
        return Response({'status': 'all_started', 'total': domains.count()})

class DomainStopAllView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if is_read_only_user(request):
            return Response({'error': 'Los usuarios de solo lectura no tienen permisos para detener monitoreo.'}, status=status.HTTP_403_FORBIDDEN)
        ensure_domain_table()
        domains = Domain.objects.all()
        for domain in domains:
            stop_monitoring_domain(domain.id)
        return Response({'status': 'all_stopped', 'total': domains.count()})

# ==========================================
# 5.5 TELEMETRÍA DEL SISTEMA (DATOS)
# ==========================================
_public_ip_cache = {"ip": None, "timestamp": 0}

def get_cached_public_ip():
    now_t = time.time()
    if _public_ip_cache["ip"] and (now_t - _public_ip_cache["timestamp"] < 60):
        return _public_ip_cache["ip"]
    
    # Intento 1: ipify
    try:
        r = requests.get('https://api.ipify.org?format=json', timeout=2)
        if r.status_code == 200:
            ip = r.json().get('ip')
            if ip:
                _public_ip_cache["ip"] = ip
                _public_ip_cache["timestamp"] = now_t
                return ip
    except Exception:
        pass

    # Intento 2: icanhazip
    try:
        r = requests.get('https://icanhazip.com', timeout=2)
        if r.status_code == 200:
            ip = r.text.strip()
            if ip:
                _public_ip_cache["ip"] = ip
                _public_ip_cache["timestamp"] = now_t
                return ip
    except Exception:
        pass

    return _public_ip_cache["ip"] or "No disponible"


def get_primary_private_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return '127.0.0.1'
    finally:
        s.close()


def get_icmp_latency():
    try:
        start_t = time.time()
        res = subprocess.run(
            ["ping", "-c", "1", "-W", "1", "8.8.8.8"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                if 'rtt min/avg/max' in line or 'round-trip min/avg/max' in line:
                    parts = line.split('=')[1].strip().split('/')
                    if len(parts) >= 2:
                        return float(parts[1])
            return round((time.time() - start_t) * 1000, 1)
        return None
    except Exception:
        return None


def get_cpu_info():
    try:
        percent_total = psutil.cpu_percent(interval=None)
        percent_per_core = psutil.cpu_percent(interval=None, percpu=True)
        count_logical = psutil.cpu_count(logical=True) or 1
        count_physical = psutil.cpu_count(logical=False) or count_logical
        freq = psutil.cpu_freq()
        freq_current = round(freq.current, 1) if freq else None
        freq_max = round(freq.max, 1) if freq and freq.max else None
        
        load_avg = []
        try:
            load_avg = [round(x, 2) for x in os.getloadavg()]
        except Exception:
            pass

        model = platform.processor() or "Procesador Genérico"
        if os.path.exists('/proc/cpuinfo'):
            try:
                with open('/proc/cpuinfo', 'r') as f:
                    for line in f:
                        if 'model name' in line:
                            model = line.split(':', 1)[1].strip()
                            break
            except Exception:
                pass

        return {
            "model": model,
            "percent_total": percent_total,
            "percent_per_core": percent_per_core,
            "cores_logical": count_logical,
            "cores_physical": count_physical,
            "freq_current_mhz": freq_current,
            "freq_max_mhz": freq_max,
            "load_avg": load_avg
        }
    except Exception as e:
        return {"error": str(e), "percent_total": 0, "percent_per_core": []}


def get_memory_info():
    try:
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()
        buff_cache = getattr(vm, 'buffers', 0) + getattr(vm, 'cached', 0)
        return {
            "ram_total_gb": round(vm.total / (1024 ** 3), 2),
            "ram_used_gb": round(vm.used / (1024 ** 3), 2),
            "ram_available_gb": round(vm.available / (1024 ** 3), 2),
            "ram_cached_gb": round(buff_cache / (1024 ** 3), 2),
            "ram_free_gb": round(vm.free / (1024 ** 3), 2),
            "ram_percent": vm.percent,
            "swap_total_gb": round(swap.total / (1024 ** 3), 2),
            "swap_used_gb": round(swap.used / (1024 ** 3), 2),
            "swap_percent": swap.percent
        }
    except Exception as e:
        return {"error": str(e)}


def get_disk_info():
    disks = []
    try:
        partitions = psutil.disk_partitions(all=False)
        seen_mounts = set()
        for p in partitions:
            if p.mountpoint in seen_mounts or p.fstype in ('squashfs', 'iso9660', 'tmpfs', 'devtmpfs'):
                continue
            seen_mounts.add(p.mountpoint)
            try:
                usage = psutil.disk_usage(p.mountpoint)
                disks.append({
                    "device": p.device,
                    "mountpoint": p.mountpoint,
                    "fstype": p.fstype,
                    "total_gb": round(usage.total / (1024 ** 3), 2),
                    "used_gb": round(usage.used / (1024 ** 3), 2),
                    "free_gb": round(usage.free / (1024 ** 3), 2),
                    "percent": usage.percent
                })
            except (PermissionError, FileNotFoundError):
                continue
    except Exception:
        pass

    disk_io = {}
    try:
        io = psutil.disk_io_counters()
        if io:
            disk_io = {
                "read_bytes_mb": round(io.read_bytes / (1024 ** 2), 1),
                "write_bytes_mb": round(io.write_bytes / (1024 ** 2), 1),
                "read_count": io.read_count,
                "write_count": io.write_count
            }
    except Exception:
        pass

    return {
        "partitions": disks,
        "io": disk_io
    }


def get_network_info():
    interfaces = []
    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        for iface, addr_list in addrs.items():
            ipv4 = None
            netmask = None
            for a in addr_list:
                if getattr(a, 'family', None) == socket.AF_INET:
                    ipv4 = a.address
                    netmask = a.netmask
                    break
            is_up = stats.get(iface).isup if iface in stats else True
            speed = stats.get(iface).speed if iface in stats else 0
            if ipv4:
                interfaces.append({
                    "name": iface,
                    "ipv4": ipv4,
                    "netmask": netmask,
                    "is_up": is_up,
                    "speed_mbps": speed
                })
    except Exception:
        pass

    net_io = {}
    try:
        nio = psutil.net_io_counters()
        if nio:
            net_io = {
                "bytes_sent_mb": round(nio.bytes_sent / (1024 ** 2), 2),
                "bytes_recv_mb": round(nio.bytes_recv / (1024 ** 2), 2),
                "packets_sent": nio.packets_sent,
                "packets_recv": nio.packets_recv,
                "errin": nio.errin,
                "errout": nio.errout,
                "dropin": nio.dropin,
                "dropout": nio.dropout
            }
    except Exception:
        pass

    return {
        "interfaces": interfaces,
        "io": net_io
    }


def get_system_general_info():
    uptime_sec = round(time.time() - psutil.boot_time(), 0)
    days = int(uptime_sec // 86400)
    hours = int((uptime_sec % 86400) // 3600)
    minutes = int((uptime_sec % 3600) // 60)
    
    parts = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0 or days > 0:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    uptime_formatted = " ".join(parts) if parts else "< 1m"

    os_desc = platform.system()
    try:
        import distro
        os_desc = distro.name(pretty=True) or f"{platform.system()} {platform.release()}"
    except Exception:
        pass

    return {
        "hostname": socket.gethostname(),
        "fqdn": socket.getfqdn(),
        "os_name": os_desc,
        "kernel": platform.release(),
        "architecture": platform.machine(),
        "uptime_seconds": uptime_sec,
        "uptime_formatted": uptime_formatted,
        "boot_time": datetime.datetime.fromtimestamp(psutil.boot_time()).strftime('%Y-%m-%d %H:%M:%S'),
        "processes_count": len(psutil.pids()),
        "python_version": platform.python_version(),
        "server_time": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


def get_system_telemetry():
    return {
        "private_ip": get_primary_private_ip(),
        "public_ip": get_cached_public_ip(),
        "icmp_latency_ms": get_icmp_latency(),
        "cpu": get_cpu_info(),
        "memory": get_memory_info(),
        "disks": get_disk_info(),
        "network": get_network_info(),
        "system": get_system_general_info()
    }


class SystemTelemetryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = get_system_telemetry()
        icmp_val = data.get("icmp_latency_ms")
        try:
            threading.Thread(target=record_system_latency, args=(icmp_val,), daemon=True).start()
        except Exception:
            pass
        return Response(data)


class SystemLatencyHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_domain_table()
        start_latency_collector_if_needed()

        range_param = request.query_params.get('range', '20p').lower()
        now = timezone.now()

        if range_param in ('20p', '50p'):
            limit = 50 if range_param == '50p' else 20
            qs = list(SystemLatencyMetric.objects.order_by('-created_at')[:limit])
            if not qs or len(qs) < 5:
                seed_initial_latency_history()
                qs = list(SystemLatencyMetric.objects.order_by('-created_at')[:limit])
            qs.reverse()
            data_points = []
            for item in qs:
                data_points.append({
                    'timestamp': item.created_at.isoformat(),
                    'time': item.created_at.strftime('%H:%M:%S'),
                    'icmp': item.icmp_latency_ms,
                    'http': item.http_latency_ms
                })
        else:
            hours_map = {
                '1h': (1, 1),
                '6h': (6, 3),
                '12h': (12, 5),
                '24h': (24, 10),
            }
            hours, bucket_mins = hours_map.get(range_param, (24, 10))
            cutoff = now - datetime.timedelta(hours=hours)

            qs = list(SystemLatencyMetric.objects.filter(created_at__gte=cutoff).order_by('created_at'))
            if not qs or len(qs) < 10:
                seed_initial_latency_history()
                qs = list(SystemLatencyMetric.objects.filter(created_at__gte=cutoff).order_by('created_at'))

            data_points = []
            if qs:
                bucket_duration = datetime.timedelta(minutes=bucket_mins)
                bucket_start = qs[0].created_at
                bucket_icmp = []
                bucket_http = []

                for item in qs:
                    if item.created_at - bucket_start < bucket_duration:
                        if item.icmp_latency_ms is not None:
                            bucket_icmp.append(item.icmp_latency_ms)
                        if item.http_latency_ms is not None:
                            bucket_http.append(item.http_latency_ms)
                    else:
                        if bucket_icmp or bucket_http:
                            avg_i = round(sum(bucket_icmp) / len(bucket_icmp), 1) if bucket_icmp else None
                            avg_h = round(sum(bucket_http) / len(bucket_http), 1) if bucket_http else None
                            mid_time = bucket_start + (bucket_duration / 2)
                            data_points.append({
                                'timestamp': mid_time.isoformat(),
                                'time': mid_time.strftime('%H:%M'),
                                'icmp': avg_i,
                                'http': avg_h
                            })
                        bucket_start = item.created_at
                        bucket_icmp = [item.icmp_latency_ms] if item.icmp_latency_ms is not None else []
                        bucket_http = [item.http_latency_ms] if item.http_latency_ms is not None else []

                if bucket_icmp or bucket_http:
                    avg_i = round(sum(bucket_icmp) / len(bucket_icmp), 1) if bucket_icmp else None
                    avg_h = round(sum(bucket_http) / len(bucket_http), 1) if bucket_http else None
                    mid_time = bucket_start + (bucket_duration / 2)
                    data_points.append({
                        'timestamp': mid_time.isoformat(),
                        'time': mid_time.strftime('%H:%M'),
                        'icmp': avg_i,
                        'http': avg_h
                    })

        all_icmp = [p['icmp'] for p in data_points if p.get('icmp') is not None]
        all_http = [p['http'] for p in data_points if p.get('http') is not None]

        stats = {
            'avg_icmp': round(sum(all_icmp) / len(all_icmp), 1) if all_icmp else None,
            'min_icmp': min(all_icmp) if all_icmp else None,
            'max_icmp': max(all_icmp) if all_icmp else None,
            'avg_http': round(sum(all_http) / len(all_http), 1) if all_http else None,
            'min_http': min(all_http) if all_http else None,
            'max_http': max(all_http) if all_http else None,
            'total_samples': len(data_points)
        }

        return Response({
            'range': range_param,
            'stats': stats,
            'history': data_points
        })

# ==========================================
# 6. ENRUTAMIENTO (URLS)
# ==========================================
from django.urls import path, include
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')
router.register(r'agents', AgentViewSet, basename='agent')

urlpatterns = [
    path('api/system-telemetry/', SystemTelemetryView.as_view(), name='system_telemetry'),
    path('api/system-telemetry/latency-history/', SystemLatencyHistoryView.as_view(), name='system_latency_history'),
    path('api/system-branding/', SystemBrandingView.as_view(), name='system_branding'),
    path('api/ai-config/', AIConfigView.as_view(), name='ai_config'),
    path('api/email-config/', EmailConfigView.as_view(), name='email_config'),
    path('api/email-test/', EmailTestView.as_view(), name='email_test'),
    path(
        'api/telegram-preferences/',
        TelegramPreferencesView.as_view(),
        name='telegram_preferences',
    ),
    path(
        'api/telegram-test/',
        TelegramTestView.as_view(),
        name='telegram_test',
    ),
    path('api/tech-map/', TechMapView.as_view(), name='tech_map'),
    path('tech-map/', TechMapView.as_view(), name='tech_map_root'),
    path('api/domains/', DomainListView.as_view(), name='domain_list'),
    path('api/domains/<int:pk>/', DomainDetailView.as_view(), name='domain_detail'),
    path('api/domains/<int:pk>/start-monitor/', DomainStartMonitorView.as_view(), name='domain_start_monitor'),
    path('api/domains/<int:pk>/stop-monitor/', DomainStopMonitorView.as_view(), name='domain_stop_monitor'),
    path('api/domains/<int:pk>/check-now/', DomainCheckNowView.as_view(), name='domain_check_now'),
    path('api/domains/start-all/', DomainStartAllView.as_view(), name='domain_start_all'),
    path('token/', CustomLoginView.as_view(), name='token_obtain'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/mfa/verify/', MFAVerifyView.as_view(), name='mfa_verify'),
    path('api/auth/mfa/resend/', MFAResendView.as_view(), name='mfa_resend'),
    path('api/auth/sessions/', UserSessionListView.as_view(), name='user_sessions'),
    path('api/auth/sessions/<str:session_id>/revoke/', UserSessionRevokeView.as_view(), name='revoke_session'),
    path('api/auth/sessions/<str:session_id>/revoke', UserSessionRevokeView.as_view()),
    path('api/auth/sessions/<str:session_id>/authorize/', UserSessionAuthorizeView.as_view(), name='authorize_session'),
    path('api/auth/sessions/<str:session_id>/authorize', UserSessionAuthorizeView.as_view()),
    path('api/auth/sessions/revoke-others/', UserSessionRevokeOthersView.as_view(), name='revoke_other_sessions'),
    path('api/auth/trusted-accesses/', TrustedAccessListView.as_view(), name='trusted_accesses_list'),
    path('api/auth/trusted-accesses/<int:pk>/', TrustedAccessDeleteView.as_view(), name='trusted_access_delete'),
    path('api/auth/trusted-accesses/<int:pk>', TrustedAccessDeleteView.as_view()),
    path('api/security/policies/', SecurityPolicyView.as_view(), name='security_policies'),
    path('api/security/policies', SecurityPolicyView.as_view()),
    path('api/security/tor-status/', TorStatusView.as_view(), name='tor_status'),
    path('api/security/tor-status', TorStatusView.as_view()),
    path('api/security/tor-sync/', TorSyncView.as_view(), name='tor_sync'),
    path('api/security/tor-sync', TorSyncView.as_view()),
    path('api/security/tor-scan/', TorScanView.as_view(), name='tor_scan'),
    path('api/security/tor-scan', TorScanView.as_view()),
    path('api/cti/stats/', CTIStatsView.as_view(), name='cti_stats'),
    path('api/cti/stats', CTIStatsView.as_view()),
    path('api/cti/indicators/', CTIIndicatorListView.as_view(), name='cti_indicators'),
    path('api/cti/indicators', CTIIndicatorListView.as_view()),
    path('api/cti/indicators/<int:pk>/', CTIIndicatorDetailView.as_view(), name='cti_indicator_detail'),
    path('api/cti/indicators/<int:pk>', CTIIndicatorDetailView.as_view()),
    path('api/cti/sync/', CTISyncView.as_view(), name='cti_sync'),
    path('api/cti/sync', CTISyncView.as_view()),
    path('api/cti/scan/', CTIScanView.as_view(), name='cti_scan'),
    path('api/cti/scan', CTIScanView.as_view()),
    path('api/cti/hits/', CTIHitsListView.as_view(), name='cti_hits'),
    path('api/cti/hits', CTIHitsListView.as_view()),
    path('api/auth/forgot-password/', ForgotPasswordView.as_view(), name='forgot_password'),
    path('api/auth/reset-password/', ResetPasswordView.as_view(), name='reset_password'),
    path('api/auth/generate-password/', GeneratePasswordView.as_view(), name='generate_password'),
    path('agents/ping/', AgentPingView.as_view(), name='agent_ping'),
    path('logs/ingest/', LogIngestView.as_view(), name='log_ingest'),
    path('logs/', LogListView.as_view(), name='log_list'),
    path('api/agents/installer/', AgentInstallerScriptView.as_view(), name='agent_installer_script'),
    path('agents/installer/', AgentInstallerScriptView.as_view()),
    path('install.sh', AgentInstallerScriptView.as_view(), name='agent_install_sh'),
    path('api/', include(router.urls)),
    path('', include(router.urls)),
]

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()

# ==========================================
# 7. SCRIPT DE INICIO (AUTO-MIGRACIÓN)
# ==========================================
if _is_direct_entrypoint:
    # Asegurar que la base de datos MySQL exista antes de esto
    if len(sys.argv) == 1:
        print("🛠️ Configurando base de datos y migraciones...")
        # Generar migraciones para los modelos definidos en este archivo
        try:
            call_command('makemigrations', '__main__', interactive=False)
        except Exception as e:
            print(f"ℹ️ [makemigrations]: {e}")
        # Aplicar migraciones a MySQL
        try:
            call_command('migrate', interactive=False, fake_initial=True)
        except Exception as e:
            print(f"ℹ️ [migrate fake_initial]: {e}")
            try:
                call_command('migrate', interactive=False)
            except Exception as e2:
                print(f"ℹ️ [migrate fallback]: {e2}")
        
        # Crear usuario administrador si no existe
        init_user = os.environ.get('INITIAL_ADMIN_USER', 'admin').strip()
        init_pass = os.environ.get('INITIAL_ADMIN_PASSWORD', 'admin123').strip()
        init_email = os.environ.get('INITIAL_ADMIN_EMAIL', '').strip()

        if not User.objects.filter(username=init_user).exists():
            admin_user = User.objects.create_user(username=init_user, password=init_pass, email=init_email)
            UserProfile.objects.create(user=admin_user, role='admin')
            print(f"✅ Usuario Administrador inicial creado ({init_user} / {init_pass})")
            if init_email:
                print(f"📧 Correo inicial asignado: {init_email}")
        
        # Iniciar el servidor local de desarrollo
        print("🚀 Iniciando Django REST Server en el puerto 8000...")
        sys.argv.append('runserver')
        sys.argv.append('0.0.0.0:8000')
    
    # Ejecutar Django CLI
    execute_from_command_line(sys.argv)