import React, { useState, useEffect } from 'react';
import { Shield, Server, Users, Activity, LogOut, Search, AlertTriangle, Lock, Unlock, Plus, RefreshCw, Terminal, Eye } from 'lucide-react';

// ============================================================================
// MODO PREVIEW: Cambia a 'false' para conectar al Backend Django real
// ============================================================================
const SERVER_NAME = "SOC-NODE-01";
const USE_MOCK = true; 
const API_BASE_URL = 'http://localhost:8000';

const mockLogs = [
  { id: 1, server: 'IP-172-31-6-18', criticality: 'ALTA', message: 'Fallo en la conexión con Systems Manager debido a la falta de rol de instancia EC2.', timestamp: '2026-06-29 10:45:00', evidence: 'Failed to connect to SSM agent' },
  { id: 2, server: 'NGINX-FRONT', criticality: 'CRITICA', message: 'Ataque de fuerza bruta detectado en endpoint de autenticación.', timestamp: '2026-06-29 10:40:00', evidence: 'POST /login 401 Unauthorized (150 attempts)' },
  { id: 3, server: 'DB-MAIN', criticality: 'MEDIA', message: 'Errores en el servidor relacionados con tipos de datos y longitud de valores.', timestamp: '2026-06-29 10:15:00', evidence: 'Data too long for column "username" at row 1' },
  { id: 4, server: 'IP-172-31-6-18', criticality: 'INFO', message: 'Reinicio programado del servicio de monitoreo completado.', timestamp: '2026-06-29 09:00:00', evidence: 'systemd: Started SOC Agent.' }
];

const mockUsers = [
  { id: 1, username: 'admin', role: 'admin', is_locked: false },
  { id: 2, username: 'operador_noche', role: 'read', is_locked: true },
  { id: 3, username: 'devops_lead', role: 'write', is_locked: false },
];

const mockAgents = [
  { id: 1, name: 'IP-172-31-6-18', ip_address: '172.31.6.18', status: 'active', is_truly_active: true },
  { id: 2, name: 'NGINX-FRONT', ip_address: '192.168.1.50', status: 'active', is_truly_active: true },
  { id: 3, name: 'DB-MAIN', ip_address: '10.0.0.5', status: 'maintenance', is_truly_active: false }
];

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const formattedStr = typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T') 
      ? dateStr.replace(' ', 'T') 
      : dateStr;
    const d = new Date(formattedStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleString(undefined, { hour12: false });
  } catch (e) {
    return dateStr;
  }
};

