import React, { useState, useEffect, useRef } from 'react';
import { translations } from './i18n';
import { Shield, Server, Users, Activity, LogOut, Search, AlertTriangle, Lock, Unlock, Plus, RefreshCw, Terminal, Menu, X, Bell, Download, FileText, Copy, Calendar, PieChart as PieChartIcon, Eye, EyeOff, LayoutGrid, List, Globe, Satellite, Radio, Compass, ExternalLink, MapPin, Layers, Target, Crosshair, ShieldAlert, Cpu, Info, Check, Play, Square, Trash2, CheckCircle2, XCircle, Clock, Sliders, Send, Mail, Key, ArrowLeft, Building2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, HardDrive, Wifi, Pause, Zap, Network, Sparkles, ShieldCheck, Laptop, Smartphone, Tablet, Monitor, Plane, Database, Bug, Flame, Filter, Link2, Maximize2, Minimize2, ZoomIn, ZoomOut, Navigation } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import InteractiveBackground from './InteractiveBackground';

const SERVER_NAME = "SOC-NODE-01";
const USE_MOCK = false;
const API_URL = '';

// Helpers de persistencia dual (LocalStorage + Cookies HTTP/HTTPS de 24 horas)
// Garantiza que la sesión de 24 horas no se pierda al actualizar en Chrome en celulares,
// restaurar pestañas cerradas o por recargas pull-to-refresh.
const AUTH_COOKIE_NAME = 'soc_token';
const AUTH_ROLE_COOKIE = 'soc_role';
const AUTH_SESSION_COOKIE = 'soc_session_token';
const AUTH_REFRESH_COOKIE = 'soc_refresh_token';
const AUTH_LOGIN_TIME = 'soc_login_time';
const MAX_SESSION_AGE_SECONDS = 86400; // 24 horas exactas

const setCookie = (name, value, seconds = MAX_SESSION_AGE_SECONDS) => {
  try {
    const expires = new Date(Date.now() + seconds * 1000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (_) { }
};

const getCookie = (name) => {
  try {
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
  } catch (_) {
    return null;
  }
};

const deleteCookie = (name) => {
  try {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
  } catch (_) { }
};

const clearStoredAuth = () => {
  try {
    localStorage.removeItem('soc_token');
    localStorage.removeItem('soc_role');
    localStorage.removeItem('soc_session_token');
    localStorage.removeItem('soc_refresh_token');
    localStorage.removeItem(AUTH_LOGIN_TIME);
  } catch (_) { }

  deleteCookie(AUTH_COOKIE_NAME);
  deleteCookie(AUTH_ROLE_COOKIE);
  deleteCookie(AUTH_SESSION_COOKIE);
  deleteCookie(AUTH_REFRESH_COOKIE);
  deleteCookie(AUTH_LOGIN_TIME);
};

const getStoredAuth = () => {
  try {
    let token = null;
    let role = null;
    let sessionToken = null;
    let refreshToken = null;
    let loginTime = null;

    try {
      token = localStorage.getItem('soc_token');
      role = localStorage.getItem('soc_role');
      sessionToken = localStorage.getItem('soc_session_token');
      refreshToken = localStorage.getItem('soc_refresh_token');
      loginTime = localStorage.getItem(AUTH_LOGIN_TIME);
    } catch (_) { }

    // Fallback a Cookie si localStorage estuviese inaccesible o vacío en el móvil
    if (!token) token = getCookie(AUTH_COOKIE_NAME);
    if (!role) role = getCookie(AUTH_ROLE_COOKIE);
    if (!sessionToken) sessionToken = getCookie(AUTH_SESSION_COOKIE);
    if (!refreshToken) refreshToken = getCookie(AUTH_REFRESH_COOKIE);
    if (!loginTime) loginTime = getCookie(AUTH_LOGIN_TIME);

    // Verificar ventana de expiración de 24 horas del sistema
    if (loginTime) {
      const elapsed = Date.now() - parseInt(loginTime, 10);
      if (elapsed > MAX_SESSION_AGE_SECONDS * 1000) {
        clearStoredAuth();
        return { token: null, role: null, sessionToken: null, refreshToken: null };
      }
    }

    // Auto-sincronizar ambos almacenamientos para máxima persistencia
    if (token) {
      if (!loginTime) loginTime = String(Date.now());
      try {
        localStorage.setItem('soc_token', token);
        if (role) localStorage.setItem('soc_role', role);
        if (sessionToken) localStorage.setItem('soc_session_token', sessionToken);
        if (refreshToken) localStorage.setItem('soc_refresh_token', refreshToken);
        localStorage.setItem(AUTH_LOGIN_TIME, loginTime);
      } catch (_) { }

      setCookie(AUTH_COOKIE_NAME, token);
      if (role) setCookie(AUTH_ROLE_COOKIE, role);
      if (sessionToken) setCookie(AUTH_SESSION_COOKIE, sessionToken);
      if (refreshToken) setCookie(AUTH_REFRESH_COOKIE, refreshToken);
      setCookie(AUTH_LOGIN_TIME, loginTime);
    }

    return { token: token || null, role: role || null, sessionToken: sessionToken || null, refreshToken: refreshToken || null };
  } catch (_) {
    return { token: null, role: null, sessionToken: null, refreshToken: null };
  }
};

const saveStoredAuth = ({ token, role, sessionToken, refreshToken }) => {
  const now = String(Date.now());
  try {
    if (token) localStorage.setItem('soc_token', token);
    if (role) localStorage.setItem('soc_role', role);
    if (sessionToken) localStorage.setItem('soc_session_token', sessionToken);
    if (refreshToken) localStorage.setItem('soc_refresh_token', refreshToken);
    localStorage.setItem(AUTH_LOGIN_TIME, now);
  } catch (_) { }

  if (token) setCookie(AUTH_COOKIE_NAME, token);
  if (role) setCookie(AUTH_ROLE_COOKIE, role);
  if (sessionToken) setCookie(AUTH_SESSION_COOKIE, sessionToken);
  if (refreshToken) setCookie(AUTH_REFRESH_COOKIE, refreshToken);
  setCookie(AUTH_LOGIN_TIME, now);
};

let isRefreshing = false;
let refreshSubscribers = [];
const subscribeTokenRefresh = (cb) => { refreshSubscribers.push(cb); };
const onRefreshed = (newToken) => {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
};

const apiFetch = async (endpoint, options = {}, token = null) => {
  const auth = getStoredAuth();
  const effectiveToken = token || auth.token;
  const effectiveSessionToken = auth.sessionToken;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (effectiveToken) headers['Authorization'] = `Bearer ${effectiveToken}`;
  if (effectiveSessionToken) headers['X-Session-Token'] = effectiveSessionToken;

  let response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  } catch (err) {
    // Los fallos de red momentáneos en celulares (cambio de antena o wifi)
    // NO deben desconectar la sesión del usuario.
    throw err;
  }

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(text || `API Error: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  if (!response.ok) {
    // Manejo de expiración 401 con intento transparente de Token Refresh
    if (response.status === 401 && effectiveToken && !endpoint.includes('/token/') && !endpoint.includes('/api/auth/mfa/')) {
      if (auth.refreshToken) {
        if (!isRefreshing) {
          isRefreshing = true;
          try {
            const refreshResp = await fetch(`${API_URL}/api/token/refresh/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh: auth.refreshToken })
            });
            if (refreshResp.ok) {
              const refreshData = await refreshResp.json();
              if (refreshData.access) {
                saveStoredAuth({
                  token: refreshData.access,
                  role: auth.role,
                  sessionToken: auth.sessionToken,
                  refreshToken: refreshData.refresh || auth.refreshToken
                });
                isRefreshing = false;
                onRefreshed(refreshData.access);
                // Reintentar la llamada original con el nuevo token
                headers['Authorization'] = `Bearer ${refreshData.access}`;
                const retryResp = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
                if (retryResp.ok) {
                  const retryType = retryResp.headers.get('content-type') || '';
                  if (retryType.includes('application/json')) return await retryResp.json().catch(() => null);
                  return null;
                }
              }
            }
          } catch (_) { }
          isRefreshing = false;
        } else {
          // Esperar a que la primera petición complete el refresco
          return new Promise((resolve, reject) => {
            subscribeTokenRefresh(async (newToken) => {
              try {
                headers['Authorization'] = `Bearer ${newToken}`;
                const retryResp = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
                if (retryResp.ok) {
                  const retryType = retryResp.headers.get('content-type') || '';
                  if (retryType.includes('application/json')) resolve(await retryResp.json().catch(() => null));
                  else resolve(null);
                } else {
                  reject(new Error(`API Error: ${retryResp.status}`));
                }
              } catch (e) {
                reject(e);
              }
            });
          });
        }
      }

      // Si no es posible refrescar y es un endpoint privado, expirar sesión
      if (!endpoint.includes('/system-branding/')) {
        clearStoredAuth();
        window.dispatchEvent(new Event('soc_auth_expired'));
      }
    }

    const err = new Error(data?.detail || data?.message || `API Error: ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary detectó un error no capturado:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 panel my-4 text-center">
          <AlertTriangle className="w-12 h-12 text-rose-500 mb-4" />
          <h3 className="text-lg font-semibold text-theme-main mb-2">Error al cargar este módulo</h3>
          <p className="text-sm text-theme-muted mb-4 max-w-md">
            {this.state.error?.message || "Ocurrió un error inesperado al renderizar la vista."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const safeFormatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const formattedStr = typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T')
      ? dateStr.replace(' ', 'T')
      : dateStr;
    const d = new Date(formattedStr);
    return isNaN(d.getTime()) ? String(dateStr) : d.toLocaleString(undefined, { hour12: false });
  } catch (e) {
    return String(dateStr);
  }
};

// Helper para generar contraseñas seguras y criptográficamente robustas
export const generateSecurePassword = (length = 16) => {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // omite I, O confusos
  const lower = "abcdefghjkmnpqrstuvwxyz"; // omite l, o confusos
  const numbers = "23456789"; // omite 0, 1 confusos
  const symbols = "!@#$%^&*()_+-=[]{}|;:?";
  const all = upper + lower + numbers + symbols;

  const pwd = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)]
  ];

  for (let i = 4; i < length; i++) {
    pwd.push(all[Math.floor(Math.random() * all.length)]);
  }

  return pwd.sort(() => Math.random() - 0.5).join('');
};

export const getPasswordStrength = (pwd) => {
  if (!pwd) return { score: 0, label: 'Vacía', color: 'bg-slate-700', text: 'text-slate-500' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]/.test(pwd)) score++;

  if (score <= 2) return { score: 1, label: 'Muy Débil', color: 'bg-rose-500', text: 'text-rose-400' };
  if (score <= 4) return { score: 2, label: 'Media', color: 'bg-amber-500', text: 'text-amber-400' };
  if (score === 5) return { score: 3, label: 'Fuerte', color: 'bg-indigo-500', text: 'text-indigo-400' };
  return { score: 4, label: 'Excelente / Muy Segura', color: 'bg-emerald-500', text: 'text-emerald-400' };
};

export const validatePasswordCriteria = (pwd) => {
  if (!pwd || pwd.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[A-Z]/.test(pwd)) return "La contraseña debe incluir al menos una letra mayúscula (A-Z).";
  if (!/[a-z]/.test(pwd)) return "La contraseña debe incluir al menos una letra minúscula (a-z).";
  if (!/\d/.test(pwd)) return "La contraseña debe incluir al menos un número (0-9).";
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]/.test(pwd)) return "La contraseña debe incluir al menos un carácter especial (ej. !@#$%&*).";
  return null;
};

function SecurePasswordField({
  value,
  onChange,
  label = "Contraseña",
  placeholder = "••••••••",
  required = false,
  helpText = null,
  showStrength = true,
  suggestButton = true,
  onGenerate = null,
  autoComplete = "new-password",
  className = "",
  id = undefined,
  name = undefined,
  t = null
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    const pwd = generateSecurePassword(16);
    onChange(pwd);
    if (onGenerate) onGenerate(pwd);
    setShowPassword(true);
    navigator.clipboard.writeText(pwd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const strength = getPasswordStrength(value);

  const hasMinLen = (value || '').length >= 8;
  const hasUpper = /[A-Z]/.test(value || '');
  const hasLower = /[a-z]/.test(value || '');
  const hasNumber = /\d/.test(value || '');
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/~`]/.test(value || '');

  const getStrengthLabel = () => {
    if (!t) return strength.label;
    if (strength.score === 1) return t("weak") || "Muy Débil";
    if (strength.score === 2) return t("medium") || "Media";
    if (strength.score === 3) return t("strong") || "Fuerte";
    return t("veryStrong") || "Excelente / Muy Segura";
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-theme-muted" htmlFor={id}>
          {label} {helpText && <span className="text-[11px] text-slate-500">{helpText}</span>}
        </label>
        {suggestButton && (
          <button
            type="button"
            onClick={handleGenerate}
            className="flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors py-0.5 px-2 rounded-md hover:bg-indigo-500/10 border border-indigo-500/20 active:scale-95"
            title={t ? (t("suggestSecureTitle") || "Generar y sugerir una contraseña segura de 16 caracteres") : "Generar y sugerir una contraseña segura de 16 caracteres"}
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>{t ? (t("suggestSecure") || "Sugerir segura") : "Sugerir segura"}</span>
          </button>
        )}
      </div>

      <div className="relative">
        <input
          id={id}
          name={name}
          type={showPassword ? "text" : "password"}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          data-lpignore="true"
          data-form-type="other"
          className="w-full input-field py-2.5 pl-3 pr-20 text-sm text-theme-main font-mono"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              title={t ? (t("copyPassword") || "Copiar contraseña") : "Copiar contraseña"}
              className="p-1.5 text-theme-muted hover:text-theme-main transition-colors rounded"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            title={showPassword ? (t ? (t("hidePassword") || "Ocultar") : "Ocultar") : (t ? (t("showPassword") || "Mostrar") : "Mostrar")}
            className="p-1.5 text-theme-muted hover:text-theme-main transition-colors rounded"
          >
            {showPassword ? <EyeOff className="w-4 h-4 text-slate-400" /> : <Eye className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>

      {copied && (
        <p className="text-[11px] text-emerald-400 font-medium animate-fade-in flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 shrink-0" /> {t ? (t("passwordCopied") || "¡Contraseña generada y copiada al portapapeles!") : "¡Contraseña generada y copiada al portapapeles!"}
        </p>
      )}

      {showStrength && (
        <div className="space-y-1.5 pt-1 animate-fade-in">
          {value ? (
            <>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-theme-muted">{t ? (t("securityLevel") || "Nivel de seguridad:") : "Nivel de seguridad:"}</span>
                <span className={`font-semibold ${strength.text}`}>{getStrengthLabel()}</span>
              </div>

              <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full">
                <div className={`h-full rounded-full transition-all duration-300 ${strength.score >= 1 ? strength.color : 'bg-slate-700/50'}`} />
                <div className={`h-full rounded-full transition-all duration-300 ${strength.score >= 2 ? strength.color : 'bg-slate-700/50'}`} />
                <div className={`h-full rounded-full transition-all duration-300 ${strength.score >= 3 ? strength.color : 'bg-slate-700/50'}`} />
                <div className={`h-full rounded-full transition-all duration-300 ${strength.score >= 4 ? strength.color : 'bg-slate-700/50'}`} />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-theme-muted">
              <span>{t ? (t("securePasswordCriteria") || "Criterios de contraseña segura:") : "Criterios de contraseña segura:"}</span>
              <span className="text-[10px] text-indigo-400 font-medium">{t ? (t("requiredBadge") || "Requeridos") : "Requeridos"}</span>
            </div>
          )}

          {/* Checklist de requisitos de seguridad interactivo */}
          <div className="grid grid-cols-2 gap-1 pt-0.5 text-[10px]">
            <span className={`flex items-center gap-1 transition-colors ${hasMinLen ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
              {hasMinLen ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <span className="w-3 h-3 flex items-center justify-center text-slate-500">○</span>} {t ? (t("min8Chars") || "Mín. 8 caracteres") : "Mín. 8 caracteres"}
            </span>
            <span className={`flex items-center gap-1 transition-colors ${hasUpper && hasLower ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
              {hasUpper && hasLower ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <span className="w-3 h-3 flex items-center justify-center text-slate-500">○</span>} {t ? (t("upperAndLower") || "Mayúscula y minúscula") : "Mayúscula y minúscula"}
            </span>
            <span className={`flex items-center gap-1 transition-colors ${hasNumber ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
              {hasNumber ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <span className="w-3 h-3 flex items-center justify-center text-slate-500">○</span>} {t ? (t("numberCriteria") || "Al menos un número (0-9)") : "Al menos un número (0-9)"}
            </span>
            <span className={`flex items-center gap-1 transition-colors ${hasSpecial ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
              {hasSpecial ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <span className="w-3 h-3 flex items-center justify-center text-slate-500">○</span>} {t ? (t("specialCriteria") || "Símbolo (!@#$%&*...)") : "Símbolo (!@#$%&*...)"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Fallback mock data in case the server is offline but USE_MOCK is accidentally forced
const mockLogs = [
  { id: 1, server: 'IP-172-31-6-18', criticality: 'CRITICA', message: 'Fallo en la conexión.', timestamp: '2026-06-29 10:45:00' }
];

export default function App() {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('soc_lang') || 'es';
    } catch (_) {
      return 'es';
    }
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastLogId, setLastLogId] = useState(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('soc_theme') || 'dark';
    } catch (_) {
      return 'dark';
    }
  });
  const t = (key) => (translations[lang] && translations[lang][key]) || (translations['es'] && translations['es'][key]) || key;

  useEffect(() => {
    try {
      localStorage.setItem('soc_lang', lang);
    } catch (_) { }
  }, [lang]);

  useEffect(() => {
    try {
      localStorage.setItem('soc_theme', theme);
    } catch (_) { }
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [theme]);

  const [token, setToken] = useState(() => getStoredAuth().token);
  const [role, setRole] = useState(() => getStoredAuth().role);
  const [currentView, setCurrentView] = useState(() => {
    try {
      return localStorage.getItem('soc_current_view') || 'dashboard';
    } catch (_) {
      return 'dashboard';
    }
  });

  const mainScrollRef = useRef(null);

  // Asegurar que al cambiar de vista o navegar en el menú siempre inicie arriba de todo
  useEffect(() => {
    const scrollToTop = () => {
      if (mainScrollRef.current) {
        mainScrollRef.current.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        mainScrollRef.current.scrollTop = 0;
      }
      const scrollEl = document.getElementById('soc-main-scroll');
      if (scrollEl) {
        scrollEl.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        scrollEl.scrollTop = 0;
      }
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    scrollToTop();
    const t1 = setTimeout(scrollToTop, 20);
    const t2 = setTimeout(scrollToTop, 80);
    const t3 = setTimeout(scrollToTop, 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [currentView]);

  useEffect(() => {
    try {
      if (currentView) localStorage.setItem('soc_current_view', currentView);
    } catch (_) { }
  }, [currentView]);

  useEffect(() => {
    const handleAuthExpired = () => {
      clearStoredAuth();
      setToken(null);
      setRole(null);
    };
    window.addEventListener('soc_auth_expired', handleAuthExpired);
    return () => window.removeEventListener('soc_auth_expired', handleAuthExpired);
  }, []);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [setupNotice, setSetupNotice] = useState('');
  const [branding, setBranding] = useState({
    company_name: '',
    custom_welcome_text: '',
    welcome_text: ''
  });

  const fetchBranding = async () => {
    try {
      const data = await apiFetch('/api/system-branding/');
      if (data) {
        setBranding(data);
        try {
          localStorage.setItem('soc_branding', JSON.stringify(data));
        } catch (_) { }
      }
    } catch (e) {
      try {
        const cached = localStorage.getItem('soc_branding');
        if (cached) setBranding(JSON.parse(cached));
      } catch (_) { }
    }
  };

  useEffect(() => {
    try {
      const cached = localStorage.getItem('soc_branding');
      if (cached) setBranding(JSON.parse(cached));
    } catch (_) { }
    fetchBranding();
  }, []);

  useEffect(() => {
    if (!token) return;
    const checkNewLogs = async () => {
      try {
        const data = await apiFetch('/logs/', {}, token);
        const logsList = Array.isArray(data) ? data : (data?.results || []);
        if (logsList.length > 0) {
          const validIds = logsList.map(l => l.id).filter(id => typeof id === 'number' && !isNaN(id));
          if (validIds.length > 0) {
            const maxId = Math.max(...validIds);
            setLastLogId(prevId => {
              if (prevId !== null && maxId > prevId && currentView !== 'dashboard') {
                const newLogs = logsList.filter(l => l.id > prevId).length;
                setUnreadCount(prevCount => prevCount + newLogs);
              }
              return maxId;
            });
          }
        }
      } catch (e) { }
    };

    checkNewLogs();
    const interval = setInterval(checkNewLogs, 10000);
    return () => clearInterval(interval);
  }, [token, currentView]);

  // Si abrimos el dashboard, limpiamos las notificaciones
  useEffect(() => {
    if (currentView === 'dashboard') setUnreadCount(0);
  }, [currentView]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogin = async (username, password) => {
    if (USE_MOCK) {
      if (username && password) {
        setToken('mock-jwt-token');
        setRole('admin');
        saveStoredAuth({
          token: 'mock-jwt-token',
          role: 'admin',
          sessionToken: 'mock-session-token',
          refreshToken: 'mock-refresh-token'
        });
        return { success: true };
      }
      return { success: false, error: 'Credenciales inválidas.' };
    }

    try {
      const data = await apiFetch('/token/', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      if (data.mfa_required) {
        return {
          success: false,
          mfa_required: true,
          mfa_token: data.mfa_token,
          email_masked: data.email_masked,
          message: data.message
        };
      }
      setToken(data.access_token);
      setRole(data.role);
      saveStoredAuth({
        token: data.access_token,
        role: data.role,
        sessionToken: data.session_token,
        refreshToken: data.refresh_token
      });
      if (data.initial_setup_required) {
        setSetupNotice(data.setup_warning || 'Primer inicio: Configure un servidor SMTP en Ajustes y asigne su correo electrónico para activar la protección MFA obligatoria.');
      } else {
        setSetupNotice('');
      }
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e.message || 'Error de conexión con el backend.',
        remainingSeconds: e.data?.remaining_seconds,
        lockedUntil: e.data?.locked_until,
        failedAttempts: e.data?.failed_attempts,
        status: e.status
      };
    }
  };

  const handleMFAVerify = async (mfa_token, code) => {
    try {
      const data = await apiFetch('/api/auth/mfa/verify/', {
        method: 'POST',
        body: JSON.stringify({ mfa_token, code })
      });
      setToken(data.access_token);
      setRole(data.role);
      saveStoredAuth({
        token: data.access_token,
        role: data.role,
        sessionToken: data.session_token,
        refreshToken: data.refresh_token
      });
      setSetupNotice('');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message || 'Código incorrecto o expirado.' };
    }
  };

  const handleMFAResend = async (mfa_token) => {
    try {
      const data = await apiFetch('/api/auth/mfa/resend/', {
        method: 'POST',
        body: JSON.stringify({ mfa_token })
      });
      return { success: true, message: data.message, email_masked: data.email_masked };
    } catch (e) {
      return { success: false, error: e.message || 'Error al reenviar el código.' };
    }
  };

  const handleLogout = () => {
    clearStoredAuth();
    try {
      localStorage.removeItem('soc_current_view');
    } catch (e) { }
    setSetupNotice('');
    setToken(null);
    setRole(null);
  };

  if (!token) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onMFAVerify={handleMFAVerify}
        onMFAResend={handleMFAResend}
        t={t}
        lang={lang}
        setLang={setLang}
        branding={branding}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Overlay for mobile menu */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-theme-main/80 backdrop-blur-sm z-40 lg:hidden transition-all"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 sidebar-panel flex flex-col transform transition-transform duration-300 ease-in-out
        lg:relative lg:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-700 shadow-lg shadow-indigo-500/40 shrink-0 border border-indigo-400/30">
              <Shield className="w-6 h-6 text-indigo-100 absolute" strokeWidth={1.5} />
              <Activity className="w-3 h-3 text-white absolute" strokeWidth={3} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-blue-500 tracking-tight leading-none mt-1">AgentSOC</span>
              <span className="text-[14px] font-bold text-slate-500 tracking-widest mt-0.5 truncate max-w-[130px]" title={branding?.company_name || 'RaspGuardGC'}>
                {branding?.company_name?.trim() ? branding.company_name.trim() : 'RaspGuardGC'}
              </span>
            </div>
          </div>
          <button className="lg:hidden text-theme-muted hover:text-theme-main" onClick={() => setMobileMenuOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 text-xs font-semibold text-theme-muted uppercase tracking-wider mb-2 mt-4">{t("mainMenu") || "Menú Principal"}</p>
          <MenuButton
            id="dashboard" icon={Activity} label={t("dashboard")}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />
          <MenuButton
            id="agents" icon={Server} label={t("nodes")}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />
          <MenuButton
            id="reports" icon={FileText} label={t("reports")}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />
          <MenuButton
            id="techmap" icon={Globe} label={t("techMap") || "Mapa Tecnológico"}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />
          <MenuButton
            id="domains" icon={Radio} label={t("domains") || "Dominios"}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />
          <MenuButton
            id="system_data" icon={Activity} label={t("systemData") || "Datos"}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />
          <MenuButton
            id="cti" icon={Crosshair} label={t("ctiMenu") || "Ciberinteligencia & IOCs (CTI)"}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />

          {role === 'admin' && (
            <>
              <p className="px-3 text-xs font-semibold text-theme-muted uppercase tracking-wider mb-2 mt-8">{t("admin") || "Administración"}</p>
              <MenuButton
                id="users" icon={Users} label={t("iam")}
                currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
              />
              <MenuButton
                id="security" icon={ShieldCheck} label={t("securitySessions") || "Seguridad y Sesiones"}
                currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
              />
            </>
          )}
          <MenuButton
            id="settings" icon={Menu} label={t("settings")}
            currentView={currentView} setView={setCurrentView} setMobileMenuOpen={setMobileMenuOpen}
          />
        </nav>

        <div className="p-4 border-t border-theme-light">
          <div className="flex items-center gap-3 px-3 py-3 mb-2">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
              <span className="text-sm font-bold text-theme-main">{(role || 'U')[0].toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-theme-main truncate capitalize">{t("operator")}: {role}</p>
              <p className="text-xs text-theme-muted truncate">{t("online")}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3 text-theme-muted hover:text-theme-main hover:bg-slate-500/10 rounded-xl transition-colors w-full">
            <LogOut className="w-4 h-4" />
            <span className="text-sm font-medium">{t("logout")}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 z-10">
        <header className="h-16 px-6 lg:px-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button className="lg:hidden p-2 -ml-2 text-theme-muted hover:text-theme-main" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <form role="search" onSubmit={(e) => e.preventDefault()} autoComplete="off" className="hidden sm:flex items-center gap-2 bg-theme-panel border border-theme-light px-4 py-2 rounded-full">
              <Search className="w-4 h-4 text-theme-muted shrink-0" />
              <input
                type="search"
                name="soc_events_search_query"
                id="soc_events_search_query"
                role="searchbox"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck="false"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                readOnly
                onMouseDown={(e) => e.target.removeAttribute('readonly')}
                onFocus={(e) => e.target.removeAttribute('readonly')}
                onBlur={(e) => { if (!e.target.value) e.target.setAttribute('readonly', 'true'); }}
                value={globalSearch}
                onChange={(e) => {
                  setGlobalSearch(e.target.value);
                  if (e.target.value && currentView !== 'dashboard') setCurrentView('dashboard');
                }}
                placeholder="Search events..."
                className="bg-transparent border-none outline-none text-sm text-theme-main w-48"
              />
            </form>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentView('dashboard')}
              className="relative p-2 text-theme-muted hover:text-theme-main transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <div id="soc-main-scroll" ref={mainScrollRef} className="flex-1 overflow-y-auto p-4 lg:p-10">
          <div className="w-full max-w-7xl mx-auto space-y-6 pb-24">
            {setupNotice && role === 'admin' && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-amber-950/20">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 border border-amber-500/30">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-theme-main">Configuración Inicial Requerida: MFA Temporalmente Inactivo</p>
                    <p className="text-xs text-theme-muted mt-0.5">{setupNotice}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setCurrentView('settings')}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors shadow-sm"
                  >
                    Configurar Correo y SMTP
                  </button>
                  <button
                    onClick={() => setSetupNotice('')}
                    className="p-1.5 text-theme-muted hover:text-theme-main rounded-lg"
                    title="Ocultar advertencia"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <ErrorBoundary>
              {currentView === 'dashboard' && <LogsView token={token} t={t} searchQuery={globalSearch} role={role} />}
              {currentView === 'agents' && <AgentsView role={role} token={token} t={t} />}
              {currentView === 'reports' && <ReportsView token={token} t={t} />}
              {currentView === 'techmap' && <TechMapView token={token} t={t} theme={theme} />}
              {currentView === 'domains' && <DomainsView token={token} t={t} theme={theme} role={role} />}
              {currentView === 'system_data' && <SystemDataView token={token} t={t} theme={theme} role={role} />}
              {currentView === 'cti' && <CTIView role={role} token={token} t={t} theme={theme} setView={setCurrentView} />}
              {currentView === 'users' && <UsersView role={role} token={token} t={t} />}
              {currentView === 'security' && <SecurityView role={role} token={token} t={t} setView={setCurrentView} />}
              {currentView === 'settings' && (
                <SettingsView
                  token={token}
                  t={t}
                  lang={lang}
                  setLang={setLang}
                  theme={theme}
                  setTheme={setTheme}
                  role={role}
                  branding={branding}
                  onBrandingUpdated={fetchBranding}
                />
              )}
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}

function MenuButton({ id, icon: Icon, label, currentView, setView, setMobileMenuOpen }) {
  const active = currentView === id;
  return (
    <button
      onClick={() => {
        setView(id);
        setMobileMenuOpen(false);
        const scrollEl = document.getElementById('soc-main-scroll');
        if (scrollEl) {
          scrollEl.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          scrollEl.scrollTop = 0;
        }
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
        ${active
          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20'
          : 'text-theme-muted hover:text-theme-main hover:bg-slate-500/10'}
      `}
    >
      <Icon className={`w-5 h-5 ${active ? 'text-theme-main' : ''}`} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

const getPageNumbers = (current, total) => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [];
  if (current <= 3) {
    pages.push(1, 2, 3, 4, '...', total);
  } else if (current >= total - 2) {
    pages.push(1, '...', total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, '...', current - 1, current, current + 1, '...', total);
  }
  return pages;
};

function LogsView({ token, t, searchQuery = '', role = 'admin' }) {
  const [logs, setLogs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [filterServer, setFilterServer] = useState('');
  const [filterCrit, setFilterCrit] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState(null);

  // Estados de paginación
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [serverStats, setServerStats] = useState({ critical: 0, high: 0 });

  // Selección y eliminación de logs
  const [selectedLogIds, setSelectedLogIds] = useState([]);
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { type, title, message }
  const [actionLoading, setActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Debounce para búsquedas de texto y filtros
  const [debouncedServer, setDebouncedServer] = useState(filterServer);
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedServer(filterServer);
    }, 300);
    return () => clearTimeout(handler);
  }, [filterServer]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Reiniciar a la página 1 cuando se cambie un filtro o el tamaño de página
  useEffect(() => {
    setCurrentPage(1);
    setSelectedLogIds([]);
  }, [debouncedServer, debouncedSearch, filterCrit, pageSize]);

  const toggleExpand = (id) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  // Selección individual
  const toggleSelectLog = (id, e) => {
    e.stopPropagation();
    setSelectedLogIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Selección de toda la página
  const isAllPageSelected = logs.length > 0 && logs.every(l => selectedLogIds.includes(l.id));
  const toggleSelectAllPage = () => {
    if (isAllPageSelected) {
      const pageIds = new Set(logs.map(l => l.id));
      setSelectedLogIds(prev => prev.filter(id => !pageIds.has(id)));
    } else {
      const newIds = new Set([...selectedLogIds, ...logs.map(l => l.id)]);
      setSelectedLogIds(Array.from(newIds));
    }
  };

  useEffect(() => {
    let isMounted = true;
    const fetchLogs = async (showLoading = true) => {
      if (showLoading) setLoading(true);
      try {
        const params = new URLSearchParams();
        params.append('page', currentPage);
        params.append('page_size', pageSize);
        if (filterCrit) params.append('criticidad', filterCrit);
        if (debouncedServer) params.append('server', debouncedServer);
        if (debouncedSearch) params.append('search', debouncedSearch);

        const [logsData, agentsData] = await Promise.all([
          apiFetch(`/logs/?${params.toString()}`, {}, token),
          apiFetch(`/agents/`, {}, token)
        ]);

        if (!isMounted) return;

        if (logsData && typeof logsData === 'object' && !Array.isArray(logsData)) {
          setLogs(Array.isArray(logsData.results) ? logsData.results : []);
          setTotalCount(logsData.count || 0);
          setTotalPages(logsData.total_pages || 1);
          setServerStats({
            critical: logsData.critical_count || 0,
            high: logsData.high_count || 0
          });
        } else if (Array.isArray(logsData)) {
          setLogs(logsData);
          setTotalCount(logsData.length);
          setTotalPages(1);
        }
        setAgents(Array.isArray(agentsData) ? agentsData : []);
      } catch (e) {
        console.error("Error fetching logs:", e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchLogs(true);
    const interval = setInterval(() => fetchLogs(false), 10000); // Auto-refresh silencioso
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [token, currentPage, pageSize, filterCrit, debouncedServer, debouncedSearch, refreshTrigger]);

  const executeDelete = async (action) => {
    setActionLoading(true);
    try {
      let body = {};
      if (action.type === 'selected') {
        body = { ids: selectedLogIds };
      } else if (action.type === 'info') {
        body = { criticidad: 'INFO' };
      } else if (action.type === 'info_low') {
        body = { criticidad_in: ['INFO', 'BAJA'] };
      } else if (action.type === 'all') {
        body = { all: true };
      }

      const res = await apiFetch('/logs/', {
        method: 'DELETE',
        body: JSON.stringify(body)
      }, token);

      setToastMessage(res?.message || t("eventsDeletedSuccess"));
      setSelectedLogIds([]);
      setConfirmAction(null);
      setShowPurgeModal(false);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      alert(err.message || "Error al eliminar eventos.");
    } finally {
      setActionLoading(false);
    }
  };

  const getCritStyle = (crit) => {
    const styles = {
      'CRITICA': 'text-theme-danger bg-rose-500/10',
      'ALTA': 'text-theme-warning bg-orange-500/10',
      'MEDIA': 'text-theme-warning bg-amber-500/10',
      'BAJA': 'text-theme-success bg-emerald-500/10',
      'INFO': 'text-theme-info bg-blue-500/10'
    };
    return styles[crit] || styles['INFO'];
  };

  const activeNodesCount = agents.filter(a => a.is_truly_active).length;
  const criticalCount = serverStats.critical !== undefined ? serverStats.critical : logs.filter(l => l.criticality === 'CRITICA').length;
  const highCount = serverStats.high !== undefined ? serverStats.high : logs.filter(l => l.criticality === 'ALTA').length;

  let threatScore = "A";
  let threatTrend = t("secure");
  let threatUp = true;
  if (criticalCount > 0) { threatScore = "F"; threatTrend = t("threatCrit"); threatUp = false; }
  else if (highCount > 2) { threatScore = "D"; threatTrend = t("danger"); threatUp = false; }
  else if (highCount > 0) { threatScore = "C"; threatTrend = t("warning"); threatUp = false; }
  else if (logs.filter(l => l.criticality === 'MEDIA').length > 5) { threatScore = "B"; threatTrend = t("elevated"); threatUp = true; }

  const fetchAllMatchingLogs = async () => {
    try {
      const params = new URLSearchParams();
      params.append('all', 'true');
      if (filterCrit) params.append('criticidad', filterCrit);
      if (debouncedServer) params.append('server', debouncedServer);
      if (debouncedSearch) params.append('search', debouncedSearch);

      const data = await apiFetch(`/logs/?${params.toString()}`, {}, token);
      return Array.isArray(data) ? data : (data?.results || logs);
    } catch (e) {
      return logs;
    }
  };

  const handleExportCSV = async () => {
    const dataToExport = await fetchAllMatchingLogs();
    if (dataToExport.length === 0) return alert(t("noExportData"));

    const headers = ["ID", "Timestamp", "Node", "Severity", "Message", "Resources"];
    const csvContent = [
      headers.join(","),
      ...dataToExport.map(l => `"${l.id}","${l.timestamp}","${l.server}","${l.criticality}","${(l.message || '').replace(/"/g, '""')}","${(l.resources_info || '').replace(/"/g, '""')}"`)
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `soc_logs_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCreateReport = async () => {
    const dataToReport = await fetchAllMatchingLogs();
    if (dataToReport.length === 0) return alert(t("noReportData"));

    const reportContent = `
====================================================
      SOC CENTRAL - SECURITY INCIDENT REPORT
====================================================
Date Generated: ${new Date().toLocaleString(undefined, { hour12: false })}
Threat Score: ${threatScore} (${threatTrend})
Active Nodes: ${activeNodesCount} / ${agents.length}

--- SUMMARY ---
Total Events: ${totalCount || dataToReport.length}
Critical Alerts: ${criticalCount}
High Alerts: ${highCount}

--- CRITICAL & HIGH EVENTS ---
${dataToReport.filter(l => ['CRITICA', 'ALTA'].includes(l.criticality)).map(l =>
      `[${l.timestamp}] [${l.server}] ${l.criticality} - ${l.message}`
    ).join('\n') || "No critical or high events detected."}

====================================================
END OF REPORT
====================================================
    `.trim();

    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `soc_security_report_${new Date().toISOString().split('T')[0]}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fade-in">

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-theme-main tracking-tight">{t("dashTitle")}</h1>
          <p className="text-sm text-theme-muted mt-1">{t("dashDesc")}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowPurgeModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-lg text-sm font-medium transition-colors"
            title={t("purgeModalDesc")}
          >
            <Trash2 className="w-4 h-4" /> {t("cleanDatabase")}
          </button>
          <button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/10 rounded-lg text-sm text-theme-main transition-colors">
            <Download className="w-4 h-4" /> {t("exportData")}
          </button>
          <button onClick={handleCreateReport} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm text-white font-medium transition-colors">
            {t("createReport")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <StatCard title={t("totalEvents")} value={totalCount} trend={t("live")} trendUp={true} />
        <StatCard title={t("critAlerts")} value={criticalCount} trend={criticalCount > 0 ? t("actionReq") : t("clear")} trendUp={criticalCount === 0} />
        <StatCard title={t("activeNodes")} value={`${activeNodesCount} / ${agents.length || 0}`} trend={t("onlineStatus")} trendUp={activeNodesCount === agents.length && agents.length > 0} />
        <StatCard title={t("threatScore")} value={threatScore} trend={threatTrend} trendUp={threatUp} />
      </div>

      <div className="panel overflow-hidden">
        <div className="px-6 py-5 border-b border-theme-light flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-base font-medium text-theme-main flex items-center gap-2">
            {t("eventLogs")} {loading && <RefreshCw className="w-4 h-4 text-theme-muted animate-spin" />}
          </h3>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
              <input
                type="search"
                name="logs_node_filter"
                id="logs_node_filter"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck="false"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                placeholder={t("filterNodes")}
                className="input-field py-2 pl-9 pr-4 text-sm text-theme-main w-full sm:w-48"
                value={filterServer}
                onChange={e => setFilterServer(e.target.value)}
              />
            </div>
            <select
              className="input-field py-2 px-4 text-sm text-theme-main w-full sm:w-auto appearance-none cursor-pointer"
              value={filterCrit} onChange={e => setFilterCrit(e.target.value)}
            >
              <option value="">{t("allLevels")}</option>
              <option value="CRITICA">{t("critical")}</option>
              <option value="ALTA">{t("high")}</option>
              <option value="MEDIA">{t("medium")}</option>
              <option value="BAJA">{t("low")}</option>
              <option value="INFO">{t("info")}</option>
            </select>
          </div>
        </div>

        {/* Barra de acción para elementos seleccionados */}
        {selectedLogIds.length > 0 && (
          <div className="mx-6 mt-4 p-3.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-indigo-600 text-white text-xs font-bold shadow-sm">
                {selectedLogIds.length}
              </span>
              <span className="text-sm font-medium text-theme-main">
                {selectedLogIds.length} {t("selectedEvents")}
              </span>
              <button
                onClick={() => setSelectedLogIds([])}
                className="text-xs text-theme-muted hover:text-theme-main underline transition-colors cursor-pointer"
              >
                {t("clearSelection")}
              </button>
            </div>
            <button
              onClick={() => setConfirmAction({
                type: 'selected',
                title: t("confirmDeleteTitle"),
                message: `¿Estás seguro de que deseas eliminar permanentemente los ${selectedLogIds.length} eventos seleccionados de la base de datos?`
              })}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("deleteSelected")} ({selectedLogIds.length})
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap min-w-[800px]">
            <thead>
              <tr className="border-b border-theme-light text-xs text-theme-muted">
                <th className="px-4 py-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllPageSelected}
                    onChange={toggleSelectAllPage}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-theme-panel cursor-pointer w-4 h-4"
                    title={t("selectAll")}
                  />
                </th>
                <th className="px-6 py-4 font-medium">{t("timestamp")}</th>
                <th className="px-6 py-4 font-medium">{t("node")}</th>
                <th className="px-6 py-4 font-medium">{t("severity")}</th>
                <th className="px-6 py-4 font-medium">{t("threatAnalysis")}</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-500/10">
              {logs.map(log => (
                <React.Fragment key={log.id}>
                  <tr
                    className={`hover:bg-white/[0.02] transition-colors cursor-pointer ${selectedLogIds.includes(log.id) ? 'bg-indigo-500/10' : ''}`}
                    onClick={() => toggleExpand(log.id)}
                    title="Click para ver evidencia"
                  >
                    <td className="px-4 py-4 w-10 text-center" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedLogIds.includes(log.id)}
                        onChange={e => toggleSelectLog(log.id, e)}
                        className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-theme-panel cursor-pointer w-4 h-4"
                      />
                    </td>
                    <td className="px-6 py-4 text-theme-muted">{safeFormatDate(log.timestamp)}</td>
                    <td className="px-6 py-4 font-medium text-theme-main">{log.server}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${getCritStyle(log.criticality)}`}>
                        {log.criticality}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-theme-muted truncate max-w-sm">{log.message}</td>
                  </tr>
                  {expandedLogId === log.id && (
                    <tr className="bg-theme-main">
                      <td colSpan="5" className="px-6 py-4">
                        <div className="bg-theme-panel border border-theme-light rounded-lg p-4">
                          <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wider mb-2">{t("logEvidence")}</h4>
                          <pre className="text-xs text-theme-main font-mono whitespace-pre-wrap break-all overflow-x-auto bg-theme-main p-3 rounded border border-theme-light">
                            {log.evidence || t("noEvidence")}
                          </pre>
                          {log.resources_info && (
                            <div className="mt-4 pt-3 border-t border-theme-light">
                              <h4 className="text-xs font-semibold text-theme-muted uppercase tracking-wider mb-1">{t("serverResources")}</h4>
                              <p className="text-xs text-theme-muted">{log.resources_info}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center text-theme-muted">{t("noLogs")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Barra de Paginación */}
        <div className="px-6 py-4 border-t border-theme-light flex flex-col sm:flex-row items-center justify-between gap-4 bg-theme-panel/30">
          <div className="flex flex-wrap items-center gap-4 text-xs text-theme-muted">
            <span>
              {t("showingLogs")} <span className="font-semibold text-theme-main">{totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1}</span> {t("to")}{" "}
              <span className="font-semibold text-theme-main">{Math.min(currentPage * pageSize, totalCount)}</span> {t("of")}{" "}
              <span className="font-semibold text-theme-main">{totalCount}</span> {t("events")}
            </span>
            <div className="flex items-center gap-2">
              <span>{t("perPage")}:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="input-field py-1 px-2.5 text-xs rounded-md border border-theme-light bg-theme-panel text-theme-main cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-lg border border-theme-light text-theme-muted hover:text-theme-main hover:bg-slate-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t("firstPage")}
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              className="p-1.5 rounded-lg border border-theme-light text-theme-muted hover:text-theme-main hover:bg-slate-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t("prevPage")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {getPageNumbers(currentPage, totalPages).map((p, idx) => (
              p === '...' ? (
                <span key={`ellipsis-${idx}`} className="px-2 text-xs text-theme-muted select-none">...</span>
              ) : (
                <button
                  key={`page-${p}`}
                  onClick={() => setCurrentPage(p)}
                  className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-medium transition-all ${currentPage === p
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'border border-theme-light text-theme-muted hover:text-theme-main hover:bg-slate-500/10'
                    }`}
                >
                  {p}
                </button>
              )
            ))}

            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded-lg border border-theme-light text-theme-muted hover:text-theme-main hover:bg-slate-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t("nextPage")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded-lg border border-theme-light text-theme-muted hover:text-theme-main hover:bg-slate-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t("lastPage")}
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Limpieza y Purga */}
      {showPurgeModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
          <div className="bg-theme-main border border-theme-strong rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-theme-light flex justify-between items-center bg-theme-panel">
              <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-400" />
                {t("purgeModalTitle")}
              </h3>
              <button onClick={() => setShowPurgeModal(false)} className="text-theme-muted hover:text-theme-main cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-theme-muted leading-relaxed">
                {t("purgeModalDesc")}
              </p>

              <div className="space-y-3">
                {/* Opción 1: Borrar todos los INFO */}
                <div className="p-4 rounded-xl border border-theme-light bg-theme-panel/40 flex items-center justify-between gap-4 hover:border-blue-500/40 transition-colors">
                  <div>
                    <h4 className="text-sm font-medium text-theme-main flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
                      {t("purgeInfoOnly")}
                    </h4>
                    <p className="text-xs text-theme-muted mt-1">
                      Elimina todos los eventos informativos para liberar espacio rápido sin perder alertas críticas ni advertencias.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowPurgeModal(false);
                      setConfirmAction({
                        type: 'info',
                        title: t("purgeInfoOnly"),
                        message: "¿Deseas eliminar permanentemente TODOS los eventos con severidad INFO de la base de datos?"
                      });
                    }}
                    className="px-3.5 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors border border-blue-500/30 cursor-pointer"
                  >
                    Borrar INFO
                  </button>
                </div>

                {/* Opción 2: Borrar INFO y BAJA */}
                <div className="p-4 rounded-xl border border-theme-light bg-theme-panel/40 flex items-center justify-between gap-4 hover:border-emerald-500/40 transition-colors">
                  <div>
                    <h4 className="text-sm font-medium text-theme-main flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                      {t("purgeInfoAndLow")}
                    </h4>
                    <p className="text-xs text-theme-muted mt-1">
                      Conserva únicamente eventos relevantes (Media, Alta y Crítica).
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowPurgeModal(false);
                      setConfirmAction({
                        type: 'info_low',
                        title: t("purgeInfoAndLow"),
                        message: "¿Deseas eliminar permanentemente todos los eventos INFO y BAJA de la base de datos?"
                      });
                    }}
                    className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors border border-emerald-500/30 cursor-pointer"
                  >
                    Borrar INFO & BAJA
                  </button>
                </div>

                {/* Opción 3: Reset Total */}
                <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/5 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-rose-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                      {t("purgeAll")}
                    </h4>
                    <p className="text-xs text-theme-muted mt-1">
                      Vacía completamente el historial de eventos para dejar la base de datos en blanco.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowPurgeModal(false);
                      setConfirmAction({
                        type: 'all',
                        title: t("purgeAll"),
                        message: "¡PELIGRO! Se eliminarán ABSOLUTAMENTE TODOS los eventos del sistema. Esta acción no se puede deshacer. ¿Confirmas la purga total?"
                      });
                    }}
                    className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold whitespace-nowrap transition-colors shadow-sm cursor-pointer"
                  >
                    Purgar Todo
                  </button>
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-theme-panel border-t border-theme-light flex justify-end">
              <button
                onClick={() => setShowPurgeModal(false)}
                className="px-4 py-2 bg-theme-panel border border-theme-light text-theme-muted hover:text-theme-main rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación de Eliminación */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
          <div className="bg-theme-main border border-theme-strong rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-4 mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-theme-main text-center mb-2">
                {confirmAction.title || t("confirmDeleteTitle")}
              </h3>
              <p className="text-xs text-theme-muted text-center leading-relaxed">
                {confirmAction.message || t("confirmPurgeMsg")}
              </p>
            </div>

            <div className="px-6 py-4 bg-theme-panel border-t border-theme-light flex items-center justify-end gap-3">
              <button
                disabled={actionLoading}
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 border border-theme-light text-theme-muted hover:text-theme-main rounded-lg text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={actionLoading}
                onClick={() => executeDelete(confirmAction)}
                className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
              >
                {actionLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                {actionLoading ? t("deleting") : "Sí, eliminar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notificación */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-fade-in border border-emerald-400/30">
          <CheckCircle2 className="w-5 h-5 text-white" />
          <span className="text-sm font-medium">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-white/80 hover:text-white ml-2 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, trend, trendUp }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-theme-muted">{title}</span>
        <button className="text-theme-muted hover:text-theme-main"><AlertTriangle className="w-4 h-4 opacity-0" /></button>
      </div>
      <div className="flex items-end gap-3">
        <span className="text-2xl font-bold text-theme-main">{value}</span>
        <span className={`text-xs font-medium px-2 py-1 rounded-md mb-1 ${trendUp ? 'text-theme-success bg-emerald-500/10' : 'text-theme-danger bg-rose-500/10'}`}>
          {trend}
        </span>
      </div>
    </div>
  );
}

function AgentsView({ role, token, t }) {
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setShowApiKey(false);
  }, [selectedAgent]);

  const fetchAgents = async () => {
    try {
      const data = await apiFetch('/agents/', {}, token);
      setAgents(data);
    } catch (e) {
      console.error(e);
    }
  };

  const getAgentStatus = (agent) => {
    if (agent.status === 'maintenance') return { text: 'maintenance', color: 'text-theme-warning bg-amber-500/10' };
    if (agent.status === 'inactive') return { text: 'inactive', color: 'text-theme-danger bg-rose-500/10' };

    if (agent.is_truly_active) {
      return { text: 'active', color: 'text-theme-success bg-emerald-500/10' };
    } else {
      return { text: 'not active', color: 'text-theme-danger bg-rose-500/10' };
    }
  };

  const getAgentBorderClass = (agent) => {
    if (agent.status === 'maintenance') return "!border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]";
    if (agent.status === 'inactive' || !agent.is_truly_active) return "!border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.4)]";
    return "!border-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.4)]";
  };

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [token]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [deployModalAgent, setDeployModalAgent] = useState(null);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeIp, setNewNodeIp] = useState('');
  const [addNodeLoading, setAddNodeLoading] = useState(false);
  const [addNodeError, setAddNodeError] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [activeDeployTab, setActiveDeployTab] = useState('quick'); // 'quick' | 'manual'

  useEffect(() => {
    if (deployModalAgent) {
      const live = agents.find(a => a.id === deployModalAgent.id || (a.api_key && a.api_key === deployModalAgent.api_key));
      if (live) {
        setDeployModalAgent(live);
      }
    }
  }, [agents]);

  const getSocServerUrl = () => {
    if (typeof window === 'undefined') return 'http://127.0.0.1:8000';
    if (window.location.port === '5173' || window.location.port === '3000') {
      return `http://${window.location.hostname}:8000`;
    }
    return window.location.origin;
  };

  const handleOpenAddModal = () => {
    setNewNodeName('');
    setNewNodeIp('');
    setAddNodeError('');
    setIsAddModalOpen(true);
  };

  const handleCreateNodeSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newNodeName.trim()) {
      setAddNodeError('Por favor ingrese un nombre para el servidor.');
      return;
    }
    if (!newNodeIp.trim()) {
      setAddNodeError('Por favor ingrese la dirección IP del servidor.');
      return;
    }
    setAddNodeLoading(true);
    setAddNodeError('');

    const api_key = "key_" + Math.random().toString(36).substring(2, 15);

    try {
      const created = await apiFetch('/agents/', {
        method: 'POST',
        body: JSON.stringify({
          name: newNodeName.trim(),
          ip_address: newNodeIp.trim(),
          api_key,
          status: 'active'
        })
      }, token);

      setIsAddModalOpen(false);
      setNewNodeName('');
      setNewNodeIp('');
      await fetchAgents();
      setDeployModalAgent(created || {
        name: newNodeName.trim(),
        ip_address: newNodeIp.trim(),
        api_key,
        status: 'active',
        is_truly_active: false
      });
    } catch (err) {
      setAddNodeError(err.message || 'Error al añadir el servidor');
    } finally {
      setAddNodeLoading(false);
    }
  };

  const handleDeleteNode = async (id, name) => {
    if (!confirm(`¿Estás completamente seguro de que deseas ELIMINAR el nodo ${name}? Esto borrará todos sus logs asociados.`)) return;
    try {
      await apiFetch(`/agents/${id}/`, {
        method: 'DELETE'
      }, token);
      fetchAgents();
    } catch (e) {
      alert("Error al eliminar nodo: " + e.message);
    }
  };

  const handleRestart = async (id) => {
    if (!confirm("¿Seguro que deseas activar este nodo?")) return;
    try {
      await apiFetch(`/agents/${id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' })
      }, token);
      await fetchAgents();
      setSelectedAgent(current => (
        current?.id === id
          ? { ...current, status: 'active' }
          : current
      ));
    } catch (e) {
      alert("Error al activar nodo: " + e.message);
    }
  };

  const handleEditIp = async (agent) => {
    const ipAddress = prompt(`Nueva dirección IP para ${agent.name}:`, agent.ip_address);
    if (ipAddress === null || ipAddress.trim() === '' || ipAddress.trim() === agent.ip_address) return;

    try {
      await apiFetch(`/agents/${agent.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ ip_address: ipAddress.trim() })
      }, token);
      alert('✅ Dirección IP actualizada correctamente.');
      await fetchAgents();
      setSelectedAgent(current => (
        current?.id === agent.id
          ? { ...current, ip_address: ipAddress.trim() }
          : current
      ));
    } catch (e) {
      alert('Error al actualizar la dirección IP: ' + e.message);
    }
  };

  const filteredAgents = agents.filter(agent => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const nameMatch = agent.name && agent.name.toLowerCase().includes(q);
    const ipMatch = agent.ip_address && agent.ip_address.toLowerCase().includes(q);
    const statusMatch = agent.status && agent.status.toLowerCase().includes(q);
    return nameMatch || ipMatch || statusMatch;
  });

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-theme-main tracking-tight">{t("nodesTitle")}</h1>
          <p className="text-sm text-theme-muted mt-1">{t("nodesDesc")}</p>
        </div>
        {(role === 'admin' || role === 'write') && (
          <button onClick={handleOpenAddModal} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm text-white font-medium transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> {t("addNode") || "Añadir Nodo"}
          </button>
        )}
      </div>

      {/* Barra de Búsqueda y Selector de Vista */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
        {/* Formulario / Input de Búsqueda */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="flex items-center gap-2 flex-1 max-w-md"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
            <input
              type="search"
              name="agents_node_search_query"
              id="agents_node_search_query"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck="false"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchNodesPlaceholder") || "Buscar por nombre o IP..."}
              className="input-field py-2 pl-9 pr-8 text-sm text-theme-main w-full"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-main p-0.5"
                title={t("clearSearch") || "Limpiar búsqueda"}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/10 hover:text-theme-main rounded-lg text-sm text-theme-muted transition-colors font-medium shrink-0"
            title={t("searchNode") || "Buscar"}
          >
            <Search className="w-4 h-4" />
            <span>{t("searchNode") || "Buscar"}</span>
          </button>
        </form>

        {/* Toggle de Modo Cuadrícula vs Lista y Contador */}
        <div className="flex items-center justify-between sm:justify-end gap-3">
          <span className="text-xs text-theme-muted">
            {filteredAgents.length === agents.length
              ? `${agents.length} ${agents.length === 1 ? 'nodo' : 'nodos'}`
              : `${filteredAgents.length} de ${agents.length} ${agents.length === 1 ? 'nodo' : 'nodos'}`}
          </span>

          <div className="flex items-center bg-theme-panel border border-theme-light rounded-lg p-1 gap-1">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${viewMode === 'grid'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-500/10'
                }`}
              title={t("viewGrid") || "Vista Cuadrícula (Rectangular)"}
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden md:inline">{t("viewGridShort") || "Cuadrícula"}</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${viewMode === 'list'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-500/10'
                }`}
              title={t("viewList") || "Vista Lista"}
            >
              <List className="w-4 h-4" />
              <span className="hidden md:inline">{t("viewListShort") || "Lista"}</span>
            </button>
          </div>
        </div>
      </div>

      {filteredAgents.length === 0 ? (
        <div className="panel p-12 text-center flex flex-col items-center justify-center">
          <Server className="w-12 h-12 text-theme-muted mb-3 opacity-40" />
          <h3 className="text-base font-semibold text-theme-main mb-1">
            {searchQuery ? (t("noSearchResults") || "No se encontraron nodos") : (t("noNodes") || "Aún no hay nodos conectados.")}
          </h3>
          <p className="text-sm text-theme-muted max-w-sm">
            {searchQuery
              ? `No se encontró ningún nodo que coincida con "${searchQuery}".`
              : "Registra tu primer servidor para empezar a monitorear recursos y logs."}
          </p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-4 px-4 py-1.5 bg-theme-panel border border-theme-light hover:bg-slate-500/10 rounded-lg text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {t("clearSearch") || "Limpiar búsqueda"}
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAgents.map(agent => (
            <div key={agent.id} className={`panel p-6 flex flex-col transition-all duration-300 ${getAgentBorderClass(agent)}`}>
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-xl bg-theme-main border border-theme-light">
                  <Server className="w-6 h-6 text-theme-accent" />
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-md capitalize ${getAgentStatus(agent).color}`}>
                  {getAgentStatus(agent).text}
                </span>
              </div>

              <h3 className="text-lg font-semibold text-theme-main mb-1">{agent.name}</h3>
              <div className="flex items-center justify-between gap-2 mb-6">
                <p className="text-sm text-theme-muted font-mono truncate">{agent.ip_address}</p>
                {(role === 'admin' || role === 'write') && (
                  <button
                    onClick={() => handleEditIp(agent)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded hover:bg-slate-500/10 transition-colors shrink-0"
                  >
                    Editar IP
                  </button>
                )}
              </div>

              <div className="mt-auto pt-4 border-t border-theme-light flex flex-wrap gap-2">
                <button
                  onClick={() => setDeployModalAgent(agent)}
                  className="flex-1 min-w-[110px] text-xs font-medium py-2 px-2.5 text-indigo-400 hover:text-white hover:bg-indigo-600 bg-indigo-500/10 border border-indigo-500/20 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  title="Ver comando de instalación remota para este servidor"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>{t("deployNode") || "Desplegar"}</span>
                </button>
                <button onClick={() => setSelectedAgent(agent)} className="flex-1 min-w-[85px] text-xs text-center py-2 px-2 text-theme-muted hover:text-theme-main hover:bg-slate-500/10 border border-theme-light rounded-lg transition-colors font-medium">{t("viewDetails")}</button>
                {(role === 'admin' || role === 'write') && (
                  <>
                    <button onClick={() => handleRestart(agent.id)} className="px-2.5 text-xs text-center py-2 text-theme-muted hover:text-theme-main hover:bg-slate-500/10 border border-theme-light rounded-lg transition-colors font-medium" title={t("restart") || "Reiniciar"}>
                      {t("restart") || "Reiniciar"}
                    </button>
                    <button onClick={() => handleDeleteNode(agent.id, agent.name)} className="px-2.5 text-xs text-center py-2 text-rose-400 hover:text-white hover:bg-rose-500 border border-rose-500/20 rounded-lg transition-colors font-medium" title={t("delete") || "Eliminar"}>
                      {t("delete") || "Eliminar"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel overflow-hidden border border-theme-light shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap min-w-[720px]">
              <thead>
                <tr className="border-b border-theme-light text-xs text-theme-muted uppercase tracking-wider bg-theme-panel/60">
                  <th className="px-6 py-4 font-medium">{t("name")}</th>
                  <th className="px-6 py-4 font-medium">{t("ipAddress")}</th>
                  <th className="px-6 py-4 font-medium">{t("status")}</th>
                  <th className="px-6 py-4 font-medium">{t("nodeResources") || "Recursos"}</th>
                  <th className="px-6 py-4 font-medium text-right">{t("actions") || "Acciones"}</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-500/10">
                {filteredAgents.map(agent => (
                  <tr key={agent.id} className="hover:bg-slate-500/5 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-theme-main border border-theme-light shrink-0 group-hover:border-indigo-500/40 transition-colors">
                          <Server className="w-4 h-4 text-theme-accent" />
                        </div>
                        <div>
                          <p className="font-semibold text-theme-main">{agent.name}</p>
                          {agent.metrics_updated_at ? (
                            <p className="text-[11px] text-theme-muted">
                              Act: {safeFormatDate(agent.metrics_updated_at)}
                            </p>
                          ) : (
                            <p className="text-[11px] text-theme-muted">Sin métricas</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-theme-main">{agent.ip_address}</span>
                        {(role === 'admin' || role === 'write') && (
                          <button
                            onClick={() => handleEditIp(agent)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium px-2 py-0.5 rounded hover:bg-slate-500/10 transition-colors"
                            title="Editar IP"
                          >
                            Editar IP
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-md capitalize ${getAgentStatus(agent).color}`}>
                        {getAgentStatus(agent).text}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs">
                        <div className="flex items-center gap-1 bg-theme-panel px-2 py-1 rounded border border-theme-light">
                          <span className="text-theme-muted">CPU:</span>
                          <span className="font-semibold text-theme-main">
                            {agent.cpu_usage != null ? `${Number(agent.cpu_usage).toFixed(0)}%` : '—'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 bg-theme-panel px-2 py-1 rounded border border-theme-light">
                          <span className="text-theme-muted">RAM:</span>
                          <span className="font-semibold text-theme-main">
                            {agent.memory_usage != null ? `${Number(agent.memory_usage).toFixed(0)}%` : '—'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 bg-theme-panel px-2 py-1 rounded border border-theme-light">
                          <span className="text-theme-muted">Disk:</span>
                          <span className="font-semibold text-theme-main">
                            {agent.disk_usage != null ? `${Number(agent.disk_usage).toFixed(0)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setDeployModalAgent(agent)}
                          className="px-2.5 py-1.5 text-xs text-indigo-400 hover:text-white hover:bg-indigo-600 bg-indigo-500/10 border border-indigo-500/20 rounded-lg transition-colors font-medium flex items-center gap-1 shadow-sm"
                          title="Ver comando de instalación remota para este servidor"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          <span>{t("deployNode") || "Desplegar"}</span>
                        </button>
                        <button
                          onClick={() => setSelectedAgent(agent)}
                          className="px-3 py-1.5 text-xs text-theme-muted hover:text-theme-main hover:bg-slate-500/10 border border-theme-light rounded-lg transition-colors font-medium"
                        >
                          {t("viewDetails")}
                        </button>
                        {(role === 'admin' || role === 'write') && (
                          <>
                            <button
                              onClick={() => handleRestart(agent.id)}
                              className="px-3 py-1.5 text-xs text-theme-muted hover:text-theme-main hover:bg-slate-500/10 border border-theme-light rounded-lg transition-colors font-medium"
                            >
                              {t("restart") || "Reiniciar"}
                            </button>
                            <button
                              onClick={() => handleDeleteNode(agent.id, agent.name)}
                              className="px-3 py-1.5 text-xs text-rose-400 hover:text-white hover:bg-rose-600/80 border border-rose-500/20 rounded-lg transition-colors font-medium"
                            >
                              {t("delete") || "Eliminar"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedAgent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
          <div className="bg-theme-main border border-theme-strong rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-theme-light flex justify-between items-center bg-theme-panel">
              <h3 className="text-lg font-medium text-theme-main flex items-center gap-2">
                <Server className="w-5 h-5 text-theme-accent" /> Detalle del Nodo
              </h3>
              <button onClick={() => setSelectedAgent(null)} className="text-theme-muted hover:text-theme-main">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider mb-1">{t("name")}</p>
                <p className="text-theme-main font-medium">{selectedAgent.name}</p>
              </div>
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider mb-1">{t("ipAddress")}</p>
                <div className="flex items-center gap-3">
                  <p className="text-theme-main font-medium font-mono">{selectedAgent.ip_address}</p>
                  {(role === 'admin' || role === 'write') && (
                    <button
                      onClick={() => handleEditIp(selectedAgent)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded hover:bg-slate-500/10 transition-colors"
                    >
                      Editar IP
                    </button>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider mb-1">{t("status")}</p>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-md capitalize ${getAgentStatus(selectedAgent).color}`}>
                  {getAgentStatus(selectedAgent).text}
                </span>
              </div>

              <div className="border-t border-theme-light pt-4">
                <p className="text-xs text-theme-muted uppercase tracking-wider mb-3">
                  Recursos del servidor
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-theme-panel border border-theme-light p-3 text-center">
                    <p className="text-xs text-theme-muted mb-1">CPU</p>
                    <p className="text-lg font-semibold text-theme-main">
                      {selectedAgent.cpu_usage != null
                        ? `${Number(selectedAgent.cpu_usage).toFixed(1)}%`
                        : 'Sin datos'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-theme-panel border border-theme-light p-3 text-center">
                    <p className="text-xs text-theme-muted mb-1">Memoria</p>
                    <p className="text-lg font-semibold text-theme-main">
                      {selectedAgent.memory_usage != null
                        ? `${Number(selectedAgent.memory_usage).toFixed(1)}%`
                        : 'Sin datos'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-theme-panel border border-theme-light p-3 text-center">
                    <p className="text-xs text-theme-muted mb-1">Disco</p>
                    <p className="text-lg font-semibold text-theme-main">
                      {selectedAgent.disk_usage != null
                        ? `${Number(selectedAgent.disk_usage).toFixed(1)}%`
                        : 'Sin datos'}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-theme-muted mt-3">
                  Última actualización:{' '}
                  {selectedAgent.metrics_updated_at
                    ? safeFormatDate(selectedAgent.metrics_updated_at)
                    : 'Sin datos'}
                </p>
              </div>

              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider mb-1">{t("apiKey")}</p>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    readOnly
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={selectedAgent.api_key || 'No disponible'}
                    style={{ WebkitTextSecurity: showApiKey || !selectedAgent.api_key ? 'none' : 'disc' }}
                    className={`input-field py-2 px-3 text-sm text-theme-main w-full font-mono bg-theme-panel border-theme-light ${!showApiKey && selectedAgent.api_key ? 'tracking-widest' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(prev => !prev)}
                    className="p-2 bg-theme-panel border border-theme-light hover:bg-slate-500/20 hover:text-theme-main rounded-lg text-theme-muted transition-colors"
                    title={showApiKey ? (t("hideApiKey") || "Ocultar API Key") : (t("showApiKey") || "Mostrar API Key")}
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedAgent.api_key) {
                        navigator.clipboard.writeText(selectedAgent.api_key);
                        alert(t("keyCopied") || "API Key copiada al portapapeles.");
                      }
                    }}
                    className="p-2 bg-theme-panel border border-theme-light hover:bg-slate-500/20 hover:text-theme-main rounded-lg text-theme-muted transition-colors"
                    title="Copiar API Key"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-theme-muted mt-2">{t("copyApiKey")}</p>
                <button
                  type="button"
                  onClick={() => {
                    const a = selectedAgent;
                    setSelectedAgent(null);
                    setDeployModalAgent(a);
                  }}
                  className="w-full mt-4 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
                >
                  <Terminal className="w-4 h-4" /> Ver Comando de Instalación Remota
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registrar Nuevo Servidor / Nodo */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
          <div className="bg-theme-main border border-theme-strong rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-theme-light flex justify-between items-center bg-theme-panel">
              <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
                <Server className="w-5 h-5 text-indigo-400" />
                {t("addNodeModalTitle") || "Registrar Nuevo Servidor"}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-theme-muted hover:text-theme-main p-1 rounded-lg hover:bg-slate-500/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNodeSubmit} className="p-6 space-y-4">
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-xs text-indigo-300 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  Cada servidor remoto debe tener su propio agente con una <strong>API Key única</strong>. Al registrarlo, obtendrás el comando listo para ejecutar en su terminal.
                </span>
              </div>

              {addNodeError && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-xs text-rose-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{addNodeError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1.5">
                  {t("serverNameLabel") || "Nombre del Servidor / Hostname"} <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  placeholder={t("serverNamePlaceholder") || "ej: Debian-Prod-01, DB-Cluster"}
                  className="input-field py-2.5 px-3 text-sm text-theme-main w-full"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1.5">
                  {t("serverIpLabel") || "Dirección IP del Servidor"} <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newNodeIp}
                  onChange={(e) => setNewNodeIp(e.target.value)}
                  placeholder={t("serverIpPlaceholder") || "ej: 192.168.1.50"}
                  className="input-field py-2.5 px-3 text-sm text-theme-main w-full font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-sm text-theme-muted hover:text-theme-main hover:bg-slate-500/10 border border-theme-light rounded-lg transition-colors font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={addNodeLoading}
                  className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-md shadow-indigo-600/20"
                >
                  {addNodeLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Registrando...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      {t("createAndDeploy") || "Registrar y Obtener Comando"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Despliegue de Agente Remoto */}
      {deployModalAgent && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in">
          <div className="bg-theme-main border border-theme-strong rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="px-6 py-4 border-b border-theme-light flex justify-between items-center bg-theme-panel shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600/20 border border-indigo-500/30 rounded-lg text-indigo-400">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
                    {t("deployModalTitle") || "Despliegue del Agente"}: {deployModalAgent.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-theme-muted font-mono">{deployModalAgent.ip_address}</span>
                    <span className="text-xs text-theme-muted">•</span>
                    {deployModalAgent.is_truly_active ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" /> En línea / Operativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Esperando primer reporte
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeployModalAgent(null);
                  setCopiedKey(false);
                  setCopiedCommand(false);
                }}
                className="text-theme-muted hover:text-theme-main p-1.5 rounded-lg hover:bg-slate-500/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Architecture notice */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 text-xs text-amber-300 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-200">Arquitectura Multi-Servidor:</p>
                  <p className="leading-relaxed">
                    {t("multiAgentNotice") || "Cada servidor remoto debe tener su propio agente en ejecución con esta API Key única. No reutilices ni sobrescribas las claves entre diferentes servidores para evitar que compitan entre sí."}
                  </p>
                </div>
              </div>

              {/* API Key Box */}
              <div>
                <label className="block text-xs font-medium text-theme-muted uppercase tracking-wider mb-1.5">
                  API Key Única Asignada a este Servidor
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={deployModalAgent.api_key || ''}
                    className="input-field py-2 px-3 text-sm text-theme-main w-full font-mono bg-theme-panel border-theme-light"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (deployModalAgent.api_key) {
                        await navigator.clipboard.writeText(deployModalAgent.api_key);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2500);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/10 text-theme-main rounded-lg text-xs font-medium transition-colors shrink-0"
                    title="Copiar API Key"
                  >
                    {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-theme-muted" />}
                    <span>{copiedKey ? "¡Copiada!" : "Copiar Clave"}</span>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div>
                <div className="flex items-center border-b border-theme-light gap-4 mb-4">
                  <button
                    type="button"
                    onClick={() => setActiveDeployTab('quick')}
                    className={`pb-2.5 text-xs font-semibold transition-all relative ${activeDeployTab === 'quick'
                      ? 'text-indigo-400 border-b-2 border-indigo-500'
                      : 'text-theme-muted hover:text-theme-main'
                      }`}
                  >
                    ⚡ Comando Automático (1 Línea)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDeployTab('manual')}
                    className={`pb-2.5 text-xs font-semibold transition-all relative ${activeDeployTab === 'manual'
                      ? 'text-indigo-400 border-b-2 border-indigo-500'
                      : 'text-theme-muted hover:text-theme-main'
                      }`}
                  >
                    🛠️ Instalación Manual / Git
                  </button>
                </div>

                {activeDeployTab === 'quick' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-theme-muted">
                      {t("quickInstallDesc") || "Copia y ejecuta este comando directamente en la terminal de tu servidor remoto como root:"}
                    </p>

                    <div className="relative group">
                      <pre className="p-3.5 bg-black/80 border border-slate-700 rounded-lg text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed select-all">
                        {`curl -sSL ${getSocServerUrl()}/install.sh | sudo bash -s -- --soc-url "${getSocServerUrl()}" --api-key "${deployModalAgent.api_key}" --auto-start`}
                      </pre>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          const cmd = `curl -sSL ${getSocServerUrl()}/install.sh | sudo bash -s -- --soc-url "${getSocServerUrl()}" --api-key "${deployModalAgent.api_key}" --auto-start`;
                          await navigator.clipboard.writeText(cmd);
                          setCopiedCommand(true);
                          setTimeout(() => setCopiedCommand(false), 3000);
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors shadow-md shadow-indigo-600/20"
                      >
                        {copiedCommand ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                        <span>{copiedCommand ? "¡Comando Copiado!" : (t("copyInstallCommand") || "Copiar Comando de 1 Línea")}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-xs text-theme-muted leading-relaxed">
                    <p>Si prefieres transferir el script o configurarlo manualmente:</p>
                    <ol className="list-decimal pl-5 space-y-2">
                      <li>
                        Conéctate por SSH a tu servidor:
                        <div className="font-mono bg-black/60 p-2 rounded border border-theme-light text-theme-main mt-1">
                          ssh root@{deployModalAgent.ip_address}
                        </div>
                      </li>
                      <li>
                        Copia el archivo <code>instalar_ai_soc_agent.sh</code> a ese servidor.
                      </li>
                      <li>
                        Ejecuta el instalador con la clave única de este servidor:
                        <div className="font-mono bg-black/60 p-2 rounded border border-theme-light text-emerald-400 mt-1 select-all break-all">
                          sudo bash instalar_ai_soc_agent.sh --soc-url "{getSocServerUrl()}" --api-key "{deployModalAgent.api_key}" --auto-start
                        </div>
                      </li>
                      <li>
                        Verifica el servicio Systemd con:
                        <div className="font-mono bg-black/60 p-2 rounded border border-theme-light text-theme-main mt-1">
                          sudo systemctl status ai_soc_agent
                        </div>
                      </li>
                    </ol>
                  </div>
                )}
              </div>

              {/* Real-time status */}
              <div className={`rounded-xl p-4 border transition-all ${deployModalAgent.is_truly_active
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-theme-panel border-theme-light text-theme-muted'
                }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {deployModalAgent.is_truly_active ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <RefreshCw className="w-5 h-5 text-indigo-400 shrink-0 animate-spin" />
                    )}
                    <span className="text-xs font-medium">
                      {deployModalAgent.is_truly_active
                        ? (t("connectedTelemetry") || "🟢 ¡Servidor conectado y transmitiendo telemetría en tiempo real!")
                        : (t("waitingHeartbeat") || "⏳ Esperando primer latido (heartbeat) desde el servidor remoto...")}
                    </span>
                  </div>
                  {deployModalAgent.metrics_updated_at && (
                    <span className="text-[11px] opacity-80">
                      Último reporte: {safeFormatDate(deployModalAgent.metrics_updated_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-theme-light bg-theme-panel flex items-center justify-between shrink-0">
              <span className="text-xs text-theme-muted">
                El panel actualiza el estado de conexión automáticamente cada 10 segundos.
              </span>
              <button
                type="button"
                onClick={() => {
                  setDeployModalAgent(null);
                  setCopiedKey(false);
                  setCopiedCommand(false);
                }}
                className="px-4 py-2 bg-theme-main hover:bg-slate-500/10 text-theme-main border border-theme-light rounded-lg text-xs font-medium transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UsersView({ role, token, t }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [editingUserId, setEditingUserId] = useState(null);
  const [formUser, setFormUser] = useState({ username: '', email: '', role: 'read', password: '' });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/users/', {}, token);
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        console.warn("fetchUsers: la respuesta no es un array:", data);
        setUsers([]);
      }
    } catch (e) {
      console.error("fetchUsers error:", e);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === 'admin') fetchUsers();
  }, [role, token]);

  const handleUnlock = async (id) => {
    try {
      await apiFetch(`/users/${id}/unlock/`, { method: 'POST' }, token);
      alert("Usuario desbloqueado.");
      fetchUsers();
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  const openAddModal = () => {
    setModalMode('create');
    setEditingUserId(null);
    setFormUser({ username: '', email: '', role: 'read', password: '' });
    setModalError('');
    setModalOpen(true);
  };

  const openEditModal = (u) => {
    setModalMode('edit');
    setEditingUserId(u.id);
    setFormUser({ username: u.username, email: u.email || '', role: u.role || 'read', password: '' });
    setModalError('');
    setModalOpen(true);
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    setModalLoading(true);
    setModalError('');

    try {
      if (modalMode === 'create') {
        if (!formUser.username.trim() || !formUser.password) {
          throw new Error('El nombre de usuario y la contraseña son obligatorios.');
        }
        const pwdErr = validatePasswordCriteria(formUser.password);
        if (pwdErr) throw new Error(pwdErr);

        await apiFetch('/users/', {
          method: 'POST',
          body: JSON.stringify({
            username: formUser.username.trim(),
            email: formUser.email.trim(),
            role_input: formUser.role,
            password: formUser.password
          })
        }, token);
      } else {
        const payload = {
          email: formUser.email.trim(),
          role_input: formUser.role
        };
        if (formUser.password) {
          const pwdErr = validatePasswordCriteria(formUser.password);
          if (pwdErr) throw new Error(pwdErr);
          payload.password = formUser.password;
        }
        await apiFetch(`/users/${editingUserId}/`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        }, token);
      }

      setModalOpen(false);
      fetchUsers();
    } catch (err) {
      setModalError(err.message || 'Error al guardar el usuario.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleDeleteUser = async (id, username) => {
    if (username === 'admin') return alert("El usuario admin no puede ser eliminado.");
    if (!confirm(`¿Estás seguro de eliminar al usuario ${username}?`)) return;

    try {
      await apiFetch(`/users/${id}/`, { method: 'DELETE' }, token);
      fetchUsers();
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  if (role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] panel p-8 text-center">
        <Lock className="w-16 h-16 text-slate-600 mb-6" />
        <h2 className="text-2xl font-semibold text-theme-main mb-2">{t("accessRestricted")}</h2>
        <p className="text-theme-muted text-sm max-w-md">
          No tienes los permisos necesarios para ver la interfaz IAM. Por favor contacta a un Administrador.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-theme-main tracking-tight">{t("iamTitle")}</h1>
          <p className="text-sm text-theme-muted mt-1">{t("iamDesc")}</p>
        </div>
        <button onClick={openAddModal} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm text-white font-medium transition-colors">
          <Plus className="w-4 h-4" /> {t("addUser")}
        </button>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap min-w-[750px]">
            <thead>
              <tr className="border-b border-theme-light text-xs text-theme-muted">
                <th className="px-6 py-4 font-medium">{t("userId")}</th>
                <th className="px-6 py-4 font-medium">{t("username")}</th>
                <th className="px-6 py-4 font-medium">{t("email") || "CORREO ELECTRÓNICO"}</th>
                <th className="px-6 py-4 font-medium">{t("role")}</th>
                <th className="px-6 py-4 font-medium">{t("status")}</th>
                <th className="px-6 py-4 font-medium text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-500/10">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-theme-muted">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                      <span>Cargando usuarios...</span>
                    </div>
                  </td>
                </tr>
              ) : !Array.isArray(users) || users.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-theme-muted">
                    No se encontraron usuarios registrados.
                  </td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 text-theme-muted">#{u.id.toString().padStart(4, '0')}</td>
                    <td className="px-6 py-4 font-medium text-theme-main">{u.username}</td>
                    <td className="px-6 py-4 text-theme-muted font-mono text-xs">
                      {u.email ? (
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <Mail className="w-3.5 h-3.5 text-indigo-400" />
                          {u.email}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs px-2.5 py-1 bg-indigo-500/10 text-theme-accent rounded-md capitalize font-medium">
                        {u.role || 'read'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {u.is_locked ? (
                        <div className="flex flex-col gap-1 items-start">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-theme-danger bg-rose-500/10 border border-rose-500/20">
                            <Lock className="w-3.5 h-3.5" /> Bloqueado ({u.failed_attempts || 0} fallos)
                          </span>
                          {u.locked_until && (
                            <span className="text-[10px] text-theme-muted font-mono">
                              Hasta: {safeFormatDate(u.locked_until)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-theme-success bg-emerald-500/10">
                          <Unlock className="w-3.5 h-3.5" /> Activo {u.failed_attempts > 0 ? `(${u.failed_attempts} errados)` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right flex justify-end gap-3 items-center">
                      {u.is_locked && (
                        <button onClick={() => handleUnlock(u.id)} className="text-theme-success hover:text-emerald-300 font-medium text-xs">{t("unlock")}</button>
                      )}
                      <button onClick={() => openEditModal(u)} className="text-indigo-400 hover:text-indigo-300 font-medium text-xs">Editar</button>
                      {u.username !== 'admin' && (
                        <button onClick={() => handleDeleteUser(u.id, u.username)} className="text-theme-danger hover:text-rose-400 font-medium text-xs">Eliminar</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Añadir / Editar Usuario */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md panel p-6 shadow-2xl border border-slate-700/50">
            <div className="flex justify-between items-center mb-5 pb-3 border-b border-theme-light">
              <h3 className="text-lg font-semibold text-theme-main flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                {modalMode === 'create' ? 'Añadir Nuevo Usuario' : `Editar Usuario: ${formUser.username}`}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-theme-muted hover:text-theme-main p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-theme-danger text-sm p-3 rounded-lg mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1.5">{t("username")}</label>
                <input
                  type="text"
                  value={formUser.username}
                  onChange={e => setFormUser({ ...formUser, username: e.target.value })}
                  disabled={modalMode === 'edit'}
                  required
                  placeholder="ej. analista_soc"
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1.5 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" />
                  {t("email") || "Correo Electrónico"}
                </label>
                <input
                  type="email"
                  value={formUser.email}
                  onChange={e => setFormUser({ ...formUser, email: e.target.value })}
                  placeholder="analista@empresa.com"
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1.5">{t("role")}</label>
                <select
                  value={formUser.role}
                  onChange={e => setFormUser({ ...formUser, role: e.target.value })}
                  disabled={modalMode === 'edit' && formUser.username === 'admin'}
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main cursor-pointer disabled:opacity-60"
                >
                  <option value="read">Lectura (read)</option>
                  <option value="write">Escritura (write)</option>
                  <option value="admin">Administrador (admin)</option>
                </select>
                {modalMode === 'edit' && formUser.username === 'admin' && (
                  <p className="text-[11px] text-theme-muted mt-1">El usuario principal 'admin' conserva siempre el rol de Administrador.</p>
                )}
              </div>

              <SecurePasswordField
                value={formUser.password}
                onChange={pwd => setFormUser({ ...formUser, password: pwd })}
                label={t("password")}
                helpText={modalMode === 'edit' ? (t("leaveBlankToKeep") || "(Dejar en blanco para no cambiar)") : null}
                required={modalMode === 'create'}
                placeholder={modalMode === 'create' ? "••••••••" : (t("keepCurrentPassword") || "Mantener contraseña actual")}
                showStrength={true}
                suggestButton={true}
                t={t}
              />

              <div className="flex justify-end gap-3 pt-3 border-t border-theme-light">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/20 text-theme-muted hover:text-theme-main rounded-lg text-sm font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20"
                >
                  {modalLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {modalMode === 'create' ? 'Crear Usuario' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportsView({ token, t }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterServer, setFilterServer] = useState('');
  const [filterCrit, setFilterCrit] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const query = filterCrit ? `?criticidad=${filterCrit}&all=true` : '?all=true';
        const data = await apiFetch(`/logs/${query}`, {}, token);
        const logsList = Array.isArray(data) ? data : (data?.results || []);
        setLogs(logsList);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [token, filterCrit]);

  const filteredLogs = logs.filter(l => {
    const matchServer = filterServer === '' || (l.server && l.server.toLowerCase().includes(filterServer.toLowerCase()));

    // date filtering
    let matchDate = true;
    if (filterStartDate) {
      matchDate = matchDate && new Date(l.timestamp) >= new Date(filterStartDate);
    }
    if (filterEndDate) {
      const end = new Date(filterEndDate);
      end.setHours(23, 59, 59, 999);
      matchDate = matchDate && new Date(l.timestamp) <= end;
    }
    return matchServer && matchDate;
  });

  // Data processing for charts
  const critCounts = { CRITICA: 0, ALTA: 0, MEDIA: 0, BAJA: 0, INFO: 0 };
  const nodeCounts = {};
  const dateCounts = {};

  filteredLogs.forEach(l => {
    critCounts[l.criticality] = (critCounts[l.criticality] || 0) + 1;
    nodeCounts[l.server] = (nodeCounts[l.server] || 0) + 1;
    const dateStr = new Date(l.timestamp).toLocaleDateString();
    dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
  });

  const pieData = [
    { name: 'CRITICA', value: critCounts.CRITICA, color: '#fb7185' },
    { name: 'ALTA', value: critCounts.ALTA, color: '#f97316' },
    { name: 'MEDIA', value: critCounts.MEDIA, color: '#fbbf24' },
    { name: 'BAJA', value: critCounts.BAJA, color: '#34d399' },
    { name: 'INFO', value: critCounts.INFO, color: '#60a5fa' },
  ].filter(d => d.value > 0);

  const barData = Object.entries(nodeCounts).map(([name, value]) => ({ name, value }));
  const lineData = Object.entries(dateCounts).map(([date, count]) => ({ date, count })).sort((a, b) => new Date(a.date) - new Date(b.date));

  const handleExportCSV = () => {
    if (filteredLogs.length === 0) return alert(t("noReports"));
    const headers = ["ID", "Timestamp", "Node", "Severity", "Message"];
    const csvContent = [
      headers.join(","),
      ...filteredLogs.map(l => `"${l.id}","${l.timestamp}","${l.server}","${l.criticality}","${l.message.replace(/"/g, '""')}"`)
    ].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    if (filteredLogs.length === 0) return alert(t("noReports"));
    const ws = XLSX.utils.json_to_sheet(filteredLogs.map(l => ({
      ID: l.id,
      Fecha: l.timestamp,
      Nodo: l.server,
      Criticidad: l.criticality,
      Mensaje: l.message
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte SOC");
    XLSX.writeFile(wb, `report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportPDF = async () => {
    if (filteredLogs.length === 0) return alert(t("noReports"));
    const element = document.getElementById('pdf-report-content');
    if (!element) return;
    try {
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: null, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Error generating PDF.");
    }
  };

  return (
    <div className="fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-theme-main tracking-tight">{t("reportsTitle")}</h1>
          <p className="text-sm text-theme-muted mt-1">{t("reportsDesc")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExportCSV} className="flex items-center gap-2 px-3 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/10 rounded-lg text-xs text-theme-main transition-colors">
            <Download className="w-4 h-4" /> {t("generateCsv")}
          </button>
          <button onClick={handleExportExcel} className="flex items-center gap-2 px-3 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/10 rounded-lg text-xs text-theme-main transition-colors">
            <Download className="w-4 h-4" /> {t("generateExcel")}
          </button>
          <button onClick={handleExportPDF} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm text-white font-medium transition-colors">
            <FileText className="w-4 h-4" /> {t("generatePdf")}
          </button>
        </div>
      </div>

      <div className="panel p-5 mb-8 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-theme-muted mb-1.5">{t("filterStartDate")}</label>
          <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="input-field py-2 px-3 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-theme-muted mb-1.5">{t("filterEndDate")}</label>
          <input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="input-field py-2 px-3 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-theme-muted mb-1.5">{t("filterNodes")}</label>
          <input type="text" placeholder="..." value={filterServer} onChange={e => setFilterServer(e.target.value)} className="input-field py-2 px-3 text-sm w-40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-theme-muted mb-1.5">{t("severity")}</label>
          <select value={filterCrit} onChange={e => setFilterCrit(e.target.value)} className="input-field py-2 px-3 text-sm cursor-pointer">
            <option value="">{t("allLevels")}</option>
            <option value="CRITICA">{t("critical")}</option>
            <option value="ALTA">{t("high")}</option>
            <option value="MEDIA">{t("medium")}</option>
            <option value="BAJA">{t("low")}</option>
            <option value="INFO">{t("info")}</option>
          </select>
        </div>
      </div>

      <div id="pdf-report-content" className="bg-theme-main p-4 rounded-xl -mx-4 sm:mx-0">
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="panel p-5 flex flex-col justify-center items-center">
            <span className="text-theme-muted text-sm mb-1">{t("totalAlerts")}</span>
            <span className="text-3xl font-bold text-theme-main">{filteredLogs.length}</span>
          </div>
          <div className="panel p-5 flex flex-col justify-center items-center">
            <span className="text-theme-muted text-sm mb-1">{t("critical")}</span>
            <span className="text-3xl font-bold text-theme-danger">{critCounts.CRITICA || 0}</span>
          </div>
          <div className="panel p-5 flex flex-col justify-center items-center">
            <span className="text-theme-muted text-sm mb-1">{t("high")}</span>
            <span className="text-3xl font-bold text-theme-warning">{critCounts.ALTA || 0}</span>
          </div>
        </div>

        {filteredLogs.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="panel p-6 h-80">
              <h3 className="text-sm font-medium text-theme-muted mb-4">{t("incidentsByCrit")}</h3>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" label>
                    {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={{ backgroundColor: '#131826', borderColor: '#1e293b' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="panel p-6 h-80">
              <h3 className="text-sm font-medium text-theme-muted mb-4">{t("incidentsByNode")}</h3>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                  <RechartsTooltip contentStyle={{ backgroundColor: '#131826', borderColor: '#1e293b' }} />
                  <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel p-6 h-80 lg:col-span-2">
              <h3 className="text-sm font-medium text-theme-muted mb-4">{t("eventsTimeline")}</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                  <RechartsTooltip contentStyle={{ backgroundColor: '#131826', borderColor: '#1e293b' }} />
                  <Line type="monotone" dataKey="count" stroke="#60a5fa" strokeWidth={3} dot={{ r: 4, fill: '#60a5fa', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 panel border-dashed border-2 border-theme-light bg-transparent">
            <PieChartIcon className="w-12 h-12 text-slate-600 mb-4" />
            <p className="text-theme-muted">{t("noReports")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TechMapView({ token, t, theme }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [issTracking, setIssTracking] = useState(false);
  const [mapStyle, setMapStyle] = useState('google-hybrid'); // 'google-hybrid' | 'cyber-dark' | 'esri-satellite' | 'google-terrain' | 'google-streets'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpandedHeight, setIsExpandedHeight] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [cursorCoords, setCursorCoords] = useState({ lat: 20.0, lon: 0.0 });
  const [currentZoom, setCurrentZoom] = useState(2);
  const [ipModalOpen, setIpModalOpen] = useState(false);
  const [ipInput, setIpInput] = useState('186.189.244.18');
  const [ipLoading, setIpLoading] = useState(false);
  const [ipError, setIpError] = useState(null);
  const [jsonModalItem, setJsonModalItem] = useState(null);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layerGroupRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersMapRef = useRef(new Map());

  const CATEGORIES = [
    { id: 'all', label: t('techCatAll') || 'Todos', query: 'all', emoji: '🌐', color: '#6366f1' },
    { id: 'udc', label: t('techCatUdc') || 'UDC Chubut', query: 'udc', emoji: '🏛️', color: '#0ea5e9' },
    { id: 'satelite', label: t('techCatIss') || 'ISS & Satélites', query: 'iss', emoji: '🛰️', color: '#eab308' },
    { id: 'cable', label: t('techCatCables') || 'Cables Submarinos', query: 'cable', emoji: '🌊', color: '#06b6d4' },
    { id: 'ia', label: t('techCatAi') || 'Inteligencia Artificial', query: 'ia', emoji: '🤖', color: '#8b5cf6' },
    { id: 'seguridad', label: t('techCatSecurity') || 'Seguridad & Militar', query: 'seguridad', emoji: '🛡️', color: '#f43f5e' },
    { id: 'osint', label: t('techCatOsint') || 'OSINT & Rastreo', query: 'osint', emoji: '🕵️', color: '#10b981' },
    { id: 'quantum', label: t('techCatQuantum') || 'Computación Cuántica', query: 'cuantica', emoji: '⚛️', color: '#ec4899' },
    { id: 'datacenter', label: t('techCatDataCenters') || 'Data Centers', query: 'data center', emoji: '💾', color: '#f97316' },
    { id: 'tor', label: t('techCatTor') || 'Red Tor & IXP', query: 'tor', emoji: '🧅', color: '#38bdf8' },
    { id: 'chip', label: t('techCatChips') || 'Chips & Semiconductores', query: 'chip', emoji: '💻', color: '#a855f7' },
    { id: 'crypto', label: t('techCatCrypto') || 'Crypto & Blockchain', query: 'crypto', emoji: '🪙', color: '#f59e0b' },
    { id: 'energia', label: t('techCatEnergy') || 'Energía & Bio', query: 'energia', emoji: '⚡', color: '#84cc16' },
    { id: 'radio', label: t('techCatRadio') || 'Radioastronomía & SETI', query: 'radio', emoji: '📡', color: '#14b8a6' },
    { id: 'misterio', label: t('techCatMystery') || 'Misterios & Secreto', query: 'misterio', emoji: '🛸', color: '#d946ef' },
  ];

  const getColorAndEmoji = (tipo) => {
    switch (tipo) {
      case 'ip': return { color: '#ef4444', emoji: '🎯' };
      case 'satelite': return { color: '#eab308', emoji: '🛰️' };
      case 'cable': return { color: '#06b6d4', emoji: '🌊' };
      case 'ia': return { color: '#8b5cf6', emoji: '🤖' };
      case 'osint': return { color: '#10b981', emoji: '🕵️' };
      case 'seguridad': return { color: '#f43f5e', emoji: '🛡️' };
      case 'quantum': return { color: '#ec4899', emoji: '⚛️' };
      case 'datacenter': return { color: '#f97316', emoji: '💾' };
      case 'tor': return { color: '#38bdf8', emoji: '🧅' };
      case 'net': return { color: '#38bdf8', emoji: '🌐' };
      case 'tech': return { color: '#a855f7', emoji: '💻' };
      case 'crypto': return { color: '#f59e0b', emoji: '🪙' };
      case 'energia': return { color: '#84cc16', emoji: '⚡' };
      case 'bio': return { color: '#ec4899', emoji: '🧬' };
      case 'udc': return { color: '#0ea5e9', emoji: '🏛️' };
      case 'radio': return { color: '#14b8a6', emoji: '📡' };
      case 'misterio': return { color: '#d946ef', emoji: '🛸' };
      case 'ciencia': return { color: '#6366f1', emoji: '📍' };
      default: return { color: '#6366f1', emoji: '📍' };
    }
  };

  // Capas de mapa 100% GRATIS y sin necesidad de API KEY
  const getTileConfig = (style) => {
    switch (style) {
      case 'google-hybrid':
        return {
          url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
          options: {
            subdomains: ['0', '1', '2', '3'],
            attribution: 'Imágenes Satelitales &copy; Google Maps / Google Earth',
            maxZoom: 20
          },
          label: t('googleEarthTileLabel') || 'Google Earth (Satélite HD)'
        };
      case 'cyber-dark':
        return {
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          options: {
            attribution: '&copy; OpenStreetMap (Modo Cyber)',
            maxZoom: 19,
            className: 'cyber-tile-dark'
          },
          label: t('cyberDarkTileLabel') || 'Cyber Dark (Táctico)'
        };
      case 'esri-satellite':
      case 'satellite':
        return {
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          options: {
            attribution: 'Tiles &copy; Esri &mdash; Earthstar Geographics',
            maxZoom: 18
          },
          label: t('esriSatelliteTileLabel') || 'Satélite Esri'
        };
      case 'google-terrain':
        return {
          url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
          options: {
            subdomains: ['0', '1', '2', '3'],
            attribution: 'Relieve &copy; Google Maps',
            maxZoom: 20
          },
          label: t('googleTerrainTileLabel') || 'Google Terreno (Relieve)'
        };
      case 'google-streets':
        return {
          url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
          options: {
            subdomains: ['0', '1', '2', '3'],
            attribution: 'Calles &copy; Google Maps',
            maxZoom: 20
          },
          label: t('googleStreetsTileLabel') || 'Google Calles'
        };
      case 'streets':
      case 'osm':
      default:
        return {
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          options: {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
          },
          label: 'OpenStreetMap'
        };
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  // Asegurar que al ingresar al Mapa Tecnológico la pantalla siempre esté posicionada arriba de todo
  useEffect(() => {
    const scrollToTop = () => {
      const scrollEl = document.getElementById('soc-main-scroll');
      if (scrollEl) {
        scrollEl.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        scrollEl.scrollTop = 0;
      }
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    scrollToTop();
    const t1 = setTimeout(scrollToTop, 40);
    const t2 = setTimeout(scrollToTop, 150);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Salir de pantalla completa con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // ResizeObserver para garantizar que el mapa NUNCA quede gris o en blanco al cambiar tamaño o pantalla completa
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize({ debounceMoveEvents: true });
      }
    });
    ro.observe(mapContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Forzar múltiples invalidaciones al alternar modos
  useEffect(() => {
    const trigger = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };
    trigger();
    const t1 = setTimeout(trigger, 60);
    const t2 = setTimeout(trigger, 180);
    const t3 = setTimeout(trigger, 400);
    const t4 = setTimeout(trigger, 750);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [isFullscreen, isExpandedHeight, showSidebar]);

  const fetchMapData = async (query = '') => {
    const q = (query || '').trim();
    if (!q) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const endpoint = `/api/tech-map/?q=${encodeURIComponent(q)}`;
      const data = await apiFetch(endpoint, {}, token);
      const results = Array.isArray(data?.results) ? data.results : [];
      setItems(results);

      if (results.length === 1 && Array.isArray(results[0].coords)) {
        setSelectedItem(results[0]);
        if (mapRef.current) {
          const zoomLevel = results[0].tipo === 'udc' ? 16 : (results[0].tipo === 'ip' ? 12 : 14);
          mapRef.current.flyTo(results[0].coords, zoomLevel, { duration: 1.4 });
          setTimeout(() => {
            const marker = markersMapRef.current.get(0);
            if (marker && marker.openPopup) marker.openPopup();
          }, 700);
        }
      } else if (results.length > 1 && mapRef.current) {
        setSelectedItem(results[0]);
        const validCoords = [];
        results.forEach(r => {
          if (Array.isArray(r.coords)) {
            if (typeof r.coords[0] === 'number') {
              validCoords.push(r.coords);
            } else if (Array.isArray(r.coords[0])) {
              r.coords.forEach(c => validCoords.push(c));
            }
          }
        });
        if (validCoords.length > 0 && window.L) {
          const bounds = window.L.latLngBounds(validCoords);
          mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 13, duration: 1.4 });
          setTimeout(() => {
            const marker = markersMapRef.current.get(0);
            if (marker && marker.openPopup) marker.openPopup();
          }, 800);
        }
      }
    } catch (e) {
      console.error("Error fetching tech map data:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleGeolocateIp = async (targetIp) => {
    const ip = (targetIp || ipInput).trim();
    if (!ip) return;
    setIpLoading(true);
    setIpError(null);
    try {
      const endpoint = `/api/tech-map/?ip=${encodeURIComponent(ip)}`;
      const data = await apiFetch(endpoint, {}, token);
      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length > 0) {
        setItems(results);
        setActiveCategory('');
        setSearchQuery(ip);
        setIpModalOpen(false);
        const first = results[0];
        setSelectedItem(first);
        if (mapRef.current && Array.isArray(first.coords)) {
          mapRef.current.flyTo(first.coords, 12, { duration: 1.4 });
          setTimeout(() => {
            const marker = markersMapRef.current.get(0);
            if (marker && marker.openPopup) marker.openPopup();
          }, 750);
        }
      } else {
        setIpError(`No se pudo geolocalizar la IP "${ip}". Verifica que sea una dirección pública válida.`);
      }
    } catch (e) {
      console.error("Error al geolocalizar IP:", e);
      setIpError("Error de conexión al consultar el servicio de geolocalización.");
    } finally {
      setIpLoading(false);
    }
  };

  useEffect(() => {
    let checkInterval = null;

    const initMap = () => {
      if (!window.L || !mapContainerRef.current) return;
      if (mapRef.current) return;

      // Por defecto ver todo el planeta tierra completo (Vista Global)
      const map = window.L.map(mapContainerRef.current, {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 20,
        zoomControl: false,
      });

      const { url, options } = getTileConfig(mapStyle);
      const tileLayer = window.L.tileLayer(url, options).addTo(map);
      tileLayerRef.current = tileLayer;

      const layerGroup = window.L.layerGroup().addTo(map);
      mapRef.current = map;
      layerGroupRef.current = layerGroup;

      map.on('mousemove', (e) => {
        if (e.latlng) {
          setCursorCoords({ lat: e.latlng.lat, lon: e.latlng.lng });
        }
      });
      map.on('zoomend', () => {
        setCurrentZoom(map.getZoom());
      });
    };

    if (window.L) {
      initMap();
    } else {
      checkInterval = setInterval(() => {
        if (window.L) {
          clearInterval(checkInterval);
          initMap();
        }
      }, 200);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerGroupRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, []);

  // Update tile layer when mapStyle changes
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current || !window.L) return;

    mapRef.current.removeLayer(tileLayerRef.current);
    const { url, options } = getTileConfig(mapStyle);
    const newLayer = window.L.tileLayer(url, options).addTo(mapRef.current);
    newLayer.bringToBack();
    tileLayerRef.current = newLayer;
  }, [mapStyle]);

  // Render markers and polyline cables
  useEffect(() => {
    if (!mapRef.current || !layerGroupRef.current || !window.L) return;

    const layerGroup = layerGroupRef.current;
    layerGroup.clearLayers();
    markersMapRef.current.clear();

    items.forEach((item, index) => {
      const { color, emoji } = getColorAndEmoji(item.tipo);

      if (item.tipo === 'cable' && Array.isArray(item.coords) && item.coords.length >= 2) {
        const polyline = window.L.polyline(item.coords, {
          color: '#06b6d4',
          weight: 4,
          opacity: 0.9,
          dashArray: '8, 10'
        }).addTo(layerGroup);

        item.coords.forEach((coord) => {
          window.L.circleMarker(coord, {
            radius: 5,
            fillColor: '#06b6d4',
            color: '#ffffff',
            weight: 2,
            fillOpacity: 1
          }).addTo(layerGroup);
        });

        const popupContent = `
          <div style="min-width: 230px; max-width: 300px; padding: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
              <span style="font-weight: 800; font-size: 14px; color: #38bdf8;">${item.nombre}</span>
              <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: rgba(6,182,212,0.2); color: #06b6d4; border: 1px solid rgba(6,182,212,0.4);">CABLE SUBMARINO</span>
            </div>
            <p style="font-size: 12px; line-height: 1.45; opacity: 0.95; margin-bottom: 8px; color: #f1f5f9;">${item.desc || ''}</p>
            <div style="font-family: monospace; font-size: 11px; opacity: 0.7; background: rgba(6,182,212,0.1); padding: 4px 6px; border-radius: 4px;">
              🌊 Conexión Transoceánica de Fibra Óptica
            </div>
          </div>
        `;
        polyline.bindPopup(popupContent);
        markersMapRef.current.set(index, polyline);
      } else if (Array.isArray(item.coords) && typeof item.coords[0] === 'number') {
        const isSatelite = item.tipo === 'satelite';
        const isIp = item.tipo === 'ip';
        const isUdc = item.tipo === 'udc';
        const ipData = item.ip_data || {};

        let pinClass = 'custom-tech-pin';
        if (isSatelite) pinClass += ' pulse-satellite';
        if (isIp) pinClass += ' pulse-target-ip';
        if (isUdc) pinClass += ' pulse-udc';

        const pinColor = isIp ? '#ef4444' : (isUdc ? '#0284c7' : color);
        const pinEmoji = isIp ? '🎯' : (isUdc ? '🏛️' : emoji);
        const pinSize = isIp ? 36 : (isUdc ? 34 : 30);

        const iconHtml = `
          <div class="${pinClass}" style="
            background: ${pinColor};
            width: ${pinSize}px;
            height: ${pinSize}px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 18px ${pinColor}ee, inset 0 0 6px rgba(255,255,255,0.6);
            border: 2px solid #ffffff;
            font-size: ${isIp ? '18px' : '15px'};
            cursor: pointer;
            transition: all 0.2s ease;
          ">
            <span>${pinEmoji}</span>
          </div>
        `;

        const icon = window.L.divIcon({
          html: iconHtml,
          className: '',
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
          popupAnchor: [0, -pinSize / 2]
        });

        const marker = window.L.marker(item.coords, { icon }).addTo(layerGroup);

        let popupContent = '';
        if (isIp) {
          const isProxy = String(ipData.is_proxy).toLowerCase() === 'true';
          const riskScore = Number(ipData.risk_score || 0);
          popupContent = `
            <div style="min-width: 270px; max-width: 320px; padding: 6px; font-family: system-ui, sans-serif;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid rgba(239,68,68,0.3); padding-bottom: 6px;">
                <span style="font-weight: 800; font-size: 15px; color: #f87171;">🎯 ${ipData.ip || item.nombre}</span>
                <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.4);">IP INTEL</span>
              </div>
              <div style="font-size: 12px; margin-bottom: 6px; line-height: 1.5; color: #f1f5f9;">
                <div>📍 <b>Ubicación:</b> ${[ipData.city, ipData.region, ipData.country].filter(Boolean).join(', ') || 'N/A'}</div>
                <div>🏢 <b>ISP / Red:</b> ${ipData.isp || 'N/A'}</div>
                <div>🌐 <b>ASN:</b> ${ipData.asn || 'N/A'} (${ipData.as_owner || ''})</div>
                ${ipData.company ? `<div>🏛️ <b>Compañía:</b> ${ipData.company}</div>` : ''}
              </div>
              <div style="display: flex; gap: 6px; margin: 8px 0; flex-wrap: wrap;">
                <span style="font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: ${isProxy ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}; color: ${isProxy ? '#ef4444' : '#10b981'}; border: 1px solid ${isProxy ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'};">
                  ${isProxy ? '⚠️ Proxy: SÍ' : '🛡️ Proxy: NO'}
                </span>
                <span style="font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: ${riskScore > 40 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}; color: ${riskScore > 40 ? '#f87171' : '#fbbf24'}; border: 1px solid ${riskScore > 40 ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)'};">
                  Riesgo: ${riskScore}/100
                </span>
              </div>
              <div style="font-family: monospace; font-size: 11px; opacity: 0.65; margin-top: 6px;">
                Coordenadas: [${item.coords[0].toFixed(5)}, ${item.coords[1].toFixed(5)}]
              </div>
            </div>
          `;
        } else if (isUdc) {
          popupContent = `
            <div style="min-width: 270px; max-width: 330px; padding: 6px; font-family: system-ui, sans-serif;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; border-bottom: 1px solid rgba(14,165,233,0.3); padding-bottom: 6px;">
                <span style="font-weight: 800; font-size: 15px; color: #38bdf8;">🏛️ ${item.nombre}</span>
                <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: rgba(14,165,233,0.2); color: #38bdf8; border: 1px solid rgba(14,165,233,0.4);">UNIVERSIDAD</span>
              </div>
              <p style="font-size: 12px; line-height: 1.45; margin-bottom: 8px; color: #f1f5f9;">${item.desc || 'Sede oficial de la Universidad del Chubut (UDC).'}</p>
              <div style="display: flex; align-items: center; justify-content: space-between; font-family: monospace; font-size: 11px; opacity: 0.85; margin-bottom: 8px; background: rgba(14,165,233,0.12); padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(14,165,233,0.25);">
                <span>📍 Chubut, Argentina</span>
                <span>[${item.coords[0].toFixed(4)}, ${item.coords[1].toFixed(4)}]</span>
              </div>
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <a href="${item.url || 'https://udc.edu.ar'}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #38bdf8; text-decoration: none; font-weight: 700; background: rgba(14,165,233,0.2); border: 1px solid rgba(14,165,233,0.4); padding: 5px 10px; border-radius: 6px; transition: background 0.2s;">
                  Portal UDC Oficial ↗
                </a>
              </div>
            </div>
          `;
        } else {
          popupContent = `
            <div style="min-width: 230px; max-width: 310px; padding: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                <span style="font-weight: 800; font-size: 14px; color: #ffffff;">${item.nombre}</span>
                <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: ${color}25; color: ${color}; border: 1px solid ${color}50;">${item.tipo}</span>
              </div>
              <p style="font-size: 12px; line-height: 1.45; opacity: 0.95; margin-bottom: 8px; color: #f1f5f9;">${item.desc || ''}</p>
              <div style="font-family: monospace; font-size: 11px; opacity: 0.7; margin-bottom: 8px;">
                📍 [${item.coords[0].toFixed(4)}, ${item.coords[1].toFixed(4)}]
              </div>
              ${item.url ? `<a href="${item.url}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #818cf8; text-decoration: underline; font-weight: 600;">Abrir enlace oficial ↗</a>` : ''}
            </div>
          `;
        }
        marker.bindPopup(popupContent);
        markersMapRef.current.set(index, marker);
      }
    });
  }, [items]);

  useEffect(() => {
    if (!issTracking) return;
    const interval = setInterval(() => {
      fetchMapData('iss');
    }, 6000);
    return () => clearInterval(interval);
  }, [issTracking]);

  const handleCategoryClick = (cat) => {
    setActiveCategory(cat.id);
    setSearchQuery(cat.query || '');
    if (cat.id === 'satelite') {
      setIssTracking(true);
    } else {
      setIssTracking(false);
    }
    fetchMapData(cat.query || '');
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setItems([]);
      setActiveCategory('');
      setIssTracking(false);
      return;
    }
    const ipMatch = q.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) {
      handleGeolocateIp(ipMatch[0]);
      return;
    }
    setActiveCategory('');
    fetchMapData(q);
  };

  const handleFocusItem = (item, index) => {
    setSelectedItem(item);
    if (!mapRef.current) return;

    if (Array.isArray(item.coords) && typeof item.coords[0] === 'number') {
      const zoomTarget = item.tipo === 'udc' ? 16 : (item.tipo === 'ip' ? 13 : 14);
      mapRef.current.flyTo(item.coords, zoomTarget, { duration: 1.3 });
      const marker = markersMapRef.current.get(index);
      if (marker && marker.openPopup) {
        setTimeout(() => marker.openPopup(), 650);
      }
    } else if (item.tipo === 'cable' && Array.isArray(item.coords) && item.coords.length > 0) {
      const midCoord = item.coords[0];
      mapRef.current.flyTo(midCoord, 5, { duration: 1.2 });
      const marker = markersMapRef.current.get(index);
      if (marker && marker.openPopup) {
        setTimeout(() => marker.openPopup(), 650);
      }
    }
  };

  const handleResetMap = () => {
    if (mapRef.current) {
      mapRef.current.flyTo([20, 0], 2, { duration: 1.2 });
    }
  };

  const currentHeightPx = isExpandedHeight ? 760 : 560;

  return (
    <div className={isFullscreen
      ? "fixed inset-0 z-[99999] w-screen h-screen bg-slate-950 p-2 sm:p-3 flex flex-col gap-2 overflow-hidden select-none"
      : "fade-in space-y-4"
    }>
      {/* Top Header / Control Bar */}
      <div className="shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 bg-theme-panel/80 p-3 rounded-xl border border-theme-light shadow-lg">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
            <Globe className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-theme-main tracking-tight flex items-center gap-1.5">
                {t("techMap") || "Mapa Tecnológico Forense"}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                {getTileConfig(mapStyle).label}
              </span>
            </div>
            {!isFullscreen && (
              <p className="text-xs text-theme-muted mt-0.5 hidden md:block">
                {t("techMapDesc") || "Monitoreo geoespacial interactivo de infraestructura crítica, UDC Chubut, nodos Tor, satélites ISS y cables submarinos."}
              </p>
            )}
          </div>
        </div>

        {/* Toolbar Actions */}
        <div className="flex items-center gap-1.5 flex-wrap ml-auto">
          {/* Layer Selector */}
          <div className="flex items-center bg-slate-900/90 border border-theme-light rounded-lg p-0.5 shadow-inner">
            <button
              type="button"
              onClick={() => setMapStyle('google-hybrid')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${mapStyle === 'google-hybrid'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-950/40'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-800'
                }`}
              title="Google Earth Satelital HD"
            >
              <span>🌍</span> {t("satelliteEarth") || "Satélite Earth"}
            </button>
            <button
              type="button"
              onClick={() => setMapStyle('cyber-dark')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${mapStyle === 'cyber-dark'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950/40'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-800'
                }`}
              title="Cyber Dark"
            >
              <span>🌌</span> {t("cyberDark") || "Cyber Dark"}
            </button>
            <button
              type="button"
              onClick={() => setMapStyle('esri-satellite')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${mapStyle === 'esri-satellite'
                ? 'bg-cyan-700 text-white shadow-md'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-800'
                }`}
              title="Esri Satellite"
            >
              <span>🛰️</span> {t("esriSatellite") || "Esri"}
            </button>
            <button
              type="button"
              onClick={() => setMapStyle('google-terrain')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${mapStyle === 'google-terrain'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-800'
                }`}
              title="Terrain"
            >
              <span>🏔️</span> {t("terrainMap") || "Relieve"}
            </button>
            <button
              type="button"
              onClick={() => setMapStyle('google-streets')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${mapStyle === 'google-streets'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-950/40'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-800'
                }`}
              title="Streets"
            >
              <span>🗺️</span> {t("streetsMap") || "Calles"}
            </button>
          </div>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${isFullscreen
              ? 'bg-rose-500/25 text-rose-300 border-rose-500/50 hover:bg-rose-500/35 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
              : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
              }`}
            title={isFullscreen ? (t("exitFullscreen") || "Salir de pantalla completa (Esc)") : (t("fullscreen") || "Agrandar mapa a pantalla completa")}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            <span>{isFullscreen ? (t("exitFullscreen") || "Reducir (Esc)") : (t("fullscreen") || "Pantalla Completa")}</span>
          </button>

          {/* Height Expand Toggle (only in normal view) */}
          {!isFullscreen && (
            <button
              type="button"
              onClick={() => setIsExpandedHeight(prev => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-theme-panel border border-theme-light hover:bg-slate-800 rounded-lg text-xs font-semibold text-theme-muted hover:text-theme-main transition-colors cursor-pointer"
              title="Ampliar / Reducir alto"
            >
              <span>↕</span> {isExpandedHeight ? (t("normalHeight") || "Normal (560px)") : (t("expandHeight") || "Ampliar Alto (760px)")}
            </button>
          )}

          {/* Global World Center Button */}
          <button
            type="button"
            onClick={handleResetMap}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-theme-panel border border-theme-light hover:bg-slate-800 rounded-lg text-xs font-medium text-theme-muted hover:text-theme-main transition-colors cursor-pointer"
            title={t("worldGlobalView") || "Vista global de la Tierra"}
          >
            <Compass className="w-3.5 h-3.5 text-cyan-400" /> {t("globalPlanet") || "Planeta Global"}
          </button>

          {/* IP Geolocation Modal Trigger */}
          <button
            type="button"
            onClick={() => { setIpInput('186.189.244.18'); setIpModalOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm"
            title={t("trackIp") || "Rastrear IP"}
          >
            <Target className="w-3.5 h-3.5 text-rose-400" /> {t("trackIp") || "Rastrear IP"}
          </button>

          {/* Clear button if active */}
          {(items.length > 0 || activeCategory || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setItems([]);
                setActiveCategory('');
                setIssTracking(false);
                handleResetMap();
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              title={t("clearMap") || "Limpiar mapa y objetivos"}
            >
              <X className="w-3.5 h-3.5" /> {t("clearMap") || "Limpiar"}
            </button>
          )}
        </div>
      </div>

      {/* Buscador + Presets Rápidos */}
      <div className="shrink-0 space-y-2">
        <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
          <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1 max-w-2xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400" />
              <input
                type="search"
                name="tech_map_geo_search"
                id="tech_map_geo_search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck="false"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchMapPlaceholder") || 'Buscar "udc", ciudad (ej. Rawson, Buenos Aires), satélite, cable submarino, IP...'}
                className="w-full pl-9 pr-9 py-2 input-field text-xs sm:text-sm font-medium text-theme-main shadow-sm focus:border-cyan-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setItems([]); setActiveCategory(''); setIssTracking(false); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-main p-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 shrink-0 shadow-md shadow-cyan-950/40 cursor-pointer disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>{loading ? (t("searching") || "Buscando...") : (t("searchAndCenter") || "Buscar y Centrar")}</span>
            </button>
          </form>

          {/* Quick Presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('udc');
                setActiveCategory('udc');
                fetchMapData('udc');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${activeCategory === 'udc'
                ? 'bg-sky-500/25 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(14,165,233,0.3)]'
                : 'bg-sky-500/10 border-sky-500/30 text-sky-300 hover:bg-sky-500/20'
                }`}
              title="UDC Chubut"
            >
              <span>🏛️</span> UDC Chubut
            </button>
          </div>
        </div>

        {/* Coincidencias / Quick Result Pills */}
        {items.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 animate-fadeIn">
            <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
              <Crosshair className="w-3.5 h-3.5" /> {items.length} {items.length === 1 ? (t('placeFound') || 'Lugar encontrado') : (t('placesFound') || 'Lugares encontrados')}:
            </span>
            {items.map((item, idx) => {
              const { emoji } = getColorAndEmoji(item.tipo);
              const isSelected = selectedItem === item;
              return (
                <button
                  key={`${item.nombre}-${idx}`}
                  type="button"
                  onClick={() => handleFocusItem(item, idx)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border ${isSelected
                    ? 'bg-cyan-500/30 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/50 scale-105'
                    : 'bg-theme-panel hover:bg-slate-800 border-theme-light text-theme-muted hover:text-theme-main'
                    }`}
                >
                  <span>{emoji}</span>
                  <span>{item.nombre}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Chips de Categorías */}
        {!isFullscreen && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategoryClick(cat)}
                  className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1.5 border cursor-pointer ${active
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                    : 'bg-theme-panel text-theme-muted hover:text-theme-main border-theme-light hover:bg-slate-800/60'
                    }`}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Visual: Map + Sidebar */}
      <div
        className={`flex flex-col lg:flex-row gap-3 w-full ${isFullscreen ? 'flex-1 min-h-0' : ''
          }`}
        style={isFullscreen ? { flex: '1 1 0%', minHeight: 0 } : {}}
      >
        {/* Leaflet Map Frame */}
        <div
          className="flex-1 relative rounded-xl border border-cyan-500/30 overflow-hidden shadow-2xl earth-map-wrapper earth-atmosphere-glow"
          style={{
            height: isFullscreen ? '100%' : `${currentHeightPx}px`,
            minHeight: isFullscreen ? '100%' : `${currentHeightPx}px`,
            position: 'relative'
          }}
        >
          <div
            id="tech-map"
            ref={mapContainerRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              height: '100%',
              zIndex: 0
            }}
          />

          {/* Loading Indicator Overlay */}
          {loading && (
            <div className="absolute top-4 left-4 z-20 bg-slate-950/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-cyan-500/40 flex items-center gap-2 text-xs font-semibold text-cyan-300 shadow-2xl animate-pulse">
              <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
              <span>{t("syncingCoordinates") || "Sincronizando coordenadas y satélites..."}</span>
            </div>
          )}

          {/* On-Map Floating HUD Telemetry (Bottom Left) */}
          <div className="absolute bottom-3 left-3 z-10 bg-slate-950/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-cyan-500/30 text-[11px] font-mono text-cyan-300 flex items-center gap-3 shadow-xl pointer-events-none">
            <div className="flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-cyan-400 rotate-45" />
              <span>LAT: {cursorCoords.lat.toFixed(4)}° | LON: {cursorCoords.lon.toFixed(4)}°</span>
            </div>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <div className="hidden sm:flex items-center gap-1 text-slate-400">
              <span>ZOOM: {currentZoom}</span>
              <span>({getTileConfig(mapStyle).label})</span>
            </div>
          </div>

          {/* On-Map Quick Controls (Bottom Right) */}
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 bg-slate-950/90 backdrop-blur-md p-1.5 rounded-xl border border-cyan-500/30 shadow-2xl">
            <button
              type="button"
              onClick={() => mapRef.current?.zoomIn()}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-cyan-300 font-bold text-base transition-colors cursor-pointer"
              title={t("zoomIn") || "Acercar mapa (+)"}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => mapRef.current?.zoomOut()}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-cyan-300 font-bold text-base transition-colors cursor-pointer"
              title={t("zoomOut") || "Alejar mapa (-)"}
            >
              -
            </button>
            <button
              type="button"
              onClick={handleResetMap}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-cyan-300 transition-colors cursor-pointer"
              title={t("worldGlobalView") || "Vista global de la Tierra"}
            >
              <Compass className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="w-7 h-7 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 flex items-center justify-center transition-colors cursor-pointer"
              title={isFullscreen ? (t("exitFullscreen") || "Salir de pantalla completa") : (t("fullscreen") || "Pantalla Completa")}
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setShowSidebar(prev => !prev)}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer hidden md:flex"
              title={showSidebar ? (t("hideSidebar") || "Ocultar panel lateral (100% mapa)") : (t("showSidebar") || "Mostrar panel de objetivos")}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Panel lateral con listado interactivo */}
        {showSidebar && (
          <div
            className={`w-full lg:w-96 shrink-0 panel p-4 border border-theme-light flex flex-col ${isFullscreen ? 'h-full min-h-0 overflow-hidden' : ''
              }`}
            style={{
              height: isFullscreen ? '100%' : `${currentHeightPx}px`,
              maxHeight: isFullscreen ? '100%' : `${currentHeightPx}px`
            }}
          >
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-theme-light">
              <h3 className="text-sm font-bold text-theme-main flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                {t("radarTargets") || "Objetivos en el Radar"} ({items.length})
              </h3>
              {loading && <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {items.map((item, index) => {
                const { color, emoji } = getColorAndEmoji(item.tipo);
                const isSelected = selectedItem === item;
                const isUdc = item.tipo === 'udc';
                return (
                  <div
                    key={`${item.nombre}-${index}`}
                    onClick={() => handleFocusItem(item, index)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${isSelected
                      ? 'bg-cyan-500/15 border-cyan-400 shadow-md shadow-cyan-950/30'
                      : isUdc
                        ? 'bg-sky-950/20 border-sky-500/30 hover:border-sky-400 hover:bg-sky-900/20'
                        : 'bg-theme-main border-theme-light hover:border-slate-500/40 hover:bg-slate-800/30'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg shrink-0">{emoji}</span>
                        <p className="text-xs sm:text-sm font-bold text-theme-main truncate">{item.nombre}</p>
                      </div>
                      <span
                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0"
                        style={{ backgroundColor: `${color}25`, color: color, border: `1px solid ${color}50` }}
                      >
                        {item.tipo}
                      </span>
                    </div>

                    {item.tipo === 'ip' && item.ip_data ? (
                      <div className="space-y-2 mt-2 pt-2 border-t border-theme-light text-[11px]">
                        <div className="grid grid-cols-2 gap-1 bg-slate-900/40 p-2 rounded-lg border border-slate-800/80">
                          <div>
                            <span className="text-slate-400 block text-[10px]">{t("city") || "Ciudad:"}</span>
                            <span className="font-semibold text-theme-main truncate block">{item.ip_data.city || 'N/A'}, {item.ip_data.country || ''}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px]">{t("ispNetwork") || "ISP / Red:"}</span>
                            <span className="font-semibold text-theme-main truncate block" title={item.ip_data.isp}>{item.ip_data.isp || 'N/A'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${String(item.ip_data.is_proxy).toLowerCase() === 'true' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
                            {String(item.ip_data.is_proxy).toLowerCase() === 'true' ? (t("proxyYes") || '⚠️ Proxy: SÍ') : (t("proxyNo") || '🛡️ Proxy: NO')}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {t("risk") || "Riesgo:"} {item.ip_data.risk_score || 0}/100
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setJsonModalItem(item.ip_data);
                          }}
                          className="w-full mt-1 py-1 px-2 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/40 border border-cyan-800/40 rounded flex items-center justify-center gap-1 transition-colors cursor-pointer"
                        >
                          <Terminal className="w-3 h-3" /> {t("viewApiJson") || "Ver JSON de API iping.cc"}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-theme-muted line-clamp-2 mb-1.5 leading-relaxed">
                        {item.desc || (t("noDescription") || 'Sin descripción disponible.')}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] mt-1.5 pt-1 border-t border-theme-light/40">
                      <span className="font-mono text-slate-500">
                        {Array.isArray(item.coords) && typeof item.coords[0] === 'number'
                          ? `[${item.coords[0].toFixed(2)}, ${item.coords[1].toFixed(2)}]`
                          : (t("submarine") || 'Submarino')}
                      </span>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                        >
                          {t("openOfficialLink") || "Abrir enlace"} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}

              {items.length === 0 && !loading && (
                <div className="text-center py-16 px-4 text-theme-muted text-xs flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-lg">
                    <Compass className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <p className="font-bold text-theme-main text-sm">{t("radarIdle") || "Radar en espera"}</p>
                    <p className="max-w-[240px] text-theme-muted leading-relaxed mt-1">
                      {t("radarIdleDesc") || 'Escribe "udc", elige una categoría o busca cualquier ciudad para volar allí.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Geolocalizador de IP */}
      {ipModalOpen && (
        <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-theme-panel border border-cyan-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-theme-light">
              <h3 className="text-base font-bold text-theme-main flex items-center gap-2">
                <Target className="w-5 h-5 text-rose-500" /> {t("ipForensicGeolocator") || "Geolocalizador Forense de IP"}
              </h3>
              <button
                type="button"
                onClick={() => { setIpModalOpen(false); setIpError(null); }}
                className="text-theme-muted hover:text-theme-main p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-theme-muted leading-relaxed">
              {t("ipForensicGeolocatorDesc") || "Ingresa una dirección IP pública para geolocalizarla en el mapa, obtener coordenadas exactas, ASN, proveedor de Internet (ISP), proxy y análisis de riesgo."}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleGeolocateIp(ipInput);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-theme-main mb-1.5">
                  {t("ipv4OrIpv6") || "Dirección IPv4 o IPv6:"}
                </label>
                <input
                  type="text"
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  placeholder="Ej: 186.189.244.18"
                  className="input-field py-2.5 px-3 font-mono text-sm text-theme-main w-full"
                  autoFocus
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-theme-muted text-[11px]">{t("suggestions") || "Sugerencias:"}</span>
                <button
                  type="button"
                  onClick={() => {
                    setIpInput('186.189.244.18');
                    handleGeolocateIp('186.189.244.18');
                  }}
                  className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded text-[11px] font-mono transition-colors cursor-pointer"
                >
                  📍 186.189.244.18 (Chubut, AR)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIpInput('8.8.8.8');
                    handleGeolocateIp('8.8.8.8');
                  }}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-[11px] font-mono transition-colors cursor-pointer"
                >
                  8.8.8.8 (Google)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIpInput('1.1.1.1');
                    handleGeolocateIp('1.1.1.1');
                  }}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-[11px] font-mono transition-colors cursor-pointer"
                >
                  1.1.1.1 (Cloudflare)
                </button>
              </div>

              {ipError && (
                <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{ipError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-theme-light">
                <button
                  type="button"
                  onClick={() => { setIpModalOpen(false); setIpError(null); }}
                  className="px-4 py-2 text-xs font-semibold text-theme-muted hover:text-theme-main bg-theme-panel border border-theme-light rounded-xl transition-colors cursor-pointer"
                >
                  {t("cancel") || "Cancelar"}
                </button>
                <button
                  type="submit"
                  disabled={ipLoading || !ipInput.trim()}
                  className="px-4 py-2 bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-rose-950/40 disabled:opacity-50 cursor-pointer"
                >
                  {ipLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t("trackingInProgress") || "Rastreando..."}
                    </>
                  ) : (
                    <>
                      <Target className="w-3.5 h-3.5" /> {t("trackIpOnMap") || "Rastrear IP en Mapa"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Visor JSON Completo de iping.cc */}
      {jsonModalItem && (
        <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-theme-panel border border-cyan-500/30 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-theme-light">
              <h3 className="text-base font-bold text-theme-main flex items-center gap-2">
                <Terminal className="w-5 h-5 text-cyan-400" /> {t("rawIntelIping") || "Inteligencia Bruta (API iping.cc)"}
              </h3>
              <button
                type="button"
                onClick={() => setJsonModalItem(null)}
                className="text-theme-muted hover:text-theme-main p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400">
              <pre>{JSON.stringify(jsonModalItem, null, 2)}</pre>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(jsonModalItem, null, 2));
                }}
                className="px-3.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" /> {t("copyJson") || "Copiar JSON"}
              </button>
              <button
                type="button"
                onClick={() => setJsonModalItem(null)}
                className="px-4 py-1.5 text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl transition-colors cursor-pointer"
              >
                {t("close") || "Cerrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DomainsView({ token, t, theme, role }) {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'online' | 'offline' | 'monitoring'
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'

  // Modal de Agregar Dominio
  const [modalOpen, setModalOpen] = useState(false);
  const [inputTarget, setInputTarget] = useState('');
  const [inputInterval, setInputInterval] = useState(60);
  const [inputChatId, setInputChatId] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState(null);

  // Modal de Edición de Intervalo & Telegram
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState(null);
  const [editInterval, setEditInterval] = useState(60);
  const [editChatId, setEditChatId] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editSuccess, setEditSuccess] = useState(false);

  const fetchDomains = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await apiFetch('/api/domains/', {}, token);
      if (Array.isArray(data)) {
        setDomains(data);
      }
    } catch (e) {
      console.error("Error al obtener dominios:", e);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains(true);
    const interval = setInterval(() => {
      fetchDomains(false);
    }, 8000);
    return () => clearInterval(interval);
  }, [token]);

  const handleAddDomain = async (e) => {
    e.preventDefault();
    const target = inputTarget.trim();
    if (!target) return;
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await apiFetch('/api/domains/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: target,
          check_interval_seconds: Number(inputInterval) || 60,
          custom_telegram_chat_id: inputChatId.trim(),
          auto_start: autoStart
        })
      }, token);

      if (res && res.id) {
        setInputTarget('');
        setInputInterval(60);
        setInputChatId('');
        setModalOpen(false);
        fetchDomains(false);
      } else if (res && res.error) {
        setAddError(res.error);
      }
    } catch (e) {
      console.error("Error agregando dominio:", e);
      setAddError(e.message || "Error al registrar el dominio/IP en el backend.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleOpenEdit = (domain) => {
    setEditingDomain(domain);
    setEditInterval(domain.check_interval_seconds || 60);
    setEditChatId(domain.custom_telegram_chat_id || '');
    setEditError(null);
    setEditSuccess(false);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingDomain) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await apiFetch(`/api/domains/${editingDomain.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          check_interval_seconds: Math.max(5, Math.min(86400, Number(editInterval) || 60)),
          custom_telegram_chat_id: editChatId.trim()
        })
      }, token);

      if (res && res.id) {
        setDomains(prev => prev.map(d => d.id === res.id ? res : d));
        setEditSuccess(true);
        setTimeout(() => {
          setEditModalOpen(false);
          setEditSuccess(false);
        }, 600);
      } else if (res && res.error) {
        setEditError(res.error);
      }
    } catch (e) {
      console.error("Error actualizando intervalo:", e);
      setEditError(e.message || "Error al actualizar la configuración.");
    } finally {
      setEditLoading(false);
    }
  };
  const handleSaveEditModal = handleSaveEdit;

  const handleDeleteDomain = async (id, name) => {
    const confirmMsg = (t("confirmDeleteTarget") || '¿Estás seguro de eliminar el objetivo "{name}" del monitoreo?').replace('{name}', name);
    if (!window.confirm(confirmMsg)) return;
    try {
      await apiFetch(`/api/domains/${id}/`, { method: 'DELETE' }, token);
      setDomains(prev => prev.filter(d => d.id !== id));
    } catch (e) {
      console.error("Error al eliminar dominio:", e);
    }
  };

  const handleToggleMonitor = async (id, isCurrentlyMonitoring) => {
    setActionLoading(id);
    try {
      const endpoint = isCurrentlyMonitoring
        ? `/api/domains/${id}/stop-monitor/`
        : `/api/domains/${id}/start-monitor/`;
      await apiFetch(endpoint, { method: 'POST' }, token);
      setDomains(prev => prev.map(d => d.id === id ? { ...d, is_monitoring: !isCurrentlyMonitoring } : d));
    } catch (e) {
      console.error("Error alternando monitoreo:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckNow = async (id) => {
    setCheckingId(id);
    try {
      const res = await apiFetch(`/api/domains/${id}/check-now/`, { method: 'POST' }, token);
      if (res && res.id) {
        setDomains(prev => prev.map(d => d.id === id ? res : d));
      }
    } catch (e) {
      console.error("Error al comprobar ahora:", e);
    } finally {
      setCheckingId(null);
    }
  };

  const handleStartAll = async () => {
    try {
      await apiFetch('/api/domains/start-all/', { method: 'POST' }, token);
      fetchDomains(false);
    } catch (e) {
      console.error("Error al iniciar todos:", e);
    }
  };

  const handleStopAll = async () => {
    try {
      await apiFetch('/api/domains/stop-all/', { method: 'POST' }, token);
      fetchDomains(false);
    } catch (e) {
      console.error("Error al detener todos:", e);
    }
  };

  const filteredDomains = domains.filter(d => {
    const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;
    if (statusFilter === 'online') return d.last_status === 'online';
    if (statusFilter === 'offline') return d.last_status === 'offline';
    if (statusFilter === 'monitoring') return d.is_monitoring;
    return true;
  });

  const totalCount = domains.length;
  const onlineCount = domains.filter(d => d.last_status === 'online').length;
  const offlineCount = domains.filter(d => d.last_status === 'offline').length;
  const monitoringCount = domains.filter(d => d.is_monitoring).length;

  return (
    <div className="fade-in space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-theme-main tracking-tight flex items-center gap-2.5">
            <Radio className="w-7 h-7 text-indigo-400" /> {t("domainsPublicIps") || `${t("domains") || "Dominios"} & IPs Públicas`}
          </h1>
          <p className="text-sm text-theme-muted mt-1">
            {t("domainsDesc") || "Monitoreo continuo de disponibilidad (Ping ICMP y HTTP/HTTPS) para dominios e IPs públicas con alertas automáticas."}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {role !== 'read' && (
            <>
              <button
                type="button"
                onClick={handleStartAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold transition-colors"
                title="Iniciar monitoreo continuo en todos los dominios"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> {t("startAll") || "Iniciar Todo"}
              </button>
              <button
                type="button"
                onClick={handleStopAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-panel hover:bg-slate-700/40 text-theme-muted hover:text-theme-main border border-theme-light rounded-lg text-xs font-medium transition-colors"
                title="Detener el monitoreo de todos los dominios"
              >
                <Square className="w-3.5 h-3.5" /> {t("stopAll") || "Detener Todo"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => fetchDomains(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-panel hover:bg-slate-700/40 text-theme-muted hover:text-theme-main border border-theme-light rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            title="Refrescar lista y estados"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {t("refresh") || "Refrescar"}
          </button>
          {role !== 'read' && (
            <button
              type="button"
              onClick={() => { setInputTarget(''); setAddError(null); setModalOpen(true); }}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-900/20 transition-all"
            >
              <Plus className="w-4 h-4" /> {t("addTarget") || "Agregar Objetivo"}
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="panel p-4 border border-theme-light flex items-center justify-between">
          <div>
            <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("totalTargets") || "Total Objetivos"}</p>
            <p className="text-2xl font-bold text-theme-main mt-1">{totalCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Globe className="w-5 h-5" />
          </div>
        </div>

        <div className="panel p-4 border border-theme-light flex items-center justify-between">
          <div>
            <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("onlineTargets") || "En Línea (Online)"}</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{onlineCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="panel p-4 border border-theme-light flex items-center justify-between">
          <div>
            <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("offlineTargets") || "Caídos (Offline)"}</p>
            <p className="text-2xl font-bold text-rose-400 mt-1">{offlineCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <XCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="panel p-4 border border-theme-light flex items-center justify-between">
          <div>
            <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("monitoringActive") || "Monitoreo Activo"}</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{monitoringCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Activity className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Buscador & Filtros */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
          <input
            type="search"
            name="domains_search_filter"
            id="domains_search_filter"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t("searchDomainIpPlaceholder") || "Buscar por dominio o dirección IP..."}
            className="input-field py-2 pl-9 pr-3 text-xs text-theme-main w-full"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-main p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between w-full sm:w-auto">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {[
              { id: 'all', label: `${t("allFilter") || "Todos"} (${totalCount})` },
              { id: 'online', label: `${t("onlineFilter") || "En Línea"} (${onlineCount})` },
              { id: 'offline', label: `${t("offlineFilter") || "Caídos"} (${offlineCount})` },
              { id: 'monitoring', label: `${t("monitoredFilter") || "Monitoreados"} (${monitoringCount})` },
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border ${statusFilter === f.id
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-theme-panel text-theme-muted hover:text-theme-main border-theme-light hover:bg-slate-700/30'
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Selector de Vista: Cuadrícula vs Lista */}
          <div className="flex items-center bg-theme-panel border border-theme-light rounded-lg p-1 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${viewMode === 'grid'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-500/10'
                }`}
              title={t("gridView") || "Cuadrícula"}
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden md:inline">{t("gridView") || "Cuadrícula"}</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${viewMode === 'list'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-500/10'
                }`}
              title={t("listView") || "Lista"}
            >
              <List className="w-4 h-4" />
              <span className="hidden md:inline">{t("listView") || "Lista"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Lista de Dominios / IPs */}
      {loading && domains.length === 0 ? (
        <div className="panel p-12 text-center text-theme-muted text-xs border border-theme-light flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
          <p>{t("loadingDomains") || "Cargando dominios e IPs..."}</p>
        </div>
      ) : filteredDomains.length === 0 ? (
        <div className="panel p-14 text-center text-theme-muted text-xs border border-theme-light flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-full bg-slate-800/60 border border-slate-700/50 flex items-center justify-center text-indigo-400">
            <Radio className="w-6 h-6 opacity-70" />
          </div>
          <p className="font-semibold text-theme-main text-sm">{t("noMatchingTargets") || "No hay objetivos que coincidan"}</p>
          <p className="max-w-md text-theme-muted leading-relaxed">
            {domains.length === 0
              ? (t("noDomainsRegisteredYet") || 'Aún no has registrado ningún dominio o IP para monitorear. Haz clic en "Agregar Objetivo" para comenzar el monitoreo con Ping y HTTP.')
              : (t("noDomainsFilterResults") || 'No se encontraron resultados con el filtro o término de búsqueda actual.')}
          </p>
          {domains.length === 0 && role !== 'read' && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow transition-all flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> {t("addFirstTarget") || "Agregar primer dominio / IP"}
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredDomains.map(d => {
            const isChecking = checkingId === d.id;
            const isOnline = d.last_status === 'online';
            const isOffline = d.last_status === 'offline';
            const isActionLoading = actionLoading === d.id;

            return (
              <div
                key={d.id}
                className={`panel p-4 border transition-all rounded-xl relative flex flex-col justify-between ${isOnline
                  ? 'border-emerald-500/30 hover:border-emerald-500/50 bg-gradient-to-b from-emerald-950/5 to-transparent'
                  : isOffline
                    ? 'border-rose-500/30 hover:border-rose-500/50 bg-gradient-to-b from-rose-950/10 to-transparent'
                    : 'border-theme-light hover:border-slate-600'
                  }`}
              >
                {/* Cabecera de la tarjeta */}
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${d.is_ip
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                        }`}>
                        {d.is_ip ? <Target className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-theme-main truncate" title={d.name}>
                            {d.name}
                          </h3>
                          {!d.is_ip && (
                            <a
                              href={`https://${d.name}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-theme-muted hover:text-indigo-400 transition-colors p-0.5"
                              title={`Abrir https://${d.name}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded border inline-block ${d.is_ip
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                          }`}>
                          {d.is_ip ? (t("publicIpBadge") || 'IP Pública') : (t("webDomainBadge") || 'Dominio Web')}
                        </span>
                      </div>
                    </div>

                    {/* Estado de conectividad & Badge de Intervalo */}
                    <div className="shrink-0 flex items-center gap-1.5 flex-wrap justify-end">
                      {role !== 'read' ? (
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(d)}
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/25 flex items-center gap-1 transition-all"
                          title="Clic para ajustar intervalo de sondeo"
                        >
                          <Clock className="w-2.5 h-2.5 text-indigo-400" />
                          <span>{t("everySeconds") || "Cada"} {d.check_interval_seconds || 60}s</span>
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5 text-slate-500" />
                          <span>{t("everySeconds") || "Cada"} {d.check_interval_seconds || 60}s</span>
                        </span>
                      )}

                      {isOnline ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          {t("statusOnline") || "ONLINE"}
                        </span>
                      ) : isOffline ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                          <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                          {t("statusOffline") || "OFFLINE"}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                          {t("statusPending") || "PENDIENTE"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Telemetría / Protocolo */}
                  <div className="grid grid-cols-2 gap-2 my-3 p-2.5 rounded-lg bg-theme-panel/70 border border-theme-light text-xs">
                    <div>
                      <span className="text-[10px] text-theme-muted block font-medium">{t("protocolCode") || "Protocolo / Código:"}</span>
                      <span className="font-mono font-semibold text-theme-main">
                        {d.last_http_code ? (
                          d.last_http_code === 'ICMP' ? 'ICMP Ping OK' : `HTTP ${d.last_http_code}`
                        ) : (
                          t("noRecord") || 'Sin registro'
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-theme-muted block font-medium">{t("latencyPing") || "Latencia (Ping):"}</span>
                      <span className={`font-mono font-semibold ${d.response_time_ms == null ? 'text-theme-muted' :
                        d.response_time_ms < 100 ? 'text-emerald-400' :
                          d.response_time_ms < 300 ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                        {d.response_time_ms != null ? `${d.response_time_ms} ms` : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-theme-muted block font-medium">{t("consecutiveFailures") || "Fallas seguidas:"}</span>
                      <span className={`font-mono font-semibold ${d.failed_attempts > 0 ? 'text-rose-400' : 'text-theme-muted'}`}>
                        {d.failed_attempts} / 5
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-theme-muted block font-medium">{t("monitoringLabel") || "Monitoreo:"}</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-xs">
                        {d.is_monitoring ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> {t("activeStatus") || "Activo"} ({d.check_interval_seconds || 60}s)
                          </span>
                        ) : (
                          <span className="text-slate-500">{t("inactiveStatus") || "Inactivo"}</span>
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-theme-muted block font-medium">{t("responsibleUser") || "Usuario Responsable:"}</span>
                      <span className="font-medium text-theme-main truncate block" title={d.user_username || 'Sistema SOC'}>
                        👤 {d.user_username || t("systemUser") || 'Sistema'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-theme-muted block font-medium">{t("telegramAlerts") || "Alertas Telegram:"}</span>
                      <span className="font-mono text-[11px] text-indigo-300 truncate block" title={d.custom_telegram_chat_id ? `Chat #${d.custom_telegram_chat_id}` : (d.user_username ? `Usuario: ${d.user_username}` : 'SOC General')}>
                        📲 {d.custom_telegram_chat_id ? `ID #${d.custom_telegram_chat_id}` : (d.user_username ? `@${d.user_username}` : t("generalSoc") || 'SOC General')}
                      </span>
                    </div>
                  </div>

                  {/* Error si existe */}
                  {d.last_error && isOffline && (
                    <div className="mb-3 p-2 bg-rose-500/10 border border-rose-500/20 rounded text-[11px] text-rose-300 leading-tight">
                      {d.last_error}
                    </div>
                  )}

                  {/* Timestamp de última comprobación */}
                  <div className="flex items-center gap-1 text-[11px] text-theme-muted mb-3">
                    <Clock className="w-3 h-3 opacity-60" />
                    <span>{t("lastProbe") || "Último sondeo:"}</span>
                    <span className="font-mono text-theme-main">
                      {d.last_checked ? safeFormatDate(d.last_checked) : (t("never") || 'Nunca')}
                    </span>
                  </div>
                </div>

                {/* Botones de acción */}
                <div className="pt-2 border-t border-theme-light flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleCheckNow(d.id)}
                    disabled={isChecking}
                    className="flex-1 py-1.5 px-2.5 bg-theme-panel hover:bg-slate-700/30 text-theme-main border border-theme-light rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                    title="Ejecutar comprobación Ping y HTTP de inmediato"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isChecking ? 'animate-spin' : ''}`} />
                    <span>{isChecking ? (t("checkingBtn") || 'Comprobando...') : (t("checkBtn") || 'Comprobar')}</span>
                  </button>

                  {role !== 'read' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleToggleMonitor(d.id, d.is_monitoring)}
                        disabled={isActionLoading}
                        className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${d.is_monitoring
                          ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
                          : 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30'
                          }`}
                        title={d.is_monitoring ? "Pausar monitoreo continuo" : "Iniciar monitoreo continuo"}
                      >
                        {d.is_monitoring ? (
                          <>
                            <Square className="w-3 h-3 fill-current" /> {t("pauseBtn") || "Pausar"}
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" /> {t("monitorBtn") || "Monitorear"}
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEdit(d)}
                        className="p-2 text-theme-muted hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors border border-transparent hover:border-indigo-500/20"
                        title={t("adjustDomainTitle") || "Ajustar intervalo de sondeo y Telegram"}
                      >
                        <Sliders className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteDomain(d.id, d.name)}
                        className="p-2 text-theme-muted hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                        title={t("deleteDomainTitle") || "Eliminar del monitoreo"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel overflow-hidden border border-theme-light shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap min-w-[820px]">
              <thead>
                <tr className="border-b border-theme-light text-xs text-theme-muted uppercase tracking-wider bg-theme-panel/60">
                  <th className="px-5 py-3.5 font-medium">{t("thTargetType") || "Objetivo / Tipo"}</th>
                  <th className="px-5 py-3.5 font-medium">{t("thStatus") || "Estado"}</th>
                  <th className="px-5 py-3.5 font-medium">{t("thInterval") || "Intervalo"}</th>
                  <th className="px-5 py-3.5 font-medium">{t("thLatencyProtocol") || "Latencia / Protocolo"}</th>
                  <th className="px-5 py-3.5 font-medium">{t("thFailures") || "Fallas"}</th>
                  <th className="px-5 py-3.5 font-medium">{t("thResponsibleTelegram") || "Responsable & Telegram"}</th>
                  <th className="px-5 py-3.5 font-medium">{t("thLastProbe") || "Último Sondeo"}</th>
                  <th className="px-5 py-3.5 font-medium text-right">{t("thActions") || "Acciones"}</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-500/10">
                {filteredDomains.map(d => {
                  const isChecking = checkingId === d.id;
                  const isOnline = d.last_status === 'online';
                  const isOffline = d.last_status === 'offline';
                  const isActionLoading = actionLoading === d.id;

                  return (
                    <tr key={d.id} className="hover:bg-slate-500/5 transition-colors group">
                      {/* Objetivo */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${d.is_ip
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                            }`}>
                            {d.is_ip ? <Target className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-theme-main">{d.name}</span>
                              {!d.is_ip && (
                                <a
                                  href={`https://${d.name}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-theme-muted hover:text-indigo-400 transition-colors p-0.5"
                                  title={`Abrir https://${d.name}`}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded border inline-block ${d.is_ip
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                              }`}>
                              {d.is_ip ? (t("publicIpBadge") || 'IP Pública') : (t("webDomainBadge") || 'Dominio Web')}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Estado */}
                      <td className="px-5 py-3.5">
                        {isOnline ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            {t("statusOnline") || "ONLINE"}
                          </span>
                        ) : isOffline ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                            <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                            {t("statusOffline") || "OFFLINE"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                            {t("statusPending") || "PENDIENTE"}
                          </span>
                        )}
                      </td>

                      {/* Intervalo */}
                      <td className="px-5 py-3.5">
                        {role !== 'read' ? (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(d)}
                            className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/25 flex items-center gap-1 transition-all"
                            title="Clic para cambiar intervalo"
                          >
                            <Clock className="w-2.5 h-2.5 text-indigo-400" />
                            <span>{t("everySeconds") || "Cada"} {d.check_interval_seconds || 60}s</span>
                          </button>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-slate-500" />
                            <span>{t("everySeconds") || "Cada"} {d.check_interval_seconds || 60}s</span>
                          </span>
                        )}
                      </td>

                      {/* Latencia / Protocolo */}
                      <td className="px-5 py-3.5">
                        <div className="text-xs">
                          <span className={`font-mono font-bold block ${d.response_time_ms == null ? 'text-theme-muted' :
                            d.response_time_ms < 100 ? 'text-emerald-400' :
                              d.response_time_ms < 300 ? 'text-amber-400' : 'text-rose-400'
                            }`}>
                            {d.response_time_ms != null ? `${d.response_time_ms} ms` : 'N/A'}
                          </span>
                          <span className="text-[10px] font-mono text-theme-muted">
                            {d.last_http_code ? (d.last_http_code === 'ICMP' ? 'Ping ICMP OK' : `HTTP ${d.last_http_code}`) : (t("noRecord") || 'Sin registro')}
                          </span>
                        </div>
                      </td>

                      {/* Fallas */}
                      <td className="px-5 py-3.5">
                        <span className={`font-mono text-xs font-semibold ${d.failed_attempts > 0 ? 'text-rose-400' : 'text-theme-muted'}`}>
                          {d.failed_attempts} / 5
                        </span>
                      </td>

                      {/* Responsable & Telegram */}
                      <td className="px-5 py-3.5">
                        <div className="text-xs max-w-[170px]">
                          <span className="font-medium text-theme-main block truncate">
                            👤 {d.user_username || t("systemUser") || 'Sistema SOC'}
                          </span>
                          <span className="font-mono text-[11px] text-indigo-300 block truncate" title={d.custom_telegram_chat_id ? `Chat #${d.custom_telegram_chat_id}` : (d.user_username ? `Usuario: ${d.user_username}` : 'SOC General')}>
                            📲 {d.custom_telegram_chat_id ? `ID #${d.custom_telegram_chat_id}` : (d.user_username ? `@${d.user_username}` : t("generalSoc") || 'SOC General')}
                          </span>
                        </div>
                      </td>

                      {/* Último Sondeo */}
                      <td className="px-5 py-3.5">
                        <span className="text-xs text-theme-muted font-mono">
                          {d.last_checked ? safeFormatDate(d.last_checked) : (t("never") || 'Nunca')}
                        </span>
                      </td>

                      {/* Acciones */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCheckNow(d.id)}
                            disabled={isChecking}
                            className="p-1.5 bg-theme-panel hover:bg-slate-700/40 text-theme-main border border-theme-light rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                            title="Comprobar ahora"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isChecking ? 'animate-spin' : ''}`} />
                          </button>

                          {role !== 'read' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleMonitor(d.id, d.is_monitoring)}
                                disabled={isActionLoading}
                                className={`p-1.5 rounded-lg text-xs font-semibold transition-colors ${d.is_monitoring
                                  ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
                                  : 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30'
                                  }`}
                                title={d.is_monitoring ? "Pausar monitoreo continuo" : "Iniciar monitoreo continuo"}
                              >
                                {d.is_monitoring ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenEdit(d)}
                                className="p-1.5 text-theme-muted hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors border border-theme-light"
                                title={t("adjustDomainTitle") || "Ajustar intervalo y Telegram"}
                              >
                                <Sliders className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteDomain(d.id, d.name)}
                                className="p-1.5 text-theme-muted hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                                title={t("deleteDomainTitle") || "Eliminar del monitoreo"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Agregar Dominio o IP */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-theme-panel border border-theme-light rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-theme-light">
              <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
                <Radio className="w-5 h-5 text-indigo-400" /> {t("modalAddDomainTitle") || "Monitorear Dominio o IP Pública"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-theme-muted hover:text-theme-main p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-theme-muted leading-relaxed">
              {t("modalAddDomainDesc") || "Ingresa el nombre del dominio (ej. udc.edu.ar) o una dirección IP pública (ej. 186.189.244.18). El sistema ejecutará ping ICMP y validación HTTP/HTTPS con alertas personalizadas por usuario."}
            </p>

            <form onSubmit={handleAddDomain} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-main mb-1">
                  {t("domainOrIpLabel") || "Dominio o Dirección IP:"}
                </label>
                <input
                  type="text"
                  value={inputTarget}
                  onChange={(e) => setInputTarget(e.target.value)}
                  placeholder="ej: google.com o 186.189.244.18"
                  className="input-field py-2.5 px-3 font-mono text-sm text-theme-main w-full"
                  autoFocus
                />
              </div>

              {/* Sugerencias rápidas */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-theme-muted block">{t("quickSuggestions") || "Sugerencias para prueba rápida:"}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { label: '📌 186.189.244.18 (Trelew)', val: '186.189.244.18' },
                    { label: '🌐 udc.edu.ar', val: 'udc.edu.ar' },
                    { label: '🌐 google.com', val: 'google.com' },
                    { label: '🌐 cloudflare.com', val: 'cloudflare.com' },
                  ].map(s => (
                    <button
                      key={s.val}
                      type="button"
                      onClick={() => setInputTarget(s.val)}
                      className="px-2 py-1 bg-theme-panel hover:bg-slate-700/40 border border-theme-light text-theme-muted hover:text-theme-main rounded text-[11px] font-mono transition-colors"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Configuración de Intervalo de Sondeo */}
              <div className="space-y-2 pt-2 border-t border-theme-light">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-theme-main flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" /> {t("probeIntervalLabel") || "Intervalo de Sondeo (Segundos):"}
                  </label>
                  <span className="text-[11px] font-mono text-indigo-300 font-bold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                    {inputInterval}s {inputInterval >= 60 ? `(${Math.floor(inputInterval / 60)}m ${inputInterval % 60 ? inputInterval % 60 + 's' : ''})` : ''}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: t("fast15s") || '15s (Rápido)', val: 15 },
                    { label: t("std30s") || '30s (Estándar)', val: 30 },
                    { label: t("rec60s") || '60s (Recomendado)', val: 60 },
                    { label: '120s (2 min)', val: 120 },
                    { label: '300s (5 min)', val: 300 },
                    { label: '600s (10 min)', val: 600 },
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setInputInterval(p.val)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all border ${inputInterval === p.val
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm font-semibold'
                        : 'bg-theme-panel text-theme-muted hover:text-theme-main border-theme-light hover:bg-slate-700/30'
                        }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-xs text-theme-muted shrink-0">{t("orTypeSeconds") || "O escribe los segundos:"}</span>
                  <input
                    type="number"
                    min="5"
                    max="86400"
                    value={inputInterval}
                    onChange={(e) => setInputInterval(Math.max(5, Math.min(86400, Number(e.target.value) || 5)))}
                    className="input-field py-1 px-2.5 font-mono text-xs w-24 text-center"
                  />
                  <span className="text-xs text-theme-muted">{t("secondsWord") || "segundos"}</span>
                </div>

                <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 leading-relaxed">
                  🛡️ {t("socIpProtectionNotice") || "Protección de IP pública del SOC: Un intervalo moderado (60s o más) previene que los firewalls (WAF, Fail2ban, IDS) del objetivo bloqueen o incluyan en lista negra la IP pública del SOC por exceso de peticiones."}
                </p>
              </div>

              {/* Chat ID de Telegram opcional */}
              <div className="space-y-1.5 pt-2 border-t border-theme-light">
                <label className="block text-xs font-medium text-theme-main flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-indigo-400" /> {t("telegramChatIdOptional") || "Telegram Chat ID para Alertas (Opcional):"}
                </label>
                <input
                  type="text"
                  value={inputChatId}
                  onChange={(e) => setInputChatId(e.target.value)}
                  placeholder="Ej: 987654321"
                  className="input-field py-2 px-3 font-mono text-xs text-theme-main w-full"
                />
                <p className="text-[11px] text-theme-muted leading-relaxed">
                  {t("telegramChatIdHelp") || "Si se deja en blanco, notificará al Chat ID configurado en tu perfil de usuario, o al canal general de alertas si no tienes uno."}
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-indigo-500"
                />
                <span className="text-xs text-theme-main font-medium">
                  {t("startBackgroundImmediately") || "Iniciar monitoreo continuo en segundo plano de inmediato"}
                </span>
              </label>

              {addError && (
                <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-lg text-xs text-rose-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{addError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-theme-light">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-theme-muted hover:text-theme-main bg-theme-panel border border-theme-light rounded-lg transition-colors"
                >
                  {t("cancel") || "Cancelar"}
                </button>
                <button
                  type="submit"
                  disabled={addLoading || !inputTarget.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-indigo-900/30"
                >
                  {addLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t("saving") || "Guardando..."}
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" /> {t("saveAndMonitor") || "Guardar y Monitorear"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Intervalo y Telegram */}
      {editModalOpen && editingDomain && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-theme-panel border border-theme-light rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-theme-light">
              <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
                <Sliders className="w-5 h-5 text-indigo-400" /> {t("modalEditDomainTitle") || "Configurar Monitoreo"}
              </h3>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-theme-muted hover:text-theme-main p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
              <span className="text-[11px] text-theme-muted block">{t("selectedTarget") || "Objetivo seleccionado:"}</span>
              <span className="text-sm font-bold font-mono text-indigo-300">{editingDomain.name}</span>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-theme-main flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-400" /> {t("monitoringInterval") || "Intervalo de Monitoreo:"}
                </label>

                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: '5s', val: 5 },
                    { label: '10s', val: 10 },
                    { label: '30s', val: 30 },
                    { label: '60s (1 min)', val: 60 },
                    { label: '300s (5 min)', val: 300 },
                    { label: '600s (10 min)', val: 600 },
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setEditInterval(p.val)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all border ${editInterval === p.val
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm font-semibold'
                        : 'bg-theme-panel text-theme-muted hover:text-theme-main border-theme-light hover:bg-slate-700/30'
                        }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-xs text-theme-muted shrink-0">{t("orTypeSeconds") || "O escribe los segundos:"}</span>
                  <input
                    type="number"
                    min="5"
                    max="86400"
                    value={editInterval}
                    onChange={(e) => setEditInterval(Math.max(5, Math.min(86400, Number(e.target.value) || 5)))}
                    className="input-field py-1 px-2.5 font-mono text-xs w-24 text-center"
                  />
                  <span className="text-xs text-theme-muted">{t("secondsWord") || "segundos"}</span>
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-theme-light">
                <label className="block text-xs font-medium text-theme-main flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-indigo-400" /> {t("specificTelegramChatId") || "Telegram Chat ID Específico (Opcional):"}
                </label>
                <input
                  type="text"
                  value={editChatId}
                  onChange={(e) => setEditChatId(e.target.value)}
                  placeholder="Ej: 987654321"
                  className="input-field py-2 px-3 font-mono text-xs text-theme-main w-full"
                />
                <p className="text-[11px] text-theme-muted leading-relaxed">
                  {t("specificTelegramChatIdHelp") || "Si se deja en blanco, notificará al Chat ID configurado en tu perfil de usuario."}
                </p>
              </div>

              {editError && (
                <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-lg text-xs text-rose-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-theme-light">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-theme-muted hover:text-theme-main bg-theme-panel border border-theme-light rounded-lg transition-colors"
                >
                  {t("cancel") || "Cancelar"}
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-indigo-900/30"
                >
                  {editLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t("saving") || "Guardando..."}
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" /> {t("saveChanges") || "Guardar Cambios"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const LATENCY_RANGES = [
  { id: '20p', label: 'Últimos 20 muestreos', shortLabel: '20 pts', isLive: true },
  { id: '50p', label: 'Últimos 50 muestreos', shortLabel: '50 pts', isLive: true },
  { id: '1h', label: 'Última 1 hora', shortLabel: '1 h', isLive: false },
  { id: '6h', label: 'Últimas 6 horas', shortLabel: '6 h', isLive: false },
  { id: '12h', label: 'Últimas 12 horas', shortLabel: '12 h', isLive: false },
  { id: '24h', label: 'Últimas 24 horas', shortLabel: '24 h', isLive: false },
];

function SystemDataView({ token, t, theme, role }) {
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const [latencyRange, setLatencyRange] = useState('20p');
  const [latencyStats, setLatencyStats] = useState(null);
  const [latencyLoading, setLatencyLoading] = useState(false);
  const latencyRangeRef = useRef(latencyRange);
  latencyRangeRef.current = latencyRange;
  const tickCountRef = useRef(0);
  const [copiedField, setCopiedField] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [clientLatency, setClientLatency] = useState(null);
  const [error, setError] = useState(null);

  const fetchLatencyHistory = async (range, isSilent = false) => {
    if (!isSilent) setLatencyLoading(true);
    try {
      const data = await apiFetch(`/api/system-telemetry/latency-history/?range=${range}`, {}, token);
      const isHourRange = ['1h', '6h', '12h', '24h'].includes(range);
      const formatted = (data.history || []).map(pt => {
        let displayTime = pt.time;
        let fullTimeStr = pt.time;
        if (pt.timestamp) {
          const d = new Date(pt.timestamp);
          if (!isNaN(d.getTime())) {
            displayTime = isHourRange
              ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            fullTimeStr = d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }
        }
        return {
          ...pt,
          time: displayTime,
          fullTime: fullTimeStr
        };
      });
      setLatencyHistory(formatted);
      if (data.stats) {
        setLatencyStats(data.stats);
      }
    } catch (e) {
      console.error("Error fetching latency history:", e);
    } finally {
      if (!isSilent) setLatencyLoading(false);
    }
  };

  const handleRangeChange = (newRange) => {
    setLatencyRange(newRange);
    fetchLatencyHistory(newRange);
  };

  const fetchTelemetry = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    const startT = performance.now();
    try {
      const data = await apiFetch('/api/system-telemetry/', {}, token);
      const rtt = Math.round(performance.now() - startT);
      setClientLatency(rtt);
      setTelemetry(data);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());

      const icmpVal = data.icmp_latency_ms !== null && data.icmp_latency_ms !== undefined ? data.icmp_latency_ms : rtt;
      const currentRange = latencyRangeRef.current;
      tickCountRef.current += 1;

      if (currentRange === '20p' || currentRange === '50p') {
        const maxPts = currentRange === '50p' ? 50 : 20;
        setLatencyHistory(prev => {
          const nowD = new Date();
          const next = [...prev, {
            time: nowD.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            fullTime: nowD.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            icmp: icmpVal,
            http: rtt
          }];
          const sliced = next.slice(-maxPts);
          const validIcmp = sliced.map(p => p.icmp).filter(v => v !== null && v !== undefined);
          const validHttp = sliced.map(p => p.http).filter(v => v !== null && v !== undefined);
          if (validIcmp.length > 0) {
            setLatencyStats({
              avg_icmp: Math.round(validIcmp.reduce((a, b) => a + b, 0) / validIcmp.length * 10) / 10,
              min_icmp: Math.min(...validIcmp),
              max_icmp: Math.max(...validIcmp),
              avg_http: validHttp.length ? Math.round(validHttp.reduce((a, b) => a + b, 0) / validHttp.length * 10) / 10 : null,
              min_http: validHttp.length ? Math.min(...validHttp) : null,
              max_http: validHttp.length ? Math.max(...validHttp) : null,
              total_samples: sliced.length
            });
          }
          return sliced;
        });
      } else if (tickCountRef.current % 6 === 0) {
        // En rangos agregados (1h, 6h, 12h, 24h), refrescar suavemente cada 30 segundos
        fetchLatencyHistory(currentRange, true);
      }
    } catch (e) {
      console.error("Error fetching system telemetry:", e);
      setError(e.message || "Error al obtener telemetría del sistema.");
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    fetchLatencyHistory('20p');
  }, [token]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchTelemetry();
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, token]);

  const handleCopy = (text, field) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const getLatencyBadge = (ms) => {
    if (ms === null || ms === undefined) return { label: 'N/D', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' };
    if (ms < 50) return { label: 'Excelente', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
    if (ms < 120) return { label: 'Buena', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
    return { label: 'Elevada', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' };
  };

  const getUsageColor = (pct) => {
    if (pct < 60) return 'bg-emerald-500';
    if (pct < 85) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  const getUsageTextColor = (pct) => {
    if (pct < 60) return 'text-emerald-400';
    if (pct < 85) return 'text-amber-400';
    return 'text-rose-400';
  };

  if (loading && !telemetry) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
        <p className="text-sm text-theme-muted">Recopilando telemetría del servidor en tiempo real...</p>
      </div>
    );
  }

  const { private_ip, public_ip, icmp_latency_ms, cpu, memory, disks, network, system } = telemetry || {};

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-theme-main tracking-tight flex items-center gap-2.5">
            <Activity className="w-7 h-7 text-indigo-400" />
            {t("systemData") || "Datos del Sistema"}
          </h1>
          <p className="text-sm text-theme-muted mt-1">
            {t("systemDataDesc") || "Telemetría en tiempo real del servidor SOC (IPs, latencia, CPU, memoria y almacenamiento)."}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Indicador en vivo */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-theme-panel border border-theme-light text-xs">
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
            <span className="text-theme-muted font-medium">
              {autoRefresh ? 'En vivo (cada 5s)' : 'Pausado'}
            </span>
          </div>

          {/* Botón Pausar / Reanudar */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? "Pausar refresco automático" : "Reanudar refresco automático cada 5s"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-panel border border-theme-light text-xs font-medium text-theme-muted hover:text-theme-main transition-colors"
          >
            {autoRefresh ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
            {autoRefresh ? "Pausar" : "Reanudar"}
          </button>

          {/* Botón Actualizar Ahora */}
          <button
            onClick={() => fetchTelemetry(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Actualizar Ahora
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Fila 1: KPI Cards Principales (IP Privada, IP Pública, Latencias) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* IP Privada Card */}
        <div className="panel p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-theme-muted flex items-center gap-1.5">
              <Network className="w-4 h-4 text-indigo-400" /> IP Privada (Local)
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
              LAN / Host
            </span>
          </div>

          <div className="my-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xl font-bold font-mono text-theme-main tracking-tight select-all">
                {private_ip || '127.0.0.1'}
              </span>
              <button
                onClick={() => handleCopy(private_ip, 'private_ip')}
                title="Copiar IP Privada"
                className="p-1.5 rounded-lg bg-theme-panel border border-theme-light text-theme-muted hover:text-theme-main transition-colors shrink-0"
              >
                {copiedField === 'private_ip' ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            {copiedField === 'private_ip' && (
              <p className="text-[11px] text-emerald-400 mt-1">¡Copiado al portapapeles!</p>
            )}
          </div>

          <div className="pt-3 border-t border-theme-light text-xs text-theme-muted flex items-center justify-between">
            <span>Hostname: <strong className="text-theme-main font-mono">{system?.hostname || 'localhost'}</strong></span>
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Activa
            </span>
          </div>
        </div>

        {/* IP Pública Card */}
        <div className="panel p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-theme-muted flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-sky-400" /> IP Pública (Internet)
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
              WAN / Ext
            </span>
          </div>

          <div className="my-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xl font-bold font-mono text-theme-main tracking-tight select-all">
                {public_ip || 'No disponible'}
              </span>
              <button
                onClick={() => handleCopy(public_ip, 'public_ip')}
                title="Copiar IP Pública"
                className="p-1.5 rounded-lg bg-theme-panel border border-theme-light text-theme-muted hover:text-theme-main transition-colors shrink-0"
              >
                {copiedField === 'public_ip' ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            {copiedField === 'public_ip' && (
              <p className="text-[11px] text-emerald-400 mt-1">¡Copiado al portapapeles!</p>
            )}
          </div>

          <div className="pt-3 border-t border-theme-light text-xs text-theme-muted flex items-center justify-between">
            <span>Salida Externa: <strong className="text-theme-main">IPv4 WAN</strong></span>
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Online
            </span>
          </div>
        </div>

        {/* Latencia Card */}
        <div className="panel p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-theme-muted flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-400" /> Latencia (Cada 5s)
            </span>
            {(() => {
              const badge = getLatencyBadge(icmp_latency_ms !== null && icmp_latency_ms !== undefined ? icmp_latency_ms : clientLatency);
              return (
                <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${badge.color}`}>
                  {badge.label}
                </span>
              );
            })()}
          </div>

          <div className="my-2 flex items-baseline gap-4">
            <div>
              <span className="text-3xl font-bold font-mono text-theme-main tracking-tight">
                {icmp_latency_ms !== null && icmp_latency_ms !== undefined ? icmp_latency_ms : (clientLatency || '--')}
              </span>
              <span className="text-xs text-theme-muted ml-1 font-mono">ms</span>
              <p className="text-[11px] text-theme-muted mt-0.5">Ping ICMP (8.8.8.8)</p>
            </div>

            {clientLatency !== null && (
              <div className="border-l border-theme-light pl-4">
                <span className="text-xl font-bold font-mono text-theme-main tracking-tight">
                  {clientLatency}
                </span>
                <span className="text-xs text-theme-muted ml-1 font-mono">ms</span>
                <p className="text-[11px] text-theme-muted mt-0.5">HTTP SOC API</p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-theme-light text-xs text-theme-muted flex items-center justify-between">
            <span>Última toma: <strong className="text-theme-main font-mono">{lastUpdated || '--:--:--'}</strong></span>
            <span className="text-[11px] text-indigo-400">Refresco: 5 seg</span>
          </div>
        </div>
      </div>

      {/* Historial de Latencia Dinámico (20 pts, 50 pts, 1h, 6h, 12h, 24h) */}
      <div className="panel p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-theme-main flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" />
              <span>
                Histórico de Latencia{' '}
                <span className="text-indigo-400 font-normal">
                  ({LATENCY_RANGES.find(r => r.id === latencyRange)?.label || latencyRange})
                </span>
              </span>
            </h3>
            {['20p', '50p'].includes(latencyRange) ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                En Vivo (5s)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Clock className="w-3 h-3" />
                Histórico
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Leyenda de métricas */}
            <div className="hidden sm:flex items-center gap-3 text-xs mr-1">
              <span className="flex items-center gap-1.5 text-theme-muted">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> Ping ICMP
              </span>
              <span className="flex items-center gap-1.5 text-theme-muted">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> HTTP SOC API
              </span>
            </div>

            {/* Selector de Rango Temporal */}
            <div className="flex items-center bg-black/20 p-1 rounded-lg border border-theme-light overflow-x-auto max-w-full">
              {LATENCY_RANGES.map(r => (
                <button
                  key={r.id}
                  onClick={() => handleRangeChange(r.id)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-all font-medium whitespace-nowrap ${latencyRange === r.id
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/25'
                    : 'text-theme-muted hover:text-theme-main hover:bg-white/5'
                    }`}
                  title={`Ver histórico: ${r.label}`}
                >
                  {r.shortLabel}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Barra de Estadísticas Resumen del Rango */}
        {latencyStats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 p-3 bg-white/[0.02] border border-theme-light rounded-lg text-xs">
            <div className="border-r border-theme-light pr-2">
              <span className="text-theme-muted text-[11px] block">Ping ICMP Promedio</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-sm font-bold font-mono text-indigo-400">
                  {latencyStats.avg_icmp !== null && latencyStats.avg_icmp !== undefined ? latencyStats.avg_icmp : '--'}
                </span>
                <span className="text-[10px] text-theme-muted font-mono">ms</span>
              </div>
              <span className="text-[10px] text-theme-muted block mt-0.5 font-mono">
                Min: {latencyStats.min_icmp ?? '--'}ms | Max: {latencyStats.max_icmp ?? '--'}ms
              </span>
            </div>

            <div className="border-r border-theme-light pr-2">
              <span className="text-theme-muted text-[11px] block">HTTP API Promedio</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-sm font-bold font-mono text-emerald-400">
                  {latencyStats.avg_http !== null && latencyStats.avg_http !== undefined ? latencyStats.avg_http : '--'}
                </span>
                <span className="text-[10px] text-theme-muted font-mono">ms</span>
              </div>
              <span className="text-[10px] text-theme-muted block mt-0.5 font-mono">
                Min: {latencyStats.min_http ?? '--'}ms | Max: {latencyStats.max_http ?? '--'}ms
              </span>
            </div>

            <div className="border-r border-theme-light pr-2">
              <span className="text-theme-muted text-[11px] block">Muestras Analizadas</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-sm font-bold font-mono text-theme-main">
                  {latencyStats.total_samples || latencyHistory.length}
                </span>
                <span className="text-[10px] text-theme-muted font-mono">puntos</span>
              </div>
              <span className="text-[10px] text-theme-muted block mt-0.5">
                {['20p', '50p'].includes(latencyRange) ? 'Intervalo: ~5 seg' : 'Agrupación adaptativa'}
              </span>
            </div>

            <div>
              <span className="text-theme-muted text-[11px] block">Calidad de Conexión</span>
              {(() => {
                const b = getLatencyBadge(latencyStats.avg_icmp);
                return (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${b.color}`}>
                      {b.label}
                    </span>
                  </div>
                );
              })()}
              <span className="text-[10px] text-theme-muted block mt-1">
                {latencyStats.avg_icmp < 50 ? 'Conexión óptima y estable' : latencyStats.avg_icmp < 120 ? 'Latencia regular' : 'Posible congestión de red'}
              </span>
            </div>
          </div>
        )}

        {/* Gráfico Recharts de Latencia */}
        <div className="h-44 w-full relative">
          {latencyLoading && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center z-10 rounded">
              <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
            </div>
          )}

          {latencyHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={10} tickLine={false} unit="ms" domain={[0, 'auto']} />
                <RechartsTooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const dataPt = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700/60 p-2.5 rounded-lg shadow-xl text-xs space-y-1.5">
                          <div className="text-slate-400 font-mono text-[11px] border-b border-slate-800 pb-1 flex items-center justify-between gap-3">
                            <span>{dataPt.fullTime || label}</span>
                            <span className="text-[10px] px-1 rounded bg-slate-800 text-slate-300">
                              {latencyRange}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-1.5 text-indigo-400 font-medium">
                              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                              Ping ICMP:
                            </span>
                            <span className="font-mono font-bold text-white">
                              {dataPt.icmp !== null && dataPt.icmp !== undefined ? `${dataPt.icmp} ms` : 'N/D'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                              HTTP SOC API:
                            </span>
                            <span className="font-mono font-bold text-white">
                              {dataPt.http !== null && dataPt.http !== undefined ? `${dataPt.http} ms` : 'N/D'}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line type="monotone" dataKey="icmp" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Ping ICMP" />
                <Line type="monotone" dataKey="http" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="HTTP API" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-theme-muted">
              {latencyLoading ? 'Cargando datos de latencia...' : 'No hay datos de latencia disponibles para el rango seleccionado.'}
            </div>
          )}
        </div>
      </div>

      {/* Fila 2: Rendimiento Hardware (Procesador & Memoria) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Procesador (CPU) Card */}
        <div className="panel p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
              <Cpu className="w-5 h-5 text-indigo-400" /> Procesador (CPU)
            </h3>
            <span className={`text-sm font-bold font-mono px-2.5 py-1 rounded-md bg-theme-panel border border-theme-light ${getUsageTextColor(cpu?.percent_total || 0)}`}>
              {cpu?.percent_total !== undefined ? `${cpu.percent_total}%` : '--%'}
            </span>
          </div>

          <div>
            <p className="text-sm font-medium text-theme-main truncate" title={cpu?.model}>
              {cpu?.model || 'Procesador del Sistema'}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-theme-muted mt-1.5">
              <span>Núcleos: <strong className="text-theme-main font-mono">{cpu?.cores_physical || 1} Físicos / {cpu?.cores_logical || 1} Hilos</strong></span>
              {cpu?.freq_current_mhz && (
                <span>Frecuencia: <strong className="text-theme-main font-mono">{cpu.freq_current_mhz} MHz</strong></span>
              )}
            </div>
          </div>

          {/* Barra de Progreso Global */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-theme-muted">
              <span>Carga Total del CPU</span>
              <span className="font-mono">{cpu?.percent_total || 0}%</span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-slate-800/80 overflow-hidden border border-theme-light">
              <div
                className={`h-full transition-all duration-500 rounded-full ${getUsageColor(cpu?.percent_total || 0)}`}
                style={{ width: `${Math.min(100, Math.max(0, cpu?.percent_total || 0))}%` }}
              />
            </div>
          </div>

          {/* Promedio de Carga (Load Average) */}
          {cpu?.load_avg && cpu.load_avg.length >= 3 && (
            <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-xs text-theme-muted block mb-2 font-medium">Carga Promedio (Load Avg):</span>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded bg-slate-800/50">
                  <span className="text-[11px] text-theme-muted block">1 min</span>
                  <span className="text-sm font-bold font-mono text-theme-main">{cpu.load_avg[0]}</span>
                </div>
                <div className="p-2 rounded bg-slate-800/50">
                  <span className="text-[11px] text-theme-muted block">5 min</span>
                  <span className="text-sm font-bold font-mono text-theme-main">{cpu.load_avg[1]}</span>
                </div>
                <div className="p-2 rounded bg-slate-800/50">
                  <span className="text-[11px] text-theme-muted block">15 min</span>
                  <span className="text-sm font-bold font-mono text-theme-main">{cpu.load_avg[2]}</span>
                </div>
              </div>
            </div>
          )}

          {/* Desglose por Núcleos */}
          {cpu?.percent_per_core && cpu.percent_per_core.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs text-theme-muted block font-medium">Uso por Núcleo / Hilo:</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {cpu.percent_per_core.map((usage, idx) => (
                  <div key={idx} className="p-2 rounded bg-theme-panel border border-theme-light text-center">
                    <span className="text-[10px] text-theme-muted block">Core {idx}</span>
                    <span className={`text-xs font-mono font-bold ${getUsageTextColor(usage)}`}>
                      {usage}%
                    </span>
                    <div className="w-full h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                      <div className={`h-full ${getUsageColor(usage)}`} style={{ width: `${usage}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Memoria RAM & Swap Card */}
        <div className="panel p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-400" /> Memoria (RAM & Swap)
            </h3>
            <span className={`text-sm font-bold font-mono px-2.5 py-1 rounded-md bg-theme-panel border border-theme-light ${getUsageTextColor(memory?.ram_percent || 0)}`}>
              {memory?.ram_percent !== undefined ? `${memory.ram_percent}%` : '--%'}
            </span>
          </div>

          {/* Memoria RAM */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium text-theme-main">Memoria RAM</span>
              <span className="font-mono text-xs text-theme-muted">
                <strong className="text-theme-main">{memory?.ram_used_gb || 0} GB</strong> / {memory?.ram_total_gb || 0} GB
              </span>
            </div>
            <div className="w-full h-3 rounded-full bg-slate-800/80 overflow-hidden border border-theme-light">
              <div
                className={`h-full transition-all duration-500 rounded-full ${getUsageColor(memory?.ram_percent || 0)}`}
                style={{ width: `${Math.min(100, Math.max(0, memory?.ram_percent || 0))}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-theme-muted pt-1">
              <span>Libre / Disponible: <strong className="text-emerald-400 font-mono">{memory?.ram_available_gb || 0} GB</strong></span>
              <span>Usada: <strong className="text-theme-main font-mono">{memory?.ram_percent || 0}%</strong></span>
            </div>
          </div>

          {/* Memoria Swap */}
          {memory?.swap_total_gb !== undefined && memory.swap_total_gb > 0 && (
            <div className="space-y-2 pt-4 border-t border-theme-light">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-theme-main">Memoria de Intercambio (Swap)</span>
                <span className="font-mono text-xs text-theme-muted">
                  <strong className="text-theme-main">{memory.swap_used_gb} GB</strong> / {memory.swap_total_gb} GB
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800/80 overflow-hidden border border-theme-light">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${getUsageColor(memory.swap_percent || 0)}`}
                  style={{ width: `${Math.min(100, Math.max(0, memory.swap_percent || 0))}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-theme-muted pt-0.5">
                <span>Porcentaje Swap: <strong className="text-theme-main font-mono">{memory.swap_percent}%</strong></span>
              </div>
            </div>
          )}

          {/* Tarjetas resumen de Memoria */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
            <div className="p-2.5 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-[11px] text-theme-muted block">RAM Total</span>
              <span className="text-base font-bold font-mono text-theme-main mt-0.5 block">
                {memory?.ram_total_gb || 0} GB
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-[11px] text-theme-muted block">En Uso (Apps)</span>
              <span className="text-base font-bold font-mono text-theme-main mt-0.5 block">
                {memory?.ram_used_gb || 0} GB
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-[11px] text-theme-muted block">Búfer / Caché</span>
              <span className="text-base font-bold font-mono text-sky-400 mt-0.5 block">
                {memory?.ram_cached_gb !== undefined ? `${memory.ram_cached_gb} GB` : '--'}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-[11px] text-theme-muted block">Disponible</span>
              <span className="text-base font-bold font-mono text-emerald-400 mt-0.5 block">
                {memory?.ram_available_gb || 0} GB
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Fila 3: Almacenamiento & Discos */}
      <div className="panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-indigo-400" /> Almacenamiento & Particiones de Disco
          </h3>
          {disks?.io?.read_bytes_mb !== undefined && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-theme-muted">
              <span>Lecturas I/O: <strong className="text-theme-main font-mono">{disks.io.read_bytes_mb} MB</strong></span>
              <span>Escrituras I/O: <strong className="text-theme-main font-mono">{disks.io.write_bytes_mb} MB</strong></span>
            </div>
          )}
        </div>

        {disks?.partitions && disks.partitions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {disks.partitions.map((disk, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-theme-panel border border-theme-light space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-mono font-semibold">
                      {disk.mountpoint}
                    </span>
                    <span className="text-xs text-theme-muted font-mono">{disk.device}</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    {disk.fstype}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-theme-muted">
                    <span>Espacio Usado ({disk.percent}%)</span>
                    <span className="font-mono">
                      <strong className="text-theme-main">{disk.used_gb} GB</strong> de {disk.total_gb} GB
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${getUsageColor(disk.percent)}`}
                      style={{ width: `${Math.min(100, Math.max(0, disk.percent))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-theme-muted">
                    <span>Libre: <strong className="text-emerald-400 font-mono">{disk.free_gb} GB</strong></span>
                    <span>Capacidad: <strong className="text-theme-main font-mono">{disk.total_gb} GB</strong></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-theme-muted">No se detectaron particiones de disco.</p>
        )}
      </div>

      {/* Fila 4: Datos de Información Útiles del Sistema & Interfaces */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Información del Sistema */}
        <div className="panel p-6 space-y-4">
          <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-400" /> Información Útil del Servidor
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-theme-muted block">Sistema Operativo</span>
              <span className="font-semibold text-theme-main text-sm block mt-0.5">{system?.os_name || 'Linux'}</span>
            </div>

            <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-theme-muted block">Kernel</span>
              <span className="font-mono text-theme-main text-sm block mt-0.5 truncate" title={system?.kernel}>{system?.kernel || '--'}</span>
            </div>

            <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-theme-muted block">Arquitectura</span>
              <span className="font-mono text-theme-main text-sm block mt-0.5">{system?.architecture || '--'}</span>
            </div>

            <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-theme-muted block">Tiempo Encendido (Uptime)</span>
              <span className="font-semibold text-emerald-400 text-sm block mt-0.5">{system?.uptime_formatted || '--'}</span>
            </div>

            <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-theme-muted block">Procesos Activos</span>
              <span className="font-mono text-theme-main text-sm block mt-0.5">{system?.processes_count || '--'} procesos</span>
            </div>

            <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
              <span className="text-theme-muted block">Hora del Servidor</span>
              <span className="font-mono text-theme-main text-sm block mt-0.5">{system?.server_time || '--'}</span>
            </div>
          </div>
        </div>

        {/* Tráfico de Red & Interfaces */}
        <div className="panel p-6 space-y-4">
          <h3 className="text-base font-semibold text-theme-main flex items-center gap-2">
            <Wifi className="w-5 h-5 text-indigo-400" /> Interfaces de Red & Tráfico
          </h3>

          {network?.io && (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
                <span className="text-xs text-theme-muted block">Total Recibido (RX)</span>
                <span className="text-base font-bold font-mono text-emerald-400 block mt-0.5">
                  {network.io.bytes_recv_mb !== undefined ? `${network.io.bytes_recv_mb} MB` : '--'}
                </span>
                <span className="text-[10px] text-theme-muted">{network.io.packets_recv || 0} paquetes</span>
              </div>
              <div className="p-3 rounded-lg bg-theme-panel border border-theme-light">
                <span className="text-xs text-theme-muted block">Total Transmitido (TX)</span>
                <span className="text-base font-bold font-mono text-indigo-400 block mt-0.5">
                  {network.io.bytes_sent_mb !== undefined ? `${network.io.bytes_sent_mb} MB` : '--'}
                </span>
                <span className="text-[10px] text-theme-muted">{network.io.packets_sent || 0} paquetes</span>
              </div>
            </div>
          )}

          {network?.interfaces && network.interfaces.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs text-theme-muted font-medium block">Interfaces Detectadas:</span>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {network.interfaces.map((iface, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-theme-panel border border-theme-light text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <strong className="text-theme-main font-mono">{iface.name}</strong>
                    </div>
                    <span className="font-mono text-theme-muted select-all">{iface.ipv4}</span>
                    {iface.netmask && (
                      <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">/{iface.netmask}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsView({ token, t, lang, setLang, theme, setTheme, role, branding, onBrandingUpdated }) {
  const [companyName, setCompanyName] = useState(branding?.company_name || '');
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    if (branding?.company_name !== undefined) {
      setCompanyName(branding.company_name || '');
    }
  }, [branding]);

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    setBrandingMsg({ type: '', text: '' });
    try {
      await apiFetch('/api/system-branding/', {
        method: 'POST',
        body: JSON.stringify({ company_name: companyName.trim() })
      }, token);
      setBrandingMsg({ type: 'success', text: 'Identidad de la empresa guardada exitosamente.' });
      if (onBrandingUpdated) {
        onBrandingUpdated();
      }
      setTimeout(() => setBrandingMsg({ type: '', text: '' }), 4000);
    } catch (e) {
      setBrandingMsg({ type: 'error', text: e.message || 'Error al guardar la identidad de la empresa.' });
    } finally {
      setSavingBranding(false);
    }
  };

  const [aiConfig, setAiConfig] = useState({ provider: 'gemini', model_name: '', api_key: '' });
  const [telegramPreferences, setTelegramPreferences] = useState({
    telegram_chat_id: '',
    telegram_bot_token: '',
    telegram_severities: ['ALTA', 'CRITICA']
  });
  const [emailConfig, setEmailConfig] = useState({
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    from_name: 'AgentSOC Seguridad',
    from_email: ''
  });
  const [saving, setSaving] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [saveMsg, setSaveMsg] = useState({ type: '', text: '' });
  const [telegramMsg, setTelegramMsg] = useState({ type: '', text: '' });
  const [emailMsg, setEmailMsg] = useState({ type: '', text: '' });
  const [showKey, setShowKey] = useState(false);
  const [showChatId, setShowChatId] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');

  const severityOptions = [
    { value: 'INFO', label: t("sevInfo") || 'Informativa' },
    { value: 'BAJA', label: t("sevLow") || 'Baja' },
    { value: 'MEDIA', label: t("sevMedium") || 'Media' },
    { value: 'ALTA', label: t("sevHigh") || 'Alta' },
    { value: 'CRITICA', label: t("sevCritical") || 'Crítica' }
  ];

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [aiData, telegramData, emailData] = await Promise.all([
          apiFetch('/api/ai-config/', {}, token),
          apiFetch('/api/telegram-preferences/', {}, token),
          apiFetch('/api/email-config/', {}, token).catch(() => null)
        ]);
        if (aiData && aiData.provider) setAiConfig(aiData);
        if (telegramData) {
          setTelegramPreferences({
            telegram_chat_id: telegramData.telegram_chat_id || '',
            telegram_bot_token: telegramData.telegram_bot_token || '',
            telegram_severities: telegramData.telegram_severities || []
          });
        }
        if (emailData) {
          setEmailConfig(prev => ({
            ...prev,
            ...emailData
          }));
        }
      } catch (e) {
        console.error("Error fetching settings", e);
      }
    };
    fetchSettings();
  }, [token]);

  const handleSaveEmail = async () => {
    setSavingEmail(true);
    setEmailMsg({ type: '', text: '' });
    try {
      await apiFetch('/api/email-config/', {
        method: 'POST',
        body: JSON.stringify(emailConfig)
      }, token);
      setEmailMsg({ type: 'success', text: 'Configuración SMTP guardada exitosamente.' });
      setTimeout(() => setEmailMsg({ type: '', text: '' }), 4000);
    } catch (e) {
      setEmailMsg({ type: 'error', text: e.message || 'Error al guardar la configuración SMTP.' });
    } finally {
      setSavingEmail(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmailAddress.trim()) {
      setEmailMsg({ type: 'error', text: 'Ingresa un correo de destino para la prueba.' });
      return;
    }
    setTestingEmail(true);
    setEmailMsg({ type: '', text: '' });
    try {
      const res = await apiFetch('/api/email-test/', {
        method: 'POST',
        body: JSON.stringify({ target_email: testEmailAddress.trim() })
      }, token);
      setEmailMsg({ type: 'success', text: res.status || 'Correo de prueba enviado con éxito.' });
    } catch (e) {
      setEmailMsg({ type: 'error', text: e.message || 'Error al enviar correo de prueba.' });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTelegramSeverityChange = (severity) => {
    setTelegramPreferences(current => {
      const selected = current.telegram_severities.includes(severity);
      return {
        ...current,
        telegram_severities: selected
          ? current.telegram_severities.filter(item => item !== severity)
          : [...current.telegram_severities, severity]
      };
    });
  };

  const handleSaveTelegram = async () => {
    setSavingTelegram(true);
    setTelegramMsg({ type: '', text: '' });
    try {
      await apiFetch('/api/telegram-preferences/', {
        method: 'PUT',
        body: JSON.stringify(telegramPreferences)
      }, token);
      setTelegramMsg({ type: 'success', text: 'Preferencias de Telegram guardadas.' });
    } catch (e) {
      setTelegramMsg({ type: 'error', text: e.message || 'No se pudieron guardar las preferencias.' });
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleTestTelegram = async () => {
    setSavingTelegram(true);
    setTelegramMsg({ type: '', text: '' });
    try {
      const data = await apiFetch('/api/telegram-test/', {
        method: 'POST',
        body: JSON.stringify({
          telegram_chat_id: telegramPreferences.telegram_chat_id,
          telegram_bot_token: telegramPreferences.telegram_bot_token
        })
      }, token);
      setTelegramMsg({ type: 'success', text: data.status || 'Mensaje de prueba enviado.' });
    } catch (e) {
      setTelegramMsg({ type: 'error', text: e.message || 'No se pudo enviar el mensaje de prueba.' });
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleSaveAI = async () => {
    setSaving(true);
    setSaveMsg({ type: '', text: '' });
    try {
      await apiFetch('/api/ai-config/', {
        method: 'POST',
        body: JSON.stringify(aiConfig)
      }, token);
      setSaveMsg({ type: 'success', text: t("saveSuccess") });
      setTimeout(() => setSaveMsg({ type: '', text: '' }), 3000);
    } catch (e) {
      setSaveMsg({ type: 'error', text: t("saveError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-theme-main tracking-tight">{t("settingsTitle")}</h1>
        <p className="text-sm text-theme-muted mt-1">{t("settingsDesc")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-medium text-theme-main flex items-center gap-2 mb-6">
              <Menu className="w-5 h-5 text-theme-accent" /> {t("uiPrefs")}
            </h3>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-theme-main">{t("sysLang")}</p>
                  <p className="text-xs text-theme-muted mt-1">{t("sysLangDesc")}</p>
                </div>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="px-3 py-1.5 bg-indigo-500/10 text-theme-accent border border-indigo-500/20 rounded-md text-sm font-medium cursor-pointer outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="es">Español (ES)</option>
                  <option value="en">English (EN)</option>
                </select>
              </div>
              <hr className="border-theme-light" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-theme-main">{t("visualTheme")}</p>
                  <p className="text-xs text-theme-muted mt-1">{t("visualThemeDesc")}</p>
                </div>
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className={`w-11 h-6 rounded-full flex items-center transition-colors ${theme === 'dark' ? 'bg-indigo-600' : 'bg-slate-300'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full transform transition-transform shadow-sm ${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'}`}></div>
                </button>
              </div>
            </div>
          </div>

          {/* Acerca de AgentSOC integrado */}
          <div className="mt-8 pt-6 border-t border-theme-light">
            <h4 className="text-base font-medium text-theme-main flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 text-theme-success" /> {t("aboutTitle")}
            </h4>

            <div className="space-y-2.5 text-xs text-theme-muted leading-relaxed">
              <p>
                <strong className="text-theme-main font-semibold">AgentSOC Central</strong> {t("aboutP1")}
              </p>
              <p>
                {t("aboutP2")}
              </p>
            </div>

            <div className="mt-5 pt-4 border-t border-theme-light/60 space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-theme-muted">{t("sysVer")}</span>
                <span className="text-theme-main font-medium">v1.0.0 (Build 8492)</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-theme-muted">{t("author")}</span>
                <span className="text-theme-accent font-semibold tracking-wide">Lic. Gabriel Omar Cendra</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-theme-muted">{t("license")}</span>
                <span className="text-theme-main">{t("privateUse")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Identidad de la Empresa / Branding (Solo Admin) */}
        <div className="panel p-6">
          <form onSubmit={(e) => { e.preventDefault(); handleSaveBranding(); }} autoComplete="off">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-theme-main flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" /> {t("companyIdentity") || "Identidad de la Empresa"}
              </h3>
              {role === 'admin' ? (
                <span className="text-xs px-2.5 py-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-md flex items-center gap-1 font-medium">
                  <Check className="w-3 h-3" /> {t("adminOnly") || "Solo Administrador"}
                </span>
              ) : (
                <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md flex items-center gap-1">
                  <Lock className="w-3 h-3" /> {t("readOnlyAdmin") || "Solo lectura (Requiere Admin)"}
                </span>
              )}
            </div>
            <p className="text-xs text-theme-muted mb-4">
              {t("companyIdentityDesc") || 'Personaliza el encabezado del SOC y la pantalla de acceso. Al configurar el nombre de la empresa, el título de bienvenida cambia automáticamente a AgentSOC - "nombre de la empresa".'}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-main mb-1.5" htmlFor="soc_company_name_cfg">
                  {t("companyNameLabel") || "Nombre de la Empresa u Organización"}
                </label>
                <input
                  type="text"
                  id="soc_company_name_cfg"
                  name="soc_company_name_cfg"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  disabled={role !== 'admin'}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t("companyNamePlaceholder") || "Ej: Banco Nacional, TechCorp, Acme S.A."}
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main disabled:opacity-60"
                />
                <p className="text-[11px] text-theme-muted mt-1">
                  {role === 'admin'
                    ? (t("companyNameHelpAdmin") || 'Dejar vacío para restablecer el título predeterminado "Agent - SOC".')
                    : (t("companyNameHelpUser") || 'Solo los administradores tienen permisos para cambiar este valor.')}
                </p>
              </div>

              {/* Vista Previa en tiempo real */}
              <div className="p-3.5 rounded-lg bg-theme-panel border border-theme-light flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider">
                  {t("previewTitleLabel") || "Vista previa del Título (Login y Sistema)"}
                </span>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-theme-muted text-xs">{t("resultLabel") || "Resultado:"}</span>
                  <span className="font-bold text-indigo-400 text-base">
                    {companyName.trim() ? `AgentSOC - ${companyName.trim()}` : (t("welcomeSoc") || 'Agent - SOC')}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-theme-light">
                {brandingMsg.text ? (
                  <p className={`text-sm ${brandingMsg.type === 'success' ? 'text-theme-success' : 'text-theme-danger'}`}>
                    {brandingMsg.text}
                  </p>
                ) : <div />}

                {role === 'admin' && (
                  <button
                    type="submit"
                    disabled={savingBranding}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors ml-auto shadow-sm shadow-indigo-600/20"
                  >
                    {savingBranding && <RefreshCw className="w-4 h-4 animate-spin" />}
                    {savingBranding ? (t("savingIdentity") || 'Guardando...') : (t("saveIdentity") || 'Guardar Identidad')}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>

        {/* Motores de IA Card */}
        <div className="panel p-6">
          <form onSubmit={(e) => { e.preventDefault(); handleSaveAI(); }} autoComplete="off">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-theme-main flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-400" /> {t("aiConfigTitle")}
              </h3>
              {role !== 'admin' && (
                <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md flex items-center gap-1">
                  <Lock className="w-3 h-3" /> {t("readOnlyProtected") || "Solo lectura (Protegido)"}
                </span>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-main mb-1.5" htmlFor="ai_provider_select_cfg">{t("aiProvider")}</label>
                <select
                  id="ai_provider_select_cfg"
                  name="ai_provider_select_cfg"
                  disabled={role !== 'admin'}
                  value={aiConfig.provider || 'gemini'}
                  onChange={(e) => setAiConfig(c => ({ ...c, provider: e.target.value }))}
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main cursor-pointer disabled:opacity-60"
                >
                  <option value="gemini">Google Gemini AI</option>
                  <option value="openai">OpenAI (GPT-4)</option>
                  <option value="custom">Custom Endpoint</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-main mb-1.5" htmlFor="ai_model_name_cfg">{t("aiModel")}</label>
                <input
                  type="text"
                  id="ai_model_name_cfg"
                  name="ai_model_name_cfg"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  disabled={role !== 'admin'}
                  value={aiConfig.model_name || ''}
                  onChange={(e) => setAiConfig(c => ({ ...c, model_name: e.target.value }))}
                  placeholder="gemini-1.5-flash"
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main disabled:opacity-60"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-sm font-medium text-theme-main" htmlFor="ai_api_key_secret_cfg">{t("apiKeySettings")}</label>
                  {role === 'admin' ? (
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                    >
                      {showKey ? (t("hide") || 'Ocultar') : (t("show") || 'Mostrar')}
                    </button>
                  ) : (
                    <span className="text-xs text-amber-400 flex items-center gap-1 font-mono">
                      <Lock className="w-3 h-3" /> {t("hiddenKey") || "Clave Oculta"}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  id="ai_api_key_secret_cfg"
                  name="ai_api_key_secret_cfg"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  disabled={role !== 'admin'}
                  value={role === 'admin' ? (aiConfig.api_key || '') : '••••••••••••••••'}
                  onChange={(e) => setAiConfig(c => ({ ...c, api_key: e.target.value }))}
                  placeholder="AIzaSy..."
                  style={{ WebkitTextSecurity: role === 'admin' && showKey ? 'none' : 'disc' }}
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main font-mono disabled:opacity-60"
                />
              </div>

              {role === 'admin' && (
                <div className="flex items-center justify-between gap-4 pt-2">
                  {saveMsg.text && (
                    <p className={`text-sm ${saveMsg.type === 'success' ? 'text-theme-success' : 'text-theme-danger'}`}>
                      {saveMsg.text}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={saving}
                    className="ml-auto flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors"
                  >
                    {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
                    {t("saveChanges")}
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>

        <div className="panel p-6">
          <form onSubmit={(e) => { e.preventDefault(); handleSaveTelegram(); }} autoComplete="off">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-theme-main flex items-center gap-2">
                <Bell className="w-5 h-5 text-theme-accent" /> {t("telegramAlertsTitle") || "Alertas por Telegram"}
              </h3>
              {role === 'read' && (
                <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md flex items-center gap-1">
                  <Lock className="w-3 h-3" /> {t("readOnlyProtected") || "Solo lectura (Protegido)"}
                </span>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-sm font-medium text-theme-main" htmlFor="soc_telegram_chat_id_cfg">
                    {t("telegramChatIdLabel") || "Telegram Chat ID"}
                  </label>
                  {role !== 'read' ? (
                    <button
                      type="button"
                      onClick={() => setShowChatId(!showChatId)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      {showChatId ? <><EyeOff className="w-3.5 h-3.5" /> {t("hide") || "Ocultar"}</> : <><Eye className="w-3.5 h-3.5" /> {t("show") || "Mostrar"}</>}
                    </button>
                  ) : (
                    <span className="text-xs text-amber-400 flex items-center gap-1 font-mono">
                      <Lock className="w-3 h-3" /> {t("hiddenKey") || "Clave Oculta"}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  id="soc_telegram_chat_id_cfg"
                  name="soc_telegram_chat_id_cfg"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  disabled={role === 'read'}
                  value={role === 'read' ? (telegramPreferences.telegram_chat_id ? '••••••••' : (t("notConfigured") || 'No configurado')) : (telegramPreferences.telegram_chat_id || '')}
                  onChange={(e) => setTelegramPreferences(current => ({
                    ...current,
                    telegram_chat_id: e.target.value
                  }))}
                  placeholder={role !== 'read' && showChatId ? "Ej.: 123456789" : "••••••••"}
                  style={{ WebkitTextSecurity: role !== 'read' && showChatId ? 'none' : 'disc' }}
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main font-mono disabled:opacity-60"
                />
                <p className="text-xs text-theme-muted mt-2">
                  {role === 'read'
                    ? (t("telegramChatIdDescUser") || 'El identificador de chat se encuentra protegido para usuarios de solo lectura.')
                    : (t("telegramChatIdDescAdmin") || 'Es necesario para que el bot pueda enviarte las alertas.')}
                </p>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-sm font-medium text-theme-main" htmlFor="soc_telegram_bot_token_cfg">
                    {t("telegramBotTokenLabel") || "Token del Bot de Telegram (Bot Token)"}
                  </label>
                  {role !== 'read' ? (
                    <button
                      type="button"
                      onClick={() => setShowBotToken(!showBotToken)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      {showBotToken ? <><EyeOff className="w-3.5 h-3.5" /> {t("hide") || "Ocultar"}</> : <><Eye className="w-3.5 h-3.5" /> {t("show") || "Mostrar"}</>}
                    </button>
                  ) : (
                    <span className="text-xs text-amber-400 flex items-center gap-1 font-mono">
                      <Lock className="w-3 h-3" /> {t("hiddenToken") || "Token Oculto"}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  id="soc_telegram_bot_token_cfg"
                  name="soc_telegram_bot_token_cfg"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  disabled={role === 'read'}
                  value={role === 'read' ? (telegramPreferences.telegram_bot_token ? '••••••••••••••••' : (t("notConfigured") || 'No configurado')) : (telegramPreferences.telegram_bot_token || '')}
                  onChange={(e) => setTelegramPreferences(current => ({
                    ...current,
                    telegram_bot_token: e.target.value
                  }))}
                  placeholder={role !== 'read' && showBotToken ? "Ej.: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" : "••••••••••••••••"}
                  style={{ WebkitTextSecurity: role !== 'read' && showBotToken ? 'none' : 'disc' }}
                  className="w-full input-field py-2.5 px-3 text-sm text-theme-main font-mono disabled:opacity-60"
                />
                <p className="text-xs text-theme-muted mt-2">
                  {role === 'read'
                    ? (t("telegramBotTokenDescUser") || 'El token del bot se encuentra protegido para usuarios de solo lectura.')
                    : (t("telegramBotTokenDescAdmin") || 'Token provisto por @BotFather. Si lo dejás en blanco, se utilizará el configurado en el servidor (.env).')}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-theme-main mb-1">
                  {t("severitiesToReceive") || "Severidades a recibir"}
                </p>
                <p className="text-xs text-theme-muted mb-3">
                  {t("selectSeveritiesDesc") || "Seleccioná individualmente qué tipos de eventos querés recibir."}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {severityOptions.map((severity) => {
                    const checked = telegramPreferences.telegram_severities.includes(severity.value);
                    return (
                      <label
                        key={severity.value}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${role === 'read' ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
                          } ${checked
                            ? 'border-indigo-500/50 bg-indigo-500/10'
                            : 'border-theme-light bg-theme-panel'
                          }`}
                      >
                        <input
                          type="checkbox"
                          disabled={role === 'read'}
                          checked={checked}
                          onChange={() => handleTelegramSeverityChange(severity.value)}
                          className="h-4 w-4 accent-indigo-600 disabled:opacity-50"
                        />
                        <span className="text-sm text-theme-main">
                          {severity.label} ({severity.value})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {role !== 'read' && (
                <div className="flex items-center justify-between gap-4 pt-2">
                  {telegramMsg.text && (
                    <p className={`text-sm ${telegramMsg.type === 'success' ? 'text-theme-success' : 'text-theme-danger'}`}>
                      {telegramMsg.text}
                    </p>
                  )}
                  <div className="ml-auto flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={handleTestTelegram}
                      disabled={savingTelegram}
                      className="flex items-center gap-2 px-4 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/10 disabled:opacity-50 rounded-lg text-sm text-theme-main font-medium transition-colors"
                    >
                      {savingTelegram && <RefreshCw className="w-4 h-4 animate-spin" />}
                      {t("testTelegram") || "Probar Telegram"}
                    </button>
                    <button
                      type="submit"
                      disabled={savingTelegram}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors"
                    >
                      {savingTelegram && <RefreshCw className="w-4 h-4 animate-spin" />}
                      {savingTelegram ? (t("saving") || 'Guardando...') : (t("saveTelegram") || 'Guardar alertas')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Servidor de Correo Saliente (SMTP / Recuperación) Card */}
        <div className="panel p-6 lg:col-span-2">
          <form onSubmit={(e) => { e.preventDefault(); handleSaveEmail(); }} autoComplete="off">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 className="text-lg font-medium text-theme-main flex items-center gap-2">
                <Mail className="w-5 h-5 text-indigo-400" /> {t("smtpServerTitle") || "Servidor de Correo Saliente (SMTP / Recuperación)"}
              </h3>
              {role && role !== 'admin' && (
                <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md">
                  {t("readOnlyAdmin") || "Solo lectura (Requiere rol Administrador)"}
                </span>
              )}
            </div>
            <p className="text-xs text-theme-muted mb-5">
              {t("smtpServerDesc") || "Configuración de la cuenta de correo saliente que enviará automáticamente el código de seguridad de 6 dígitos a los usuarios para el restablecimiento de contraseñas."}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-theme-main mb-1.5" htmlFor="smtp_sender_display_name">{t("smtpSenderName") || "Nombre Remitente"}</label>
                    <input
                      type="text"
                      id="smtp_sender_display_name"
                      name="smtp_sender_display_name"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck="false"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      disabled={role !== 'admin'}
                      value={emailConfig.from_name || ''}
                      onChange={(e) => setEmailConfig(c => ({ ...c, from_name: e.target.value }))}
                      placeholder="AgentSOC Seguridad"
                      className="w-full input-field py-2 px-3 text-sm text-theme-main disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-main mb-1.5" htmlFor="smtp_sender_email_address">{t("smtpSenderEmail") || "Email Remitente (From)"}</label>
                    <input
                      type="email"
                      id="smtp_sender_email_address"
                      name="smtp_sender_email_address"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck="false"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      disabled={role !== 'admin'}
                      value={emailConfig.from_email || ''}
                      onChange={(e) => setEmailConfig(c => ({ ...c, from_email: e.target.value }))}
                      placeholder="seguridad@tudominio.com"
                      className="w-full input-field py-2 px-3 text-sm text-theme-main disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-theme-main mb-1.5" htmlFor="smtp_server_hostname">{t("smtpHost") || "Servidor Host SMTP"}</label>
                    <input
                      type="text"
                      id="smtp_server_hostname"
                      name="smtp_server_hostname"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck="false"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      disabled={role !== 'admin'}
                      value={emailConfig.smtp_host || ''}
                      onChange={(e) => setEmailConfig(c => ({ ...c, smtp_host: e.target.value }))}
                      placeholder="smtp.gmail.com"
                      className="w-full input-field py-2 px-3 text-sm text-theme-main font-mono disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-main mb-1.5" htmlFor="smtp_server_port_number">{t("smtpPort") || "Puerto"}</label>
                    <input
                      type="number"
                      id="smtp_server_port_number"
                      name="smtp_server_port_number"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      disabled={role !== 'admin'}
                      value={emailConfig.smtp_port || 587}
                      onChange={(e) => setEmailConfig(c => ({ ...c, smtp_port: parseInt(e.target.value, 10) || 587 }))}
                      placeholder="587"
                      className="w-full input-field py-2 px-3 text-sm text-theme-main font-mono disabled:opacity-50"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-theme-main">
                    <input
                      type="checkbox"
                      disabled={role !== 'admin'}
                      checked={emailConfig.smtp_use_tls}
                      onChange={(e) => setEmailConfig(c => ({ ...c, smtp_use_tls: e.target.checked }))}
                      className="h-4 w-4 accent-indigo-600 rounded"
                    />
                    <span>{t("smtpStarttls") || "STARTTLS (Recomendado puerto 587)"}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-theme-main">
                    <input
                      type="checkbox"
                      disabled={role !== 'admin'}
                      checked={emailConfig.smtp_use_ssl}
                      onChange={(e) => setEmailConfig(c => ({ ...c, smtp_use_ssl: e.target.checked }))}
                      className="h-4 w-4 accent-indigo-600 rounded"
                    />
                    <span>{t("smtpDirectSsl") || "SSL Directo (Recomendado puerto 465)"}</span>
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-theme-main mb-1.5" htmlFor="smtp_cfg_mail_sender">{t("smtpUser") || "Usuario / Correo SMTP"}</label>
                  <input
                    type="text"
                    id="smtp_cfg_mail_sender"
                    name="smtp_cfg_mail_sender"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    disabled={role !== 'admin'}
                    value={emailConfig.smtp_user || ''}
                    onChange={(e) => setEmailConfig(c => ({ ...c, smtp_user: e.target.value }))}
                    placeholder="alertas.soc@gmail.com"
                    className="w-full input-field py-2 px-3 text-sm text-theme-main disabled:opacity-50"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-medium text-theme-main" htmlFor="smtp_cfg_secret_token">{t("smtpPassword") || "Contraseña o Clave de Aplicación"}</label>
                    {role === 'admin' ? (
                      <button
                        type="button"
                        onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        {showSmtpPassword ? <><EyeOff className="w-3.5 h-3.5" /> {t("hide") || "Ocultar"}</> : <><Eye className="w-3.5 h-3.5" /> {t("show") || "Mostrar"}</>}
                      </button>
                    ) : (
                      <span className="text-xs text-amber-400 flex items-center gap-1 font-mono">
                        <Lock className="w-3 h-3" /> {t("hiddenKey") || "Clave Oculta"}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    id="smtp_cfg_secret_token"
                    name="smtp_cfg_secret_token"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    disabled={role !== 'admin'}
                    value={role === 'admin' ? (emailConfig.smtp_password || '') : '••••••••••••••••'}
                    onChange={(e) => setEmailConfig(c => ({ ...c, smtp_password: e.target.value }))}
                    placeholder="••••••••••••••••"
                    style={{ WebkitTextSecurity: role === 'admin' && showSmtpPassword ? 'none' : 'disc' }}
                    className="w-full input-field py-2 px-3 text-sm text-theme-main font-mono disabled:opacity-50"
                  />
                  <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-theme-muted mt-2 space-y-1.5">
                    <p className="text-theme-accent font-medium flex items-center gap-1">
                      <Info className="w-3.5 h-3.5 shrink-0" /> {t("smtpGmailQuestion") || "¿Usás una cuenta de Gmail?"}
                    </p>
                    <p>
                      {t("smtpGmailWarning") || "Google bloquea contraseñas personales directas en SMTP. Requiere una Contraseña de Aplicación de 16 caracteres:"}
                    </p>
                    <div className="text-[11px] space-y-0.5 text-theme-main">
                      <p>{t("smtpGmailStep1") || "1. Tené activada la Verificación en 2 pasos en tu cuenta de Google."}</p>
                      <p>{t("smtpGmailStep2") || "2. Ingresá en"} <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-indigo-400 underline font-medium hover:text-indigo-300 inline-flex items-center gap-0.5">myaccount.google.com/apppasswords <ExternalLink className="w-3 h-3 inline" /></a>.</p>
                      <p>{t("smtpGmailStep3") || '3. Creá una clave con nombre "AgentSOC" y pegá los 16 caracteres en este campo.'}</p>
                    </div>
                  </div>
                </div>

                {/* Test section - Solo para Administradores */}
                {role === 'admin' && (
                  <div className="pt-2 border-t border-theme-light">
                    <label className="block text-xs font-medium text-theme-main mb-1.5" htmlFor="smtp_test_dest_address">
                      {t("testPinEmail") || "Probar envío de código PIN de prueba"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        id="smtp_test_dest_address"
                        name="smtp_test_dest_address"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck="false"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                        placeholder={t("testEmailPlaceholder") || "correo.para.prueba@ejemplo.com"}
                        className="flex-1 input-field py-2 px-3 text-xs text-theme-main"
                      />
                      <button
                        type="button"
                        onClick={handleTestEmail}
                        disabled={testingEmail}
                        className="flex items-center gap-1.5 px-3 py-2 bg-theme-panel border border-theme-light hover:bg-slate-500/10 disabled:opacity-50 rounded-lg text-xs text-theme-main font-medium transition-colors whitespace-nowrap"
                      >
                        {testingEmail ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        {testingEmail ? (t("sending") || 'Enviando...') : (t("testSend") || 'Probar Envío')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-5 mt-4 border-t border-theme-light">
              {emailMsg.text ? (
                <p className={`text-sm ${emailMsg.type === 'success' ? 'text-theme-success' : 'text-theme-danger'}`}>
                  {emailMsg.text}
                </p>
              ) : <div />}

              {role === 'admin' && (
                <button
                  type="submit"
                  disabled={savingEmail}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors ml-auto shadow-sm shadow-indigo-600/20"
                >
                  {savingEmail && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {savingEmail ? (t("saving") || 'Guardando...') : (t("saveEmailSettings") || 'Guardar Configuración de Correo')}
                </button>
              )}
            </div>
          </form>
        </div>


      </div>
    </div>
  );
}

function SecurityView({ token, role, t, setView }) {
  const [activeTab, setActiveTab] = useState('sessions'); // 'sessions', 'policies', 'alerts'
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsMsg, setSessionsMsg] = useState({ type: '', text: '' });

  const [policies, setPolicies] = useState({
    enforce_mfa_admin: true,
    enforce_mfa_all: false,
    max_active_sessions_per_user: 5,
    session_timeout_hours: 24,
    alert_on_new_device: true,
    alert_on_new_ip: true,
    notify_suspicious_email: true,
    notify_suspicious_telegram: true,
    detect_impossible_travel: true,
    impossible_travel_speed_kmh: 800,
    detect_tor_exit_nodes: true,
    block_tor_logins: false
  });
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [policiesMsg, setPoliciesMsg] = useState({ type: '', text: '' });

  const [torStatus, setTorStatus] = useState({
    active_nodes: 0,
    last_updated: null,
    detect_tor_exit_nodes: true,
    block_tor_logins: false
  });
  const [syncingTor, setSyncingTor] = useState(false);

  const [trustedList, setTrustedList] = useState([]);
  const [loadingTrusted, setLoadingTrusted] = useState(false);

  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const data = await apiFetch('/api/auth/sessions/?all=true', {}, token);
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      setSessionsMsg({ type: 'error', text: err.message || 'Error al cargar sesiones.' });
    } finally {
      setLoadingSessions(false);
    }
  };

  const fetchTrustedList = async () => {
    setLoadingTrusted(true);
    try {
      const data = await apiFetch('/api/auth/trusted-accesses/', {}, token);
      setTrustedList(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Error al cargar accesos confiables:', err);
    } finally {
      setLoadingTrusted(false);
    }
  };

  const fetchTorStatus = async () => {
    try {
      const data = await apiFetch('/api/security/tor-status/', {}, token);
      if (data) {
        setTorStatus(data);
      }
    } catch (err) {
      console.warn('Error al obtener estado Tor CTI:', err);
    }
  };

  const handleSyncTor = async () => {
    setSyncingTor(true);
    try {
      const res = await apiFetch('/api/security/tor-sync/', { method: 'POST' }, token);
      setPoliciesMsg({ type: 'success', text: res.message || t("torSyncSuccess") || 'Lista de nodos Tor sincronizada.' });
      setTimeout(() => setPoliciesMsg({ type: '', text: '' }), 4000);
      fetchTorStatus();
    } catch (err) {
      setPoliciesMsg({ type: 'error', text: err.message || 'Error al sincronizar lista Tor.' });
    } finally {
      setSyncingTor(false);
    }
  };

  const fetchPolicies = async () => {
    setLoadingPolicies(true);
    try {
      const data = await apiFetch('/api/security/policies/', {}, token);
      if (data) {
        setPolicies(prev => ({ ...prev, ...data }));
      }
    } catch (err) {
      setPoliciesMsg({ type: 'error', text: err.message || 'Error al cargar políticas.' });
    } finally {
      setLoadingPolicies(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchTrustedList();
    fetchTorStatus();
    if (role === 'admin') {
      fetchPolicies();
    }
  }, [token, role]);

  const handleAuthorizeSession = async (sessionId, ipAddress, deviceName) => {
    const detail = [ipAddress, deviceName].filter(Boolean).join(' - ');
    const confirmMsg = t("confirmAuthorizeSession") ||
      `¿Confirmas que este acceso (${detail || 'IP/Dispositivo'}) es legítimo y autorizado?\nSe guardará la IP y el dispositivo como confiables para que no vuelva a generar alertas de sospecha.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await apiFetch(`/api/auth/sessions/${sessionId}/authorize/`, { method: 'POST' }, token);
      setSessionsMsg({ type: 'success', text: res.message || t("sessionAuthorizedSuccess") || 'Acceso marcado y guardado como legítimo.' });
      setTimeout(() => setSessionsMsg({ type: '', text: '' }), 4000);
      fetchSessions();
      fetchTrustedList();
    } catch (err) {
      setSessionsMsg({ type: 'error', text: err.message || 'Error al autorizar sesión.' });
    }
  };

  const handleDeleteTrusted = async (id, ipOrDev) => {
    if (!window.confirm(t("confirmDeleteTrustedAccess") || `¿Deseas eliminar '${ipOrDev}' de la lista de accesos confiables? Futuras conexiones desde esta IP o dispositivo podrán generar alertas.`)) return;
    try {
      const res = await apiFetch(`/api/auth/trusted-accesses/${id}/`, { method: 'DELETE' }, token);
      setSessionsMsg({ type: 'success', text: res.message || t("trustedDeletedSuccess") || 'Acceso confiable eliminado de la lista.' });
      setTimeout(() => setSessionsMsg({ type: '', text: '' }), 3500);
      fetchTrustedList();
      fetchSessions();
    } catch (err) {
      setSessionsMsg({ type: 'error', text: err.message || 'Error al eliminar acceso confiable.' });
    }
  };

  const handleRevokeSession = async (sessionId, isCurrent) => {
    const confirmMsg = isCurrent
      ? (t("confirmRevokeCurrent") || '¿Estás seguro de que deseas cerrar tu sesión actual? Tendrás que volver a autenticarte.')
      : (t("confirmRevokeSession") || '¿Deseas revocar esta sesión? El dispositivo perderá acceso de inmediato.');
    if (!window.confirm(confirmMsg)) return;

    try {
      await apiFetch(`/api/auth/sessions/${sessionId}/revoke/`, { method: 'POST' }, token);
      setSessionsMsg({ type: 'success', text: t("sessionRevokedSuccess") || 'Sesión revocada exitosamente.' });
      setTimeout(() => setSessionsMsg({ type: '', text: '' }), 3500);
      if (isCurrent) {
        window.location.reload();
      } else {
        fetchSessions();
      }
    } catch (err) {
      setSessionsMsg({ type: 'error', text: err.message || 'Error al revocar sesión.' });
    }
  };

  const handleRevokeOthers = async () => {
    if (!window.confirm(t("confirmRevokeOthers") || '¿Deseas revocar todas las demás sesiones activas en otros dispositivos? Esta acción desconectará inmediatamente cualquier otro acceso.')) return;
    try {
      const res = await apiFetch('/api/auth/sessions/revoke-others/', { method: 'POST' }, token);
      setSessionsMsg({ type: 'success', text: res.message || t("allOtherSessionsRevoked") || 'Todas las demás sesiones fueron revocadas.' });
      setTimeout(() => setSessionsMsg({ type: '', text: '' }), 3500);
      fetchSessions();
    } catch (err) {
      setSessionsMsg({ type: 'error', text: err.message || 'Error al revocar otras sesiones.' });
    }
  };

  const handleSavePolicies = async (e) => {
    e.preventDefault();
    setSavingPolicies(true);
    setPoliciesMsg({ type: '', text: '' });
    try {
      const res = await apiFetch('/api/security/policies/', {
        method: 'PATCH',
        body: JSON.stringify(policies)
      }, token);
      setPoliciesMsg({ type: 'success', text: res.message || t("policiesSavedSuccess") || 'Políticas de seguridad actualizadas con éxito.' });
      setTimeout(() => setPoliciesMsg({ type: '', text: '' }), 4000);
    } catch (err) {
      setPoliciesMsg({ type: 'error', text: err.message || 'Error al guardar políticas.' });
    } finally {
      setSavingPolicies(false);
    }
  };

  const suspiciousSessions = sessions.filter(s => s.is_suspicious);
  const activeSessions = sessions.filter(s => s.is_active);
  const desktopCount = activeSessions.filter(s => s.device_type === 'desktop').length;
  const mobileCount = activeSessions.filter(s => s.device_type === 'mobile' || s.device_type === 'tablet').length;

  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'mobile') return <Smartphone className="w-5 h-5 text-indigo-400" />;
    if (deviceType === 'tablet') return <Tablet className="w-5 h-5 text-cyan-400" />;
    return <Laptop className="w-5 h-5 text-blue-400" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 panel p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-theme-main tracking-tight flex items-center gap-2">
              {t("securityDevices") || "Seguridad y Dispositivos"}
              <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                {t("centralizedPolicies") || "Políticas Centralizadas"}
              </span>
            </h1>
            <p className="text-xs text-theme-muted mt-1">
              {t("securityDesc") || "Control de sesiones en tiempo real, autenticación de dos factores (MFA), auditoría de accesos y configuración de políticas."}
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-theme-panel border border-theme-light p-1 rounded-lg gap-1 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('sessions')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'sessions'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-theme-muted hover:text-theme-main hover:bg-slate-700/20'
              }`}
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>{t("devicesTab") || "Dispositivos"} ({activeSessions.length})</span>
          </button>
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setActiveTab('policies')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'policies'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-theme-muted hover:text-theme-main hover:bg-slate-700/20'
                }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{t("centralPoliciesTab") || "Políticas Centrales"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('alerts')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all ${activeTab === 'alerts'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-theme-muted hover:text-theme-main hover:bg-slate-700/20'
              }`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${suspiciousSessions.length > 0 ? 'text-rose-400' : ''}`} />
            <span>{t("suspiciousLoginsTab") || "Accesos Sospechosos"}</span>
            {suspiciousSessions.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {suspiciousSessions.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Tab 1: Sessions & Devices */}
      {activeTab === 'sessions' && (
        <div className="space-y-6">
          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <div className="panel p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("activeSessionsCard") || "Sesiones Activas"}</p>
                <p className="text-2xl font-bold text-theme-main mt-1">{activeSessions.length}</p>
                <span className="text-[11px] text-emerald-400 font-medium">{t("connectedDevicesCard") || "Dispositivos conectados"}</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="panel p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("desktopCard") || "Equipos de Escritorio"}</p>
                <p className="text-2xl font-bold text-theme-main mt-1">{desktopCount}</p>
                <span className="text-[11px] text-indigo-400 font-medium">{t("laptopsAndPcsCard") || "Laptops y PCs"}</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Laptop className="w-5 h-5" />
              </div>
            </div>

            <div className="panel p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("mobileCard") || "Dispositivos Móviles"}</p>
                <p className="text-2xl font-bold text-theme-main mt-1">{mobileCount}</p>
                <span className="text-[11px] text-cyan-400 font-medium">{t("phonesAndTabletsCard") || "Celulares y Tablets"}</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Smartphone className="w-5 h-5" />
              </div>
            </div>

            <div className="panel p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold">{t("unusualLoginsCard") || "Accesos Inusuales"}</p>
                <p className="text-2xl font-bold text-rose-400 mt-1">{suspiciousSessions.length}</p>
                <span className="text-[11px] text-rose-400/80 font-medium">{t("unusualIpsCard") || "IPs o equipos no habituales"}</span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
            </div>

            <div
              onClick={() => {
                sessionStorage.setItem('cti_initial_mode', 'radar');
                if (setView) setView('cti');
              }}
              className="panel p-4 flex items-center justify-between cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/5 transition-all group"
              title="Abrir Radar CTI y Escáner Visual"
            >
              <div>
                <p className="text-xs text-theme-muted uppercase tracking-wider font-semibold flex items-center gap-1.5">
                  {t("torNodesMonitored") || "Inteligencia Tor (CTI)"}
                  <span className="text-[10px] text-amber-400 group-hover:translate-x-0.5 transition-transform">➜</span>
                </p>
                <p className="text-2xl font-bold text-amber-400 mt-1">{torStatus.active_nodes ? torStatus.active_nodes.toLocaleString() : '0'}</p>
                <span className="text-[11px] text-amber-400/80 font-medium">
                  {policies.block_tor_logins ? (t("blockTorLogins") || "Bloqueo activo") : (policies.detect_tor_exit_nodes ? "Monitoreo CTI activo" : "Inactivo")}
                </span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                <Globe className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Action Bar & Notification */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-theme-muted">
              {loadingSessions ? (
                <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t("updatingSessions") || "Actualizando sesiones en tiempo real..."}</span>
              ) : (
                <span>{t("showingAllSessions") || "Mostrando todas las sesiones vinculadas al sistema. Revoca accesos desconocidos de inmediato."}</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchSessions}
                disabled={loadingSessions}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-panel hover:bg-slate-700/20 border border-theme-light rounded-lg text-xs font-medium text-theme-main transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSessions ? 'animate-spin' : ''}`} />
                <span>{t("refreshSessions") || "Refrescar"}</span>
              </button>

              <button
                type="button"
                onClick={handleRevokeOthers}
                disabled={activeSessions.length <= 1}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 rounded-lg text-xs font-medium text-rose-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={t("revokeAllOthersTitle") || "Cierra todas las sesiones en otros equipos dejando únicamente abierta esta sesión"}
              >
                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                <span>{t("revokeAllOthersBtn") || "Revocar todas las demás sesiones"}</span>
              </button>
            </div>
          </div>

          {sessionsMsg.text && (
            <div className={`p-3.5 rounded-lg text-xs flex items-center gap-2 ${sessionsMsg.type === 'error'
              ? 'bg-rose-500/10 border border-rose-500/20 text-theme-danger'
              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              }`}>
              {sessionsMsg.type === 'error' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{sessionsMsg.text}</span>
            </div>
          )}

          {/* Sessions List */}
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-theme-light bg-slate-800/40 text-theme-muted uppercase tracking-wider font-semibold">
                    <th className="py-3 px-4">{t("deviceBrowserCol") || "Dispositivo / Navegador"}</th>
                    <th className="py-3 px-4">{t("userCol") || "Usuario"}</th>
                    <th className="py-3 px-4">{t("ipNetworkCol") || "Dirección IP / Red"}</th>
                    <th className="py-3 px-4">{t("lastActivityCol") || "Última Actividad"}</th>
                    <th className="py-3 px-4">{t("statusCol") || "Estado"}</th>
                    <th className="py-3 px-4 text-right">{t("actionCol") || "Acción"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-light">
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-theme-muted">
                        <Laptop className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <span>{t("noActiveSessions") || "No hay sesiones activas registradas en este momento."}</span>
                      </td>
                    </tr>
                  ) : (
                    sessions.map((s) => (
                      <tr key={s.id} className={`hover:bg-slate-700/10 transition-colors ${s.is_current ? 'bg-indigo-500/5' : ''}`}>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-theme-panel border border-theme-light flex items-center justify-center shrink-0">
                              {getDeviceIcon(s.device_type)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-theme-main truncate">{s.device_name}</p>
                              <p className="text-[11px] text-theme-muted font-mono">{s.device_type}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-medium text-theme-main">{s.username}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-theme-main">{s.ip_address}</span>
                              {s.is_tor && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40" title="Nodo de salida Tor detectado">
                                  🧅 Tor
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-theme-muted block">
                              {s.city ? `${s.city}, ` : ''}{s.country || s.location || 'Red Local'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-theme-muted whitespace-nowrap">
                          <div>
                            <span className="text-theme-main block">{safeFormatDate(s.last_activity)}</span>
                            <span className="text-[10px] text-theme-muted">{t("startedAt") || "Iniciada:"} {safeFormatDate(s.created_at)}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col gap-1 items-start">
                            {s.is_current ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                {t("currentSessionBadge") || "Sesión Actual"}
                              </span>
                            ) : s.is_active ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                {t("activeBadge") || "Activa"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
                                {t("revokedBadge") || "Revocada"}
                              </span>
                            )}

                            {s.is_suspicious ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30" title={s.suspicious_reason}>
                                <AlertTriangle className="w-3 h-3 text-rose-400" />
                                {t("suspiciousBadge") || "Sospechosa"}
                              </span>
                            ) : (s.suspicious_reason && s.suspicious_reason.includes('Autorizado')) ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" title={s.suspicious_reason}>
                                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                {t("authorizedBadge") || "Legítimo"}
                              </span>
                            ) : null}

                            {s.is_tor && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40" title="Acceso desde la red Tor">
                                {t("torBadge") || "🧅 Red Tor"}
                              </span>
                            )}

                            {s.suspicious_reason && s.suspicious_reason.includes('Viaje Imposible') && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/25 text-rose-300 border border-rose-500/40" title={s.suspicious_reason}>
                                <Plane className="w-3 h-3 text-rose-400" />
                                {t("impossibleTravelBadge") || "✈️ Viaje Imposible"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                sessionStorage.setItem('cti_initial_mode', 'radar');
                                sessionStorage.setItem('cti_radar_ip', s.ip_address);
                                if (setView) setView('cti');
                              }}
                              className="px-2 py-1.5 rounded-md text-xs font-medium bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 transition-colors inline-flex items-center gap-1 shadow-sm cursor-pointer"
                              title={t("inspectInRadar") || "Inspeccionar en Radar CTI"}
                            >
                              <Crosshair className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Radar</span>
                            </button>
                            {s.is_suspicious && (
                              <button
                                type="button"
                                onClick={() => handleAuthorizeSession(s.id, s.ip_address, s.device_name)}
                                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                                title={t("markAsLegitimateDesc") || "Marcar y guardar este acceso como legítimo"}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{t("markAsLegitimateBtn") || "Marcar Legítimo"}</span>
                              </button>
                            )}
                            {s.is_active ? (
                              <button
                                type="button"
                                onClick={() => handleRevokeSession(s.id, s.is_current)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${s.is_current
                                  ? 'bg-slate-700/30 hover:bg-slate-700/50 text-theme-muted hover:text-theme-main border border-theme-light'
                                  : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20'
                                  }`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>{s.is_current ? (t("logoutBtn") || 'Cerrar sesión') : (t("revokeBtn") || 'Revocar')}</span>
                              </button>
                            ) : (
                              <span className="text-slate-500 text-[11px] italic">{t("inactiveLabel") || "Inactiva"}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Centralized Security Policies */}
      {activeTab === 'policies' && role === 'admin' && (
        <form onSubmit={handleSavePolicies} className="space-y-6">
          {policiesMsg.text && (
            <div className={`p-4 rounded-lg text-xs flex items-center gap-2.5 ${policiesMsg.type === 'error'
              ? 'bg-rose-500/10 border border-rose-500/20 text-theme-danger'
              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              }`}>
              {policiesMsg.type === 'error' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span className="font-medium">{policiesMsg.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* MFA Policies */}
            <div className="panel p-6 space-y-5">
              <div className="flex items-center gap-3 border-b border-theme-light pb-4">
                <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-theme-main">{t("mfaPoliciesTitle") || "Autenticación en Dos Pasos (MFA)"}</h3>
                  <p className="text-xs text-theme-muted">{t("mfaPoliciesDesc") || "Configura la obligatoriedad de PIN de 6 dígitos por email."}</p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-indigo-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("enforceMfaAdmin") || "MFA Obligatorio para Administradores"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("enforceMfaAdminDesc") || "Exige verificación obligatoria con código PIN de 6 dígitos al correo registrado en cada inicio de sesión de cuentas admin."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.enforce_mfa_admin}
                    onChange={e => setPolicies({ ...policies, enforce_mfa_admin: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-indigo-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("enforceMfaAll") || "MFA Obligatorio para Todos los Usuarios"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("enforceMfaAllDesc") || "Extiende la exigencia de verificación de 6 dígitos a todos los operadores de lectura y escritura."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.enforce_mfa_all}
                    onChange={e => setPolicies({ ...policies, enforce_mfa_all: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
              </div>
            </div>

            {/* Suspicious Access Policies */}
            <div className="panel p-6 space-y-5">
              <div className="flex items-center gap-3 border-b border-theme-light pb-4">
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-theme-main">{t("suspiciousDetectionTitle") || "Detección de Accesos Sospechosos"}</h3>
                  <p className="text-xs text-theme-muted">{t("suspiciousDetectionDesc") || "Alertas automáticas por comportamientos inusuales."}</p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-indigo-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("alertNewDevice") || "Alerta por Nuevo Dispositivo"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("alertNewDeviceDesc") || "Genera evento de criticidad ALTA si una cuenta inicia sesión desde un navegador o sistema operativo nunca antes visto."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.alert_on_new_device}
                    onChange={e => setPolicies({ ...policies, alert_on_new_device: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-indigo-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("alertNewIp") || "Alerta por Nueva Dirección IP"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("alertNewIpDesc") || "Dispara advertencia inmediata al detectar conexiones desde una dirección IP desconocida para el operador."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.alert_on_new_ip}
                    onChange={e => setPolicies({ ...policies, alert_on_new_ip: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
              </div>
            </div>

            {/* Notification Channels */}
            <div className="panel p-6 space-y-5">
              <div className="flex items-center gap-3 border-b border-theme-light pb-4">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-theme-main">{t("alertChannelsTitle") || "Canales de Alerta Inmediata"}</h3>
                  <p className="text-xs text-theme-muted">{t("alertChannelsDesc") || "Vías de entrega de incidentes y advertencias."}</p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-indigo-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("notifyEmail") || "Notificar por Correo Electrónico"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("notifyEmailDesc") || "Envía un correo con los detalles del acceso (IP, Dispositivo, Hora) ante cualquier alerta de seguridad."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.notify_suspicious_email}
                    onChange={e => setPolicies({ ...policies, notify_suspicious_email: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-indigo-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("notifyTelegram") || "Notificar por Telegram Bot"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("notifyTelegramDesc") || "Publica la alerta instantánea en el chat de Telegram registrado con prioridad ALTA."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.notify_suspicious_telegram}
                    onChange={e => setPolicies({ ...policies, notify_suspicious_telegram: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
              </div>
            </div>

            {/* Session Limits */}
            <div className="panel p-6 space-y-5">
              <div className="flex items-center gap-3 border-b border-theme-light pb-4">
                <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-theme-main">{t("sessionLimitsTitle") || "Límites y Tiempos de Expiración"}</h3>
                  <p className="text-xs text-theme-muted">{t("sessionLimitsDesc") || "Parámetros de control de ciclo de vida de sesiones."}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-theme-main mb-1.5">
                    {t("sessionTimeoutLabel") || "Expiración de Sesión (Horas)"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={policies.session_timeout_hours}
                    onChange={e => setPolicies({ ...policies, session_timeout_hours: parseInt(e.target.value) || 24 })}
                    className="w-full input-field py-2.5 px-3 text-sm text-theme-main"
                  />
                  <p className="text-[11px] text-theme-muted mt-1">{t("sessionTimeoutDesc") || "Tiempo de validez máxima antes de requerir reautenticación (ej. 24 horas)."}</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-theme-main mb-1.5">
                    {t("maxActiveSessionsLabel") || "Máximo de Sesiones Simultáneas por Usuario"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={policies.max_active_sessions_per_user}
                    onChange={e => setPolicies({ ...policies, max_active_sessions_per_user: parseInt(e.target.value) || 5 })}
                    className="w-full input-field py-2.5 px-3 text-sm text-theme-main"
                  />
                  <p className="text-[11px] text-theme-muted mt-1">{t("maxActiveSessionsDesc") || "Cantidad máxima permitida de dispositivos conectados al mismo tiempo."}</p>
                </div>
              </div>
            </div>

            {/* Impossible Travel Detection (UEBA) */}
            <div className="panel p-6 space-y-5">
              <div className="flex items-center gap-3 border-b border-theme-light pb-4">
                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
                  <Plane className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-theme-main">{t("impossibleTravelTitle") || "Detección de Viaje Imposible (UEBA)"}</h3>
                  <p className="text-xs text-theme-muted">{t("impossibleTravelDesc") || "Análisis geográfico y matemático de velocidad de tránsito entre inicios de sesión consecutivos."}</p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-indigo-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("detectImpossibleTravel") || "Habilitar Detección de Viaje Imposible"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("detectImpossibleTravelDesc") || "Calcula la distancia física (fórmula de Haversine) y la velocidad en km/h entre inicios de sesión para alertar accesos humanamente imposibles."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.detect_impossible_travel}
                    onChange={e => setPolicies({ ...policies, detect_impossible_travel: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                </label>

                <div>
                  <label className="block text-xs font-semibold text-theme-main mb-1.5">
                    {t("impossibleSpeedLabel") || "Umbral de Velocidad Máxima (km/h)"}
                  </label>
                  <input
                    type="number"
                    min={200}
                    max={3000}
                    step={50}
                    value={policies.impossible_travel_speed_kmh}
                    onChange={e => setPolicies({ ...policies, impossible_travel_speed_kmh: parseInt(e.target.value) || 800 })}
                    className="w-full input-field py-2.5 px-3 text-sm text-theme-main"
                  />
                  <p className="text-[11px] text-theme-muted mt-1">
                    {t("impossibleSpeedDesc") || "Velocidad de traslado a partir de la cual se considera viaje imposible (ej. 800 km/h: límite de aviación comercial)."}
                  </p>
                </div>
              </div>
            </div>

            {/* Tor Network & CTI Intelligence */}
            <div className="panel p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-theme-light pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-theme-main">{t("torDetectionTitle") || "Ciberinteligencia de Amenazas (CTI) - Red Tor y Proxies"}</h3>
                    <p className="text-xs text-theme-muted">{t("torDetectionDesc") || "Monitoreo continuo contra nodos de salida de Tor y redes de anonimización."}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSyncTor}
                  disabled={syncingTor}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 shrink-0"
                  title={t("syncTorList") || "Sincronizar Lista Tor"}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingTor ? 'animate-spin' : ''}`} />
                  <span>{syncingTor ? (t("syncingTorList") || "Sincronizando...") : (t("syncTorList") || "Sincronizar Lista Tor")}</span>
                </button>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">🧅</span>
                  <span className="text-xs text-theme-muted">
                    {t("torNodesMonitored") || "Nodos de salida Tor registrados en CTI"}:
                  </span>
                </div>
                <span className="text-xs font-bold font-mono text-amber-300">
                  {torStatus.active_nodes ? torStatus.active_nodes.toLocaleString() : '0'} nodos activos
                </span>
              </div>

              <div className="space-y-4">
                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-amber-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-theme-main block">
                      {t("detectTorNodes") || "Detectar Inicios de Sesión desde Nodos Tor"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("detectTorNodesDesc") || "Compara IPs en tiempo real con la lista oficial de nodos de salida Tor (Tor Project) y genera alerta CRÍTICA inmediata."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.detect_tor_exit_nodes}
                    onChange={e => setPolicies({ ...policies, detect_tor_exit_nodes: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-amber-600 focus:ring-amber-500"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-theme-panel border border-theme-light cursor-pointer hover:border-rose-500/40 transition-colors">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-rose-300 block">
                      {t("blockTorLogins") || "Bloquear Acceso desde Nodos de Salida Tor"}
                    </span>
                    <span className="text-[11px] text-theme-muted block leading-relaxed">
                      {t("blockTorLoginsDesc") || "Deniega automáticamente el inicio de sesión si la conexión proviene de un nodo de salida Tor verificado."}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={policies.block_tor_logins}
                    onChange={e => setPolicies({ ...policies, block_tor_logins: e.target.checked })}
                    className="mt-1 w-4 h-4 rounded border-slate-700 text-rose-600 focus:ring-rose-500"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingPolicies}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors shadow-lg shadow-indigo-900/20"
            >
              {savingPolicies ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              <span>{savingPolicies ? (t("savingPoliciesBtn") || "Guardando Políticas...") : (t("savePoliciesBtn") || "Guardar Políticas de Seguridad")}</span>
            </button>
          </div>
        </form>
      )}

      {/* Tab 3: Suspicious Access Audit */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="panel p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-sm text-theme-main flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  {t("suspiciousHistoryTitle") || "Historial de Accesos Sospechosos"}
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  {t("suspiciousHistoryDesc") || "Registro de intentos de acceso identificados por la detección de anomalías del SOC."}
                </p>
              </div>
              <button
                type="button"
                onClick={fetchSessions}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-panel hover:bg-slate-700/20 border border-theme-light rounded-lg text-xs font-medium text-theme-main"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t("refreshSessions") || "Actualizar"}</span>
              </button>
            </div>

            {suspiciousSessions.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2 opacity-80" />
                <h4 className="text-sm font-semibold text-theme-main">{t("secureEnvironment") || "Entorno Seguro"}</h4>
                <p className="text-xs text-theme-muted mt-1 max-w-md mx-auto">
                  {t("secureEnvDesc") || "No se han registrado accesos sospechosos recientemente. Todas las sesiones activas provienen de dispositivos y direcciones IP conocidas."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {suspiciousSessions.map(s => (
                  <div key={s.id} className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${s.is_tor || (s.suspicious_reason && s.suspicious_reason.includes('Viaje Imposible')) ? 'bg-rose-600 text-white animate-pulse' : 'bg-rose-500 text-white'}`}>
                          {s.is_tor ? 'TOR CTI CRÍTICA' : (s.suspicious_reason && s.suspicious_reason.includes('Viaje Imposible') ? 'UEBA CRÍTICA' : (t("alertBadge") || "ALERTA"))}
                        </span>
                        {s.is_tor && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            🧅 Tor Exit Node
                          </span>
                        )}
                        {s.suspicious_reason && s.suspicious_reason.includes('Viaje Imposible') && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                            <Plane className="w-3 h-3 text-rose-400" /> Viaje Imposible
                          </span>
                        )}
                        <span className="font-semibold text-xs text-rose-300">{s.suspicious_reason}</span>
                      </div>
                      <p className="text-xs text-theme-muted">
                        {t("affectedUser") || "Usuario afectado"}: <strong className="text-theme-main">{s.username}</strong> • IP: <strong className="font-mono text-theme-main">{s.ip_address}</strong> • Dispositivo: <strong className="text-theme-main">{s.device_name}</strong>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {t("detectedOn") || "Detectado el"} {safeFormatDate(s.created_at)} ({s.city ? `${s.city}, ` : ''}{s.country || s.location || 'Red Local'})
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          sessionStorage.setItem('cti_initial_mode', 'radar');
                          sessionStorage.setItem('cti_radar_ip', s.ip_address);
                          if (setView) setView('cti');
                        }}
                        className="px-2.5 py-1.5 bg-cyan-600/15 hover:bg-cyan-600/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                        title={t("inspectInRadar") || "Inspeccionar en Radar CTI"}
                      >
                        <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{t("inspectInRadar") || "Radar CTI"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAuthorizeSession(s.id, s.ip_address, s.device_name)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md transition-colors shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                        title={t("markAsLegitimateDesc") || "Guardar IP y dispositivo como confiables y marcar acceso como legítimo"}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>{t("markAsLegitimateBtn") || "Marcar como Legítimo"}</span>
                      </button>
                      {s.is_active ? (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(s.id, s.is_current)}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-md transition-colors shadow-sm"
                        >
                          {t("revokeAccessImmediately") || "Revocar Acceso Inmediatamente"}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500 italic">{t("sessionAlreadyRevoked") || "Sesión ya revocada"}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Panel de Accesos Autorizados Guardados */}
          <div className="panel p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-sm text-theme-main flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  {t("authorizedHistoryTitle") || "Accesos Autorizados y Dispositivos Confiables Guardados"}
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  {t("authorizedHistoryDesc") || "Direcciones IP y dispositivos aprobados que no generan alertas de sospecha."}
                </p>
              </div>
              <button
                type="button"
                onClick={fetchTrustedList}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-theme-panel hover:bg-slate-700/20 border border-theme-light rounded-lg text-xs font-medium text-theme-main"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTrusted ? 'animate-spin' : ''}`} />
                <span>{t("refreshSessions") || "Actualizar"}</span>
              </button>
            </div>

            {trustedList.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-theme-light rounded-lg">
                <p className="text-xs text-theme-muted">
                  {t("noTrustedAccesses") || "No hay accesos de confianza guardados manualmente todavía."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-theme-main border-collapse">
                  <thead>
                    <tr className="border-b border-theme-light text-theme-muted uppercase text-[10px] tracking-wider bg-theme-panel/50">
                      <th className="py-2.5 px-3">{t("user") || "Usuario"}</th>
                      <th className="py-2.5 px-3">IP</th>
                      <th className="py-2.5 px-3">{t("device") || "Dispositivo"}</th>
                      <th className="py-2.5 px-3">{t("notes") || "Detalle"}</th>
                      <th className="py-2.5 px-3">{t("date") || "Fecha de Aprobación"}</th>
                      <th className="py-2.5 px-3 text-right">{t("action") || "Acción"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-light/60">
                    {trustedList.map(item => (
                      <tr key={item.id} className="hover:bg-slate-700/10 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-theme-main">{item.username}</td>
                        <td className="py-2.5 px-3 font-mono text-emerald-400">{item.ip_address || "—"}</td>
                        <td className="py-2.5 px-3 text-theme-main">{item.device_name || "—"}</td>
                        <td className="py-2.5 px-3 text-theme-muted">{item.note || "Autorizado como legítimo"}</td>
                        <td className="py-2.5 px-3 text-theme-muted whitespace-nowrap">{safeFormatDate(item.created_at)}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteTrusted(item.id, item.ip_address || item.device_name)}
                            className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded transition-colors"
                            title={t("deleteTrustedAccess") || "Eliminar de Confiables"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// COMPONENTE: CTIView (Ciberinteligencia & IOCs)
// ==========================================
function CTIView({ token, role, t, theme, setView }) {
  // Modo CTI: 'center' (Centro CTI & IOCs) o 'radar' (Radar CTI & Escáner)
  const [ctiMode, setCtiMode] = useState(() => {
    const saved = sessionStorage.getItem('cti_initial_mode');
    if (saved) {
      sessionStorage.removeItem('cti_initial_mode');
      return saved;
    }
    return 'center';
  });

  const [activeTab, setActiveTab] = useState('hunter'); // 'hunter', 'database', 'hits', 'feeds'
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Estados de Radar CTI y Escáner Forense
  const [torStatus, setTorStatus] = useState({
    active_nodes: 0,
    last_updated: null,
    detect_tor_exit_nodes: true,
    block_tor_logins: false
  });
  const [syncingTor, setSyncingTor] = useState(false);
  const [radarTargetIp, setRadarTargetIp] = useState(() => {
    const savedIp = sessionStorage.getItem('cti_radar_ip');
    if (savedIp) {
      sessionStorage.removeItem('cti_radar_ip');
      return savedIp;
    }
    return '185.220.101.5';
  });
  const [radarScanning, setRadarScanning] = useState(false);
  const [radarScanResult, setRadarScanResult] = useState(null);
  const [radarActiveStep, setRadarActiveStep] = useState(4);
  const [radarMsg, setRadarMsg] = useState({ type: '', text: '' });

  // Estados de Escáner / Threat Hunter
  const [scanTarget, setScanTarget] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [copiedItem, setCopiedItem] = useState(null);

  // Estados de Base de Datos de IOCs
  const [indicators, setIndicators] = useState([]);
  const [loadingIndicators, setLoadingIndicators] = useState(false);
  const [iocSearch, setIocSearch] = useState('');
  const [iocTypeFilter, setIocTypeFilter] = useState('all');
  const [iocThreatFilter, setIocThreatFilter] = useState('all');
  const [iocSeverityFilter, setIocSeverityFilter] = useState('all');
  const [iocPage, setIocPage] = useState(1);
  const [iocTotalPages, setIocTotalPages] = useState(1);
  const [iocTotalCount, setIocTotalCount] = useState(0);

  // Modal para agregar IOC Manual
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newIocVal, setNewIocVal] = useState('');
  const [newIocType, setNewIocType] = useState('ip');
  const [newIocThreat, setNewIocThreat] = useState('c2_botnet');
  const [newIocFamily, setNewIocFamily] = useState('');
  const [newIocConfidence, setNewIocConfidence] = useState(90);
  const [newIocSeverity, setNewIocSeverity] = useState('CRITICA');
  const [newIocDesc, setNewIocDesc] = useState('');
  const [newIocTags, setNewIocTags] = useState('');
  const [addingIoc, setAddingIoc] = useState(false);

  // Estados de Historial de Detecciones / Hits
  const [hits, setHits] = useState([]);
  const [loadingHits, setLoadingHits] = useState(false);
  const [hitsSearch, setHitsSearch] = useState('');
  const [hitsPage, setHitsPage] = useState(1);
  const [hitsTotalPages, setHitsTotalPages] = useState(1);
  const [hitsTotalCount, setHitsTotalCount] = useState(0);

  // Estados de Sincronización de Feeds
  const [syncingFeeds, setSyncingFeeds] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  // 1. Cargar Estadísticas Globales y Estado Tor
  const fetchStats = async () => {
    try {
      const data = await apiFetch('/api/cti/stats/', {}, token);
      if (data) {
        setStats(data);
      }
    } catch (e) {
      console.error("Error cargando estadísticas CTI:", e);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchTorStatus = async () => {
    try {
      const data = await apiFetch('/api/security/tor-status/', {}, token);
      if (data) {
        setTorStatus(data);
      }
    } catch (err) {
      console.warn('Error al obtener estado Tor CTI:', err);
    }
  };

  const handleSyncTor = async () => {
    setSyncingTor(true);
    setRadarMsg({ type: '', text: '' });
    try {
      const res = await apiFetch('/api/security/tor-sync/', { method: 'POST' }, token);
      setRadarMsg({ type: 'success', text: res.message || t("torSyncSuccess") || 'Lista de nodos Tor sincronizada.' });
      setTimeout(() => setRadarMsg({ type: '', text: '' }), 4000);
      fetchTorStatus();
    } catch (err) {
      setRadarMsg({ type: 'error', text: err.message || 'Error al sincronizar lista Tor.' });
    } finally {
      setSyncingTor(false);
    }
  };

  const handleRunRadarScan = async (ipToScan, options = {}) => {
    const target = ipToScan || radarTargetIp || '185.220.101.5';
    setRadarScanning(true);
    setRadarActiveStep(1);

    setTimeout(() => setRadarActiveStep(2), 350);
    setTimeout(() => setRadarActiveStep(3), 700);

    try {
      const payload = {
        ip: target,
        prev_name: options.prev_name,
        prev_lat: options.prev_lat,
        prev_lon: options.prev_lon,
        elapsed_minutes: options.elapsed_minutes || 15
      };

      const res = await apiFetch('/api/security/tor-scan/', {
        method: 'POST',
        body: JSON.stringify(payload)
      }, token);

      setTimeout(() => {
        setRadarActiveStep(4);
        setRadarScanResult(res);
        setRadarScanning(false);
      }, 1050);
    } catch (err) {
      console.warn('Error running forensic scan:', err);
      setRadarScanning(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchTorStatus();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (ctiMode === 'radar' && !radarScanResult && !radarScanning) {
      handleRunRadarScan(radarTargetIp);
    }
  }, [ctiMode]);

  // 2. Cargar Indicadores (Database)
  const fetchIndicators = async (page = 1) => {
    setLoadingIndicators(true);
    try {
      const params = new URLSearchParams({
        page: page,
        page_size: 15,
        search: iocSearch,
        type: iocTypeFilter,
        threat: iocThreatFilter,
        severity: iocSeverityFilter
      });
      const data = await apiFetch(`/api/cti/indicators/?${params.toString()}`, {}, token);
      if (data) {
        setIndicators(data.results || []);
        setIocTotalCount(data.total || 0);
        setIocTotalPages(data.total_pages || 1);
        setIocPage(data.current_page || 1);
      }
    } catch (e) {
      console.error("Error cargando IOCs:", e);
    } finally {
      setLoadingIndicators(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'database') {
      fetchIndicators(1);
    }
  }, [activeTab, iocTypeFilter, iocThreatFilter, iocSeverityFilter]);

  // 3. Cargar Historial de Hits
  const fetchHits = async (page = 1) => {
    setLoadingHits(true);
    try {
      const params = new URLSearchParams({
        page: page,
        page_size: 15,
        search: hitsSearch
      });
      const data = await apiFetch(`/api/cti/hits/?${params.toString()}`, {}, token);
      if (data) {
        setHits(data.results || []);
        setHitsTotalCount(data.total || 0);
        setHitsTotalPages(data.total_pages || 1);
        setHitsPage(data.current_page || 1);
      }
    } catch (e) {
      console.error("Error cargando Hits CTI:", e);
    } finally {
      setLoadingHits(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'hits') {
      fetchHits(1);
    }
  }, [activeTab]);

  // Ejecutar Escáner Forense
  const handleRunScan = async (targetToScan) => {
    const query = (targetToScan !== undefined ? targetToScan : scanTarget).trim();
    if (!query) {
      setScanError(t("scanTargetPlaceholder") || "Ingresa un artefacto para escanear");
      return;
    }
    setScanError('');
    setScanning(true);
    try {
      const data = await apiFetch('/api/cti/scan/', {
        method: 'POST',
        body: JSON.stringify({ target: query })
      }, token);
      if (data) {
        setScanResult(data);
      }
    } catch (e) {
      setScanError(e.message || "Error ejecutando correlación CTI");
    } finally {
      setScanning(false);
    }
  };

  // Sincronizar Feeds CTI
  const handleSyncFeeds = async () => {
    setSyncingFeeds(true);
    setSyncMsg('');
    try {
      const data = await apiFetch('/api/cti/sync/', {
        method: 'POST'
      }, token);
      if (data) {
        setSyncMsg(data.message || "Feeds sincronizados con éxito.");
        fetchStats();
        if (activeTab === 'database') fetchIndicators(iocPage);
      }
    } catch (e) {
      setSyncMsg(e.message || "Error sincronizando feeds de inteligencia.");
    } finally {
      setSyncingFeeds(false);
    }
  };

  // Guardar IOC Manual
  const handleSaveIoc = async (e) => {
    e.preventDefault();
    if (!newIocVal.trim()) return;
    setAddingIoc(true);
    try {
      await apiFetch('/api/cti/indicators/', {
        method: 'POST',
        body: JSON.stringify({
          indicator_value: newIocVal.trim(),
          indicator_type: newIocType,
          threat_type: newIocThreat,
          malware_family: newIocFamily.trim(),
          confidence: newIocConfidence,
          severity: newIocSeverity,
          description: newIocDesc.trim(),
          tags: newIocTags.trim()
        })
      }, token);
      setIsAddModalOpen(false);
      setNewIocVal('');
      setNewIocFamily('');
      setNewIocDesc('');
      setNewIocTags('');
      fetchIndicators(1);
      fetchStats();
    } catch (e) {
      console.error("Error guardando IOC:", e);
      alert(e.message || "Error guardando IOC");
    } finally {
      setAddingIoc(false);
    }
  };

  // Eliminar IOC
  const handleDeleteIoc = async (id) => {
    if (!window.confirm("¿Seguro que deseas eliminar este indicador de la base de CTI?")) return;
    try {
      await apiFetch(`/api/cti/indicators/${id}/`, {
        method: 'DELETE'
      }, token);
      fetchIndicators(iocPage);
      fetchStats();
    } catch (e) {
      console.error("Error eliminando IOC:", e);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(id);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  const getThreatBadge = (threat) => {
    switch (threat) {
      case 'c2_botnet':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">🔴 C2 Botnet</span>;
      case 'ransomware':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">💀 Ransomware</span>;
      case 'malware':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">☣️ Malware</span>;
      case 'phishing':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30">🎣 Phishing</span>;
      case 'tor_exit':
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">🧅 Nodo Tor</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/15 text-slate-300 border border-slate-600/30">⚠️ Amenaza</span>;
    }
  };

  const getSeverityBadge = (sev) => {
    if (sev === 'CRITICA') return <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-600/25 text-red-300 border border-red-500/40">CRÍTICA</span>;
    if (sev === 'ALTA') return <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-orange-600/25 text-orange-300 border border-orange-500/40">ALTA</span>;
    if (sev === 'MEDIA') return <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-yellow-600/25 text-yellow-300 border border-yellow-500/40">MEDIA</span>;
    return <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-600/25 text-blue-300 border border-blue-500/40">BAJA</span>;
  };

  const totalHitsCount = stats?.total_hits || 0;

  return (
    <div className="space-y-6 fade-in text-theme-main pb-12">
      {/* Selector Responsive de Modo CTI: Centro CTI & IOCs vs Radar CTI & Escáner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2 bg-slate-900/90 border border-slate-800 rounded-xl shadow-lg backdrop-blur">
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setCtiMode('center')}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${ctiMode === 'center'
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/20'
              : 'text-theme-muted hover:text-white hover:bg-slate-800/60'
              }`}
          >
            <Database className="w-4 h-4 text-cyan-300 shrink-0" />
            <span className="truncate">{t("centerCti") || "Centro CTI & IOCs"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCtiMode('radar');
              if (!radarScanResult) {
                handleRunRadarScan(radarTargetIp);
              }
            }}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${ctiMode === 'radar'
              ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-500/20'
              : 'text-theme-muted hover:text-white hover:bg-slate-800/60'
              }`}
          >
            <Crosshair className={`w-4 h-4 shrink-0 ${ctiMode === 'radar' ? 'text-white animate-spin' : 'text-cyan-400'}`} />
            <span className="truncate">{t("radarTab") || "Radar CTI & Escáner"}</span>
            <span className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
              LIVE
            </span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-theme-muted px-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-mono text-[11px] text-cyan-300/80">Threat Intelligence &amp; Forensics Hub</span>
        </div>
      </div>

      {ctiMode === 'center' && (
        <>
          {/* Header Principal con Glowing Status y Acción de Sincronización */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 p-6 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-0 right-1/4 w-48 h-48 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10">
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-sm shadow-cyan-500/20">
                  <Crosshair className="w-5 h-5 animate-pulse" />
                </span>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  {t("ctiTitle") || "Motor de Ciberinteligencia y Correlación de IOCs (CTI)"}
                </h1>
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>O(1) Ultra-Fast RAM Cache (&lt; 0.05ms)</span>
                </span>
              </div>
              <p className="text-xs md:text-sm text-theme-muted max-w-3xl">
                {t("ctiSubtitle") || "Threat Intelligence Platform (TIP) con correlación en tiempo real de Servidores C2, Hashes Maliciosos, Dominios Botnet y Nodos de Ataque."}
              </p>
            </div>

            <div className="relative z-10 flex flex-wrap items-center gap-3">
              <button
                onClick={handleSyncFeeds}
                disabled={syncingFeeds}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingFeeds ? 'animate-spin' : ''}`} />
                {syncingFeeds ? (t("syncingFeedsBtn") || 'Sincronizando...') : (t("syncFeedsBtn") || 'Sincronizar Feeds CTI')}
              </button>
            </div>
          </div>

          {syncMsg && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-xs text-cyan-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>{syncMsg}</span>
              </div>
              <button onClick={() => setSyncMsg('')} className="text-cyan-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 5 KPI Cards en Vivo */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800/80 shadow-md backdrop-blur flex flex-col justify-between hover:border-slate-700 transition-all">
              <div className="flex items-center justify-between text-xs text-theme-muted mb-2">
                <span>{t("activeIocsCard") || "Total IOCs Activos"}</span>
                <Database className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <div className="text-2xl font-black text-white tracking-tight">
                  {loadingStats ? "..." : (stats?.total_iocs?.toLocaleString() || "0")}
                </div>
                <div className="text-[11px] text-theme-muted mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span>{stats?.ram_cached_iocs || 0} cargados en RAM</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800/80 shadow-md backdrop-blur flex flex-col justify-between hover:border-rose-500/30 transition-all">
              <div className="flex items-center justify-between text-xs text-theme-muted mb-2">
                <span>{t("c2ServersCard") || "Servidores C2 & Botnets"}</span>
                <Server className="w-4 h-4 text-rose-400" />
              </div>
              <div>
                <div className="text-2xl font-black text-rose-400 tracking-tight">
                  {loadingStats ? "..." : ((stats?.iocs_by_threat?.c2_botnet || 0) + (stats?.iocs_by_type?.ip || 0)).toLocaleString()}
                </div>
                <div className="text-[11px] text-rose-400/80 mt-1 flex items-center gap-1">
                  <span>Feodo &amp; ThreatFox IPs</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800/80 shadow-md backdrop-blur flex flex-col justify-between hover:border-purple-500/30 transition-all">
              <div className="flex items-center justify-between text-xs text-theme-muted mb-2">
                <span>{t("malwareHashesCard") || "Hashes de Malware"}</span>
                <ShieldAlert className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-black text-purple-400 tracking-tight">
                  {loadingStats ? "..." : ((stats?.iocs_by_type?.hash_sha256 || 0) + (stats?.iocs_by_type?.hash_md5 || 0)).toLocaleString()}
                </div>
                <div className="text-[11px] text-purple-400/80 mt-1">
                  <span>SHA256 &amp; MD5 Payloads</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-800/80 shadow-md backdrop-blur flex flex-col justify-between hover:border-amber-500/30 transition-all">
              <div className="flex items-center justify-between text-xs text-theme-muted mb-2">
                <span>{t("phishDomainsCard") || "Dominios y URLs C2"}</span>
                <Globe className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-black text-amber-400 tracking-tight">
                  {loadingStats ? "..." : ((stats?.iocs_by_type?.domain || 0) + (stats?.iocs_by_type?.url || 0)).toLocaleString()}
                </div>
                <div className="text-[11px] text-amber-400/80 mt-1">
                  <span>Phishing &amp; Droppers</span>
                </div>
              </div>
            </div>

            <div className={`p-4 rounded-xl border shadow-md backdrop-blur flex flex-col justify-between transition-all ${totalHitsCount > 0
              ? 'bg-rose-950/30 border-rose-600/50 shadow-rose-950/40 animate-cyber-glow'
              : 'bg-slate-900/70 border-slate-800/80'
              }`}>
              <div className="flex items-center justify-between text-xs text-theme-muted mb-2">
                <span className={totalHitsCount > 0 ? 'text-rose-300 font-bold' : ''}>
                  {t("totalHitsCard") || "Correlaciones Detectadas"}
                </span>
                <Zap className={`w-4 h-4 ${totalHitsCount > 0 ? 'text-rose-400 animate-bounce' : 'text-slate-400'}`} />
              </div>
              <div>
                <div className={`text-2xl font-black tracking-tight ${totalHitsCount > 0 ? 'text-rose-400' : 'text-white'}`}>
                  {loadingStats ? "..." : totalHitsCount.toLocaleString()}
                </div>
                <div className="text-[11px] mt-1 text-theme-muted flex items-center gap-1">
                  {totalHitsCount > 0 ? (
                    <span className="text-rose-400 font-semibold">⚠️ Amenazas correlacionadas</span>
                  ) : (
                    <span className="text-emerald-400">✓ Sin impactos activos</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs de Navegación del Módulo CTI */}
          <div className="flex border-b border-theme-light gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('hunter')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${activeTab === 'hunter'
                ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg'
                : 'border-transparent text-theme-muted hover:text-white'
                }`}
            >
              <Crosshair className="w-4 h-4" />
              <span>{t("ctiTabHunter") || "🎯 Escáner & Cazador de Amenazas"}</span>
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${activeTab === 'database'
                ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg'
                : 'border-transparent text-theme-muted hover:text-white'
                }`}
            >
              <Database className="w-4 h-4" />
              <span>{t("ctiTabDatabase") || "🛡️ Base de Conocimiento de IOCs"}</span>
            </button>

            <button
              onClick={() => setActiveTab('hits')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${activeTab === 'hits'
                ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg'
                : 'border-transparent text-theme-muted hover:text-white'
                }`}
            >
              <Zap className="w-4 h-4" />
              <span>{t("ctiTabHits") || "🚨 Historial de Detecciones y Matches"}</span>
              {totalHitsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold animate-pulse">
                  {totalHitsCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('feeds')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${activeTab === 'feeds'
                ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg'
                : 'border-transparent text-theme-muted hover:text-white'
                }`}
            >
              <Radio className="w-4 h-4" />
              <span>{t("ctiTabFeeds") || "📡 Orígenes de Inteligencia y Feeds"}</span>
            </button>
          </div>

          {/* ======================================================== */}
          {/* SUB-TAB 1: 🎯 THREAT HUNTER & ESCÁNER MULTI-ARTEFACTO     */}
          {/* ======================================================== */}
          {activeTab === 'hunter' && (
            <div className="space-y-6">
              <div className="bg-slate-900/80 p-6 rounded-2xl border border-slate-800 shadow-xl cti-grid-scan relative">
                <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-cyan-400" />
                  <span>Cazador Forense de Amenazas (Multi-Artifact IOC Hunter)</span>
                </h2>
                <p className="text-xs text-theme-muted mb-4 max-w-2xl">
                  Pega una dirección IP, un dominio, una URL, un hash SHA256/MD5 o un bloque completo de logs de firewall/servidor. El motor extraerá todos los artefactos y los correlacionará en microsegundos contra la base de CTI.
                </p>

                {/* Presets Rápidos */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="text-[11px] font-semibold text-theme-muted">Presets de prueba:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setScanTarget("185.220.101.5");
                      handleRunScan("185.220.101.5");
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 transition-colors"
                  >
                    🔴 C2 Emotet / Dridex IP
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScanTarget("194.26.29.112");
                      handleRunScan("194.26.29.112");
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 transition-colors"
                  >
                    🔴 Cobalt Strike TeamServer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScanTarget("275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f");
                      handleRunScan("275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f");
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-colors"
                  >
                    💀 WannaCry Ransomware (Hash)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScanTarget("c2-stealer.network");
                      handleRunScan("c2-stealer.network");
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                  >
                    🔴 Dominio RedLine C2
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const sampleLog = "ALERT [IPTables-DROP]: IN=eth0 SRC=185.220.101.5 DST=10.0.0.15 PROTO=TCP DPT=443 download attempt from http://c2-stealer.network/payload.exe hash=84c82835a5d21bbcf75a61706d8ab549";
                      setScanTarget(sampleLog);
                      handleRunScan(sampleLog);
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors"
                  >
                    🚨 Log Crítico Multi-vector
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScanTarget("8.8.8.8");
                      handleRunScan("8.8.8.8");
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                  >
                    🟢 IP Limpia (Google DNS)
                  </button>
                </div>

                <div className="space-y-3">
                  <textarea
                    rows={3}
                    value={scanTarget}
                    onChange={(e) => setScanTarget(e.target.value)}
                    placeholder={t("scanTargetPlaceholder") || "Ingresa una IP, dominio, hash SHA256/MD5 o pega un log completo para correlacionar..."}
                    className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 rounded-xl p-3.5 text-xs text-white font-mono placeholder:text-theme-muted transition-colors shadow-inner"
                  />

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setScanTarget('');
                        setScanResult(null);
                        setScanError('');
                      }}
                      className="text-xs text-theme-muted hover:text-white transition-colors"
                    >
                      Limpiar entrada
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunScan()}
                      disabled={scanning}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/30 transition-all disabled:opacity-50"
                    >
                      <Crosshair className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                      <span>{scanning ? "Correlacionando IOCs..." : (t("runScanBtn") || "Ejecutar Correlación CTI")}</span>
                    </button>
                  </div>
                </div>

                {scanError && (
                  <div className="mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{scanError}</span>
                  </div>
                )}
              </div>

              {/* Resultado de Correlación Forense (Visual WOW Factor) */}
              {scanResult && (
                <div className="space-y-6 fade-in">
                  {/* Verdict Header & Gauge Card */}
                  <div className={`p-6 rounded-2xl border shadow-2xl relative overflow-hidden backdrop-blur ${scanResult.risk_score >= 80
                    ? 'bg-gradient-to-br from-rose-950/60 via-slate-900 to-slate-950 border-rose-600/60 shadow-rose-950/50'
                    : scanResult.risk_score >= 50
                      ? 'bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-950 border-amber-600/60'
                      : 'bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-950 border-emerald-600/50'
                    }`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-black tracking-wider uppercase ${scanResult.risk_score >= 80 ? 'bg-rose-500 text-white animate-pulse' :
                            scanResult.risk_score >= 50 ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-white'
                            }`}>
                            {scanResult.verdict}
                          </span>
                          {scanResult.is_tor && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                              🧅 Nodo de Salida Tor Confirmado
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-bold text-white mb-1">
                          {scanResult.matches_count > 0 ? (
                            <span>{scanResult.matches_count} Indicador(es) de Compromiso (IOC) Correlacionado(s)</span>
                          ) : (
                            <span>Sin Coincidencias Maliciosas Activas</span>
                          )}
                        </h3>
                        <p className="text-xs text-theme-muted max-w-xl font-mono truncate">
                          Artefacto analizado: {scanResult.target.slice(0, 100)}{scanResult.target.length > 100 ? '...' : ''}
                        </p>
                      </div>

                      {/* Circular Threat Score Meter */}
                      <div className="flex items-center gap-4 bg-slate-950/70 p-4 rounded-2xl border border-slate-800 shadow-inner">
                        <div className="relative w-20 h-20 flex items-center justify-center">
                          <svg className="w-20 h-20 transform -rotate-90">
                            <circle
                              cx="40"
                              cy="40"
                              r="34"
                              stroke="currentColor"
                              strokeWidth="7"
                              className="text-slate-800"
                              fill="transparent"
                            />
                            <circle
                              cx="40"
                              cy="40"
                              r="34"
                              stroke="currentColor"
                              strokeWidth="7"
                              strokeDasharray={213}
                              strokeDashoffset={213 - (213 * scanResult.risk_score) / 100}
                              strokeLinecap="round"
                              className={
                                scanResult.risk_score >= 80 ? 'text-rose-500' :
                                  scanResult.risk_score >= 50 ? 'text-amber-500' : 'text-emerald-500'
                              }
                              fill="transparent"
                            />
                          </svg>
                          <div className="absolute flex flex-col items-center justify-center text-center">
                            <span className="text-lg font-black text-white leading-none">{scanResult.risk_score}</span>
                            <span className="text-[9px] font-bold text-theme-muted uppercase tracking-wider">/ 100</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white uppercase tracking-wider">
                            {t("threatScoreLabel") || "Puntaje de Amenaza"}
                          </div>
                          <div className="text-[11px] text-theme-muted mt-0.5">
                            {scanResult.risk_score >= 80 ? "Peligro Crítico - Respuesta Inmediata" :
                              scanResult.risk_score >= 50 ? "Tráfico Sospechoso - Monitoreo Activo" : "Activo Limpio / Confiable"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Mapeo MITRE ATT&CK / Kill Chain Pipeline */}
                  <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>{t("killChainTitle") || "Mapeo MITRE ATT&CK / Matriz de Intrusión"}</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 relative">
                      {[
                        { id: 1, name: "1. Reconocimiento", code: "TA0043", match: scanResult.is_tor },
                        { id: 2, name: "2. Acceso Inicial", code: "TA0001", match: scanResult.matches.some(m => m.threat_type === 'phishing') },
                        { id: 3, name: "3. Ejecución / Malware", code: "TA0002", match: scanResult.matches.some(m => m.threat_type === 'malware' || m.threat_type === 'ransomware') },
                        { id: 4, name: "4. Comando y Control", code: "TA0011", match: scanResult.matches.some(m => m.threat_type === 'c2_botnet') },
                        { id: 5, name: "5. Impacto / Exfiltración", code: "TA0040", match: scanResult.matches.some(m => m.threat_type === 'ransomware') }
                      ].map((phase) => (
                        <div
                          key={phase.id}
                          className={`p-3 rounded-xl border text-center transition-all ${phase.match
                            ? 'bg-rose-950/60 border-rose-500/80 text-rose-300 shadow-md shadow-rose-950/50 animate-pulse'
                            : 'bg-slate-950/40 border-slate-800 text-theme-muted opacity-60'
                            }`}
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wider">{phase.code}</div>
                          <div className="text-xs font-bold mt-1 text-white">{phase.name}</div>
                          <div className="text-[10px] mt-1">
                            {phase.match ? "🚨 Vector Activo" : "Normal"}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 text-xs text-theme-muted flex items-center gap-1.5">
                      <span className="font-semibold text-white">Etapa identificada:</span>
                      <span className="text-cyan-400 font-mono">{scanResult.kill_chain_stage}</span>
                    </div>
                  </div>

                  {/* Lista Detallada de Coincidencias de IOCs */}
                  {scanResult.matches.length > 0 && (
                    <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-400" />
                        <span>Indicadores Comprometidos Coincidentes</span>
                      </h4>
                      <div className="space-y-3">
                        {scanResult.matches.map((m, idx) => (
                          <div
                            key={idx}
                            className="bg-slate-950/70 p-4 rounded-xl border border-rose-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-bold text-rose-300 select-all">{m.indicator_value}</span>
                                {getThreatBadge(m.threat_type)}
                                {getSeverityBadge(m.severity)}
                                <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                                  Tipo: {m.indicator_type?.toUpperCase()}
                                </span>
                              </div>
                              <div className="text-xs text-white font-semibold">
                                Familia de Amenaza: <span className="text-cyan-400">{m.malware_family || "No especificada"}</span>
                              </div>
                              <p className="text-xs text-theme-muted">
                                {m.description || "Identificado como nodo malicioso por el motor de ciberinteligencia."}
                              </p>
                              <div className="text-[11px] text-theme-muted flex items-center gap-3 pt-1">
                                <span>Fuente: <strong className="text-slate-300">{m.source}</strong></span>
                                <span>Confianza: <strong className="text-emerald-400">{m.confidence}%</strong></span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => copyToClipboard(m.indicator_value, `ioc-${idx}`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                <span>{copiedItem === `ioc-${idx}` ? "Copiado!" : "Copiar"}</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Playbook de Respuesta y Mitigación Inmediata */}
                  {scanResult.mitigation_actions?.length > 0 && (
                    <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-cyan-400" />
                        <span>{t("mitigationTitle") || "Acciones de Respuesta y Mitigación Inmediata"}</span>
                      </h4>

                      <ul className="space-y-2 mb-4">
                        {scanResult.mitigation_actions.map((act, idx) => (
                          <li key={idx} className="text-xs text-slate-300 flex items-start gap-2 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
                            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                            <span>{act}</span>
                          </li>
                        ))}
                      </ul>

                      {/* Comando IPTables Rápido */}
                      {scanResult.target && !scanResult.target.includes(' ') && (
                        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-4 font-mono text-xs">
                          <div className="text-cyan-300 truncate">
                            sudo iptables -I INPUT -s {scanResult.target} -j DROP
                          </div>
                          <button
                            onClick={() => copyToClipboard(`sudo iptables -I INPUT -s ${scanResult.target} -j DROP`, 'iptables-cmd')}
                            className="px-3 py-1 rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 text-xs shrink-0 flex items-center gap-1 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>{copiedItem === 'iptables-cmd' ? "Copiado!" : "Copiar Regla"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Información Geográfica (si aplica a IP) */}
                  {scanResult.geo && (
                    <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          <Globe className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs text-theme-muted">Geolocalización del Host</div>
                          <div className="text-sm font-bold text-white">
                            {scanResult.geo.city || "Ciudad Desconocida"}, {scanResult.geo.country || "País Desconocido"}
                          </div>
                          <div className="text-xs text-theme-muted font-mono">
                            ISP / ASN: {scanResult.geo.isp || "N/A"}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (setView) setView('security');
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 transition-colors"
                      >
                        <Target className="w-3.5 h-3.5" />
                        <span>Ver en Radar &amp; Viaje Imposible</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* SUB-TAB 2: 🛡️ BASE DE CONOCIMIENTO DE IOCs (DATABASE)     */}
          {/* ======================================================== */}
          {activeTab === 'database' && (
            <div className="space-y-4">
              {/* Barra de Filtros y Botón de Agregar */}
              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 flex-1">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 text-theme-muted absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      name="cti_iocs_search_query"
                      id="cti_iocs_search_query"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck="false"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      value={iocSearch}
                      onChange={(e) => setIocSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') fetchIndicators(1); }}
                      placeholder={t("searchIocsPlaceholder") || "Buscar por IP, hash, dominio, familia..."}
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-theme-muted focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  {/* Filtro Tipo */}
                  <select
                    value={iocTypeFilter}
                    onChange={(e) => setIocTypeFilter(e.target.value)}
                    className="bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  >
                    <option value="all">Todos los Tipos</option>
                    <option value="ip">Direcciones IP</option>
                    <option value="domain">Dominios</option>
                    <option value="hash_sha256">Hashes SHA256</option>
                    <option value="hash_md5">Hashes MD5</option>
                    <option value="url">URLs</option>
                  </select>

                  {/* Filtro Amenaza */}
                  <select
                    value={iocThreatFilter}
                    onChange={(e) => setIocThreatFilter(e.target.value)}
                    className="bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  >
                    <option value="all">Todas las Amenazas</option>
                    <option value="c2_botnet">C2 / Botnets</option>
                    <option value="ransomware">Ransomware</option>
                    <option value="malware">Malware</option>
                    <option value="phishing">Phishing</option>
                    <option value="tor_exit">Nodos Tor</option>
                  </select>

                  {/* Filtro Severidad */}
                  <select
                    value={iocSeverityFilter}
                    onChange={(e) => setIocSeverityFilter(e.target.value)}
                    className="bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  >
                    <option value="all">Todas las Severidades</option>
                    <option value="CRITICA">Crítica</option>
                    <option value="ALTA">Alta</option>
                    <option value="MEDIA">Media</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => fetchIndicators(1)}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                  >
                    Filtrar
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-600/20 transition-all shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t("addIocBtn") || "Agregar IOC Manual"}</span>
                  </button>
                </div>
              </div>

              {/* Tabla de Indicadores */}
              <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/90 text-theme-muted uppercase tracking-wider text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Indicador (IOC)</th>
                        <th className="px-4 py-3">Tipo / Severidad</th>
                        <th className="px-4 py-3">Amenaza / Familia</th>
                        <th className="px-4 py-3">Fuente / Confianza</th>
                        <th className="px-4 py-3 text-center">Hits en SOC</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {loadingIndicators ? (
                        <tr>
                          <td colSpan={6} className="text-center py-10 text-theme-muted">
                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-400" />
                            <span>Cargando base de conocimiento CTI...</span>
                          </td>
                        </tr>
                      ) : indicators.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-10 text-theme-muted">
                            No se encontraron indicadores que coincidan con la búsqueda.
                          </td>
                        </tr>
                      ) : (
                        indicators.map((ioc) => (
                          <tr key={ioc.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs text-white max-w-[250px] truncate select-all">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate">{ioc.indicator_value}</span>
                                <button
                                  onClick={() => copyToClipboard(ioc.indicator_value, `tbl-${ioc.id}`)}
                                  className="text-theme-muted hover:text-cyan-400 shrink-0"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              {ioc.description && (
                                <div className="text-[10px] text-theme-muted truncate max-w-[240px] font-sans">
                                  {ioc.description}
                                </div>
                              )}
                            </td>

                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300">
                                  {ioc.indicator_type.toUpperCase()}
                                </span>
                                {getSeverityBadge(ioc.severity)}
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                {getThreatBadge(ioc.threat_type)}
                                <span className="text-xs font-semibold text-white">
                                  {ioc.malware_family || "General"}
                                </span>
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <div className="text-slate-300 text-xs truncate max-w-[140px]">{ioc.source}</div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <div className="w-14 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className="bg-cyan-400 h-1.5 rounded-full"
                                    style={{ width: `${ioc.confidence}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-cyan-400 font-mono">{ioc.confidence}%</span>
                              </div>
                            </td>

                            <td className="px-4 py-3 text-center">
                              {ioc.hit_count > 0 ? (
                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                  {ioc.hit_count} hits
                                </span>
                              ) : (
                                <span className="text-theme-muted text-xs">0</span>
                              )}
                            </td>

                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setScanTarget(ioc.indicator_value);
                                    setActiveTab('hunter');
                                    handleRunScan(ioc.indicator_value);
                                  }}
                                  title="Probar en Escáner"
                                  className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                                >
                                  <Crosshair className="w-3.5 h-3.5" />
                                </button>
                                {role === 'admin' && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteIoc(ioc.id)}
                                    title="Eliminar Indicador"
                                    className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Paginación */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-950/70 border-t border-slate-800 text-xs text-theme-muted">
                  <div>
                    Total: <strong className="text-white">{iocTotalCount}</strong> indicadores
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={iocPage <= 1}
                      onClick={() => fetchIndicators(iocPage - 1)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition-colors"
                    >
                      Anterior
                    </button>
                    <span>Página {iocPage} de {iocTotalPages}</span>
                    <button
                      type="button"
                      disabled={iocPage >= iocTotalPages}
                      onClick={() => fetchIndicators(iocPage + 1)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SUB-TAB 3: 🚨 HISTORIAL DE DETECCIONES Y MATCHES (HITS)   */}
          {/* ======================================================== */}
          {activeTab === 'hits' && (
            <div className="space-y-4">
              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-md flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-theme-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    name="cti_hits_search_query"
                    id="cti_hits_search_query"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck="false"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={hitsSearch}
                    onChange={(e) => setHitsSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchHits(1); }}
                    placeholder="Buscar por IP, usuario, evento o indicador..."
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-theme-muted focus:border-cyan-500"
                  />
                </div>
                <button
                  onClick={() => fetchHits(1)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                >
                  Refrescar Historial
                </button>
              </div>

              <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/90 text-theme-muted uppercase tracking-wider text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Fecha / Hora</th>
                        <th className="px-4 py-3">Indicador Matched</th>
                        <th className="px-4 py-3">Amenaza / Familia</th>
                        <th className="px-4 py-3">Evento / Origen</th>
                        <th className="px-4 py-3">IP / Usuario</th>
                        <th className="px-4 py-3">Acción Registrada</th>
                        <th className="px-4 py-3 text-right">Analizar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {loadingHits ? (
                        <tr>
                          <td colSpan={7} className="text-center py-10 text-theme-muted">
                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-400" />
                            <span>Cargando eventos de correlación...</span>
                          </td>
                        </tr>
                      ) : hits.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-10 text-theme-muted">
                            No se han registrado coincidencias ni detecciones de IOCs hasta el momento.
                          </td>
                        </tr>
                      ) : (
                        hits.map((h) => (
                          <tr key={h.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3 text-theme-muted whitespace-nowrap font-mono text-[11px]">
                              {new Date(h.created_at).toLocaleString()}
                            </td>

                            <td className="px-4 py-3 font-mono font-bold text-rose-300 select-all max-w-[200px] truncate">
                              {h.indicator_value}
                            </td>

                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1 items-start">
                                {getThreatBadge(h.threat_type)}
                                <span className="text-xs font-semibold text-white">
                                  {h.malware_family || "General"}
                                </span>
                              </div>
                            </td>

                            <td className="px-4 py-3 text-white max-w-[220px] truncate">
                              {h.source_event}
                            </td>

                            <td className="px-4 py-3 font-mono text-xs">
                              <div className="text-slate-200">{h.client_ip || "N/A"}</div>
                              {h.user_username && (
                                <div className="text-[10px] text-theme-muted font-sans">
                                  Usuario: {h.user_username}
                                </div>
                              )}
                            </td>

                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                                {h.action_taken}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setScanTarget(h.indicator_value);
                                  setActiveTab('hunter');
                                  handleRunScan(h.indicator_value);
                                }}
                                className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                                title="Inspeccionar en Escáner"
                              >
                                <Crosshair className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Paginación Hits */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-950/70 border-t border-slate-800 text-xs text-theme-muted">
                  <div>
                    Total: <strong className="text-white">{hitsTotalCount}</strong> eventos
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={hitsPage <= 1}
                      onClick={() => fetchHits(hitsPage - 1)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition-colors"
                    >
                      Anterior
                    </button>
                    <span>Página {hitsPage} de {hitsTotalPages}</span>
                    <button
                      type="button"
                      disabled={hitsPage >= hitsTotalPages}
                      onClick={() => fetchHits(hitsPage + 1)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* SUB-TAB 4: 📡 ORÍGENES DE INTELIGENCIA Y FEEDS CTI        */}
          {/* ======================================================== */}
          {activeTab === 'feeds' && (
            <div className="space-y-6">
              <div className="bg-slate-900/80 p-6 rounded-2xl border border-slate-800 shadow-xl">
                <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  <span>Orígenes de Inteligencia Conectados (Threat Feeds)</span>
                </h3>
                <p className="text-xs text-theme-muted mb-6 max-w-2xl">
                  El motor de CTI se alimenta de fuentes oficiales, abiertas y comunitarias sin costo de suscripción. Todos los feeds se normalizan y compilan en una matriz O(1) de alto rendimiento en memoria RAM.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {stats?.feeds_status?.map((feed, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>En Línea</span>
                          </span>
                          <span className="text-[10px] text-theme-muted font-mono">{feed.trust_level}</span>
                        </div>
                        <h4 className="text-sm font-bold text-white mb-1">{feed.name}</h4>
                        <p className="text-xs text-theme-muted mb-3">{feed.type}</p>
                      </div>

                      <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                        <span className="text-theme-muted">Indicadores:</span>
                        <span className="font-bold text-cyan-400 font-mono">
                          {feed.active_indicators?.toLocaleString() || "0"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs text-theme-muted flex items-center gap-2">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    <span>
                      Última sincronización programada:{" "}
                      <strong className="text-white font-mono">
                        {stats?.last_sync ? new Date(stats.last_sync).toLocaleString() : "Al arrancar servidor"}
                      </strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSyncFeeds}
                    disabled={syncingFeeds}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/30 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingFeeds ? 'animate-spin' : ''}`} />
                    <span>{syncingFeeds ? "Sincronizando..." : "Actualizar Todos los Feeds"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MODAL: AGREGAR IOC PERSONALIZADO                          */}
          {/* ======================================================== */}
          {isAddModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm fade-in">
              <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative text-theme-main">
                <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Shield className="w-5 h-5 text-cyan-400" />
                    <span>Agregar Indicador de Compromiso (IOC)</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="text-theme-muted hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSaveIoc} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-theme-muted mb-1 font-semibold">Valor del Indicador *</label>
                    <input
                      type="text"
                      required
                      placeholder="ej: 185.220.101.5, evil.com, e3b0c44..."
                      value={newIocVal}
                      onChange={(e) => setNewIocVal(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-mono placeholder:text-theme-muted focus:border-cyan-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-theme-muted mb-1 font-semibold">Tipo</label>
                      <select
                        value={newIocType}
                        onChange={(e) => setNewIocType(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500"
                      >
                        <option value="ip">Dirección IP</option>
                        <option value="domain">Nombre de Dominio</option>
                        <option value="hash_sha256">Hash SHA256</option>
                        <option value="hash_md5">Hash MD5</option>
                        <option value="url">URL Maliciosa</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-theme-muted mb-1 font-semibold">Categoría de Amenaza</label>
                      <select
                        value={newIocThreat}
                        onChange={(e) => setNewIocThreat(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500"
                      >
                        <option value="c2_botnet">C2 / Botnet</option>
                        <option value="ransomware">Ransomware</option>
                        <option value="malware">Malware</option>
                        <option value="phishing">Phishing</option>
                        <option value="scanner">Escáner / Exploit</option>
                        <option value="tor_exit">Nodo Tor</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-theme-muted mb-1 font-semibold">Familia de Malware (Opcional)</label>
                      <input
                        type="text"
                        placeholder="ej: Cobalt Strike, Emotet, LockBit"
                        value={newIocFamily}
                        onChange={(e) => setNewIocFamily(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500"
                      />
                    </div>

                    <div>
                      <label className="block text-theme-muted mb-1 font-semibold">Confianza (%)</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={newIocConfidence}
                        onChange={(e) => setNewIocConfidence(parseInt(e.target.value) || 85)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-theme-muted mb-1 font-semibold">Severidad</label>
                    <div className="grid grid-cols-4 gap-2">
                      {['CRITICA', 'ALTA', 'MEDIA', 'BAJA'].map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setNewIocSeverity(lvl)}
                          className={`py-2 rounded-lg text-xs font-bold transition-all border ${newIocSeverity === lvl
                            ? (lvl === 'CRITICA' ? 'bg-red-600 text-white border-red-500 shadow-md shadow-red-900/40' :
                              lvl === 'ALTA' ? 'bg-orange-600 text-white border-orange-500' :
                                lvl === 'MEDIA' ? 'bg-yellow-600 text-black border-yellow-500' : 'bg-blue-600 text-white border-blue-500')
                            : 'bg-slate-950 border-slate-800 text-theme-muted hover:border-slate-700'
                            }`}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-theme-muted mb-1 font-semibold">Descripción / Justificación</label>
                    <textarea
                      rows={2}
                      placeholder="Detalles forenses o contexto del incidente..."
                      value={newIocDesc}
                      onChange={(e) => setNewIocDesc(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-theme-muted focus:border-cyan-500"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setIsAddModalOpen(false)}
                      className="px-4 py-2 rounded-xl text-xs text-theme-muted hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={addingIoc}
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/30 transition-all disabled:opacity-50"
                    >
                      {addingIoc ? "Guardando..." : "Guardar en Base CTI"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modo: Radar CTI & Escáner Forense */}
      {ctiMode === 'radar' && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="panel p-6 border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 shadow-lg shadow-cyan-500/10">
                  <Crosshair className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-theme-main">{t("radarTitle") || "Radar CTI y Escáner Forense de Amenazas"}</h2>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                      {t("radarSweepStatus") || "BARRIDO EN VIVO"}
                    </span>
                  </div>
                  <p className="text-xs text-theme-muted mt-1">
                    {t("radarDesc") || "Visualización interactiva del barrido de nodos Tor y vectores de velocidad de Viaje Imposible (UEBA)."}
                  </p>
                </div>
              </div>

              {/* Status pill */}
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <span className="text-[11px] text-theme-muted block">{t("torNodesMonitored") || "Nodos Tor Indexados"}</span>
                  <span className="text-xs font-mono font-bold text-amber-400">{torStatus.active_nodes ? torStatus.active_nodes.toLocaleString() : '0'} nodos activos</span>
                </div>
                <button
                  type="button"
                  onClick={handleSyncTor}
                  disabled={syncingTor}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  title="Sincronizar Lista Oficial Tor"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingTor ? 'animate-spin' : ''}`} />
                  <span>{syncingTor ? "Sincronizando..." : "Sincronizar"}</span>
                </button>
              </div>
            </div>

            {/* Target Input & Scenario Presets */}
            <div className="mt-5 pt-4 border-t border-theme-light flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex-1 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-theme-muted">
                    <Target className="w-4 h-4 text-cyan-400" />
                  </div>
                  <input
                    type="text"
                    value={radarTargetIp}
                    onChange={(e) => setRadarTargetIp(e.target.value)}
                    placeholder="Ingresa IP pública a escanear (ej. 185.220.101.5)..."
                    className="w-full pl-9 pr-3 py-2 input-field text-xs font-mono text-theme-main"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRunRadarScan(radarTargetIp)}
                  disabled={radarScanning || !radarTargetIp}
                  className="flex items-center justify-center gap-2 px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-xs rounded-lg transition-colors shadow-md shadow-cyan-900/20 whitespace-nowrap cursor-pointer"
                >
                  <Crosshair className={`w-4 h-4 ${radarScanning ? 'animate-spin' : ''}`} />
                  <span>{radarScanning ? (t("scanningInProgress") || "Escaneando...") : (t("scanNowBtn") || "Iniciar Escaneo")}</span>
                </button>
              </div>

              {/* Quick Presets */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-theme-muted font-medium">Escenarios de prueba:</span>
                <button
                  type="button"
                  onClick={() => {
                    const ip = (radarScanResult && radarScanResult.sample_tor_node) || '185.220.101.5';
                    setRadarTargetIp(ip);
                    handleRunRadarScan(ip);
                  }}
                  className="px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  🧅 {t("demoPresetTor") || "Nodo Tor Real"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ip = '133.242.18.20';
                    setRadarTargetIp(ip);
                    handleRunRadarScan(ip, {
                      prev_name: 'Buenos Aires, Argentina',
                      prev_lat: -34.6037,
                      prev_lon: -58.3816,
                      elapsed_minutes: 12
                    });
                  }}
                  className="px-2.5 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  ✈️ {t("demoPresetTravel") || "Simular Viaje Imposible"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRadarTargetIp('192.168.1.100');
                    handleRunRadarScan('192.168.1.100');
                  }}
                  className="px-2.5 py-1 rounded bg-slate-700/30 hover:bg-slate-700/50 border border-theme-light text-theme-muted hover:text-theme-main text-xs font-medium transition-colors cursor-pointer"
                >
                  🛡️ {t("demoPresetLocal") || "Red Local"}
                </button>
              </div>
            </div>
          </div>

          {radarMsg.text && (
            <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-xs ${radarMsg.type === 'error'
              ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
              : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              }`}>
              <div className="flex items-center gap-2">
                {radarMsg.type === 'error' ? <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                <span>{radarMsg.text}</span>
              </div>
              <button onClick={() => setRadarMsg({ type: '', text: '' })} className="text-theme-muted hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Radar Screen + Circuit Flow + Forensic Steps */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Radar Scope Visual (Col 1: 7 cols) */}
            <div className="lg:col-span-7 panel p-6 flex flex-col justify-between relative overflow-hidden bg-slate-950 border-cyan-500/20 shadow-2xl">
              {/* Radar Corner HUD */}
              <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400/80 mb-2 z-10">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>CTI RADAR SCOPE // RANGE: 20,000 KM</span>
                </div>
                {radarScanResult && (
                  <span className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider ${radarScanResult.impossible_travel?.detected
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                    : radarScanResult.is_tor
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    }`}>
                    {radarScanResult.impossible_travel?.detected
                      ? (t("physicsViolation") || "🚨 INFRACCIÓN DE FÍSICA")
                      : radarScanResult.is_tor
                        ? "🧅 NODO DE SALIDA TOR"
                        : (t("normalTransit") || "✅ TRÁNSITO FÍSICO NORMAL")}
                  </span>
                )}
              </div>

              {/* The Circular Radar Scope */}
              <div className="relative w-full aspect-square max-w-[420px] mx-auto flex items-center justify-center my-4">
                {/* Background radar gradient */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-b from-cyan-950/20 via-slate-950 to-slate-950 border border-cyan-500/30 shadow-[inset_0_0_60px_rgba(6,182,212,0.15)]" />

                {/* Rotating Sweep Beam */}
                <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
                  <div
                    className="w-full h-full rounded-full animate-radar-sweep"
                    style={{
                      background: 'conic-gradient(from 0deg, rgba(6, 182, 212, 0.35) 0deg, rgba(6, 182, 212, 0.05) 45deg, transparent 60deg, transparent 360deg)'
                    }}
                  />
                </div>

                {/* Concentric Distance Rings */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 400">
                  <circle cx="200" cy="200" r="45" fill="none" stroke="rgba(6, 182, 212, 0.2)" strokeWidth="1" strokeDasharray="3 3" />
                  <circle cx="200" cy="200" r="90" fill="none" stroke="rgba(6, 182, 212, 0.25)" strokeWidth="4 4" />
                  <circle cx="200" cy="200" r="140" fill="none" stroke="rgba(6, 182, 212, 0.3)" strokeWidth="4 4" />
                  <circle cx="200" cy="200" r="185" fill="none" stroke="rgba(6, 182, 212, 0.4)" strokeWidth="1.5" />

                  <line x1="200" y1="15" x2="200" y2="385" stroke="rgba(6, 182, 212, 0.2)" strokeWidth="1" />
                  <line x1="15" y1="200" x2="385" y2="200" stroke="rgba(6, 182, 212, 0.2)" strokeWidth="1" />
                  <line x1="69" y1="69" x2="331" y2="331" stroke="rgba(6, 182, 212, 0.1)" strokeWidth="0.8" />
                  <line x1="331" y1="69" x2="69" y2="331" stroke="rgba(6, 182, 212, 0.1)" strokeWidth="0.8" />

                  <text x="204" y="152" fill="rgba(6, 182, 212, 0.5)" fontSize="9" fontFamily="monospace">2.5K KM</text>
                  <text x="204" y="108" fill="rgba(6, 182, 212, 0.5)" fontSize="9" fontFamily="monospace">5K KM</text>
                  <text x="204" y="58" fill="rgba(6, 182, 212, 0.5)" fontSize="9" fontFamily="monospace">10K KM</text>
                  <text x="204" y="24" fill="rgba(6, 182, 212, 0.7)" fontSize="9" fontFamily="monospace">15K KM</text>

                  <text x="200" y="12" fill="#06b6d4" fontSize="10" fontWeight="bold" textAnchor="middle">N</text>
                  <text x="392" y="204" fill="#06b6d4" fontSize="10" fontWeight="bold" textAnchor="middle">E</text>
                  <text x="200" y="396" fill="#06b6d4" fontSize="10" fontWeight="bold" textAnchor="middle">S</text>
                  <text x="8" y="204" fill="#06b6d4" fontSize="10" fontWeight="bold" textAnchor="middle">W</text>

                  <circle cx="160" cy="110" r="2" fill="rgba(251, 191, 36, 0.4)" />
                  <circle cx="240" cy="130" r="2" fill="rgba(251, 191, 36, 0.4)" />
                  <circle cx="110" cy="220" r="2.5" fill="rgba(251, 191, 36, 0.45)" />
                  <circle cx="280" cy="270" r="2" fill="rgba(251, 191, 36, 0.4)" />
                  <circle cx="130" cy="300" r="2" fill="rgba(251, 191, 36, 0.35)" />
                  <circle cx="290" cy="150" r="2.5" fill="rgba(251, 191, 36, 0.45)" />

                  {radarScanResult && (
                    <>
                      <path
                        d="M 120 260 Q 170 120 280 120"
                        fill="none"
                        stroke={radarScanResult.impossible_travel?.detected ? "#f43f5e" : "#06b6d4"}
                        strokeWidth="2.5"
                        className="animate-flight-dash"
                      />

                      <g transform="translate(120, 260)">
                        <circle cx="0" cy="0" r="12" fill="none" stroke="#10b981" strokeWidth="1.5" className="animate-radar-blip" />
                        <circle cx="0" cy="0" r="4.5" fill="#10b981" />
                        <text x="8" y="16" fill="#10b981" fontSize="9" fontWeight="bold" fontFamily="monospace">[A] ORIGEN</text>
                      </g>

                      <g transform="translate(280, 120)">
                        <circle
                          cx="0"
                          cy="0"
                          r="16"
                          fill="none"
                          stroke={radarScanResult.impossible_travel?.detected ? "#f43f5e" : (radarScanResult.is_tor ? "#f59e0b" : "#3b82f6")}
                          strokeWidth="2"
                          className="animate-radar-blip"
                        />
                        <circle
                          cx="0"
                          cy="0"
                          r="6"
                          fill={radarScanResult.impossible_travel?.detected ? "#f43f5e" : (radarScanResult.is_tor ? "#f59e0b" : "#3b82f6")}
                        />
                        <text
                          x="10"
                          y="-8"
                          fill={radarScanResult.impossible_travel?.detected ? "#f43f5e" : (radarScanResult.is_tor ? "#f59e0b" : "#38bdf8")}
                          fontSize="9"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          [B] {radarScanResult.is_tor ? "🧅 TOR EXIT" : (radarScanResult.impossible_travel?.detected ? "🚨 ANOMALÍA" : "DESTINO")}
                        </text>
                      </g>
                    </>
                  )}
                </svg>

                <div className="absolute w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#06b6d4]" />
              </div>

              {/* Bottom HUD Bar */}
              <div className="border-t border-cyan-500/20 pt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-theme-muted z-10">
                <div className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  <span>COORD: {radarScanResult?.geo?.latitude ? radarScanResult.geo.latitude.toFixed(2) : '0.00'}°N, {radarScanResult?.geo?.longitude ? radarScanResult.geo.longitude.toFixed(2) : '0.00'}°E</span>
                </div>
                {radarScanResult && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">Punto A: {radarScanResult.impossible_travel?.prev_point?.name || 'Referencia'}</span>
                    <span>➜</span>
                    <span className={radarScanResult.impossible_travel?.detected ? 'text-rose-400 font-bold' : 'text-cyan-400'}>
                      Punto B: {radarScanResult.geo?.location}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Telemetry & Analysis Panel (Col 2: 5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              {/* Tor Onion Circuit Visual Flow */}
              <div className="panel p-5 space-y-3 bg-gradient-to-br from-theme-panel to-slate-900 border-theme-light">
                <div className="flex items-center justify-between border-b border-theme-light pb-2.5">
                  <h3 className="text-xs font-bold text-theme-main flex items-center gap-2">
                    <span className="text-base">🧅</span>
                    {t("circuitTorTitle") || "Circuito de Anonimato Tor (Onion Routing)"}
                  </h3>
                  {radarScanResult?.is_tor ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse">
                      COINCIDENCIA EN BASE
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      NO ES NODO TOR
                    </span>
                  )}
                </div>

                {/* Circuit Nodes Horizontal Chain - Responsive */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center text-[10px]">
                  <div className="p-2 rounded-lg bg-theme-panel border border-theme-light flex flex-col items-center">
                    <Laptop className="w-4 h-4 text-theme-muted mb-1" />
                    <span className="font-semibold text-theme-main">Cliente</span>
                    <span className="text-[9px] text-theme-muted">Origen</span>
                  </div>
                  <div className="p-2 rounded-lg bg-theme-panel border border-theme-light flex flex-col items-center">
                    <Shield className="w-4 h-4 text-indigo-400 mb-1" />
                    <span className="font-semibold text-theme-main">Guard</span>
                    <span className="text-[9px] text-indigo-300/80">Capa 1</span>
                  </div>
                  <div className="p-2 rounded-lg bg-theme-panel border border-theme-light flex flex-col items-center">
                    <RefreshCw className="w-4 h-4 text-cyan-400 mb-1" />
                    <span className="font-semibold text-theme-main">Relay</span>
                    <span className="text-[9px] text-cyan-300/80">Capa 2</span>
                  </div>
                  <div className={`p-2 rounded-lg border flex flex-col items-center transition-all ${radarScanResult?.is_tor
                    ? 'bg-amber-500/20 border-amber-500/50 shadow-md shadow-amber-500/10'
                    : 'bg-theme-panel border-theme-light'
                    }`}>
                    <span className="text-sm mb-0.5">🧅</span>
                    <span className={`font-bold ${radarScanResult?.is_tor ? 'text-amber-300' : 'text-theme-main'}`}>Exit Relay</span>
                    <span className="text-[9px] font-mono text-amber-400/90">{radarScanResult?.is_tor ? 'DETECTADO' : 'Capa 3'}</span>
                  </div>
                </div>

                {radarScanResult?.is_tor && (
                  <p className="text-[11px] text-amber-300/90 bg-amber-500/10 p-2 rounded border border-amber-500/20 leading-relaxed">
                    ⚠️ <strong>Alerta CTI:</strong> La IP <code className="font-mono">{radarScanResult.target_ip}</code> es un repetidor de salida activo validado por la lista oficial de Tor Project.
                  </p>
                )}
              </div>

              {/* Haversine & Speed Meter Card */}
              {radarScanResult?.impossible_travel && (
                <div className={`panel p-5 space-y-3 border ${radarScanResult.impossible_travel.detected
                  ? 'border-rose-500/40 bg-rose-500/5'
                  : 'border-emerald-500/30 bg-emerald-500/5'
                  }`}>
                  <div className="flex items-center justify-between border-b border-theme-light/40 pb-2">
                    <span className="text-xs font-bold text-theme-main flex items-center gap-1.5">
                      <Plane className="w-4 h-4 text-rose-400" />
                      Análisis de Velocidad Geodésica (Haversine)
                    </span>
                    <span className="text-xs font-mono font-bold text-theme-main">
                      {radarScanResult.impossible_travel.distance_km.toLocaleString()} km
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded bg-theme-panel/70 border border-theme-light">
                      <span className="text-[10px] text-theme-muted block">Distancia</span>
                      <span className="text-xs font-bold font-mono text-theme-main">
                        {radarScanResult.impossible_travel.distance_km.toLocaleString()} km
                      </span>
                    </div>
                    <div className="p-2 rounded bg-theme-panel/70 border border-theme-light">
                      <span className="text-[10px] text-theme-muted block">Tiempo</span>
                      <span className="text-xs font-bold font-mono text-theme-main">
                        {radarScanResult.impossible_travel.elapsed_minutes} min
                      </span>
                    </div>
                    <div className={`p-2 rounded border ${radarScanResult.impossible_travel.detected
                      ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                      : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      }`}>
                      <span className="text-[10px] opacity-80 block">Velocidad</span>
                      <span className="text-xs font-bold font-mono">
                        {radarScanResult.impossible_travel.speed_kmh.toLocaleString()} km/h
                      </span>
                    </div>
                  </div>

                  {/* Visual Speed Threshold Comparison Bar */}
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-theme-muted mb-1">
                      <span>Límite avión (800 km/h)</span>
                      <span>Vel. Calculada: {radarScanResult.impossible_travel.speed_kmh.toLocaleString()} km/h</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${radarScanResult.impossible_travel.detected
                          ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-rose-600 animate-pulse'
                          : 'bg-emerald-500'
                          }`}
                        style={{
                          width: `${Math.min(100, (radarScanResult.impossible_travel.speed_kmh / 2400) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Forensic Execution Step Terminal */}
              <div className="panel p-5 space-y-3 bg-slate-950 font-mono text-xs border-theme-light">
                <div className="flex items-center justify-between text-[11px] text-theme-muted border-b border-slate-800 pb-2">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    TELEMETRÍA FORENSE DE ESCANEO
                  </span>
                  <span className="text-[10px] text-cyan-400">PASO {radarActiveStep}/4</span>
                </div>

                <div className="space-y-2.5">
                  {(radarScanResult?.scan_steps || []).map((step, idx) => (
                    <div key={step.id || idx} className={`p-2 rounded text-[11px] border transition-all ${radarActiveStep < idx + 1
                      ? 'opacity-40 border-slate-800 bg-slate-900/30'
                      : step.status === 'danger'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        : step.status === 'warning'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}>
                      <div className="flex items-center justify-between font-bold mb-0.5">
                        <span className="flex items-center gap-1.5">
                          {step.status === 'danger' ? '🚨' : (step.status === 'warning' ? '⚠️' : '✅')}
                          {step.label}
                        </span>
                        <span className="text-[9px] uppercase tracking-wider text-theme-muted">
                          {step.status === 'danger' ? 'ALERTA' : 'OK'}
                        </span>
                      </div>
                      <p className="text-[10px] opacity-90 leading-relaxed font-sans">{step.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LoginScreen({ onLogin, onMFAVerify, onMFAResend, t, branding, lang, setLang }) {
  const [username, setUsuario] = useState('');
  const [password, setContraseña] = useState('');
  const [error, setError] = useState('');
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loginSuccessMsg, setLoginSuccessMsg] = useState('');

  // MFA States
  const [isMFA, setIsMFA] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaEmailMasked, setMfaEmailMasked] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [mfaSuccess, setMfaSuccess] = useState('');
  const [mfaCooldown, setMfaCooldown] = useState(0);

  // Password Recovery States
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverStep, setRecoverStep] = useState(1); // 1: Request code, 2: Reset password
  const [recoverIdentifier, setRecoverIdentifier] = useState('');
  const [recoverCode, setRecoverCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoverError, setRecoverError] = useState('');
  const [recoverSuccess, setRecoverSuccess] = useState('');

  useEffect(() => {
    if (mfaCooldown <= 0) return;
    const timer = setInterval(() => {
      setMfaCooldown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [mfaCooldown]);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // Asegurar que el formulario de recuperación siempre inicie completamente limpio y sin valores precargados
  useEffect(() => {
    if (isRecovering) {
      setRecoverIdentifier('');
      setRecoverCode('');
      setNewPassword('');
      setConfirmPassword('');
      setRecoverError('');
      setRecoverSuccess('');
    }
  }, [isRecovering]);

  const submit = async (e) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;
    setLoading(true);
    setError('');
    setLoginSuccessMsg('');
    const res = await onLogin(username, password);
    if (res.mfa_required) {
      setIsMFA(true);
      setMfaToken(res.mfa_token);
      setMfaEmailMasked(res.email_masked);
      setMfaCode('');
      setMfaCooldown(60);
      setMfaError('');
      setMfaSuccess(res.message || (t("mfaSuccessSent") || 'Código enviado a tu correo.'));
    } else if (!res.success) {
      setError(res.error);
      if (res.remainingSeconds && res.remainingSeconds > 0) {
        setLockoutSeconds(res.remainingSeconds);
      }
    }
    setLoading(false);
  };

  const handleVerifyMFA = async (e) => {
    e.preventDefault();
    if (!mfaCode.trim() || mfaCode.trim().length < 6) {
      setMfaError(t("mfaInvalidCode") || 'Ingresa el código PIN completo de 6 dígitos.');
      return;
    }
    setMfaLoading(true);
    setMfaError('');
    const res = await onMFAVerify(mfaToken, mfaCode.trim());
    if (!res.success) {
      setMfaError(res.error || 'Código incorrecto o expirado.');
    }
    setMfaLoading(false);
  };

  const handleResendMFACode = async () => {
    if (mfaCooldown > 0 || mfaLoading) return;
    setMfaLoading(true);
    setMfaError('');
    setMfaSuccess('');
    const res = await onMFAResend(mfaToken);
    if (res.success) {
      setMfaSuccess(res.message || 'Nuevo código enviado con éxito.');
      setMfaCooldown(60);
      if (res.email_masked) setMfaEmailMasked(res.email_masked);
    } else {
      setMfaError(res.error || 'Error al reenviar código.');
    }
    setMfaLoading(false);
  };

  const handleRequestRecoveryCode = async (e) => {
    e.preventDefault();
    if (!recoverIdentifier.trim()) {
      setRecoverError(t("enterUserOrEmail") || 'Ingresa tu nombre de usuario o correo electrónico.');
      return;
    }
    setRecoverLoading(true);
    setRecoverError('');
    setRecoverSuccess('');
    try {
      const data = await apiFetch('/api/auth/forgot-password/', {
        method: 'POST',
        body: JSON.stringify({ identifier: recoverIdentifier.trim() })
      });
      setRecoverStep(2);
      setRecoverCode('');
      setRecoverSuccess(data.message || 'Código de recuperación enviado con éxito a tu correo electrónico.');
    } catch (err) {
      setRecoverError(err.message || 'Error al solicitar código de recuperación.');
    } finally {
      setRecoverLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!recoverCode.trim()) {
      setRecoverError(t("enterPinReceived") || 'Ingresa el código de verificación de 6 dígitos.');
      return;
    }
    const pwdErr = validatePasswordCriteria(newPassword);
    if (pwdErr) {
      setRecoverError(pwdErr);
      return;
    }
    if (newPassword !== confirmPassword) {
      setRecoverError(t("passwordsDoNotMatch") || 'Las contraseñas no coinciden.');
      return;
    }

    setRecoverLoading(true);
    setRecoverError('');
    try {
      const data = await apiFetch('/api/auth/reset-password/', {
        method: 'POST',
        body: JSON.stringify({
          identifier: recoverIdentifier.trim(),
          code: recoverCode.trim(),
          new_password: newPassword
        })
      });
      setIsRecovering(false);
      setUsuario(recoverIdentifier.trim());
      setContraseña('');
      setLoginSuccessMsg(data.message || 'Contraseña restablecida exitosamente. Inicia sesión con tu nueva contraseña.');
      setRecoverStep(1);
      setRecoverIdentifier('');
      setRecoverCode('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setRecoverError(err.message || 'Error al restablecer contraseña.');
    } finally {
      setRecoverLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-theme-main flex items-center justify-center p-4 relative overflow-hidden">
      <InteractiveBackground />
      <div className="w-full max-w-[420px] login-card-glow p-8 relative z-10">
        {/* Language switcher button in login card */}
        {setLang && (
          <div className="absolute top-4 right-4 flex items-center bg-slate-800/80 border border-slate-700/60 rounded-lg p-0.5 text-[11px] shadow-sm">
            <button
              type="button"
              onClick={() => setLang('es')}
              className={`px-2 py-0.5 rounded font-semibold transition-colors ${lang === 'es' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              ES
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2 py-0.5 rounded font-semibold transition-colors ${lang === 'en' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              EN
            </button>
          </div>
        )}

        {isMFA ? (
          /* MFA Verification View */
          <div>
            <div className="flex flex-col items-center mb-6">
              <div className="relative flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-700 shadow-lg shadow-indigo-500/30 mb-4 border border-indigo-400/30">
                <ShieldCheck className="w-8 h-8 text-indigo-100" />
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-semibold mb-2">
                <Shield className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t("adminProtected") || "Administrador Protegido"}</span>
              </div>
              <h2 className="text-xl font-bold text-theme-main tracking-tight">{t("mfaTitle") || "Verificación en Dos Pasos (MFA)"}</h2>
              <p className="text-xs text-theme-muted mt-1.5 text-center leading-relaxed">
                {t("mfaDesc") || "Ingresa el código PIN de 6 dígitos enviado a tu correo electrónico registrado."}
              </p>
            </div>

            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center gap-2.5 mb-5 text-xs text-indigo-200">
              <Mail className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="min-w-0 flex-1 truncate">
                <span className="text-theme-muted block text-[11px]">{t("codeSentTo") || "Código enviado a:"}</span>
                <span className="font-mono font-medium text-white truncate block">{mfaEmailMasked}</span>
              </div>
            </div>

            {mfaError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-theme-danger text-xs p-3 rounded-lg mb-4 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{mfaError}</span>
              </div>
            )}

            {mfaSuccess && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs p-3 rounded-lg mb-4 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{mfaSuccess}</span>
              </div>
            )}

            <form onSubmit={handleVerifyMFA} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1.5 ml-1 text-center">
                  {t("verificationCodeLabel") || "Código de Verificación (6 Dígitos)"}
                </label>
                <input
                  type="text"
                  maxLength={6}
                  name="mfa_verification_code"
                  id="mfa_verification_code"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  className="w-full input-field py-3 px-4 text-2xl font-mono text-center tracking-[0.4em] text-theme-main focus:border-indigo-500"
                />
                <p className="text-[11px] text-theme-muted mt-2 text-center">
                  {t("codeValidity") || "El código tiene una validez de 10 minutos."}
                </p>
              </div>

              <div className="pt-2 space-y-2.5">
                <button
                  type="submit"
                  disabled={mfaLoading || mfaCode.length < 6}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-lg font-medium text-sm transition-colors flex justify-center items-center gap-2 shadow-lg shadow-indigo-900/20"
                >
                  {mfaLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : (t("verifyAndAccess") || 'Verificar y Acceder al SOC')}
                </button>

                <button
                  type="button"
                  onClick={handleResendMFACode}
                  disabled={mfaCooldown > 0 || mfaLoading}
                  className="w-full py-2 bg-theme-panel hover:bg-slate-700/30 border border-theme-light disabled:opacity-50 text-xs text-theme-muted hover:text-theme-main transition-colors rounded-lg flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${mfaLoading ? 'animate-spin' : ''}`} />
                  <span>{mfaCooldown > 0 ? `${t("resendCode") || "Reenviar código"} (${mfaCooldown}s)` : (t("resendCode") || 'Reenviar código de verificación')}</span>
                </button>
              </div>
            </form>

            <button
              type="button"
              onClick={() => {
                setIsMFA(false);
                setMfaToken('');
                setMfaCode('');
                setMfaError('');
                setMfaSuccess('');
              }}
              className="mt-5 flex items-center justify-center gap-1.5 w-full text-xs text-theme-muted hover:text-theme-main transition-colors py-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> {t("backToLogin") || "Volver al inicio de sesión"}
            </button>
          </div>
        ) : !isRecovering ? (
          <>
            <div className="flex flex-col items-center mb-8">
              <div className="relative flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-700 shadow-lg shadow-indigo-500/40 mb-4 border border-indigo-400/30">
                <Shield className="w-8 h-8 text-indigo-100 absolute" strokeWidth={1.5} />
                <Activity className="w-4 h-4 text-white absolute" strokeWidth={3} />
              </div>
              <h1 className="text-2xl font-bold text-theme-main tracking-tight text-center">
                {branding?.company_name?.trim() ? `AgentSOC - ${branding.company_name.trim()}` : (branding?.welcome_text || t("welcome"))}
              </h1>
              <p className="text-sm text-theme-muted mt-2">{t("loginSub")}</p>
            </div>

            {loginSuccessMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm p-3.5 rounded-lg mb-6 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                <span>{loginSuccessMsg}</span>
              </div>
            )}

            {error && (
              <div className={`p-3.5 rounded-lg mb-6 flex items-start gap-2.5 text-sm ${lockoutSeconds > 0 ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300' : 'bg-rose-500/10 border border-rose-500/20 text-theme-danger'}`}>
                {lockoutSeconds > 0 ? (
                  <Clock className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                  <span className="block leading-relaxed">{error}</span>
                  {lockoutSeconds > 0 && (
                    <div className="mt-2.5 flex items-center gap-2 bg-rose-950/40 border border-rose-500/20 px-2.5 py-1.5 rounded text-xs text-rose-200">
                      <Clock className="w-3.5 h-3.5 text-rose-400" />
                      <span>{t("retryAvailableIn") || "Reintento disponible en:"} <strong className="font-mono text-white text-sm">{lockoutSeconds}s</strong></span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-1.5 ml-1">{t("username")}</label>
                <input
                  type="text"
                  placeholder={t("enterUsername") || (lang === 'en' ? "Enter your username" : "Ingresa tu usuario")}
                  value={username}
                  onChange={e => setUsuario(e.target.value)}
                  required
                  className="w-full input-field py-3 px-4 text-sm text-theme-main placeholder-slate-600"
                />
              </div>
              <div>
                <div className="flex justify-between mb-1.5 ml-1 mr-1">
                  <label className="block text-xs font-medium text-theme-muted">{t("password")}</label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRecovering(true);
                      setRecoverStep(1);
                      setRecoverError('');
                      setRecoverSuccess('');
                      setRecoverIdentifier('');
                      setRecoverCode('');
                      setNewPassword('');
                      setConfirmPassword('');
                    }}
                    className="text-xs text-theme-accent hover:text-indigo-300 transition-colors"
                  >
                    {t("forgotPassword") || "¿Olvidaste tu contraseña?"}
                  </button>
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setContraseña(e.target.value)}
                  required
                  className="w-full input-field py-3 px-4 text-sm text-theme-main placeholder-slate-600"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading || lockoutSeconds > 0}
                  className={`w-full py-3 rounded-lg font-medium text-sm transition-all flex justify-center items-center gap-2 shadow-lg ${lockoutSeconds > 0
                    ? 'bg-rose-950/40 text-rose-300 border border-rose-500/30 cursor-not-allowed shadow-none'
                    : 'bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-indigo-900/20'
                    }`}
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : lockoutSeconds > 0 ? (
                    <>
                      <Lock className="w-4 h-4 text-rose-400" />
                      <span>{t("tempLocked") || "Bloqueado temporalmente"} ({lockoutSeconds}s)</span>
                    </>
                  ) : (
                    t("signIn") || "Entrar al Sistema"
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          /* Password Recovery Flow */
          <div>
            <div className="flex flex-col items-center mb-6">
              <div className="relative flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-700 shadow-lg shadow-indigo-500/30 mb-4 border border-indigo-400/30">
                <Key className="w-7 h-7 text-indigo-100" />
              </div>
              <h2 className="text-xl font-bold text-theme-main tracking-tight">{t("recoverPasswordTitle") || "Recuperar Contraseña"}</h2>
              <p className="text-xs text-theme-muted mt-1.5 text-center">
                {recoverStep === 1
                  ? (t("recoverStep1Desc") || 'Ingresa tu usuario o correo para generar un código PIN temporal')
                  : (t("recoverStep2Desc") || 'Ingresa el código PIN recibido y tu nueva contraseña')}
              </p>
            </div>

            {recoverError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-theme-danger text-xs p-3 rounded-lg mb-4 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{recoverError}</span>
              </div>
            )}

            {recoverSuccess && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs p-3 rounded-lg mb-4 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{recoverSuccess}</span>
              </div>
            )}

            {recoverStep === 1 ? (
              <form onSubmit={handleRequestRecoveryCode} autoComplete="off" className="space-y-4">
                {/* Campo señuelo para absorber autofill agresivo de usuario del navegador */}
                <input type="text" name="fake_account_user_decoy" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, zIndex: -1, pointerEvents: 'none' }} autoComplete="off" />
                <div>
                  <label className="block text-xs font-medium text-theme-muted mb-1.5 ml-1">
                    {t("userOrEmail") || "Usuario o Correo Electrónico"}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      name="recovery_account_id"
                      id="recovery_account_id"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      data-lpignore="true"
                      data-form-type="other"
                      placeholder={t("enterUserOrEmail") || "Ingresa tu usuario o correo electrónico"}
                      value={recoverIdentifier}
                      onChange={e => setRecoverIdentifier(e.target.value)}
                      required
                      autoFocus
                      className="w-full input-field py-3 pl-10 pr-4 text-sm text-theme-main placeholder-slate-600"
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={recoverLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-lg font-medium text-sm transition-colors flex justify-center items-center gap-2 shadow-lg shadow-indigo-900/20"
                  >
                    {recoverLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : (t("requestCode") || 'Solicitar Código')}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} autoComplete="off" className="space-y-3.5">
                {/* Campos ocultos señuelo para absorber autofill agresivo del navegador */}
                <input type="text" name="fake_anti_autofill_username" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, zIndex: -1, pointerEvents: 'none' }} autoComplete="off" />
                <input type="password" name="fake_anti_autofill_password" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, zIndex: -1, pointerEvents: 'none' }} autoComplete="off" />

                <div className="p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-start gap-3 text-xs text-indigo-200">
                  <Mail className="w-4 h-4 mt-0.5 shrink-0 text-indigo-400" />
                  <div className="space-y-1">
                    <p className="font-semibold text-white">{t("checkEmailTelegram") || "Revisa tu correo o Telegram"}</p>
                    <p className="text-theme-muted text-[11px] leading-relaxed">
                      {t("checkEmailTelegramDesc") || "Hemos enviado un código de verificación de 6 dígitos a tu correo electrónico registrado y a tu chat de Telegram. Ingrésalo a continuación para continuar."}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-theme-muted mb-1.5 ml-1">
                    {t("verificationPin6") || "Código de 6 Dígitos recibido por correo"}
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    name="recovery_pin_code"
                    id="recovery_pin_code"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    value={recoverCode}
                    onChange={e => setRecoverCode(e.target.value.replace(/\D/g, ''))}
                    required
                    autoFocus
                    className="w-full input-field py-2.5 px-3 text-sm text-theme-main font-mono text-center tracking-widest text-xl"
                  />
                  <p className="text-[11px] text-theme-muted mt-1.5 text-center">
                    {t("codeValidity15") || "El código tiene una validez de 15 minutos."}
                  </p>
                </div>

                <SecurePasswordField
                  id="recovery_new_password"
                  name="recovery_new_password"
                  value={newPassword}
                  onChange={pwd => setNewPassword(pwd)}
                  onGenerate={pwd => setConfirmPassword(pwd)}
                  label={t("newPasswordLabel") || "Nueva Contraseña"}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                  showStrength={true}
                  suggestButton={true}
                  t={t}
                />

                <SecurePasswordField
                  id="recovery_confirm_password"
                  name="recovery_confirm_password"
                  value={confirmPassword}
                  onChange={pwd => setConfirmPassword(pwd)}
                  label={t("confirmNewPasswordLabel") || "Confirmar Nueva Contraseña"}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                  showStrength={false}
                  suggestButton={false}
                  t={t}
                />

                {confirmPassword && (
                  <div className="pt-0.5">
                    {newPassword === confirmPassword ? (
                      <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1.5 animate-fade-in bg-emerald-500/10 border border-emerald-500/20 py-1.5 px-2.5 rounded-md">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                        <span>{t("passwordsMatch") || "Las contraseñas coinciden correctamente"}</span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-rose-400 font-medium flex items-center gap-1.5 animate-fade-in bg-rose-500/10 border border-rose-500/20 py-1.5 px-2.5 rounded-md">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                        <span>{t("passwordsDoNotMatch") || "Las contraseñas no coinciden aún"}</span>
                      </p>
                    )}
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={recoverLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-lg font-medium text-sm transition-colors flex justify-center items-center gap-2 shadow-lg shadow-indigo-900/20"
                  >
                    {recoverLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : (t("resetPasswordButton") || 'Restablecer Contraseña')}
                  </button>
                </div>
              </form>
            )}

            <button
              type="button"
              onClick={() => {
                setIsRecovering(false);
                setRecoverStep(1);
                setRecoverError('');
                setRecoverSuccess('');
                setRecoverIdentifier('');
                setRecoverCode('');
                setNewPassword('');
                setConfirmPassword('');
              }}
              className="mt-5 flex items-center justify-center gap-1.5 w-full text-xs text-theme-muted hover:text-theme-main transition-colors py-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> {t("backToLogin") || "Volver al inicio de sesión"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}