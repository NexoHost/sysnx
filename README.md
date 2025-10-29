# Synx – VPS Resource Monitor

**Synx** es un software avanzado de monitorización de VPS que ofrece visibilidad completa del estado y rendimiento de tus servidores virtuales. Permite supervisar en tiempo real CPU, RAM, almacenamiento y red, así como métricas de procesos y servicios críticos, todo directamente en un frontend interactivo.

---
![Imagen1](https://github.com/NexoHost/sysnx/blob/main/images/image1.png?raw=true)
![Imagen1](https://github.com/NexoHost/sysnx/blob/main/images/image2.png?raw=true)
![Imagen1](https://github.com/NexoHost/sysnx/blob/main/images/image3.png?raw=true)
![Imagen1](https://github.com/NexoHost/sysnx/blob/main/images/image4.png?raw=true)

## Características principales

- **Monitorización en tiempo real**: Visualiza al instante CPU, RAM, disco y red mediante WebSocket.  
- **API REST completa**: Consulta métricas desde otras aplicaciones o scripts sin necesidad de almacenamiento.  
- **Alertas instantáneas**: Recibe notificaciones inmediatas según el uso de recursos.  
- **Frontend intuitivo**: Panel interactivo con gráficos y estadísticas en tiempo real.  
- **Compatibilidad multiplataforma**: Funciona en Linux y Windows.  
- **Ligero y eficiente**: No requiere base de datos; todo se muestra en tiempo real.  

---

## Cómo funciona

Synx se basa en una arquitectura cliente-servidor ligera:

1. **Backend siempre encendido**: Recolecta métricas en tiempo real del VPS.  
2. **API REST**: Permite acceder a métricas desde scripts o herramientas externas.  
3. **WebSocket**: Envía actualizaciones instantáneas al frontend para reflejar cambios en tiempo real.  
4. **Frontend interactivo**: Visualiza métricas, gráficos y alertas sin almacenar datos históricos.

> ⚠️ Nota: Para que Synx funcione correctamente, el backend debe permanecer encendido continuamente.

---

## Instalación

```bash
Descarga el archivo y usa:
mdkir NexoHost
cd NexoHost
npm install
node src/server.js