export default function App() {
  const [token, setToken] = useState(null);
  const [role, setRole] = useState(null);
  const [currentView, setCurrentView] = useState('dashboard');

  const handleLogin = async (username, password) => {
    if (USE_MOCK) {
      if (username && password) {
        setToken('mock-jwt-token');
        setRole('admin');
        return { success: true };
      }
      return { success: false, error: 'Credenciales inválidas.' };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.access_token) {
        setToken(data.access_token);
        setRole(data.role || 'read');
        return { success: true };
      }
      return { success: false, error: data.detail || 'Error de autenticación' };
    } catch (e) {
      return { success: false, error: 'Error de conexión con el servidor SOC.' };
    }
  };

  const handleLogout = () => {
    setToken(null);
    setRole(null);
    setCurrentView('dashboard');
  };

  if (!token) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className="flex h-screen bg-[#050505] text-zinc-400 font-mono selection:bg-emerald-500/30 overflow-hidden">
      <style>{`
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        .cyber-grid {
          background-image: linear-gradient(to right, #ffffff03 1px, transparent 1px),
                            linear-gradient(to bottom, #ffffff03 1px, transparent 1px);
          background-size: 32px 32px;
        }
        .glow-emerald { text-shadow: 0 0 10px rgba(16,185,129,0.5); }
        .glow-red { text-shadow: 0 0 10px rgba(239,68,68,0.5); }
      `}</style>

      {/* Scanline Effect */}
      <div className="fixed inset-0 pointer-events-none z-[100] opacity-[0.05] overflow-hidden">
        <div className="w-full h-px bg-emerald-500 animate-[scanline_6s_linear_infinite]"></div>
      </div>

      <Sidebar view={currentView} setView={setCurrentView} onLogout={handleLogout} role={role} />

      <main className="flex-1 p-8 overflow-y-auto relative cyber-grid">
        <header className="mb-10 flex items-center justify-between border-b border-zinc-900 pb-6">
          <div className="relative">
            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-emerald-500"></div>
            <h1 className="text-2xl font-black text-white tracking-widest uppercase italic glow-emerald">
              AGENT_SOC <span className="text-emerald-500">v2.0</span>
            </h1>
            <p className="text-[10px] text-zinc-600 mt-1 uppercase tracking-[0.3em] font-bold">
              Host: {SERVER_NAME} | Status: Online | Role: {role}
            </p>
          </div>
          <div className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 px-5 py-2">
             <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
             </span>
             <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">SYSTEM_LINK_ACTIVE</span>
          </div>
        </header>
        <div className="relative z-10">
          {currentView === 'dashboard' && <LogsView token={token} role={role} />}
          {currentView === 'agents' && <AgentsView token={token} role={role} />}
          {currentView === 'users' && <UsersView token={token} role={role} />}
        </div>
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await onLogin(username, password);
    if (!res.success) setError(res.error);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-mono">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 shadow-[0_0_50px_rgba(16,185,129,0.1)]">
        <div className="flex justify-center mb-6">
            <Shield className="w-12 h-12 text-emerald-500 animate-pulse" />
        </div>
        <h2 className="text-xl font-black text-center text-white mb-2 tracking-[0.3em] uppercase">ACCESO_RESTRINGIDO</h2>
        <p className="text-zinc-500 text-center text-[10px] mb-8 tracking-widest uppercase">Identificación de personal SOC requerida</p>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] p-3 mb-6 uppercase tracking-widest">
            ERROR: {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-zinc-500 mb-2 uppercase tracking-widest italic">// USER_ID</label>
            <input type="text" className="w-full bg-black border border-zinc-800 rounded-none px-4 py-3 text-emerald-500 focus:outline-none focus:border-emerald-500 transition-all font-mono" value={username} onChange={e => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="block text-[10px] font-black text-zinc-500 mb-2 uppercase tracking-widest italic">// PASSWORD_KEY</label>
            <input type="password" className="w-full bg-black border border-zinc-800 rounded-none px-4 py-3 text-emerald-500 focus:outline-none focus:border-emerald-500 transition-all font-mono" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-black font-black py-4 uppercase tracking-[0.2em] transition-all active:scale-95 flex justify-center items-center gap-2">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Ejecutar_Login'}
          </button>
        </form>
        {USE_MOCK && (
          <div className="mt-6 p-3 bg-black border border-zinc-800 text-center">
            <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest">Debug Mode Activo</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Sidebar({ view, setView, onLogout, role }) {
  const menu = [
    { id: 'dashboard', icon: Activity, label: 'Logs y Alertas' },
    { id: 'agents', icon: Server, label: 'Nodos de Red' },
  ];

  if (role === 'admin') {
    menu.push({ id: 'users', icon: Users, label: 'Control de Acceso' });
  }

  return (
    <div className="w-72 bg-black border-r border-zinc-900 flex flex-col z-10">
      <div className="p-8 flex items-center gap-3 border-b border-zinc-900">
        <Shield className="w-6 h-6 text-emerald-500" />
        <span className="text-lg font-black text-white tracking-tighter italic uppercase">SOC_AGENT</span>
      </div>

      <nav className="flex-1 p-6 space-y-2">
        {menu.map(item => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button key={item.id} onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-4 transition-all duration-300 border-l-2 ${
                active ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500 glow-emerald' : 'text-zinc-600 border-transparent hover:text-zinc-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[11px] font-black uppercase tracking-widest">{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="p-6">
        <button onClick={onLogout} className="w-full py-4 text-[10px] font-black text-zinc-600 hover:text-red-500 hover:bg-red-500/5 border border-zinc-900 hover:border-red-500/30 transition-all uppercase tracking-widest font-mono">
          Logout_Session
        </button>
      </div>
    </div>
  );
}

function LogsView({ token, role }) {
  const [logs, setLogs] = useState(USE_MOCK ? mockLogs : []);
  const [filterServer, setFilterServer] = useState('');
  const [filterCrit, setFilterCrit] = useState('');
  const [loading, setLoading] = useState(!USE_MOCK);

  useEffect(() => {
    if (USE_MOCK) return;

    const fetchLogs = async () => {
      setLoading(true);
      try {
        const query = filterCrit ? `?criticidad=${filterCrit}` : '';
        const res = await fetch(`${API_BASE_URL}/logs/${query}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const data = await res.json();
          setLogs(Array.isArray(data) ? data : (data?.results || []));
        }
      } catch (e) {
        console.error("Error fetching logs:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [token, filterCrit]);

  const getCritStyle = (crit) => {
    const styles = {
      'CRITICA': 'bg-rose-500/10 text-rose-500 border-rose-500/40',
      'ALTA': 'bg-orange-500/10 text-orange-500 border-orange-500/40',
      'MEDIA': 'bg-amber-500/10 text-amber-500 border-amber-500/40',
      'BAJA': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/40',
      'INFO': 'bg-blue-500/10 text-blue-500 border-blue-500/40'
    };
    return styles[crit] || styles['INFO'];
  };

  const filteredLogs = logs.filter(l =>
    (filterServer === '' || (l.server && l.server.toLowerCase().includes(filterServer.toLowerCase()))) &&
    (filterCrit === '' || l.criticality === filterCrit)
  );

  const AlertBadge = ({ level }) => (
    <span className={`px-2 py-1 rounded-none text-[9px] font-black tracking-widest border ${getCritStyle(level)}`}>
      {level}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-4 p-4 bg-zinc-950 border border-zinc-900">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" />
          <input
            type="text"
            placeholder="FILTRAR_NODO..."
            className="w-full bg-black border border-zinc-800 p-3 pl-12 text-[11px] text-emerald-500 outline-none focus:border-emerald-500 transition-all font-mono"
            value={filterServer}
            onChange={e => setFilterServer(e.target.value)}
          />
        </div>
        <select
          className="bg-black border border-zinc-800 p-3 text-[10px] font-black text-zinc-500 uppercase tracking-widest outline-none focus:border-emerald-500 cursor-pointer"
          value={filterCrit} onChange={e => setFilterCrit(e.target.value)}
        >
          <option value="">TODAS_LAS_ALERTAS</option>
          <option value="CRITICA">CRITICA</option>
          <option value="ALTA">ALTA</option>
          <option value="MEDIA">MEDIA</option>
          <option value="BAJA">BAJA</option>
          <option value="INFO">INFO</option>
        </select>
      </div>

      <div className="bg-zinc-950 border border-zinc-900 shadow-2xl">
        <table className="w-full text-left font-mono">
          <thead className="bg-black border-b border-zinc-900">
            <tr>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">TIMESTAMP</th>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">SERVICE_NODE</th>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">SEVERITY</th>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">THREAT_ANALYSIS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {filteredLogs.map(log => (
              <tr key={log.id} className="hover:bg-zinc-900/40 transition-colors">
                <td className="p-4 text-[11px] text-zinc-500">{formatDate(log.timestamp)}</td>
                <td className="p-4 text-[11px] font-bold text-zinc-300">{log.server}</td>
                <td className="p-4"><AlertBadge level={log.criticality} /></td>
                <td className="p-4 text-[11px] text-zinc-400">{log.message}</td>
              </tr>
            ))}
            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan="4" className="p-8 text-center text-zinc-600 text-xs uppercase tracking-widest">
                  {loading ? 'Cargando eventos...' : 'No se encontraron registros'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgentsView({ token, role }) {
  const [agents, setAgents] = useState(USE_MOCK ? mockAgents : []);
  const [loading, setLoading] = useState(!USE_MOCK);

  const fetchAgents = async () => {
    if (USE_MOCK) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents/`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setAgents(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, [token]);

  const handleRegisterNode = async () => {
    const name = prompt("Nombre del nuevo Nodo (ej: DB-MAIN):");
    if (!name) return;
    const ip_address = prompt("Dirección IP del Nodo:");
    if (!ip_address) return;

    if (USE_MOCK) {
      const newAgent = { id: Date.now(), name, ip_address, status: 'active', is_truly_active: true };
      setAgents(prev => [...prev, newAgent]);
      alert("✅ Nodo registrado en modo mock.");
      return;
    }

    const api_key = "key_" + Math.random().toString(36).substring(2, 15);
    try {
      const res = await fetch(`${API_BASE_URL}/agents/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, ip_address, api_key, status: 'active' })
      });
      if (res.ok) {
        alert("✅ Nodo registrado exitosamente. API Key: " + api_key);
        fetchAgents();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert("Error al registrar nodo: " + (errData.detail || res.statusText));
      }
    } catch (e) {
      alert("Error de conexión: " + e.message);
    }
  };

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-xl font-bold text-white">Inventario de Nodos</h2>
          <p className="text-sm text-zinc-500 mt-1 uppercase tracking-widest text-[10px]">Servidores actualmente monitoreados por el Agente SOC</p>
        </div>
        {(role === 'admin' || role === 'write') && (
          <button onClick={handleRegisterNode} className="bg-emerald-600 hover:bg-emerald-500 text-black px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2">
            <Plus className="w-3 h-3" /> Registrar_Nodo
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {agents.map(agent => (
          <div key={agent.id} className="bg-zinc-950 border border-zinc-900 p-6 relative overflow-hidden group hover:border-emerald-500/50 transition-all">
            <div className={`absolute top-0 left-0 w-full h-[1px] ${
              agent.status === 'active' ? 'bg-emerald-500' :
              agent.status === 'maintenance' ? 'bg-amber-500' : 'bg-rose-500'
            }`}></div>

            <div className="flex justify-between items-start mb-6">
              <div className="bg-black p-3 border border-zinc-800">
                <Server className={`w-5 h-5 ${
                  agent.status === 'active' ? 'text-emerald-500' :
                  agent.status === 'maintenance' ? 'text-amber-500' : 'text-rose-500'
                }`} />
              </div>
              <span className={`text-[8px] font-black tracking-[0.2em] px-2 py-1 border ${
                agent.status === 'active' ? 'text-emerald-500 border-emerald-500/30' :
                agent.status === 'maintenance' ? 'text-amber-500 border-amber-500/30' :
                'text-rose-500 border-rose-500/30'
              }`}>
                {(agent.status || 'OFFLINE').toUpperCase()}
              </span>
            </div>

            <h3 className="text-sm font-black text-white mb-2 uppercase tracking-tighter">{agent.name}</h3>
            <code className="text-[10px] text-emerald-500/70 block bg-black p-2 border border-zinc-900">
              ADDR: {agent.ip_address}
            </code>
          </div>
        ))}
        {agents.length === 0 && (
          <div className="col-span-full text-center py-10 text-zinc-600 text-xs uppercase tracking-widest">
            {loading ? 'Cargando nodos...' : 'No se encontraron nodos'}
          </div>
        )}
      </div>
    </div>
  );
}

function UsersView({ token, role }) {
  const [users, setUsers] = useState(USE_MOCK ? mockUsers : []);
  const [loading, setLoading] = useState(!USE_MOCK);

  const fetchUsers = async () => {
    if (USE_MOCK) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === 'admin') fetchUsers();
  }, [token, role]);

  const handleCreateUser = async () => {
    const username = prompt("Nombre de usuario:");
    if (!username) return;
    const password = prompt("Contraseña:");
    if (!password) return;
    const roleInput = prompt("Rol (admin, write, read):", "read");
    if (!['admin', 'write', 'read'].includes(roleInput)) return alert("Rol no válido.");

    if (USE_MOCK) {
      const newUser = { id: Date.now(), username, role: roleInput, is_locked: false };
      setUsers(prev => [...prev, newUser]);
      alert("✅ Usuario creado en modo mock.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/users/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username, password, role_input: roleInput })
      });
      if (res.ok) {
        alert("✅ Usuario creado exitosamente.");
        fetchUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        alert("Error al crear usuario: " + (data.detail || res.statusText));
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  if (role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-64 bg-zinc-950 border border-zinc-900 animate-in fade-in">
        <Lock className="w-12 h-12 text-rose-500 mb-4 opacity-50" />
        <h2 className="text-sm font-black text-white mb-2 uppercase tracking-[0.3em]">ACCESS_DENIED</h2>
        <p className="text-zinc-600 text-[10px] uppercase tracking-widest text-center max-w-xs">
          NIVEL DE AUTORIZACIÓN [{role || 'INVITADO'}] INSUFICIENTE PARA IAM_INTERFACE.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-xl font-bold text-white tracking-widest uppercase italic">CONTROL_ACCESO</h2>
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-1">Gestión de identidades y privilegios</p>
        </div>
        <button onClick={handleCreateUser} className="bg-emerald-600 hover:bg-emerald-500 text-black px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-colors">
          Nuevo_Operador
        </button>
      </div>

      <div className="bg-zinc-950 border border-zinc-900">
        <table className="w-full text-left font-mono">
          <thead className="bg-black border-b border-zinc-900">
            <tr>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">UID</th>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">USERNAME</th>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">SYSTEM_ROLE</th>
              <th className="p-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">STATUS_OK</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-zinc-900/40">
                <td className="p-4 text-[11px] text-zinc-600">#{u.id.toString().padStart(4, '0')}</td>
                <td className="p-4 text-[11px] text-zinc-200 font-bold">{u.username}</td>
                <td className="p-4">
                  <span className="text-[10px] px-2 py-1 bg-black border border-zinc-800 text-emerald-500 font-black">
                    {(u.role || 'read').toUpperCase()}
                  </span>
                </td>
                <td className="p-4">
                  {u.is_locked ?
                    <span className="text-[9px] text-rose-500 flex items-center gap-2 font-black uppercase tracking-widest">
                       <Lock className="w-3 h-3"/> Locked
                    </span> :
                    <span className="text-[9px] text-emerald-500 flex items-center gap-2 font-black uppercase tracking-widest">
                       <Unlock className="w-3 h-3"/> Authorized
                    </span>
                  }
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan="4" className="p-8 text-center text-zinc-600 text-xs uppercase tracking-widest">
                  {loading ? 'Cargando usuarios...' : 'No hay usuarios registrados'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


