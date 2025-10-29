#!/bin/bash

set -e

echo "🚀 Instalando VPS Monitor..."

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Instalar Node.js si no está instalado
if ! command -v node &> /dev/null; then
    print_status "Instalando Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Crear directorio
INSTALL_DIR="$HOME/vps-monitor"
print_status "Creando directorio: $INSTALL_DIR"

[ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/src"
cd "$INSTALL_DIR"

# Crear package.json
cat > package.json << 'EOF'
{
  "name": "vps-monitor",
  "version": "1.0.0",
  "main": "src/server.js",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "ws": "^8.14.2"
  }
}
EOF

# Crear server.js
cat > src/server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const WebSocket = require('ws');

const app = express();
const PORT = 4040;
const WS_PORT = 4041;

app.use(cors());
app.use(express.json());

const wss = new WebSocket.Server({ port: WS_PORT });

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr });
      } else {
        resolve(stdout);
      }
    });
  });
};

app.get('/processes', async (req, res) => {
  try {
    const processes = await execCommand('ps aux --sort=-%cpu | head -20');
    res.json({ data: processes });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

app.get('/resources', async (req, res) => {
  try {
    const [cpu, memory, disk, uptime] = await Promise.all([
      execCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1"),
      execCommand("free -m | awk 'NR==2{printf \"%.1f\", $3*100/$2}'"),
      execCommand("df -h / | awk 'NR==2{print $5}' | cut -d'%' -f1"),
      execCommand('uptime -p')
    ]);
    
    res.json({
      cpu: parseFloat(cpu.trim()) || 0,
      memory: parseFloat(memory.trim()) || 0,
      disk: parseFloat(disk.trim()) || 0,
      uptime: uptime.trim()
    });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

app.get('/network', async (req, res) => {
  try {
    const network = await execCommand('ip addr show');
    res.json({ data: network });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

app.get('/cron', async (req, res) => {
  try {
    const cron = await execCommand('crontab -l 2>/dev/null || echo "No crontab found"');
    res.json({ data: cron });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

app.post('/terminal', async (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Comando requerido' });
  }
  
  try {
    const result = await execCommand(command);
    res.json({ output: result });
  } catch (error) {
    res.status(500).json({ error: error.error, stderr: error.stderr });
  }
});

wss.on('connection', (ws) => {
  const interval = setInterval(async () => {
    try {
      const resources = await Promise.all([
        execCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1"),
        execCommand("free -m | awk 'NR==2{printf \"%.1f\", $3*100/$2}'"),
        execCommand("df -h / | awk 'NR==2{print $5}' | cut -d'%' -f1")
      ]);
      
      ws.send(JSON.stringify({
        type: 'resources',
        data: {
          cpu: parseFloat(resources[0].trim()) || 0,
          memory: parseFloat(resources[1].trim()) || 0,
          disk: parseFloat(resources[2].trim()) || 0,
          timestamp: new Date().toISOString()
        }
      }));
    } catch (error) {
      console.error('Error WebSocket:', error);
    }
  }, 2000);
  
  ws.on('close', () => {
    clearInterval(interval);
  });
});

app.listen(PORT, () => {
  console.log(`VPS Monitor ejecutándose en puerto ${PORT}`);
  console.log(`WebSocket en puerto ${WS_PORT}`);
});
EOF

# Instalar dependencias
print_status "Instalando dependencias..."
npm install

# Crear servicio systemd
print_status "Configurando servicio..."
sudo tee /etc/systemd/system/vps-monitor.service > /dev/null << EOF
[Unit]
Description=VPS Monitor
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Configurar firewall
if command -v ufw &> /dev/null; then
    sudo ufw allow 4040/tcp
    sudo ufw allow 4041/tcp
fi

# Iniciar servicio
sudo systemctl daemon-reload
sudo systemctl enable vps-monitor
sudo systemctl start vps-monitor

sleep 2
if sudo systemctl is-active --quiet vps-monitor; then
    IP=$(hostname -I | awk '{print $1}')
    print_status "✅ VPS Monitor API instalado!"
    echo ""
    echo "📊 API: http://$IP:4040"
    echo "🔌 WebSocket: ws://$IP:4041"
    echo ""
    echo "Endpoints disponibles:"
    echo "  GET  /resources  - Recursos del sistema"
    echo "  GET  /processes  - Lista de procesos"
    echo "  GET  /network    - Información de red"
    echo "  GET  /cron       - Tareas cron"
    echo "  POST /terminal   - Ejecutar comandos"
else
    print_error "❌ Error en instalación"
    sudo systemctl status vps-monitor
    exit 1
fi