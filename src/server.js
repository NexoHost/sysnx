const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4040;
const WS_PORT = process.env.WS_PORT || 4041;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.use(express.static(path.join(__dirname, '../frontend/out')));

// WebSocket server en puerto diferente
const wss = new WebSocket.Server({ port: WS_PORT });

// Ejecutar comando del sistema
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

// API Endpoints

// Procesos del sistema
app.get('/processes', async (req, res) => {
  try {
    const processes = await execCommand('ps aux --sort=-%cpu | head -20');
    res.json({ data: processes });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Obtener procesos en formato JSON
app.get('/processes/json', async (req, res) => {
  try {
    const processes = await execCommand('ps -eo pid,ppid,user,%cpu,%mem,comm --sort=-%cpu | head -21');
    const lines = processes.trim().split('\n');
    const headers = lines[0].trim().split(/\s+/);
    
    const processData = lines.slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parts[0],
        ppid: parts[1],
        user: parts[2],
        cpu: parseFloat(parts[3]) || 0,
        memory: parseFloat(parts[4]) || 0,
        command: parts.slice(5).join(' ')
      };
    });
    
    res.json({ processes: processData });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Terminar proceso por PID
app.post('/processes/kill', async (req, res) => {
  const { pid, signal = 'TERM' } = req.body;
  
  if (!pid) {
    return res.status(400).json({ error: 'PID requerido' });
  }
  
  // Validar que el PID sea numérico
  if (!/^\d+$/.test(pid)) {
    return res.status(400).json({ error: 'PID debe ser numérico' });
  }
  
  try {
    // Verificar que el proceso existe
    await execCommand(`ps -p ${pid}`);
    
    // Terminar proceso
    const killCommand = signal === 'KILL' ? `kill -9 ${pid}` : `kill -${signal} ${pid}`;
    await execCommand(killCommand);
    
    res.json({ 
      success: true, 
      message: `Proceso ${pid} terminado con señal ${signal}`,
      pid: pid
    });
  } catch (error) {
    if (error.error.includes('No such process')) {
      res.status(404).json({ error: `Proceso ${pid} no encontrado` });
    } else {
      res.status(500).json({ error: `Error terminando proceso: ${error.error}` });
    }
  }
});

// Terminar múltiples procesos
app.post('/processes/kill-multiple', async (req, res) => {
  const { pids, signal = 'TERM' } = req.body;
  
  if (!pids || !Array.isArray(pids) || pids.length === 0) {
    return res.status(400).json({ error: 'Array de PIDs requerido' });
  }
  
  const results = [];
  
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) {
      results.push({ pid, success: false, error: 'PID debe ser numérico' });
      continue;
    }
    
    try {
      await execCommand(`ps -p ${pid}`);
      const killCommand = signal === 'KILL' ? `kill -9 ${pid}` : `kill -${signal} ${pid}`;
      await execCommand(killCommand);
      results.push({ pid, success: true, message: `Proceso terminado con ${signal}` });
    } catch (error) {
      results.push({ pid, success: false, error: error.error });
    }
  }
  
  res.json({ results });
});

// Recursos del sistema
app.get('/resources', async (req, res) => {
  try {
    const [cpu, memory, disk, uptime, cores, totalRam, usedRam, totalDisk, usedDisk] = await Promise.all([
      execCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1"),
      execCommand("free -m | awk 'NR==2{printf \"%.1f\", $3*100/$2}'"),
      execCommand("df -h / | awk 'NR==2{print $5}' | cut -d'%' -f1"),
      execCommand('uptime -p'),
      execCommand('nproc'),
      execCommand("free -m | awk 'NR==2{print $2}'"),
      execCommand("free -m | awk 'NR==2{print $3}'"),
      execCommand("df -h / | awk 'NR==2{print $2}'"),
      execCommand("df -h / | awk 'NR==2{print $3}'")
    ]);
    
    res.json({
      cpu: parseFloat(cpu.trim()) || 0,
      memory: parseFloat(memory.trim()) || 0,
      disk: parseFloat(disk.trim()) || 0,
      uptime: uptime.trim(),
      hardware: {
        cores: parseInt(cores.trim()) || 0,
        totalRam: totalRam.trim(),
        usedRam: usedRam.trim(),
        totalDisk: totalDisk.trim(),
        usedDisk: usedDisk.trim()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Información de red (ifconfig)
app.get('/network', async (req, res) => {
  try {
    const network = await execCommand('ip addr show');
    res.json({ data: network });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Estadísticas de red en tiempo real
app.get('/network/stats', async (req, res) => {
  try {
    const [interfaces, bandwidth, connections] = await Promise.all([
      execCommand("cat /proc/net/dev | tail -n +3 | awk '{print $1,$2,$10}'"),
      execCommand("cat /proc/net/dev | tail -n +3 | awk '{rx+=$2; tx+=$10} END {print rx,tx}'"),
      execCommand('ss -tuln | wc -l')
    ]);
    
    // Parsear interfaces
    const interfaceData = interfaces.trim().split('\n').map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        interface: parts[0].replace(':', ''),
        rxBytes: parseInt(parts[1]) || 0,
        txBytes: parseInt(parts[2]) || 0
      };
    });
    
    const [totalRx, totalTx] = bandwidth.trim().split(' ').map(Number);
    
    res.json({
      interfaces: interfaceData,
      total: {
        rxBytes: totalRx || 0,
        txBytes: totalTx || 0,
        rxMB: ((totalRx || 0) / 1024 / 1024).toFixed(2),
        txMB: ((totalTx || 0) / 1024 / 1024).toFixed(2)
      },
      connections: parseInt(connections.trim()) || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Velocidad de red en tiempo real
app.get('/network/speed', async (req, res) => {
  try {
    // Primera medición
    const stats1 = await execCommand("cat /proc/net/dev | tail -n +3 | awk '{rx+=$2; tx+=$10} END {print rx,tx}'");
    const [rx1, tx1] = stats1.trim().split(' ').map(Number);
    
    // Esperar 1 segundo
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Segunda medición
    const stats2 = await execCommand("cat /proc/net/dev | tail -n +3 | awk '{rx+=$2; tx+=$10} END {print rx,tx}'");
    const [rx2, tx2] = stats2.trim().split(' ').map(Number);
    
    // Calcular velocidad (bytes por segundo)
    const rxSpeed = (rx2 - rx1) || 0;
    const txSpeed = (tx2 - tx1) || 0;
    
    res.json({
      download: {
        bytesPerSec: rxSpeed,
        kbps: (rxSpeed / 1024).toFixed(2),
        mbps: (rxSpeed / 1024 / 1024).toFixed(2)
      },
      upload: {
        bytesPerSec: txSpeed,
        kbps: (txSpeed / 1024).toFixed(2),
        mbps: (txSpeed / 1024 / 1024).toFixed(2)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Conexiones de red activas
app.get('/network/connections', async (req, res) => {
  try {
    const [tcp, udp, listening] = await Promise.all([
      execCommand('ss -t | grep ESTAB | wc -l'),
      execCommand('ss -u | wc -l'),
      execCommand('ss -tln | wc -l')
    ]);
    
    const activeConnections = await execCommand('ss -tuln | head -20');
    
    res.json({
      summary: {
        tcpEstablished: parseInt(tcp.trim()) || 0,
        udpConnections: parseInt(udp.trim()) || 0,
        listening: parseInt(listening.trim()) || 0
      },
      connections: activeConnections
    });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Información de cron
app.get('/cron', async (req, res) => {
  try {
    const cron = await execCommand('crontab -l 2>/dev/null || echo "No crontab found"');
    res.json({ data: cron });
  } catch (error) {
    res.status(500).json({ error: error.error });
  }
});

// Variables para mantener estado de terminal
let currentDirectory = process.env.HOME || '/home';
let sessionEnv = { ...process.env };

// Terminal ejecutar comando
app.post('/terminal', async (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Comando requerido' });
  }
  
  try {
    // Manejar comando cd especialmente
    if (command.trim().startsWith('cd ')) {
      const newPath = command.trim().substring(3).trim() || sessionEnv.HOME;
      const fs = require('fs');
      
      try {
        // Resolver ruta relativa/absoluta
        const resolvedPath = require('path').resolve(currentDirectory, newPath);
        
        // Verificar si el directorio existe
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
          currentDirectory = resolvedPath;
          sessionEnv.PWD = currentDirectory;
          res.json({ 
            output: `Directorio cambiado a: ${currentDirectory}`,
            currentDir: currentDirectory
          });
        } else {
          res.status(400).json({ error: `cd: ${newPath}: No such file or directory` });
        }
      } catch (error) {
        res.status(400).json({ error: `cd: ${newPath}: ${error.message}` });
      }
      return;
    }
    
    // Para otros comandos, ejecutar en el directorio actual
    const execOptions = {
      cwd: currentDirectory,
      env: sessionEnv,
      maxBuffer: 1024 * 1024 // 1MB buffer
    };
    
    exec(command, execOptions, (error, stdout, stderr) => {
      if (error) {
        res.json({ 
          output: stderr || error.message,
          error: true,
          currentDir: currentDirectory
        });
      } else {
        res.json({ 
          output: stdout || 'Comando ejecutado correctamente',
          currentDir: currentDirectory
        });
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para obtener directorio actual
app.get('/terminal/pwd', (req, res) => {
  res.json({ currentDir: currentDirectory });
});

// Obtener información detallada de un proceso
app.get('/processes/:pid', async (req, res) => {
  const { pid } = req.params;
  
  if (!/^\d+$/.test(pid)) {
    return res.status(400).json({ error: 'PID debe ser numérico' });
  }
  
  try {
    const [processInfo, processStatus] = await Promise.all([
      execCommand(`ps -p ${pid} -o pid,ppid,user,%cpu,%mem,etime,comm`),
      execCommand(`cat /proc/${pid}/status 2>/dev/null | head -10 || echo "No disponible"`)
    ]);
    
    res.json({ 
      info: processInfo,
      status: processStatus
    });
  } catch (error) {
    res.status(404).json({ error: `Proceso ${pid} no encontrado` });
  }
});

// WebSocket para actualizaciones en tiempo real
wss.on('connection', (ws) => {
  console.log('Cliente WebSocket conectado');
  
  const interval = setInterval(async () => {
    try {
      const resources = await Promise.all([
        execCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1"),
        execCommand("free -m | awk 'NR==2{printf \"%.1f\", $3*100/$2}'"),
        execCommand("df -h / | awk 'NR==2{print $5}' | cut -d'%' -f1")
      ]);
      
      const [cores, totalRam, usedRam] = await Promise.all([
        execCommand('nproc'),
        execCommand("free -m | awk 'NR==2{print $2}'"),
        execCommand("free -m | awk 'NR==2{print $3}'")
      ]);
      
      ws.send(JSON.stringify({
        type: 'resources',
        data: {
          cpu: parseFloat(resources[0].trim()) || 0,
          memory: parseFloat(resources[1].trim()) || 0,
          disk: parseFloat(resources[2].trim()) || 0,
          timestamp: new Date().toISOString(),
          hardware: {
            cores: parseInt(cores.trim()) || 0,
            totalRam: totalRam.trim(),
            usedRam: usedRam.trim()
          }
        }
      }));
    } catch (error) {
      console.error('Error enviando datos WebSocket:', error);
    }
  }, 2000);
  
  ws.on('close', () => {
    clearInterval(interval);
    console.log('Cliente WebSocket desconectado');
  });
});

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log(`WebSocket servidor en puerto ${WS_PORT}`);
});